"""
Ingestion pipeline: PDF -> page images -> ColPali multivectors -> Qdrant,
with page images uploaded to Vercel Blob for the vision model to read later.

Robust + resumable:
  - Point IDs are deterministic per (book, page) -> re-running never duplicates
    and skips pages already indexed (so a crash can just be re-run).
  - Transient errors (e.g. Qdrant 502, Modal/Blob hiccups) are retried with
    exponential backoff instead of killing the whole run.

Usage:
    pip install -r requirements.txt
    python ingest.py ./pdfs            # folder of .pdf files
    python ingest.py ./pdfs/book.pdf   # or a single file
"""
import base64
import sys
import time
import uuid
from pathlib import Path

import fitz  # PyMuPDF
import requests
import vercel_blob

import config


def iter_pdf_paths(arg: str):
    p = Path(arg)
    if p.is_dir():
        yield from sorted(p.glob("*.pdf"))
    elif p.suffix.lower() == ".pdf":
        yield p
    else:
        raise SystemExit(f"Not a PDF or folder: {arg}")


def point_id(book: str, page: int) -> str:
    """Deterministic id per (book, page) -> idempotent upserts + resume."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"{book}|{page}"))


def with_retry(fn, *, what: str, tries: int = 4, base: float = 2.0):
    """Run fn(), retrying transient failures with exponential backoff."""
    for attempt in range(1, tries + 1):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001 - we want to retry anything transient
            if attempt == tries:
                raise
            wait = base * (2 ** (attempt - 1))
            print(f"  [retry] {what} failed ({e}); retry {attempt}/{tries - 1} in {wait:.0f}s")
            time.sleep(wait)


def render_pages(pdf_path: Path):
    """Yield (page_number, png_bytes) for each page, up to MAX_PAGES_PER_PDF."""
    doc = fitz.open(pdf_path)
    zoom = config.RENDER_DPI / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    cap = config.MAX_PAGES_PER_PDF
    for i, page in enumerate(doc):
        if cap and i >= cap:
            break
        pix = page.get_pixmap(matrix=matrix)
        yield i + 1, pix.tobytes("png")
    doc.close()


def embed_images(png_list: list[bytes]) -> list[list[list[float]]]:
    images_b64 = [base64.b64encode(b).decode() for b in png_list]
    resp = requests.post(
        config.MODAL_EMBED_IMAGES_URL,
        json={"images_b64": images_b64},
        timeout=300,
    )
    resp.raise_for_status()
    return resp.json()["embeddings"]


def upload_image(book: str, page: int, png: bytes) -> str:
    """Upload a page PNG to Vercel Blob; return its public URL.

    Isolated on purpose: if you'd rather use Cloudflare R2 / Supabase Storage,
    swap only this function — it must return a public image URL.
    """
    safe_book = book.replace(" ", "_")
    path = f"pages/{safe_book}/p{page:04d}.png"
    res = vercel_blob.put(
        path, png, {"addRandomSuffix": "false", "allowOverwrite": "true"}
    )
    return res["url"]


def chunked(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def fetch_existing_ids(client) -> set[str]:
    """All point IDs already in the collection (for resume / skip)."""
    ids: set[str] = set()
    offset = None
    while True:
        points, offset = client.scroll(
            collection_name=config.QDRANT_COLLECTION,
            limit=1000,
            offset=offset,
            with_payload=False,
            with_vectors=False,
        )
        ids.update(str(p.id) for p in points)
        if offset is None:
            break
    return ids


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: python ingest.py <pdf-or-folder>")

    from qdrant_client import models

    client = config.qdrant_client()
    config.ensure_collection(client)
    existing = fetch_existing_ids(client)
    if existing:
        print(f"{len(existing)} pages already indexed — they will be skipped.")

    for pdf_path in iter_pdf_paths(sys.argv[1]):
        book = pdf_path.stem
        print(f"\n=== {book} ===")
        pages = list(render_pages(pdf_path))
        todo = [(n, png) for (n, png) in pages if point_id(book, n) not in existing]
        print(f"  {len(pages)} pages rendered · {len(todo)} to ingest · "
              f"{len(pages) - len(todo)} already present")

        for batch in chunked(todo, config.EMBED_BATCH):
            nums = [n for n, _ in batch]
            pngs = [b for _, b in batch]

            embeddings = with_retry(lambda: embed_images(pngs), what="Modal embed")

            points = []
            for (page_no, png), emb in zip(batch, embeddings):
                url = with_retry(
                    lambda p=png, n=page_no: upload_image(book, n, p),
                    what="Blob upload",
                )
                points.append(
                    models.PointStruct(
                        id=point_id(book, page_no),
                        vector=emb,  # 2D list = multivector
                        payload={"book": book, "page": page_no, "image_url": url},
                    )
                )
            with_retry(
                lambda pts=points: client.upsert(
                    collection_name=config.QDRANT_COLLECTION, points=pts
                ),
                what="Qdrant upsert",
            )
            print(f"  upserted pages {nums}")

    print("\nDone. Corpus indexed in Qdrant.")


if __name__ == "__main__":
    main()

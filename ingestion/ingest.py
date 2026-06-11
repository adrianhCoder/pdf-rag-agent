"""
Ingestion pipeline: PDF -> per-page (text + image).
  - text  -> Gemini text embedding  -> Qdrant (single vector, for retrieval)
  - image -> Vercel Blob (public URL, read later by the vision model to answer)

Retrieval is by TEXT (precise for labelled pages); answering is by VISION
(Gemini reads the page image, figures included). Robust + resumable:
deterministic ids per (book, page) and retry-with-backoff on transient errors.

Usage:
    pip install -r requirements.txt
    python ingest.py ./pdfs            # folder of .pdf files
    python ingest.py ./pdfs/book.pdf   # or a single file
"""
import sys
import time
import uuid
from pathlib import Path

import fitz  # PyMuPDF
import requests
import vercel_blob

import config

EMBED_URL = (
    f"https://generativelanguage.googleapis.com/v1beta/models/{config.EMBED_MODEL}:embedContent"
)


def iter_pdf_paths(arg: str):
    p = Path(arg)
    if p.is_dir():
        yield from sorted(p.glob("*.pdf"))
    elif p.suffix.lower() == ".pdf":
        yield p
    else:
        raise SystemExit(f"Not a PDF or folder: {arg}")


def point_id(book: str, page: int) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"{book}|{page}"))


def with_retry(fn, *, what: str, tries: int = 4, base: float = 2.0):
    for attempt in range(1, tries + 1):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001
            if attempt == tries:
                raise
            wait = base * (2 ** (attempt - 1))
            print(f"  [retry] {what} failed ({e}); retry {attempt}/{tries - 1} in {wait:.0f}s")
            time.sleep(wait)


def render_pages(pdf_path: Path):
    """Yield (page_number, png_bytes, text) up to MAX_PAGES_PER_PDF."""
    doc = fitz.open(pdf_path)
    zoom = config.RENDER_DPI / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    cap = config.MAX_PAGES_PER_PDF
    for i, page in enumerate(doc):
        if cap and i >= cap:
            break
        pix = page.get_pixmap(matrix=matrix)
        yield i + 1, pix.tobytes("png"), page.get_text()
    doc.close()


def embed_text(text: str, task_type: str = "RETRIEVAL_DOCUMENT") -> list[float]:
    body = {
        "model": f"models/{config.EMBED_MODEL}",
        "content": {"parts": [{"text": text.strip() or " "}]},
        "taskType": task_type,
        "outputDimensionality": config.VECTOR_DIM,
    }
    resp = requests.post(
        EMBED_URL,
        headers={"x-goog-api-key": config.GOOGLE_API_KEY, "Content-Type": "application/json"},
        json=body,
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["embedding"]["values"]


def upload_image(book: str, page: int, png: bytes) -> str:
    """Upload a page PNG to Vercel Blob; return its public URL."""
    safe_book = book.replace(" ", "_")
    path = f"pages/{safe_book}/p{page:04d}.png"
    res = vercel_blob.put(path, png, {"addRandomSuffix": "false", "allowOverwrite": "true"})
    return res["url"]


def fetch_existing_ids(client) -> set[str]:
    ids: set[str] = set()
    offset = None
    while True:
        points, offset = client.scroll(
            collection_name=config.QDRANT_COLLECTION,
            limit=1000, offset=offset, with_payload=False, with_vectors=False,
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
        pending: list = []

        def flush():
            if not pending:
                return
            with_retry(
                lambda pts=list(pending): client.upsert(
                    collection_name=config.QDRANT_COLLECTION, points=pts
                ),
                what="Qdrant upsert",
            )
            print(f"  upserted {len(pending)} pages (through p{pending[-1].payload['page']})")
            pending.clear()

        for page_no, png, text in render_pages(pdf_path):
            if point_id(book, page_no) in existing:
                continue
            # Prepend the book title so sparse/image-only pages still carry context.
            doc_text = f"{book}\n\n{text}"
            emb = with_retry(lambda t=doc_text: embed_text(t), what="Gemini embed")
            url = with_retry(lambda p=png, n=page_no: upload_image(book, n, p), what="Blob upload")
            pending.append(
                models.PointStruct(
                    id=point_id(book, page_no),
                    vector=emb,
                    payload={"book": book, "page": page_no, "image_url": url},
                )
            )
            if len(pending) >= config.UPSERT_BATCH:
                flush()
        flush()

    print("\nDone. Corpus indexed in Qdrant.")


if __name__ == "__main__":
    main()

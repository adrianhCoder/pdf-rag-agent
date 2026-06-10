"""
Ingestion pipeline: PDF -> page images -> ColPali multivectors -> Qdrant,
with page images uploaded to Vercel Blob for the vision model to read later.

Usage:
    pip install -r requirements.txt
    python ingest.py ./pdfs            # folder of .pdf files
    python ingest.py ./pdfs/book.pdf   # or a single file
"""
import base64
import io
import sys
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
    try:
        res = vercel_blob.put(path, png, {"addRandomSuffix": "false"})
        return res["url"]
    except Exception as e:
        raise RuntimeError(
            f"Vercel Blob upload failed for '{path}': {e}\n"
            "Check BLOB_READ_WRITE_TOKEN in .env, or swap upload_image() for "
            "your own storage provider (must return a public URL)."
        ) from e


def chunked(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: python ingest.py <pdf-or-folder>")

    from qdrant_client import models

    client = config.qdrant_client()
    config.ensure_collection(client)

    for pdf_path in iter_pdf_paths(sys.argv[1]):
        book = pdf_path.stem
        print(f"\n=== {book} ===")
        pages = list(render_pages(pdf_path))
        print(f"  {len(pages)} pages rendered")

        for batch in chunked(pages, config.EMBED_BATCH):
            nums = [n for n, _ in batch]
            pngs = [b for _, b in batch]
            embeddings = embed_images(pngs)

            points = []
            for (page_no, png), emb in zip(batch, embeddings):
                url = upload_image(book, page_no, png)
                points.append(
                    models.PointStruct(
                        id=str(uuid.uuid4()),
                        vector=emb,  # 2D list = multivector
                        payload={"book": book, "page": page_no, "image_url": url},
                    )
                )
            client.upsert(collection_name=config.QDRANT_COLLECTION, points=points)
            print(f"  upserted pages {nums}")

    print("\nDone. Corpus indexed in Qdrant.")


if __name__ == "__main__":
    main()

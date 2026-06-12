"""Shared config + clients for the ingestion pipeline."""
import os

from dotenv import load_dotenv

# Load .env from the project root (one level up from ingestion/).
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

QDRANT_URL = os.environ["QDRANT_URL"]
QDRANT_API_KEY = os.environ["QDRANT_API_KEY"]
QDRANT_COLLECTION = os.environ.get("QDRANT_COLLECTION", "visual_rag_pages")
GOOGLE_API_KEY = os.environ["GOOGLE_GENERATIVE_AI_API_KEY"]

# Gemini embeddings -> single vector per page (768-dim via Matryoshka).
EMBED_MODEL = "gemini-embedding-001"
VECTOR_DIM = 768

# Render + batching knobs.
RENDER_DPI = 150
UPSERT_BATCH = 16  # points per Qdrant upsert

# Cap pages per PDF. 0 = no cap (default). Override via env.
# Note: with single-vector text embeddings, one page = ~3 KB, so the Qdrant
# free tier (1 GiB RAM) fits ~100k pages — the cap is no longer needed. It was
# only relevant in the ColPali era (multivector: hundreds of vectors per page).
MAX_PAGES_PER_PDF = int(os.environ.get("MAX_PAGES_PER_PDF", "0"))


def qdrant_client():
    from qdrant_client import QdrantClient

    return QdrantClient(
        url=QDRANT_URL, api_key=QDRANT_API_KEY, timeout=120, check_compatibility=False
    )


def ensure_collection(client):
    """Create the single-vector collection (cosine) if missing."""
    from qdrant_client import models

    if client.collection_exists(QDRANT_COLLECTION):
        return
    client.create_collection(
        collection_name=QDRANT_COLLECTION,
        vectors_config=models.VectorParams(
            size=VECTOR_DIM,
            distance=models.Distance.COSINE,
        ),
    )
    print(f"Created Qdrant collection '{QDRANT_COLLECTION}'.")

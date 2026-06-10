"""Shared config + clients for the ingestion pipeline."""
import os

from dotenv import load_dotenv

# Load .env from the project root (one level up from ingestion/).
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

QDRANT_URL = os.environ["QDRANT_URL"]
QDRANT_API_KEY = os.environ["QDRANT_API_KEY"]
QDRANT_COLLECTION = os.environ.get("QDRANT_COLLECTION", "visual_rag_pages")
MODAL_EMBED_IMAGES_URL = os.environ["MODAL_EMBED_IMAGES_URL"]

# ColQwen2 produces 128-dim token vectors (one set per page = multivector).
VECTOR_DIM = 128

# Render + batching knobs.
RENDER_DPI = 150
EMBED_BATCH = 2  # pages per Modal call (multivectors are large; keep small)

# Cap pages per PDF so you can drop full OpenStax books without trimming them by
# hand. Protects the Qdrant free tier (1 GiB RAM) and Modal GPU cost. 0 = no cap.
# Override per run with the MAX_PAGES_PER_PDF env var.
MAX_PAGES_PER_PDF = int(os.environ.get("MAX_PAGES_PER_PDF", "100"))


def qdrant_client():
    from qdrant_client import QdrantClient

    return QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY, timeout=120)


def ensure_collection(client):
    """Create the multivector collection (MaxSim late interaction) if missing."""
    from qdrant_client import models

    if client.collection_exists(QDRANT_COLLECTION):
        return
    client.create_collection(
        collection_name=QDRANT_COLLECTION,
        vectors_config=models.VectorParams(
            size=VECTOR_DIM,
            distance=models.Distance.COSINE,
            multivector_config=models.MultiVectorConfig(
                comparator=models.MultiVectorComparator.MAX_SIM
            ),
            # store vectors on disk to keep the free-tier RAM happy
            on_disk=True,
        ),
    )
    print(f"Created Qdrant collection '{QDRANT_COLLECTION}'.")

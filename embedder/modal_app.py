"""
ColPali embedder — Modal service (Python + GPU, scale-to-zero).

This is the ONLY Python component needed at runtime. ColPali/ColQwen2 has no
pure-JS port, so the Next.js app on Vercel calls these HTTP endpoints to embed
both document pages (at ingestion) and user queries (at search time).

Deploy:
    pip install modal
    modal setup
    modal deploy embedder/modal_app.py

Modal prints two endpoint URLs after deploy, e.g.:
    https://<you>--colpali-embedder-embed-images.modal.run
    https://<you>--colpali-embedder-embed-queries.modal.run
Set the base (the embed-queries one is used by the web app) in MODAL_EMBED_URL.
"""

import base64
import io

import modal

MODEL_NAME = "vidore/colqwen2-v1.0"  # strong ColPali-family late-interaction model

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "colpali-engine>=0.3.5",
        "torch",
        "transformers>=4.45.0",
        "pillow",
        "fastapi[standard]",
    )
)

app = modal.App("colpali-embedder")

# Cache the model weights between cold starts.
volume = modal.Volume.from_name("colpali-cache", create_if_missing=True)
CACHE_DIR = "/cache"


@app.cls(
    gpu="A10G",
    image=image,
    volumes={CACHE_DIR: volume},
    scaledown_window=300,   # stay warm 5 min, then scale to zero
    timeout=600,
)
class Embedder:
    @modal.enter()
    def load(self):
        import torch
        from colpali_engine.models import ColQwen2, ColQwen2Processor

        self.torch = torch
        self.model = ColQwen2.from_pretrained(
            MODEL_NAME,
            torch_dtype=torch.bfloat16,
            device_map="cuda",
            cache_dir=CACHE_DIR,
        ).eval()
        self.processor = ColQwen2Processor.from_pretrained(MODEL_NAME, cache_dir=CACHE_DIR)

    def _to_lists(self, embeddings):
        """[batch, n_tokens, dim] tensor -> nested python lists (float32)."""
        return [e.to(self.torch.float32).cpu().tolist() for e in embeddings]

    @modal.method()
    def embed_images_b64(self, images_b64: list[str]) -> list[list[list[float]]]:
        from PIL import Image

        images = [
            Image.open(io.BytesIO(base64.b64decode(b))).convert("RGB")
            for b in images_b64
        ]
        batch = self.processor.process_images(images).to(self.model.device)
        with self.torch.no_grad():
            out = self.model(**batch)
        return self._to_lists(out)

    @modal.method()
    def embed_queries(self, queries: list[str]) -> list[list[list[float]]]:
        batch = self.processor.process_queries(queries).to(self.model.device)
        with self.torch.no_grad():
            out = self.model(**batch)
        return self._to_lists(out)


# ── HTTP endpoints (called from ingestion script + Next.js) ──────────────────
@app.function(image=image)
@modal.fastapi_endpoint(method="POST", label="embed-images")
def embed_images(payload: dict):
    """POST {"images_b64": [<base64 png>, ...]} -> {"embeddings": [[[...]]]}"""
    embs = Embedder().embed_images_b64.remote(payload["images_b64"])
    return {"embeddings": embs}


@app.function(image=image)
@modal.fastapi_endpoint(method="POST", label="embed-queries")
def embed_queries(payload: dict):
    """POST {"queries": ["...", ...]} -> {"embeddings": [[[...]]]}"""
    embs = Embedder().embed_queries.remote(payload["queries"])
    return {"embeddings": embs}

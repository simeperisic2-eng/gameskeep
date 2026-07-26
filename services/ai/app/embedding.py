"""Real, offline sentence-embedding engine for clustering (SPEC I3 §3).

The clustering engine is REAL even in the demo — only the article *source* is
mocked (BLUEPRINT 1.6). We use **fastembed** with `all-MiniLM-L6-v2`, an
ONNX-Runtime model (no PyTorch) that produces 384-dim vectors — exactly the
`EMBEDDING_DIM` the pgvector columns were created with in I1. This makes the
demo embedding engine *identical to the production one* (the whole point of
"real engine in demo"): going live swaps only the article feed, never the
engine.

Zero-network-on-boot (demo-first, CLAUDE.md): the model weights are baked into
the Docker image at BUILD time (`python -m app.embedding` in the Dockerfile,
when the network is available) into `FASTEMBED_CACHE_PATH`. At RUNTIME the model
is loaded with `local_files_only=True`, so the container never reaches out to
HuggingFace/GCS — proven by running the image with `--network none`.

Production swap: to use a different/larger model, change `MODEL_NAME` (and the
shared `EMBEDDING_DIM` if its dimension differs) and rebuild — the `/embed`
contract the main app depends on does not change.
"""

from __future__ import annotations

import math
import os
from functools import lru_cache
from typing import Any

# all-MiniLM-L6-v2 → 384 dims (matches @gameskeep/shared EMBEDDING_DIM).
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
EMBEDDING_DIM = 384

# Where the model is cached. The Dockerfile sets this and pre-downloads into it
# at build time; runtime reads from it offline.
CACHE_DIR = os.getenv("FASTEMBED_CACHE_PATH", "/models")


def _l2_normalize(vector: list[float]) -> list[float]:
    """Return the unit vector so cosine similarity == dot product and the norm
    is a stable 1.0 (fastembed already normalizes these models, but we enforce
    it so the engine is robust to a model swap)."""
    norm = math.sqrt(sum(component * component for component in vector))
    if norm == 0.0:
        return vector
    return [component / norm for component in vector]


@lru_cache(maxsize=1)
def _model() -> Any:
    """Lazily load the ONNX model from the local cache, OFFLINE. Cached for the
    process lifetime. Raises a clear error if the weights aren't baked in."""
    from fastembed import TextEmbedding

    try:
        return TextEmbedding(
            model_name=MODEL_NAME,
            cache_dir=CACHE_DIR,
            local_files_only=True,
        )
    except Exception as exc:  # pragma: no cover - exercised only on a broken image
        raise RuntimeError(
            f"Embedding model '{MODEL_NAME}' is not present in {CACHE_DIR!r} and "
            "local_files_only=True forbids downloading it. The model must be baked "
            "into the image at build time (see services/ai/Dockerfile). "
            f"Underlying error: {exc}"
        ) from exc


def embed(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts into 384-dim unit vectors. Empty/blank texts are
    tolerated (mapped to a single space) so a messy feed never crashes the
    pipeline (anti-bug rule)."""
    cleaned = [text if text and text.strip() else " " for text in texts]
    if not cleaned:
        return []
    model = _model()
    vectors: list[list[float]] = []
    for raw in model.embed(cleaned):
        vectors.append(_l2_normalize([float(component) for component in raw]))
    return vectors


def warmup() -> bool:
    """Load the model now (used at startup) so the first real request is fast and
    a broken/missing model surfaces immediately. Returns True on success."""
    try:
        embed(["warmup"])
        return True
    except Exception:  # pragma: no cover - startup best-effort
        return False


def download() -> None:
    """BUILD-TIME ONLY: fetch the model into CACHE_DIR (network available during
    `docker build`). Runtime never calls this. Run via `python -m app.embedding`."""
    from fastembed import TextEmbedding

    TextEmbedding(model_name=MODEL_NAME, cache_dir=CACHE_DIR)


if __name__ == "__main__":  # pragma: no cover - build step
    download()
    print(f"fastembed model '{MODEL_NAME}' cached in {CACHE_DIR}")

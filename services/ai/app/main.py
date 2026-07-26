"""GamesKeep AI microservice.

Hosts the REAL engines the main app calls over an internal HTTP API:
  - `/embed`     — sentence embeddings for clustering (SPEC I3 §3), backed by a
                   local ONNX model (fastembed / all-MiniLM-L6-v2, 384-dim). Runs
                   fully offline; weights are baked into the image at build time.
  - `/summarize` — neutral extractive topic summaries (SPEC I3 §3).

Bias assist and richer generation arrive in later phases. The clustering is real
even in demo — only the article source is mocked (BLUEPRINT 1.6).
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from pydantic import BaseModel, Field

from app.embedding import EMBEDDING_DIM, MODEL_NAME, embed, warmup
from app.summarize import ArticleInput, summarize

# The demo <-> production seam (mirrors the main app's APP_MODE).
APP_MODE = os.getenv("APP_MODE", "demo")

# Whether the embedding model loaded successfully (set at startup; surfaced in
# /health so the main app's readiness probe sees a half-broken AI service).
_model_ready = False


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Warm the model at boot so the first request is fast and a missing model
    surfaces immediately in /health. Never reaches the network (local files only)."""
    global _model_ready
    _model_ready = warmup()
    yield


app = FastAPI(title="GamesKeep AI Service", version="0.3.0", lifespan=_lifespan)


class HealthResponse(BaseModel):
    status: str
    service: str
    mode: str
    embeddingModel: str
    embeddingDim: int
    modelReady: bool


class PingResponse(BaseModel):
    pong: bool
    echo: str


class EmbedRequest(BaseModel):
    texts: list[str] = Field(default_factory=list, max_length=512)


class EmbedResponse(BaseModel):
    model: str
    dim: int
    vectors: list[list[float]]


class SummarizeItem(BaseModel):
    title: str = ""
    excerpt: str = ""
    source: str = ""


class SummarizeRequest(BaseModel):
    items: list[SummarizeItem] = Field(default_factory=list, max_length=200)


class SummarizeResponse(BaseModel):
    tldr: str
    summary: str
    model: str
    sourceCount: int


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Liveness + model readiness, consumed by the main app and orchestration."""
    return HealthResponse(
        status="ok",
        service="ai",
        mode=APP_MODE,
        embeddingModel=MODEL_NAME,
        embeddingDim=EMBEDDING_DIM,
        modelReady=_model_ready,
    )


@app.get("/ping", response_model=PingResponse)
def ping(msg: str = "ping") -> PingResponse:
    """Placeholder endpoint: echoes the supplied message back."""
    return PingResponse(pong=True, echo=msg)


@app.post("/embed", response_model=EmbedResponse)
def embed_endpoint(req: EmbedRequest) -> EmbedResponse:
    """Embed a batch of texts into 384-dim unit vectors for clustering."""
    vectors = embed(req.texts)
    return EmbedResponse(model=MODEL_NAME, dim=EMBEDDING_DIM, vectors=vectors)


@app.post("/summarize", response_model=SummarizeResponse)
def summarize_endpoint(req: SummarizeRequest) -> SummarizeResponse:
    """Synthesize a neutral TL;DR + summary from a topic's articles."""
    items = [ArticleInput(title=i.title, excerpt=i.excerpt, source=i.source) for i in req.items]
    tldr, summary = summarize(items)
    sources = {i.source for i in req.items if i.source}
    return SummarizeResponse(
        tldr=tldr,
        summary=summary,
        model="extractive-v1",
        sourceCount=len(sources),
    )

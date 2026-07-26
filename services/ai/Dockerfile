# syntax=docker/dockerfile:1
FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    # Where fastembed caches the ONNX model. Baked in at build time (below) so
    # the container runs FULLY OFFLINE at runtime (demo-first: zero network on boot).
    FASTEMBED_CACHE_PATH=/models

# ONNX Runtime needs libgomp (OpenMP) at runtime; the slim image omits it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Install runtime dependencies from pyproject (single source of truth).
COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir .

# Bake the embedding model into the image NOW, while the build has network. At
# runtime app.embedding loads it with local_files_only=True, so the running
# container never contacts HuggingFace/GCS. Verify with: docker run --network none.
RUN python -m app.embedding && test -d /models

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

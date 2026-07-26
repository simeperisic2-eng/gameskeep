-- Runs once, on first initialization of the Postgres data volume.
-- Enables pgvector so clustering embeddings (I3) have vector support ready.
-- The base image (pgvector/pgvector) ships the extension binaries.
CREATE EXTENSION IF NOT EXISTS vector;

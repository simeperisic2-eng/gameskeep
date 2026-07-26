import { EMBEDDING_DIM } from '@gameskeep/shared/constants';

/**
 * Vector helpers + the PURE clustering decision (SPEC I3 §3). Kept free of DB/AI
 * imports so the core "attach vs. create" rule is unit-testable without a stack.
 */

/** Format a vector as a pgvector literal: `[0.1,0.2,...]`. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((n) => (Number.isFinite(n) ? n : 0)).join(',')}]`;
}

/** L2-normalize so cosine == dot and centroids stay unit-length. */
export function normalize(vector: number[]): number[] {
  let sum = 0;
  for (const n of vector) sum += n * n;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vector;
  return vector.map((n) => n / norm);
}

/**
 * Mean of several vectors, re-normalized — a topic's representative embedding
 * (running centroid of its member articles). Returns a zero vector for an empty
 * input (caller guards against that).
 */
export function centroid(vectors: number[][]): number[] {
  if (vectors.length === 0) return new Array<number>(EMBEDDING_DIM).fill(0);
  const dim = vectors[0]?.length ?? EMBEDDING_DIM;
  const acc = new Array<number>(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i += 1) acc[i] = (acc[i] ?? 0) + (vec[i] ?? 0);
  }
  for (let i = 0; i < dim; i += 1) acc[i] = (acc[i] ?? 0) / vectors.length;
  return normalize(acc);
}

export interface TopicCandidate {
  topicId: string;
  similarity: number; // cosine similarity in [-1, 1]
}

export interface ClusterDecision {
  action: 'attach' | 'create';
  topicId?: string;
  similarity?: number;
}

/**
 * The core rule (the owner's "too many / too few topics" guard lives here): an
 * article joins the most-similar candidate topic ONLY if that similarity is at
 * or above the configured threshold; otherwise it starts a new topic. Candidates
 * are assumed already filtered by the time window in SQL.
 */
export function decideCluster(candidates: TopicCandidate[], threshold: number): ClusterDecision {
  let best: TopicCandidate | null = null;
  for (const candidate of candidates) {
    if (!best || candidate.similarity > best.similarity) best = candidate;
  }
  if (best && best.similarity >= threshold) {
    return { action: 'attach', topicId: best.topicId, similarity: best.similarity };
  }
  return { action: 'create' };
}

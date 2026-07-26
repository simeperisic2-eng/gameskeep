import { EMBEDDING_DIM } from '@gameskeep/shared/constants';
import { env } from '../config/env';
import { errorMessage } from '../lib/errors';

/**
 * Thin client for the Python AI microservice. Health probe (I0) plus the real
 * I3 engines: `/embed` (sentence embeddings for clustering) and `/summarize`
 * (neutral topic summaries). Both run on the AI service off the request path.
 */
export interface AiHealth {
  ok: boolean;
  status?: string;
  error?: string;
}

async function getJson(path: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.AI_SERVICE_URL}${path}`, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`AI service returned HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function postJson(path: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.AI_SERVICE_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`AI service returned HTTP ${res.status} for ${path}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function checkAi(timeoutMs = 4000): Promise<AiHealth> {
  try {
    const body = (await getJson('/health', timeoutMs)) as { status?: string };
    return { ok: true, status: body.status };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * Embed a batch of texts into unit vectors for clustering. Validates the shape
 * defensively (never trust a response either) — every vector must be the
 * expected dimension, else we throw so the caller's retry/backoff kicks in.
 */
export async function embedTexts(texts: string[], timeoutMs = 30_000): Promise<number[][]> {
  if (texts.length === 0) return [];
  const body = (await postJson('/embed', { texts }, timeoutMs)) as {
    vectors?: unknown;
    dim?: number;
  };
  const vectors = body.vectors;
  if (!Array.isArray(vectors) || vectors.length !== texts.length) {
    throw new Error('AI /embed returned an unexpected number of vectors');
  }
  return vectors.map((vec) => {
    if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) {
      throw new Error(`AI /embed returned a vector of wrong dimension (expected ${EMBEDDING_DIM})`);
    }
    return vec.map((n) => (typeof n === 'number' && Number.isFinite(n) ? n : 0));
  });
}

export interface TopicSummaryInput {
  title: string;
  excerpt?: string;
  source?: string;
}

export interface TopicSummary {
  tldr: string;
  summary: string;
  sourceCount: number;
}

/** Synthesize a neutral TL;DR + summary for a topic from its articles. */
export async function summarizeTopic(
  items: TopicSummaryInput[],
  timeoutMs = 15_000,
): Promise<TopicSummary> {
  const body = (await postJson(
    '/summarize',
    {
      items: items.map((i) => ({
        title: i.title,
        excerpt: i.excerpt ?? '',
        source: i.source ?? '',
      })),
    },
    timeoutMs,
  )) as { tldr?: unknown; summary?: unknown; sourceCount?: unknown };
  return {
    tldr: typeof body.tldr === 'string' ? body.tldr : '',
    summary: typeof body.summary === 'string' ? body.summary : '',
    sourceCount: typeof body.sourceCount === 'number' ? body.sourceCount : 0,
  };
}

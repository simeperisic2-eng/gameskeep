import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  communityBiasVoteInput,
  communityCommentInput,
  communityEntityParam,
  communityRatingInput,
  communityReactionInput,
  communityReportInput,
  communityTrustVoteInput,
  followEntityParam,
  reactionEntityParam,
} from '@gameskeep/shared/validation';
import { CSRF_HEADER, csrfOk } from '../auth/session';
import { requireAuth, requireVerified, sessionFromRequest } from '../auth/guards';
import { sendError } from '../admin/http';
import { allowWrite } from './rate-limit';
import * as svc from './service';
import { followEntity, getFeed, isFollowing, resolveFollowTarget, unfollowEntity } from './feed';

/**
 * Community write API (SPEC I6, Slice 4). A cookie-authed scope reached via the
 * BFF (Slice 8 wires the UI). Every MUTATION is gated in depth:
 *   1. CSRF double-submit (ambient-cookie defense — the scope onRequest hook).
 *   2. VERIFIED email (`requireVerified`, decision 6 — browse/follow is open,
 *      but rate/vote/comment require a verified address).
 *   3. Per-user rate limit (`allowWrite` — the authenticated counterpart to the
 *      anonymous global limiter).
 * One-per-user integrity is a DB unique index (upsert/toggle), never a race.
 * Reads require only auth (an unverified user may still SEE aggregates + their
 * own state); anonymous public exposure of these aggregates is Slice 8.
 */
const TOO_MANY = {
  error: 'rate_limited',
  message: 'Too many actions — slow down and retry.',
} as const;

/** requireVerified + per-user rate limit → the acting Actor, or null (replied). */
async function writer(req: FastifyRequest, reply: FastifyReply): Promise<svc.Actor | null> {
  const session = await requireVerified(req, reply);
  if (!session) return null;
  if (!(await allowWrite(session.user.id))) {
    reply.code(429).send(TOO_MANY);
    return null;
  }
  return {
    id: session.user.id,
    isEmailVerified: session.user.isEmailVerified,
    reputation: session.user.reputation,
    createdAt: session.user.createdAt,
  };
}

/**
 * requireAuth + per-user rate limit → the acting user id, or null (replied).
 * Used by FOLLOW, which is open to unverified users (decision 6) — unlike the
 * verified-gated `writer` helper above.
 */
/**
 * Community READS (aggregates + comments) are PUBLIC (SPEC I6, Slice 8) — the
 * SSR pages show them to everyone. The session is resolved OPTIONALLY so a
 * signed-in reader also gets their own "my vote / my score" overlaid; an
 * anonymous reader gets the aggregate with no personal state. Returns '' (a
 * non-matching id) when signed out.
 */
async function optionalUserId(req: FastifyRequest): Promise<string> {
  const session = await sessionFromRequest(req);
  return session?.user.id ?? '';
}

async function follower(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  const session = await requireAuth(req, reply);
  if (!session) return null;
  if (!(await allowWrite(session.user.id))) {
    reply.code(429).send(TOO_MANY);
    return null;
  }
  return session.user.id;
}

export async function registerCommunityRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (c) => {
      // CSRF gate for every mutation in this scope (GET reads exempt).
      c.addHook('onRequest', async (req, reply) => {
        if (req.method === 'GET' || req.method === 'HEAD') return;
        if (!csrfOk(req)) {
          reply.code(403).send({
            error: 'csrf',
            message: `Missing or mismatched ${CSRF_HEADER} header (fetch /auth/csrf first).`,
          });
        }
      });

      // ── game ratings (feed the I4b burst-aware engine) ──────────────────────
      c.post<{ Params: { gameId: string } }>('/games/:gameId/rating', async (req, reply) => {
        try {
          const actor = await writer(req, reply);
          if (!actor) return;
          const { score } = communityRatingInput.parse(req.body);
          await svc.rateGame(actor, req.params.gameId, score);
          reply.send({ ok: true });
        } catch (err) {
          sendError(reply, err);
        }
      });
      c.delete<{ Params: { gameId: string } }>('/games/:gameId/rating', async (req, reply) => {
        try {
          const actor = await writer(req, reply);
          if (!actor) return;
          await svc.unrateGame(actor, req.params.gameId);
          reply.send({ ok: true });
        } catch (err) {
          sendError(reply, err);
        }
      });
      c.get<{ Params: { gameId: string } }>('/games/:gameId/rating', async (req, reply) => {
        try {
          reply.send({
            data: await svc.gameRatingAggregate(req.params.gameId, await optionalUserId(req)),
          });
        } catch (err) {
          sendError(reply, err);
        }
      });

      // ── article trust votes ─────────────────────────────────────────────────
      c.post<{ Params: { articleId: string } }>(
        '/articles/:articleId/trust-vote',
        async (req, reply) => {
          try {
            const actor = await writer(req, reply);
            if (!actor) return;
            const { value } = communityTrustVoteInput.parse(req.body);
            await svc.trustVoteArticle(actor, req.params.articleId, value);
            reply.send({ ok: true });
          } catch (err) {
            sendError(reply, err);
          }
        },
      );
      c.get<{ Params: { articleId: string } }>('/articles/:articleId/trust', async (req, reply) => {
        try {
          reply.send({
            data: await svc.articleTrustAggregate(req.params.articleId, await optionalUserId(req)),
          });
        } catch (err) {
          sendError(reply, err);
        }
      });

      // ── topic bias votes (per axis) ─────────────────────────────────────────
      c.post<{ Params: { topicId: string } }>('/topics/:topicId/bias-vote', async (req, reply) => {
        try {
          const actor = await writer(req, reply);
          if (!actor) return;
          const { axis, value } = communityBiasVoteInput.parse(req.body);
          await svc.biasVoteTopic(actor, req.params.topicId, axis, value);
          reply.send({ ok: true });
        } catch (err) {
          sendError(reply, err);
        }
      });
      c.get<{ Params: { topicId: string } }>('/topics/:topicId/bias', async (req, reply) => {
        try {
          reply.send({
            data: await svc.topicBiasAggregate(req.params.topicId, await optionalUserId(req)),
          });
        } catch (err) {
          sendError(reply, err);
        }
      });

      // ── upcoming-game hype (toggle) ─────────────────────────────────────────
      c.post<{ Params: { gameId: string } }>('/games/:gameId/hype', async (req, reply) => {
        try {
          const actor = await writer(req, reply);
          if (!actor) return;
          reply.send({ data: await svc.toggleHype(actor, req.params.gameId) });
        } catch (err) {
          sendError(reply, err);
        }
      });
      c.get<{ Params: { gameId: string } }>('/games/:gameId/hype', async (req, reply) => {
        try {
          reply.send({
            data: await svc.gameHypeAggregate(req.params.gameId, await optionalUserId(req)),
          });
        } catch (err) {
          sendError(reply, err);
        }
      });

      // ── comments (polymorphic; distinct prefix avoids router param clashes) ──
      c.post<{ Params: { entityType: string; entityId: string } }>(
        '/comment/:entityType/:entityId',
        async (req, reply) => {
          try {
            const actor = await writer(req, reply);
            if (!actor) return;
            const { entityType, entityId } = communityEntityParam.parse(req.params);
            const { body, parentId } = communityCommentInput.parse(req.body);
            if (!(await svc.entityExists(entityType, entityId))) {
              reply.code(404).send({ error: 'not_found', message: 'Unknown comment target.' });
              return;
            }
            reply.send({ data: await svc.addComment(actor, entityType, entityId, body, parentId) });
          } catch (err) {
            sendError(reply, err);
          }
        },
      );
      c.get<{ Params: { entityType: string; entityId: string } }>(
        '/comment/:entityType/:entityId',
        async (req, reply) => {
          try {
            const { entityType, entityId } = communityEntityParam.parse(req.params);
            reply.send({ data: await svc.listComments(entityType, entityId) }); // public read
          } catch (err) {
            sendError(reply, err);
          }
        },
      );

      // ── reactions (polymorphic toggle) ──────────────────────────────────────
      c.post<{ Params: { entityType: string; entityId: string } }>(
        '/reaction/:entityType/:entityId',
        async (req, reply) => {
          try {
            const actor = await writer(req, reply);
            if (!actor) return;
            const { entityType, entityId } = reactionEntityParam.parse(req.params);
            const { kind } = communityReactionInput.parse(req.body);
            if (!(await svc.entityExists(entityType, entityId))) {
              reply.code(404).send({ error: 'not_found', message: 'Unknown reaction target.' });
              return;
            }
            reply.send({ data: await svc.toggleReaction(actor, entityType, entityId, kind) });
          } catch (err) {
            sendError(reply, err);
          }
        },
      );

      // ── report a comment (one per user; auto-hide at N) ─────────────────────
      c.post<{ Params: { commentId: string } }>(
        '/report/comment/:commentId',
        async (req, reply) => {
          try {
            const actor = await writer(req, reply);
            if (!actor) return;
            const { reason } = communityReportInput.parse(req.body);
            const result = await svc.reportComment(actor, req.params.commentId, reason);
            if (!result) {
              reply.code(404).send({ error: 'not_found', message: 'Unknown comment.' });
              return;
            }
            reply.send({ data: result });
          } catch (err) {
            sendError(reply, err);
          }
        },
      );

      // ── follows + "Your Feed" (decision 9; follow is open to UNVERIFIED) ─────
      // Addressed by public SLUG; resolved to the entity id server-side.
      c.get<{ Params: { entityType: string; slug: string } }>(
        '/follow/:entityType/:slug',
        async (req, reply) => {
          try {
            const session = await requireAuth(req, reply);
            if (!session) return;
            const { entityType, slug } = followEntityParam.parse(req.params);
            const id = await resolveFollowTarget(entityType, slug);
            if (!id) {
              reply.send({ data: { following: false } }); // unknown target isn't followed
              return;
            }
            reply.send({ data: { following: await isFollowing(session.user.id, entityType, id) } });
          } catch (err) {
            sendError(reply, err);
          }
        },
      );
      c.post<{ Params: { entityType: string; slug: string } }>(
        '/follow/:entityType/:slug',
        async (req, reply) => {
          try {
            const userId = await follower(req, reply);
            if (!userId) return;
            const { entityType, slug } = followEntityParam.parse(req.params);
            const id = await resolveFollowTarget(entityType, slug);
            if (!id) {
              reply.code(404).send({ error: 'not_found', message: 'Unknown follow target.' });
              return;
            }
            reply.send({ data: await followEntity(userId, entityType, id) });
          } catch (err) {
            sendError(reply, err);
          }
        },
      );
      c.delete<{ Params: { entityType: string; slug: string } }>(
        '/follow/:entityType/:slug',
        async (req, reply) => {
          try {
            const userId = await follower(req, reply);
            if (!userId) return;
            const { entityType, slug } = followEntityParam.parse(req.params);
            const id = await resolveFollowTarget(entityType, slug);
            if (!id) {
              reply.send({ data: { following: false } });
              return;
            }
            reply.send({ data: await unfollowEntity(userId, entityType, id) });
          } catch (err) {
            sendError(reply, err);
          }
        },
      );

      // The composed follow-based feed — PER-USER (served no-store, never cached).
      c.get('/feed', async (req, reply) => {
        try {
          const session = await requireAuth(req, reply);
          if (!session) return;
          reply.header('cache-control', 'private, no-store');
          reply.send({ data: await getFeed(session.user.id) });
        } catch (err) {
          sendError(reply, err);
        }
      });
    },
    { prefix: '/community' },
  );
}

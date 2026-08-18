import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { awardVoteInput } from '@gameskeep/shared/validation';
import { CSRF_HEADER, csrfOk } from '../auth/session';
import { requireVerified, sessionFromRequest } from '../auth/guards';
import { sendError } from '../admin/http';
import { allowWrite } from '../community/rate-limit';
import {
  AwardError,
  castVote,
  categoryTally,
  myVote,
  retractVote,
  type AwardActor,
} from './service';

/**
 * Public + community Awards API (SPEC I7, Slice 1). Reads (the live tally) are
 * public; the vote write is gated in depth exactly like a community write:
 *   1. CSRF double-submit (the scope onRequest hook);
 *   2. VERIFIED email (`requireVerified` — "registered only, same anti-abuse as
 *      the community score");
 *   3. per-user rate limit (`allowWrite`).
 * The domain rules (published + voting phase + window, one-per-category, valid
 * nominee) live in the service; here we only map its typed errors to HTTP.
 */
const TOO_MANY = { error: 'rate_limited', message: 'Too many actions — slow down and retry.' };

/** Map a service AwardError to its HTTP status; defer anything else to sendError. */
function sendAwardError(reply: FastifyReply, err: unknown): void {
  if (err instanceof AwardError) {
    const status =
      err.code === 'unknown_category' ? 404 : err.code === 'bad_nomination' ? 400 : 409;
    reply.code(status).send({ error: err.code, message: err.message });
    return;
  }
  sendError(reply, err);
}

/** requireVerified + per-user rate limit → the acting voter, or null (replied). */
async function voter(req: FastifyRequest, reply: FastifyReply): Promise<AwardActor | null> {
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

/** '' (a non-matching id) when signed out — a signed-in reader gets their overlay. */
async function optionalUserId(req: FastifyRequest): Promise<string> {
  const session = await sessionFromRequest(req);
  return session?.user.id ?? '';
}

export async function registerAwardRoutes(app: FastifyInstance): Promise<void> {
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

      // Cast / change a vote in a category.
      c.post<{ Params: { editionCategoryId: string } }>(
        '/categories/:editionCategoryId/vote',
        async (req, reply) => {
          try {
            const actor = await voter(req, reply);
            if (!actor) return;
            const { nominationId } = awardVoteInput.parse(req.body);
            const { editionCategoryId } = req.params;
            const cast = await castVote(actor, editionCategoryId, nominationId);
            reply.send({
              data: {
                my: { nominationId: cast.nominationId },
                tally: await categoryTally(editionCategoryId),
              },
            });
          } catch (err) {
            sendAwardError(reply, err);
          }
        },
      );

      // Retract a vote.
      c.delete<{ Params: { editionCategoryId: string } }>(
        '/categories/:editionCategoryId/vote',
        async (req, reply) => {
          try {
            const actor = await voter(req, reply);
            if (!actor) return;
            await retractVote(actor, req.params.editionCategoryId);
            reply.send({
              data: { my: null, tally: await categoryTally(req.params.editionCategoryId) },
            });
          } catch (err) {
            sendAwardError(reply, err);
          }
        },
      );

      // The live tally (public) + the signed-in reader's own vote overlay.
      c.get<{ Params: { editionCategoryId: string } }>(
        '/categories/:editionCategoryId/tally',
        async (req, reply) => {
          try {
            const { editionCategoryId } = req.params;
            reply.send({
              data: {
                tally: await categoryTally(editionCategoryId),
                my: await myVote(await optionalUserId(req), editionCategoryId),
              },
            });
          } catch (err) {
            sendAwardError(reply, err);
          }
        },
      );
    },
    { prefix: '/awards' },
  );
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  awardSubscribeInput,
  awardUnsubscribeInput,
  awardVoteInput,
} from '@gameskeep/shared/validation';
import { CSRF_HEADER, csrfOk } from '../auth/session';
import { requireVerified, sessionFromRequest } from '../auth/guards';
import { sendError } from '../admin/http';
import { allowWrite } from '../community/rate-limit';
import {
  AwardError,
  awardWinsForGame,
  castVote,
  categoryIsPublic,
  categoryTally,
  currentEditionView,
  editionViewByYear,
  listArchive,
  myVote,
  retractVote,
  type AwardActor,
} from './service';
import { emailOwnedByVerifiedUser, subscribe, unsubscribe } from './subscribe';

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

      // The live tally (public) + the signed-in reader's own vote overlay. Gated
      // on the SAME visibility predicate as the edition view (isAwardPublic) so a
      // pre-voting / unpublished category can never leak its nominees or counts,
      // even to someone who already knows its id — 404 otherwise.
      c.get<{ Params: { editionCategoryId: string } }>(
        '/categories/:editionCategoryId/tally',
        async (req, reply) => {
          try {
            const { editionCategoryId } = req.params;
            if (!(await categoryIsPublic(editionCategoryId))) {
              reply.code(404).send({ error: 'not_found', message: 'No public tally here.' });
              return;
            }
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

      // ── public phase-aware reads (SSR) ──────────────────────────────────────
      // The current edition (highest year) — Coming-Soon meta until published.
      c.get('/current', async (_req, reply) => {
        try {
          reply.send({ data: await currentEditionView() });
        } catch (err) {
          sendAwardError(reply, err);
        }
      });
      // The permanent archive index (published, decided editions).
      c.get('/archive', async (_req, reply) => {
        try {
          reply.send({ data: await listArchive() });
        } catch (err) {
          sendAwardError(reply, err);
        }
      });
      // A specific edition by year (archive detail / deep link).
      c.get<{ Params: { year: string } }>('/editions/:year', async (req, reply) => {
        try {
          // Strict: digits only (rejects "2026;DROP", "-5", "1e3" etc. outright).
          if (!/^\d{1,4}$/.test(req.params.year)) {
            reply.code(400).send({ error: 'bad_year', message: 'Year must be 1–4 digits.' });
            return;
          }
          reply.send({ data: await editionViewByYear(Number.parseInt(req.params.year, 10)) });
        } catch (err) {
          sendAwardError(reply, err);
        }
      });
      // Award wins for a game (by slug) — the game-page winner badge.
      c.get<{ Params: { slug: string } }>('/game/:slug/wins', async (req, reply) => {
        try {
          reply.send({ data: await awardWinsForGame(req.params.slug) });
        } catch (err) {
          sendAwardError(reply, err);
        }
      });

      // Awards "notify me" — EXPLICIT-opt-in marketing subscribe (anonymous or
      // signed-in; a signed-in subscribe also records the canonical user consent).
      c.post('/subscribe', async (req, reply) => {
        try {
          const { email, consent } = awardSubscribeInput.parse(req.body);
          if (!consent) {
            reply.code(400).send({
              error: 'consent_required',
              message: 'Please opt in to receive award notifications.',
            });
            return;
          }
          // SECURITY (I8 review F1): only bind the session user's id when the
          // subscribed address is THEIR OWN verified email — otherwise a
          // signed-in caller could attach their account (and consent) to any
          // email. A mismatch is treated as an anonymous subscribe.
          const session = await sessionFromRequest(req);
          const linkedUserId =
            session && (await emailOwnedByVerifiedUser(session.user.id, email))
              ? session.user.id
              : null;
          await subscribe({ email, userId: linkedUserId, source: 'awards', ip: req.ip });
          reply.send({ ok: true }); // generic — never an "is this email known?" oracle
        } catch (err) {
          sendAwardError(reply, err);
        }
      });

      // Login-free unsubscribe via the capability token (generic reply either way).
      c.post('/unsubscribe', async (req, reply) => {
        try {
          const { token } = awardUnsubscribeInput.parse(req.body);
          await unsubscribe(token);
          reply.send({ ok: true });
        } catch (err) {
          sendAwardError(reply, err);
        }
      });
    },
    { prefix: '/awards' },
  );
}

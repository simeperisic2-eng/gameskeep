import type { FastifyInstance, FastifyReply } from 'fastify';
import { newsletterCampaignCreate, newsletterCampaignUpdate } from '@gameskeep/shared/validation';
import {
  buildDigest,
  createCampaign,
  listSubscribers,
  newsletterOverview,
  NewsletterError,
  sendCampaign,
  staffUnsubscribe,
  updateCampaign,
} from '../newsletter/service';
import { actorOf, sendError } from './http';

/**
 * Newsletter admin routes (SPEC I8, Slice 3) — registered inside the
 * session/token-guarded admin scope, before the generic `/:resource` CRUD. The
 * `newsletter` section falls through to the ADMIN (40) default rank (subscriber
 * emails are PII — not a moderator surface). Sending fans out over the Mock
 * EmailSender (→ `email_outbox`, zero network); segmentation is GDPR-gated in
 * the service (active + consented only).
 */

/** Map a NewsletterError to its HTTP status; defer anything else to sendError. */
function sendNewsletterError(reply: FastifyReply, err: unknown): void {
  if (err instanceof NewsletterError) {
    const status = err.code === 'not_found' ? 404 : err.code === 'bad_state' ? 409 : 422;
    reply.code(status).send({ error: err.code, message: err.message });
    return;
  }
  sendError(reply, err);
}

export async function registerNewsletterAdminRoutes(admin: FastifyInstance): Promise<void> {
  // Overview: subscriber stats, per-segment counts, 8-week growth, campaigns.
  admin.get('/newsletter/overview', async (_req, reply) => {
    try {
      reply.send({ data: await newsletterOverview() });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Subscriber management — list/search. The address is the only PII exposed.
  admin.get<{ Querystring: { q?: string } }>('/newsletter/subscribers', async (req, reply) => {
    try {
      reply.send({ data: await listSubscribers(req.query.q) });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // CSV export of subscribers (address + source + state only — no other PII).
  // Dot-free path: the admin BFF's per-segment charset rejects '.' (no `.csv`).
  admin.get<{ Querystring: { q?: string } }>(
    '/newsletter/subscribers/export',
    async (req, reply) => {
      try {
        const rows = await listSubscribers(req.query.q, 500);
        const header = 'email,source,active,registered,created_at,unsubscribed_at';
        // A CSV cell can't break out structurally (commas/quotes/newlines are
        // quoted+escaped). SECURITY (I8 review F3): additionally neutralize
        // spreadsheet FORMULA injection — a cell whose value begins with = + - @
        // (or a tab/CR) is prefixed with a `'` so Excel/Sheets treat it as text,
        // not a formula (a `+`/`-`-leading email passes email validation).
        const cell = (v: unknown): string => {
          let s = String(v);
          if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
          return `"${s.replace(/"/g, '""')}"`;
        };
        const csv = [
          header,
          ...rows.map((r) =>
            [r.email, r.source, r.active, r.registered, r.createdAt ?? '', r.unsubscribedAt ?? '']
              .map(cell)
              .join(','),
          ),
        ].join('\n');
        reply.header('content-type', 'text/csv; charset=utf-8');
        reply.header('content-disposition', 'attachment; filename="subscribers.csv"');
        reply.send(csv);
      } catch (err) {
        sendError(reply, err);
      }
    },
  );

  // Staff unsubscribe (suppression) — same effect as a self-service unsubscribe.
  admin.post<{ Params: { id: string } }>(
    '/newsletter/subscribers/:id/unsubscribe',
    async (req, reply) => {
      try {
        const ok = await staffUnsubscribe(req.params.id, actorOf(req));
        if (!ok) {
          reply.code(404).send({ error: 'not_found', message: 'Unknown subscriber.' });
          return;
        }
        reply.send({ data: { ok: true } });
      } catch (err) {
        sendError(reply, err);
      }
    },
  );

  // Compose a campaign (draft, or scheduled if a time is given).
  admin.post('/newsletter/campaigns', async (req, reply) => {
    try {
      const input = newsletterCampaignCreate.parse(req.body);
      reply.code(201).send({ data: await createCampaign(input, actorOf(req)) });
    } catch (err) {
      sendNewsletterError(reply, err);
    }
  });

  // Generate a digest DRAFT from the existing topic summaries (no new AI).
  admin.post('/newsletter/digest', async (req, reply) => {
    try {
      const digest = await buildDigest();
      if (!digest) {
        reply.code(422).send({ error: 'no_summaries', message: 'No summarized stories yet.' });
        return;
      }
      const created = await createCampaign(
        { ...digest, segment: 'all', kind: 'digest' },
        actorOf(req),
      );
      reply.code(201).send({ data: created });
    } catch (err) {
      sendNewsletterError(reply, err);
    }
  });

  // Edit a draft campaign.
  admin.patch<{ Params: { id: string } }>('/newsletter/campaigns/:id', async (req, reply) => {
    try {
      const patch = newsletterCampaignUpdate.parse(req.body);
      reply.send({ data: await updateCampaign(req.params.id, patch, actorOf(req)) });
    } catch (err) {
      sendNewsletterError(reply, err);
    }
  });

  // Send a campaign to its GDPR-gated audience (Mock seam → outbox, zero network).
  admin.post<{ Params: { id: string } }>('/newsletter/campaigns/:id/send', async (req, reply) => {
    try {
      reply.send({ data: await sendCampaign(req.params.id, actorOf(req)) });
    } catch (err) {
      sendNewsletterError(reply, err);
    }
  });
}

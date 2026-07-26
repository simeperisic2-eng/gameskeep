# GamesKeep — README

> **Note:** this is the required structure for the project README. The agent fills in exact commands during implementation (final pass in phase I9), but every section below MUST exist and MUST be accurate to the built system. Written for a non-developer owner: clear, step-by-step, no assumed knowledge.

## What GamesKeep is
GamesKeep is a premium, global gaming platform that pairs two things side by side: **news with bias analysis** (it gathers articles from many gaming outlets, groups them into stories, and shows how coverage is influenced and how high-quality it is) and a **ratings & rankings system** (every game gets its own hub with separated critic/community scores, analytics, lists, and an annual Awards program). The promise is more professional, more accurate, and more transparent than existing gaming media. See `BLUEPRINT.md` for the full plan.

## Quick start (demo)
- **One command to boot the whole demo** (main app + AI service + database + cache), with real behavior. (A broad **mock game catalog (~190 games)** loads automatically in the background on first boot — I2; the article feed + clustering arrive in I3.)
- **Make sure Docker Desktop is running, then run** (from this folder):

  ```
  docker compose up --build
  ```

  (or `npm run demo` — same thing). The first run downloads/builds images and takes a few minutes; later runs are fast.
- **What you'll see:** open **http://localhost:3000** — the page renders **"GamesKeep — foundation OK"** with a live status panel (API, Postgres + pgvector, Redis, AI service, background job).
- **Basic admin (I1):** open **http://localhost:3000/admin** — create/read/update/delete every model (games, sources, topics, articles, users, awards, and the extensible lists), plus a Relations page to link topics/articles/games. It is intentionally minimal; the polished, permissioned Control Panel arrives in I8. (No login yet — accounts arrive in I6; the admin API is guarded by `ADMIN_API_TOKEN`, injected server-side.)
- **Game catalog & unmatched queue (I2):** the **Games** list in the admin fills with the seeded catalog a few seconds after boot. **http://localhost:3000/admin/unmatched** is the "unmatched game" queue — paste any game name to resolve it (known names auto-create from the catalog; unknown ones get filed for an editor to link / create / dismiss). This is the safety net that keeps a not-yet-known game from ever breaking anything.
- **Confirm everything is healthy** (in a second terminal): `npm run health` — prints a pass/fail table for the whole stack. Then `npm run verify:i1` (data layer: admin CRUD, relations, constraints, audit log) and `npm run verify:i2` (game data: catalog load, idempotent import, the demo↔live seam, auto-resolve, the unmatched queue, Upcoming) exercise the running stack end-to-end.
- **How to reset the demo data:** `npm run demo:reset` (stops everything and wipes the database volume). Stop without wiping: `npm run demo:down`.

## Requirements
- **To run the demo:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) (includes Docker Compose). Install it, start it, and that is all you need — the whole stack runs in containers.
- **For development only** (optional, if you want to edit code and run tests outside Docker): **Node.js 20+** and **Python 3.11+**.

## Project structure
- `apps/backend/` — the API (Node + TypeScript, Fastify). Health checks, config, the demo↔production data-source seam, the cache seam, and the background-job queue live here. The game-data seam is `src/data-source/games/` (Mock + IGDB/RAWG Live providers); the import/resolve/unmatched engine is `src/catalog/`.
- `apps/frontend/` — the website (Next.js, server-rendered for SEO). The landing page and brand theme are here.
- `services/ai/` — the Python AI microservice (FastAPI); does clustering/embeddings later.
- `infra/postgres/init/` — database setup run on first boot (enables the `pgvector` extension).
- `scripts/health-check.mjs` — the `npm run health` checker.
- `docker-compose.yml` — defines the whole stack and the one-command boot.
- `.env.example` — every setting and where each production key goes (the demo needs none of them).
- Root docs: `BLUEPRINT.md` (full plan), `CLAUDE.md` (build rules), `ASSETS.md` (assets/keys), `OWNER-TODO.md`, `PROGRESS.md`.

## How to use it (owner guide)
> These features are built in later phases (public pages I5, users I6, awards I7, Control Panel/newsletter/ads I8). This section is completed as each ships — in I0 there is no UI beyond the foundation landing page.
- **Log in to the Control Panel** and where to find each section.
- **Write an article / review:** step by step (CMS), including tagging to games/topics and structured review fields.
- **Add or edit a game.**
- **Add or edit a source** (and its pull settings).
- **Configure a list/ranking** (weights, windows, manual pin).
- **Merge/split topics** (fix clustering).
- **Manage ad slots.**
- **Prepare & launch Awards.**
- **Change brand text, logo, contact, colors** (points to `ASSETS.md`).

## Going to production
- **Switch from mock to live (the swappable data-source layer):** set `APP_MODE=production` in `.env`. The seam lives in `apps/backend/src/data-source/`. **Game metadata** already has its live adapter (IGDB primary → RAWG fallback) wired in `src/data-source/games/live-provider.ts` — dormant until you set `APP_MODE=production` and the IGDB/RAWG keys (see below); the engines (import, resolve, unmatched) don't change. Article RSS adapters and Steam land in I3+.
- **Where to put each API key:** copy `.env.example` → `.env` and fill the secret fields (IGDB, RAWG, Steam, YouTube, email, OAuth, `SESSION_SECRET`). See `ASSETS.md` §3 for what each key powers. `.env` is git-ignored — never commit secrets.
- **Deployment notes (Hetzner-class server):** _filled in by agent in I9._

## Maintenance
- **Background jobs:** run on a Redis queue (BullMQ); a dedicated `worker` container processes them — including the **catalog import** (I2; heavy work stays off the request path). Check health with `docker compose logs worker`, or see the `backgroundJobs.heartbeat` and `catalog` fields at http://localhost:4000/health/ready. Re-run the catalog import any time from **Admin → Unmatched games → "Re-run catalog import"** (idempotent).
- **Database migrations:** Drizzle migrations live in `apps/backend/drizzle/` and apply automatically on backend startup; in demo mode a small idempotent seed loads too. Regenerate after schema changes with `npm run db:generate -w apps/backend`.
- **Audit log:** every staff edit through the admin is written to the immutable `audit_logs` table from I1 (who/what/when/old→new). The audit *UI* arrives with the Control Panel in I8.
- **Run the tests / verification checks:**
  - Node: `npm test` · `npm run lint` · `npm run typecheck` · `npm run build`
  - Python (in `services/ai/`): `pytest` · `ruff check .` · `mypy`
  - Whole running stack: `npm run health`

## Troubleshooting
- Common issues and fixes. _Filled in by agent._

---
**Related docs:** `BLUEPRINT.md` (full plan) · `CLAUDE.md` (build rules) · `ASSETS.md` (where to put assets & keys).

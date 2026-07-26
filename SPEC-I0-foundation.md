# SPEC — Phase I0: Foundation

> Read `CLAUDE.md` and `BLUEPRINT.md` (Parts 1 and 4) before starting. This SPEC is the single source of truth for **this phase only**. When this SPEC conflicts with the blueprint, this SPEC wins for I0.

## Goal of this phase
Stand up the **skeleton** of the whole system so every later phase has a solid, running foundation. **No product features yet** — no games, no articles, no ratings. Just the architecture, wired together, booting cleanly with one command, with health checks passing and tests green.

Think of I0 as: "an empty but correctly-structured building with power, plumbing, and a working front door — no furniture."

## In scope (build exactly this)
1. **Monorepo / project structure** for the three pieces decided in `CLAUDE.md`:
   - **Main app** — Node.js + TypeScript, with a clear separation between **backend (API)** and **frontend (web app)**. API-first (so a future mobile app needs no refactor).
   - **AI microservice** — Python, minimal skeleton, exposes an internal health endpoint and one placeholder endpoint (e.g. `/ping` that echoes). No real AI logic yet.
   - **Database** — PostgreSQL, with the **vector extension enabled** (we'll need it for clustering later). Just provisioned + connection verified; no app tables yet beyond what migrations infrastructure needs.
   - **Cache/queue** — Redis, provisioned + connection verified + a trivial background-job runner wired (one demo job that does nothing meaningful, just proves the queue works).
2. **One-command demo boot.** A single documented command brings up the entire stack (main app + AI service + Postgres + Redis) locally, in demo mode, reproducibly. Use whatever orchestration you judge best; document it.
3. **Health checks.** Each service exposes a health endpoint; there is a way to confirm all four pieces are up and talking to each other (main app ↔ AI service, main app ↔ Postgres, main app ↔ Redis).
4. **Config & secrets scaffolding.** Environment/config layout established. **Demo runs with zero real secrets.** Document which env vars will later hold which keys (cross-reference `ASSETS.md`), but nothing real required now.
5. **Demo-mode switch.** A clear, single place that flags "demo vs production" — the seam where the swappable data-source layer will plug in later. In I0 it just exists and defaults to demo.
6. **Testing + lint + build setup.** Test runner, linter, type-checking, and build configured for both the Node and Python sides, with at least a trivial passing test per service (proves the harness works).
7. **Baseline tooling for cross-cutting requirements** (scaffold only, not full implementation):
   - SEO: confirm the frontend approach supports SSR/pre-rendering (set up the rendering mode now so I5 isn't a refactor).
   - Security: basic hardening defaults in place (secure headers, input-validation library wired, secrets-not-in-source enforced).
8. **Living docs:** create/append `PROGRESS.md` (first entry) and ensure `OWNER-TODO.md` exists. Add any `[[OWNER-TODO]]` placeholders introduced.

## Out of scope (do NOT build in I0 — later phases)
- Any of the 6 data models / tables (I1).
- IGDB/RAWG, game seed (I2).
- Article pipeline, clustering, adapters (I3).
- Bias, ratings, content flags (I4).
- Any public page UI beyond a single "it works" placeholder landing (I5).
- Auth, users, levels (I6). Awards (I7). Control Panel, newsletter, ads (I8). Polish/visualizer (I9).
- Real external API calls of any kind.

## Decisions you (the agent) make
Framework choices within the fixed stack, exact folder layout, orchestration tool, test/lint/build tools, migration tool. Prefer mature, stable, widely-supported options. No overkill. Document your choices in PROGRESS.md and the README structure.

## Constraints (from CLAUDE.md — apply here)
- TypeScript everywhere on the Node side (type safety = bug prevention).
- Nothing heavy on user request; background-job architecture must exist from the start (even if it runs a trivial job in I0).
- Caching seam present from the start.
- Validate inputs; handle missing/empty config gracefully (e.g. clear error if a service can't connect, not a silent crash).
- Secrets never committed.

## Verification (REQUIRED — do before calling I0 done)
Confirm and note the result briefly in `PROGRESS.md`:
1. The one-command boot brings up all four pieces cleanly from a fresh state.
2. All health checks pass; main app can reach AI service, Postgres, and Redis.
3. The trivial background job runs and is observable (proves the queue).
4. `npm test` / Python tests pass; linter and type-check are clean; build succeeds.
5. The demo boots with **no real secrets** present.
6. Postgres has the vector extension available.

## Done looks like
A developer (or the owner) can clone the repo, run one documented command, and watch the full skeleton come up healthy — main app serving a minimal "GamesKeep — foundation OK" response, AI service responding to its ping, Postgres (with vector) and Redis connected, a demo background job firing, and all tests/lint/build green. PROGRESS.md has the first entry describing what was built, what's verified, and that I1 (data layer) is next.

---

### Note for the next phase (I1 preview — do not build yet)
I1 will add the six core data models (Topic, Article, Game, Source, User, Awards) and admin CRUD. Structure I0 so that adding the data layer and migrations is clean and obvious.

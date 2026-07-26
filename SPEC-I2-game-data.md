# SPEC — Phase I2: Game Data + Seed

> Read `CLAUDE.md`, `BLUEPRINT.md` (2.3 Game, 2.4 Upcoming, 1.6 demo↔prod boundary, and the "Data-source reality" notes), and `PROGRESS.md` before starting. This SPEC is the single source of truth for **this phase only**; where it conflicts with the blueprint, this SPEC wins for I2. I0 + I1 are complete and verified — build on them.

## Goal of this phase
Give the platform a **real, broad catalog of games** — so later phases (articles, clustering, ratings) always have games to attach to — by wiring **IGDB (primary) + RAWG (fallback)** behind the **swappable data-source seam**, with a **realistic local mock seed for demo** and an **"unmatched game" admin queue** for games that appear (e.g. in a future article) but aren't in our DB yet.

Critically: in **demo mode nothing calls the live APIs.** The ingestion engine is real; the demo feeds it from a local mock dataset. Switching to production = flip the seam to the live IGDB/RAWG provider, no engine change (BLUEPRINT 1.6).

## In scope (build exactly this)

### 1. Game-data provider behind the seam
- Define a **GameDataProvider interface** (search game, fetch game by id, fetch upcoming) and implement:
  - **MockProvider** (demo default) — reads from a local, realistic dataset bundled in the repo (no network).
  - **LiveProvider** — IGDB primary + RAWG fallback. Structure it, but in demo it is never called; it may be a thin implementation that's fully wired but exercised only when real keys + `APP_MODE=production` are present. Document the IGDB Twitch-OAuth + RAWG key requirements in `.env.example` / `ASSETS.md` / `OWNER-TODO.md`.
- The seam picks provider by `APP_MODE` (demo→Mock, production→Live). One documented switch point.
- **Normalization:** both providers return ONE normalized Game shape (matching the I1 schema). IGDB and RAWG differ in fields — normalize both to our model so the rest of the app never sees provider differences.
- **Rate-limit awareness** (for the live path, even though demo doesn't hit it): batch/paginate, backoff, never hammer. Document that the initial seed must be gentle. (No real calls in demo, but the code must be written to respect limits when it does run.)

### 2. Local mock dataset (demo seed — broad)
- A bundled dataset of **realistic games** (aim for a few hundred — enough that later article mock-feeds reference games we already have; quality over hitting an exact number). Real-world-style names/metadata is fine for a demo; mark it clearly as mock/seed data.
- Cover the spread: various genres, platforms, years, statuses (incl. some **Upcoming** with future release dates for the Upcoming view), a few with rich metadata (so game pages later look full).
- Idempotent loader (re-running doesn't duplicate), building on the I1 seed approach. This **replaces/extends** the tiny I1 game seed with the broad catalog.

### 3. "Unmatched game" handling (the coverage safety net — BLUEPRINT data-source reality)
- When something references a game not in our DB (in I2, simulate this via an admin action or a provided test input; the real trigger is the article pipeline in I3), the system:
  1. tries the provider (in demo: the mock dataset) to resolve & auto-create the game, then
  2. if still unresolved, files it into an **"unmatched game" admin queue** with the raw reference, so an editor can manually link or create it.
- Build the queue + the admin UI to view/resolve it (link to existing game, create new, or dismiss). This is the mechanism that means "a new game we don't have yet" never silently breaks anything.

### 4. Auto-resolve on demand (structure)
- The provider seam exposes a "resolve by name/reference" path that the article pipeline (I3) will call. In demo it resolves against the mock dataset; in production it would query IGDB/RAWG live. Build and test it now against the mock data so I3 just plugs in.

### 5. Admin
- Extend the I1 admin: browse the seeded catalog, see game metadata, and manage the unmatched queue. Manual create/edit of a game already works from I1 — ensure provider-imported games are editable too (auto + manual override rule).
- Keep everything audit-logged.

### 6. Upcoming games (data only)
- Ensure the Upcoming subset is queryable (status + future release date). The Upcoming *page* is I5; here just make sure the data + a backend way to list upcoming exists.

## Out of scope (do NOT build in I2)
- Article aggregation, RSS adapters, clustering, embeddings (I3).
- Bias derivation, rating aggregation, disconnect, content-flag *logic* (I4) — flags/ratings columns already exist from I1; don't compute.
- Public game page / catalog / Upcoming page UI (I5).
- Player counts, FPS, HowLongToBeat live fetching (later) — columns exist; demo may include a little mock data but no live calls.
- Real IGDB/RAWG calls in demo. (Live provider is wired but dormant without keys + production mode.)

## Decisions you (the agent) make
The provider interface shape, how the mock dataset is stored/generated, normalization mapping details (IGDB/RAWG → our model), how big the mock catalog is (a few hundred is the target), the unmatched-queue UX. Prefer clarity and a clean seam.

## Constraints (from CLAUDE.md)
- **Demo never calls live APIs**; boots with zero real secrets.
- TypeScript everywhere; validate/normalize all provider data (never trust external shape — handle missing/null fields gracefully). This is exactly the kind of messy external data the anti-bug rule targets.
- Auto + manual override: imported games fully editable.
- Everything audit-logged; nothing hardcoded that should be configurable.
- Speed: seeding/imports are background work, not on the user request path.

## Verification (REQUIRED — note results in PROGRESS.md)
1. Fresh `demo:reset` → boot: the broad mock catalog loads (report how many games), idempotently (re-run doesn't duplicate).
2. The seam returns Mock in demo and would return Live in production (show the switch; no live call happens in demo).
3. Normalization: a provider record maps cleanly to our Game schema with missing/odd fields handled (no crash on partial data).
4. Unmatched flow: an unresolved game reference lands in the queue; an editor can resolve it (link/create) from the admin; action is audit-logged.
5. Auto-resolve by name works against the mock dataset (the path I3 will use).
6. Upcoming subset is queryable.
7. Full gate green (Node tests/lint/typecheck/build; Python unchanged) + `npm run health` + a new `verify:i2` script mirroring the I1 style.
8. Demo still boots one command, zero real secrets.

## Done looks like
From a fresh `demo:reset`, the stack boots and the admin shows a broad catalog of realistic games (various genres/platforms/years, some upcoming). The data-source seam is demo→Mock / production→Live with one switch point and a clean normalized Game shape. Feeding an unknown game name resolves it from the mock data (or files it to the unmatched queue, which an editor can clear in the admin). PROGRESS.md records what was built, the catalog size, verification results, and that I3 (article pipeline + clustering) is next.

---

### Note for the next phase (I3 preview — do not build yet)
I3 adds the article pipeline: mock feed → per-source RSS adapters → normalize → real clustering engine (embeddings via the AI service, similarity threshold, time window) → Topics, with merge/split + threshold tuning in admin. I3 will call I2's auto-resolve to attach articles to games. Structure the provider/resolve seam so I3 plugs in without churn.

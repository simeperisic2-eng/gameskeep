# SPEC — Phase I1: Data Layer

> Read `CLAUDE.md` and `BLUEPRINT.md` (Part 2 — Data Models — in full, plus Part 1.4 hierarchy) before starting. This SPEC is the single source of truth for **this phase only**. Where it conflicts with the blueprint, this SPEC wins for I1. I0 is complete and verified — build on that skeleton.

## Goal of this phase
Turn the empty skeleton into a real **data layer**: the six core domain models (plus the generic Subject) in PostgreSQL via Drizzle migrations, with their relationships, and a **basic admin CRUD** so you (the owner) can create, read, update, and delete every object by hand. This is the backbone everything later hangs on.

**Still no public site, no aggregation, no AI, no real scoring logic.** Just: well-modeled data + a way to manage it. Get the schema right and everything later "just sits."

## In scope (build exactly this)

### 1. The domain models (from BLUEPRINT Part 2 — model every field listed there)
Implement these as proper relational tables with correct relations, types, constraints, indexes, and timestamps. Use the **pgvector** column type where embeddings will live (Topic/Article), even though clustering itself comes in I3 — define the column now so I3 doesn't migrate.

- **Subject** (generic entity; types: Game / Studio / Publisher / Platform). Only Game is populated later, but model it generically now (BLUEPRINT 1.4).
- **Topic (Story)** — top of the news hierarchy. Fields per BLUEPRINT 2.1: title, TL;DR, AI summary, status (Developing/Ongoing/Resolved), type (extensible list), timestamps, the **two public bias axes at topic level are derived/aggregated** from articles (don't store as editable on Topic — they're computed; just leave room), links to 1+ Subjects (many-to-many), embedding column.
- **Article** — per BLUEPRINT 2.2: origin (Aggregated / Ours), type (news/review-article/opinion/preview/guide), auto-captured fields (title, source, author, publish date, URL, thumbnail, excerpt, paywall flag), detected signals (affiliate, sponsored/PR, review-copy), **two public bias axes (Influenced↔Independent, Slop↔Top) stored separately** + **internal-only assessment field**, links to Topics (one primary) and Subjects, embedding column. **Never a full-text field for aggregated articles** (copyright) — excerpt + summary + link only; "Ours" articles may store full body.
- **Game** — per BLUEPRINT 2.3: it's a Subject of type Game plus game-specific metadata (name, cover, screenshots, genres, platforms, developer, publisher, release date, description, engine, mode, age rating, series, tags, prices, system requirements, social/store links, status). Ratings/analytics/flags are modeled as related tables (below), not crammed into one row.
  - **Ratings:** model the three separated layers — Our score, Media Critics (aggregate + individual outlet entries with excerpt/score/link), Community (our-community aggregate + internet/Steam estimate). Store internally **0–100**; display 1–10 is a frontend concern. Leave structure for the disconnect calc (computed in I4, not now).
  - **Our review** (structured: verdict, pros/cons, platform tested, hours, author, date, body, our score) as a related record — one review = one score = one game.
  - **Content Flags** (AI-asset disclosure, launch state, monetization flags) as a related table.
  - **Videos/streams**, **HowLongToBeat**, **completion rate**, **player-count history** — model the tables/columns now (empty), filled by later phases.
- **Source** — per BLUEPRINT 2.5: name, logo, URL, RSS URL, description, type, ownership/parent + conflict indicator, status, adapter identifier, pull settings (frequency/depth/on-off), reputation baseline (+ room for dynamic update), stats (derived).
- **User** — per BLUEPRINT 2.6: identity, roles (6), the two identity axes (**level** earned + **roles** assigned), level fields (internal), badges (extensible), profile fields. **Auth itself is I6** — here just model the user/roles/badges tables and seed a demo admin row; don't build login flows yet.
- **Awards** — per BLUEPRINT 2.7: edition → categories (extensible) → nominations → outcomes (Critics' Choice + Community Choice separate), phase/status, sponsor-slot field, vote records (structure only; voting logic in I7).

### 2. Relationships & integrity
- Topic ↔ Subject (many-to-many). Article ↔ Topic (many, one primary). Article ↔ Subject (many). Game = Subject specialization. Review → Game (one-to-one-ish). Source → Articles. Awards edition → categories → nominations → games.
- Enforce referential integrity, sensible cascade rules, and uniqueness where it matters (e.g. one Our-review per game; one user rating per game — enforce at DB level even though the rating UI is later).
- Extensible lists (topic types, award categories, badges, source types) modeled so they're **data, not hardcoded enums** (admin can add values later, per the "everything configurable" rule).

### 3. Shared types
- Now is the right time to add the deferred `packages/shared` (or equivalent) for domain types shared between backend and (later) frontend. Keep it clean.

### 4. Admin CRUD (basic, functional — not the polished Control Panel)
- A **basic but real** admin interface (or admin API + minimal UI) to create/read/update/delete every model above, including managing the extensible lists.
- This is NOT the full Control Panel (that's I8 with permissions, analytics, audit log). I1's admin can be minimal and behind a simple guard, but it must let you actually enter and edit real data for testing later phases.
- **Audit-log groundwork:** even if the full audit UI is I8, start writing staff actions to an audit table now (cheap to add here, painful to retrofit). At minimum: who/what/when/old→new on edits.
- Validate all input (Zod or equivalent) — ties into the anti-bug rule. Handle missing/malformed gracefully.

### 5. Seed data (minimal, for testing)
- A small seed: a demo admin user, a couple of Subjects/Games, a Source or two, one Topic with a couple of Articles, so the CRUD and relations are demonstrably working. Keep it tiny — the real game seed (IGDB/RAWG) is I2, the article mock feed is I3.

## Out of scope (do NOT build in I1)
- IGDB/RAWG integration, large game seed (I2).
- Article aggregation, adapters, clustering, embeddings *generation* (I3) — model the columns, don't fill them.
- Bias derivation, rating aggregation, disconnect, weighting (I4) — model storage, don't compute.
- Public pages (I5). Auth/login, real user flows, levels logic (I6). Awards voting logic (I7). Full Control Panel + analytics + ad mgmt + newsletter (I8).
- Personalized feed, polish (later).

## Decisions you (the agent) make
Exact schema shape, table/column naming, index strategy, migration structure, how minimal the admin UI is (API-first is fine), Drizzle relations patterns. Prefer clarity and future-extensibility over cleverness.

## Constraints (from CLAUDE.md)
- TypeScript everywhere; types shared via the shared package.
- Validate all input; handle edge cases (nulls, missing relations, bad IDs) explicitly.
- Everything configurable: extensible lists as data, not enums.
- Audit-log groundwork from here.
- Keep the demo booting with zero real secrets; seed must not require external calls.

## Verification (REQUIRED — note results in PROGRESS.md)
1. Migrations apply cleanly from a fresh database (`demo:reset` then boot).
2. Every model can be created, read, updated, and deleted through the admin (show it works for each).
3. Key relations enforced: many-to-many Topic↔Subject, Article↔Topic (primary), one-review-per-game, one-rating-per-user-per-game (DB constraint).
4. Extensible lists work as data (add a new topic type / award category without code change).
5. Audit table records a staff edit (who/what/when/old→new).
6. pgvector columns exist on Topic/Article (empty, ready for I3).
7. Seed loads; tests/lint/typecheck/build all green (Node + Python unchanged).
8. Demo still boots with one command, zero real secrets.

## Done looks like
From a fresh `demo:reset`, the stack boots, migrations create the full schema, the seed loads, and you can open the basic admin and create/edit/delete a Game, a Source, a Topic, an Article (linking it to a Topic as primary and to a Game), a User, and an Awards edition with a category and nomination — with edits landing in the audit table and validation rejecting bad input. PROGRESS.md describes what was built, confirms verification, and notes that I2 (game data + seed) is next.

---

### Note for the next phase (I2 preview — do not build yet)
I2 fills the Game model from IGDB (primary) + RAWG (fallback) behind the demo↔production data-source seam, with a local mock seed for demo and an "unmatched game" admin queue. Structure the Game/Subject tables and the data-source seam so I2 plugs in without schema churn.

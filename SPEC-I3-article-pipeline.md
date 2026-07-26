# SPEC — Phase I3: Article Pipeline + Clustering

> Read `CLAUDE.md`, `BLUEPRINT.md` (2.1 Topic, 2.2 Article, 2.5 Source, 1.4 hierarchy, 1.6 demo↔prod boundary, "Data-source reality" + "Aggregation legal safeguards"), and `PROGRESS.md` before starting. This SPEC is the single source of truth for **this phase only**; where it conflicts with the blueprint, this SPEC wins for I3. I0–I2 are complete and verified — build on them, and reuse I2's patterns (data-source seam, background job, `resolveOrQueue`).

## Goal of this phase
Build the **news engine** — the heart of the GroundNews side. Articles flow in from sources, get normalized to one shape, and a **real clustering engine** groups articles about the same event into **Topics** (GroundNews "stories"). Editors can **merge/split** topics and tune the clustering, because no auto-clustering is ever perfect. Articles auto-attach to games via I2's resolve path.

This is the phase the owner was most concerned about: **not too many topics (the same event splintering into 10 topics), not too few (unrelated articles dumped together).** The engine is **real** even in demo; only the article *source* is a realistic mock feed (BLUEPRINT 1.6).

## In scope (build exactly this)

### 1. Article source behind the seam (mock feed in demo)
- Define an **ArticleSourceProvider** interface (pull recent articles per source) behind the same demo↔prod seam pattern as I2:
  - **MockFeedProvider** (demo default) — a bundled, realistic dataset of **~200–300 article entries** across the 10 sources (BLUEPRINT 2.5), clustered in reality around a few dozen real-world-style events (so clustering has genuine groupings to find — multiple sources covering the same "story", plus some standalone articles). Zero network. Reference games that exist in the I2 catalog (so game-attach works), plus a few referencing unknown games (to exercise `resolveOrQueue`).
  - **LiveFeedProvider** — per-source **RSS-first adapters** (BLUEPRINT: RSS-first, one adapter per source, normalize to one Article shape). Wired but dormant in demo (no network calls). Respect robots.txt/terms, excerpt-only (never full text of others' articles — enforced already by the I1 copyright CHECK), attribution + link. Document which of the 10 sources have RSS.
- One switch point (demo→Mock / production→Live), same as I2.

### 2. Normalization (per-source adapter → one Article shape)
- Each source's raw feed item → the normalized Article shape (matching I1 schema): title, source, author, publish date, url, thumbnail, excerpt. Defensive hardening like I2 (never trust external shape; handle missing/malformed/odd encodings gracefully).
- **Detected signals (auto, factual)** captured here where derivable: affiliate links present, sponsored/PR labeled, review-copy mention, paywall, article type. (The *bias scoring* from these signals is I4 — here just capture the raw signals.)

### 3. The clustering engine (the core — REAL, not mock)
This is the hardest, most important part. Build it properly so production only swaps the input.

- **Embeddings via the AI service** (`services/ai`): the Python service gains a real endpoint that turns an article's title+excerpt into an embedding vector (the pgvector(384) columns from I1). Use a sensible, self-contained embedding approach that runs in the demo with no external API/keys (local model or equivalent) — document the choice. The main app calls the AI service; embeddings are stored on the Article (and Topic).
- **Clustering logic:** for each new article, compute its embedding, compare (vector similarity) against existing **open** topics within a **time window**; if similar enough (a **configurable threshold**) → attach to that topic and update it; else → create a new topic. Set the article's **primary** topic. Topics get/maintain their own representative embedding.
- **Guards against the owner's exact fear:**
  - **Configurable similarity threshold** (admin-tunable — not hardcoded) so "too many / too few topics" can be dialed in.
  - **Configurable time window** (articles older than N days don't merge into new ones even if similar — likely a different event).
  - Sensible defaults, but everything tunable from admin.
- **Topic auto-maintenance:** status (Developing/Ongoing/Resolved) updates from activity; timeline events as articles arrive; TL;DR + AI summary generated/refreshed (the AI service synthesizes a neutral summary from the topic's articles — generated once and stored/cached, never on user request, per the speed rule). Clearly labeled AI-generated.

### 4. Editor merge/split + controls (MANDATORY — no auto-clustering is perfect)
- **Merge:** combine two topics the engine wrongly split. **Split:** break out articles the engine wrongly lumped together (move selected articles to a new/another topic, reassign primary). Both audit-logged.
- **Reassign:** move an article to a different topic; change which topic is primary.
- **Threshold/window tuning** from admin (the configurable values above), with a way to see the effect.
- All of this in the admin (building on I1/I2 admin patterns).

### 5. Game attachment (reuse I2)
- As articles are processed, resolve referenced games via I2's **`resolveOrQueue`** — known games attach (Article↔Subject), unknown games auto-create from the provider or file into the unmatched queue. No new resolve logic — reuse I2.

### 6. Background pipeline (reuse I2's job pattern)
- The whole pull → normalize → embed → cluster → summarize flow runs as **background jobs** (BullMQ, like I2's catalog import) — never on the user request path. In demo it processes the mock feed on boot (and re-runnable from admin). Idempotent (re-running doesn't duplicate articles or splinter topics).

## Out of scope (do NOT build in I3)
- Bias *scoring* on the two axes, rating aggregation, disconnect (I4) — capture raw signals + store embeddings, but don't compute bias/quality scores.
- Public topic/article/homepage UI (I5) — this is engine + admin only.
- Real RSS/network calls in demo (Live provider dormant).
- User trust/influence votes, comments (I6) — community tables exist (schema-room from I1); no flows here.
- Real Steam/player data, FPS (later).

## Decisions you (the agent) make
The embedding approach (must run locally in demo, no keys), the similarity metric + default threshold/window, the mock-feed dataset shape and how the "events" are seeded so clustering has real groupings to find, the merge/split UX, how topic summaries are generated/stored. Prefer a clean seam and clarity. Document the embedding choice and defaults.

## Constraints (from CLAUDE.md)
- **Demo never calls live APIs / network**; embeddings run locally; boots with zero real secrets.
- Real engine, mock input — production swaps only the feed provider.
- Nothing heavy on the request path — pull/embed/cluster/summarize are all background; results stored/cached; users (later) read pre-computed topics.
- Validate/harden all external data (messy feeds are exactly the anti-bug target).
- Everything configurable: thresholds/windows in admin, not hardcoded.
- Auto + manual override: merge/split/reassign always available to editors.
- Audit-log every editor action. Respect copyright (excerpt + link only — already CHECK-enforced) and aggregation safeguards.

## Verification (REQUIRED — note results in PROGRESS.md; add `verify:i3`)
1. Fresh `demo:reset` → boot: the mock feed processes in the background; articles are created, embedded, and clustered into topics (report counts: N articles → M topics).
2. **Clustering quality sanity:** articles seeded as the same event land in the same topic; unrelated ones don't. Multi-source events form one topic with multiple sources. (Show a couple of examples.)
3. Threshold is configurable: changing it (admin) measurably changes clustering; time window respected.
4. Each article has an embedding (pgvector populated) and a primary topic; topic has a generated TL;DR + AI summary (stored, labeled AI).
5. Merge/split/reassign work from admin and are audit-logged.
6. Game attach: articles attach to existing catalog games; an article referencing an unknown game triggers `resolveOrQueue` (auto-create or unmatched queue).
7. Idempotent: re-running the pipeline doesn't duplicate articles or splinter topics.
8. Seam = Mock in demo / Live in production (shown; no network in demo). Live RSS adapters exist but dormant.
9. No regression: `verify:i1` + `verify:i2` still pass. Full gate green (Node + Python — Python now has real embedding code, so its tests/lint/типecheck must pass too). `npm run health` green. Demo boots one command, zero secrets.

## Done looks like
From a fresh `demo:reset`, the stack boots and the background pipeline turns a realistic mock feed into a clean set of Topics — same-event articles grouped, unrelated ones separate, each topic with sources listed, a generated neutral AI summary, attached games, and a primary topic per article. An editor can merge two topics, split one, retune the threshold, and see it reflected — all audit-logged. The clustering engine is real; only the feed is mock. PROGRESS.md records article/topic counts, the embedding choice + default threshold/window, verification results, and that I4 (bias + rating system) is next.

---

### Note for the next phase (I4 preview — do not build yet)
I4 computes the two public bias axes (Influenced↔Independent, Slop↔Top) from the raw signals captured here + source reputation, plus the rating aggregation (three layers, 0–100 internal), disconnect calc + context tag, community weighting, and game-page Content Flags logic. Structure the captured signals + topic/article storage so I4 computes on top without churn.

**Clustering secondary gate (carried from the I3 adversarial test — build in I4):** single-vector + one-threshold clustering has a proven structural ceiling — it over-merges *same-game / same-register* events (a Cyberpunk "sequel pre-production" vs "30M sales" pair scored 0.68, above the 0.50 threshold, where they should separate; meanwhile a true-merge pair scored 0.50, so no global threshold can satisfy both). I3 accepts this and relies on editor split. **I4 should add a secondary gate on top of the cosine decision** using the per-article signals + game links already captured in I3 — e.g. *same primary-game + a time gap + a different event type → resist auto-merge*. This is architecturally enabled now (signals + `article_subjects` exist) and was deliberately left out of I3 scope.

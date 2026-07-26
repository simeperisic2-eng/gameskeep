# GamesKeep — Claude Code Project Rules

> This file loads every session. Keep it short. Full plan lives in `BLUEPRINT.md` (read it on demand).
> Asset locations & secrets: `ASSETS.md`. Setup & usage: `README.md`.

## What this project is
Premium gaming platform combining **news aggregation + bias analysis** (Ground News–style) with a **rating/ranking system** (Rotten Tomatoes / IMDb–style), focused on video games. Global, English. Senior-level, multi-file architecture.

## Golden rules (IMPORTANT)
- **DEMO-FIRST.** Build a fully working offline demo with **mock/fake but realistic data** and **real behavior**. No live external calls in demo mode. Real engines (clustering, scoring, bias) are REAL even in demo — only the data source is mocked. The data-source layer must be swappable to live with minimal change.
- **NOTHING HEAVY ON USER REQUEST.** All heavy work (article pulls, clustering, AI summaries, player-count refresh) runs in **background jobs** and is **cached/stored**. Users always read pre-computed results. Pages must be fast regardless of how slow external sources are.
- **AUTO + MANUAL OVERRIDE EVERYWHERE.** Every automated system (clustering, bias signals, ratings, statuses, videos, FPS) must be fully editable/override-able by staff. Automation runs without human input, but humans can always correct.
- **EVERYTHING CONFIGURABLE FROM ADMIN.** No hardcoded lists, thresholds, or weights. All lists/rankings, clustering thresholds, rating weights, ad slots, source settings live in admin.
- **AUDIT LOG.** Every staff action (who/what/when/old→new) is logged immutably.
- **GUARD AGAINST BUGS & EDGE CASES.** This is a stated top priority. Validate inputs, handle empty/missing/malformed data, never assume external data is well-formed. Prefer typed code; handle nulls explicitly.

## Verification (REQUIRED — do not skip)
Every phase ends with a check YOU run before calling it done:
- Run the test suite / build / linter and make sure it passes.
- Address root causes, never suppress errors.
- Briefly note the result in PROGRESS.md (e.g. "tests pass, build clean"). No screenshots needed.

## Workflow
- Work **phase by phase** (see `BLUEPRINT.md` → Implementation Phases I0–I9). Do not jump ahead.
- Each phase has its own SPEC. Build only what the current SPEC covers; list anything out of scope.
- Explore & plan before coding on multi-file changes. If you could describe the diff in one sentence, just do it.
- After a phase, write/update tests and ensure they pass before considering it complete.
- **PROGRESS.md:** at the end of each phase/session, briefly append what you did, what's done, and what's next, so the next session knows where to continue. Keep it short — a few lines, not an essay.
- **OWNER-TODO.md:** keep a running list of everything the owner must fill in manually (logo, About/Methodology/Contact/legal text, API keys, etc.) with its exact location. Whenever you leave a placeholder in code/content, mark it with the exact tag `[[OWNER-TODO: short description]]` so it's greppable, and add a matching line to OWNER-TODO.md.

## SEO (REQUIRED — build in from the start, not a later phase)
SEO is a top priority (free traffic is core to a news platform). Bake in from the foundation; refactoring later is painful.
- Server-side rendering / pre-rendering so crawlers see full content (critical for news + ratings).
- Clean semantic URLs (`/games/cyberpunk-2077`, `/topics/...`) — this is also where keyword-SEO lives.
- Meta tags, Open Graph, Twitter cards on every page.
- **Structured data / schema.org**: VideoGame, Review, AggregateRating, NewsArticle — so scores/reviews can show as rich results (stars) in search.
- Auto-generated **sitemap.xml** (content changes constantly) + robots.txt.
- **Breadcrumbs** (user + SEO).
- **Canonical tags** (important: we aggregate excerpts — avoid duplicate-content penalties).
- Core Web Vitals / speed (already covered by the cache-everything rule).

## Security (REQUIRED — build in from the start)
- Protect against injection, XSS, CSRF — especially important: we accept user-generated content (comments, reviews).
- Secure auth: hashed passwords, secure sessions, login rate-limiting.
- Cloudflare-ready (bot/DDoS).
- Lock down the Control Panel (strict permission checks + audit log).
- Secrets never in source (see `ASSETS.md`); demo runs without any.
- GDPR/privacy: account deletion, anonymous/aggregated geo analytics only.
- Validate and sanitize ALL input (ties into the anti-bug rule).

## Stack (decided — do not change without asking)
- **Main app:** Node.js + TypeScript, web application, separate backend & frontend. TypeScript everywhere (type safety is a bug-prevention requirement).
- **AI microservice:** Python (clustering, embeddings, bias assist). Communicates with main app via internal API.
- **Database:** PostgreSQL (with vector extension for clustering embeddings).
- **Cache/queue:** Redis (background jobs, caching).
- Choose specific frameworks/libraries yourself, but prefer mature, stable, widely-supported options. No overkill.

## Brand
- Name: **GamesKeep**
- Colors: dark base (warm charcoal, not pure black) + **amber/gold yellow** accent (premium, not neon). Functional green/red only for disconnect & bias indicators.
- Tone: premium, professional, precise, "jaw-dropping" through elegance and restraint — not clutter.
- Logo and all visual assets are **provided by the owner** (see `ASSETS.md`), not generated by the agent. Leave placeholders where assets go.

## Out of scope until told otherwise
- ColorGuess mini-game integration (asset exists, parked).
- Scroll-signature motion element (optional, parked — only if it strengthens the brand; not required).
- Live scraping / live external APIs (demo uses mock feed).
- Real ad-serving/payment (ad slots exist as placeholders showing "AD").
- Forum (per-topic/per-game discussion only).

## Data-source reality (do not assume magic APIs exist)
- Game metadata: **IGDB (primary) + RAWG (fallback)** + admin "unmatched game" queue. Demo uses a local seed.
- Articles: pulled from ~10 gaming sources via **RSS-first, per-source adapters** → normalized to one Article shape. Demo uses a realistic mock feed.
- Player counts: **Steam only** (no public console live counts). Label clearly.
- FPS benchmarks: **no public API** — editor-entered + community-reported, "where available", else mock/empty with edit option.
- Internet community sentiment: **Steam % auto** + editor note for Reddit/others (no NLP pipeline in demo).

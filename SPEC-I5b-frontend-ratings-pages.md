# SPEC — Phase I5b: Public Ratings Pages (Game / Catalog / Upcoming / Source)

> Read `CLAUDE.md` (Golden rules, SEO, Security, Brand), `BLUEPRINT.md` (2.3 Game, 2.4 Upcoming, 2.5 Source, 3.2/3.4/3.5/3.6 pages), `PROGRESS.md`, and the I5a foundation before starting. This SPEC is the single source of truth for **this phase only**; where it conflicts with the blueprint, this SPEC wins for I5b. I0–I5a are complete and verified — the design system, shared layout, SEO layer, shared components (CoverArt / BiasBar / ArticleFlags / Breadcrumbs / AdSlot) and the leak-proof public API pattern all exist and are proven. **This phase renders pre-computed, stored DTOs only. Nothing heavy on the request path.**

## Why I5 is split (recap)
I5a built the foundation once and proved it on the two **news-side** pages (homepage + topic). I5b builds the **ratings/IMDb side** on that exact proven skeleton — engine-consuming UI only, consuming the I4b rating/disconnect/content-flag DTOs (which already model the "data exists?" distinction so empty fields never render).

## Goal
Deliver the public ratings pages on the locked premium design system:
1. **Game page** (`/games/[slug]`) — BLUEPRINT 2.3 / 3.2. The hub. **BUILD FIRST, then STOP for owner visual review** (the topic page had a CSS layout collapse the HTML verifier couldn't catch — visual review gates each step, same as I5a).
2. **Catalog / browse** (`/games`) — BLUEPRINT 3.4. Game list + filters (genre, platform, status, sort).
3. **Upcoming** (`/upcoming`) — BLUEPRINT 2.4 / 3.5. Status + future release date + countdown + hype-vote slot (I6 placeholder).
4. **Source pages** (`/sources`, `/sources/[slug]`) — BLUEPRINT 2.5 / 3.6. Per-outlet ownership + conflict indicator + reputation + stats + its articles.

## The game page (order, top → bottom; BLUEPRINT 2.3 / 3.2)
- **Header** — cover (designed licensed-cover slot, never a scraped image), title, metadata (developer, publisher, release date, status, age rating, series), genres/platforms/mode/tags as chips, background hero slot.
- **Three-layer rating block** — **Our score** / **Media Critics** (aggregate + outlet count + outlet entries with score/native-scale/excerpt/link) / **Community** as **two never-merged lines** (Our community weighted + count, and Across-the-web Steam estimate labeled "estimate"). The **critic↔community disconnect** indicator + band + **sub-levels** (Our↔Critics, Community↔Web) + the **editor context tag** where set. Visible **unusual-activity** flag where the (effective) burst flag is set (never silent). Scores display 1–10 one decimal (stored 0–100).
- **Content Flags** — AI-asset disclosure, launch state, monetization, complexity — **shown ONLY where data exists** (never an empty/unknown field).
- **Our structured review** — verdict, pros/cons, platform tested, hours, body, our score — where it exists; badged "ours".
- **Related topics** — the news↔ratings bridge (stories that mention this game).
- **Articles that mention the game** — excerpt + link only, per-article influence flags (the copyright posture from I5a).
- **Videos / FPS / prices / system-requirements / DLC / player-count** slots — **where data exists** (empty in demo → not rendered).
- **Related games** — same series / genre (discovery).
- **Community slot** — I6 placeholder (no real flows).
- **Ad slot** — labeled "AD" (every page ≥1 slot), naturally placed (near videos/FPS).

## Leak-proof (CRITICAL — same wall as I5a)
The public game DTO selects an explicit **allowlist** of columns and **never** exposes internal-only rating internals: no `internal_assessment`, no community **naive** score, no editor **override** raw values, no **burst-info** internals (multiplier/window math). Effective values only (override ?? auto), the editor context tag (public-eligible by design), and the visible burst **flag** boolean. **Verify on the served HTML/JSON**, not the DTO.

## SEO (proven, not declared)
- SSR full content (crawlers see the ratings, not a JS shell).
- Clean URLs (`/games/<slug>`, `/sources/<slug>`).
- **schema.org `VideoGame` + `AggregateRating` + `Review`** on the game page (validates; truthful — only where a real score + count ≥ 1 exists). Canonical, OG/Twitter, breadcrumbs on every page.
- Extend `sitemap.xml` with game (and source) URLs.

## Out of scope (do NOT build in I5b)
- Auth / login / real community flows (votes, comments, hype-vote, follow) — **I6.** Slots/placeholders only.
- Real newsletter / ad serving — empty labeled slots only.
- Submit-a-game / promote-a-game flows — later light additions on the existing queue/ad-slot mechanisms.
- Live player-count / FPS / price pulls — render stored data; empty in demo.
- Awards visuals, live system visualizer, scroll-signature — later.
- Any recomputation on the request path.

## Verification (REQUIRED — note in PROGRESS.md; add `verify:i5b`)
Mirror the `verify:i5a` style on the **served output**:
1. Stack ready.
2. Game-detail API returns a full hub (three layers + disconnect + content flags where data) and is **leak-proof** (no internal/naive/override/burst-internal keys in JSON).
3. Game page **SSR** has full content (title, three-layer block, disconnect, content flags) in the served HTML; **leak-proof** on the HTML.
4. **Content-flags-only-where-data:** a game without a flag value never renders that field.
5. schema.org **VideoGame + AggregateRating + Review** present and well-formed; canonical self-points; OG/Twitter/description present; breadcrumbs present.
6. Catalog renders + filters work over SSR'd data; Upcoming renders countdown + future dates; Source page renders ownership/conflict/reputation/stats + its articles.
7. Unknown slug 404s (game + source).
8. sitemap includes game URLs.
9. **No regression:** `verify:i1`/`i2`/`i3`/`i4a`/`i4b`/`i5a` still pass; `npm run health` green; full gate (tests + lint + typecheck + Prettier + next build) green; demo boots one command, zero secrets.
10. **Visual review gates each step** — game page reviewed by owner BEFORE catalog/upcoming/sources (the topic-page CSS-collapse lesson).

## Done looks like
From a fresh `demo:reset`, the stack boots and a premium game page renders server-side: header + the three separated rating layers + the disconnect (band, sub-levels, context tag) + content flags (only where data) + our review + related topics + the articles that mention the game + related games — on the exact I5a design system. Catalog browses + filters the catalog; Upcoming counts down to future releases; source pages show ownership/conflict/reputation/stats. schema.org validates, the game page is leak-proof on the served HTML, and the owner approved the game-page layout off a real render before the other pages were built.

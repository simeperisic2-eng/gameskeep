# SPEC — Phase I5a: Frontend Foundation + Homepage + Topic Pages

> Read `CLAUDE.md` (esp. SEO + Security + Brand sections — they are first-class here, not later), `BLUEPRINT.md` (1.2 target user "5 seconds for casual, depth for enthusiast", 1.3 the differentiator / hero, 2.1 Topic, 2.2 Article, 3.1 Homepage, 3.3 Topic page, 3.13 Methodology), `ASSETS.md` (logo/brand placeholders), and `PROGRESS.md` before starting. This SPEC is the single source of truth for **this phase only**; where it conflicts with the blueprint, this SPEC wins for I5a. I0–I4b are complete and verified — all engines (clustering, bias, rating, disconnect, weighting) are built, stored, and expose pre-computed, leak-proof DTOs. **This phase renders those pre-computed results. Nothing heavy on the request path.**

## Why I5 is split (I5a / I5b)
The full I5 is every public page. That's too much to verify cleanly in one pass, and frontend pages share a skeleton (nav, footer, theme, cards, the bias-bar and rating components, the whole SEO layer). Splitting **news-vs-ratings** would force building shared components twice. So the split is **foundation-then-pages**: I5a builds the design system + SEO infrastructure + shared components **once**, proves them on the two news-side pages (homepage + topic), and front-loads the cross-cutting risk (does SSR/SEO actually work? does the internal field actually stay out of the HTML?). I5b then builds game/upcoming/sources pages on the proven skeleton. This SPEC is **I5a only.**

## Goal of this phase
Stand up the **premium public frontend foundation** — design system, shared layout, SEO baked in — and deliver the **homepage** and **topic (story) pages** on top of it: the news/GroundNews side, where the bias bar goes public for the first time. It must look genuinely premium (the brand promise), be fast (SSR pre-computed data), rank (real SEO, not declared), and **never leak an internal field into the public HTML.**

## Step 1 — ONE hero+top mock FIRST (before building the full pages)
Per the owner's decision, do NOT build the full homepage blind. **First deliver ONE living hero + top-of-page mock** on mock data, so the owner reacts to something concrete and we tweak it together (the same "propose → owner tunes" loop used for the I3 threshold and I4 weights). Then build the rest on the approved look.

The mock must demonstrate the agreed visual direction (see Step 3 brand spec):
- The **continuous "page-in-one-piece" gradient** flowing through the hero into the next section(s) — warm charcoal base + a single amber glow, crossing section boundaries with no visible seam.
- A **subtle black/amber pixel-dither texture** over the gradient — low-contrast, fine-grained, grid-aligned so it reads as a premium *texture* with a faint pixel quality, NOT as visible 8-bit/retro motif. Denser at section seams (doubles as the "seam" blend), quieted behind content so it never fights readability. **The test: a viewer should say "nice premium background," not "oh, a pixel/retro site." Pixel is a touch you *feel*, never a theme you *name*.**
- The **hero itself:** a list of several trending topics on one side; the selected one enlarges on the other with its cover image, TL;DR, and the **bias bar** (the signature visual). Selection is **user-driven** (hover/click), the highlighted/ordering is decided at **server render** (refresh-rotation), **no auto-timer carousel** that steals control. Cover images **fade into** the gradient at their edges (no pasted-rectangle look).

Owner approves/tweaks the mock (especially the pixel-dither intensity — that's tuned by looking, not describing) before the full page is built. Keep the mock simple and real (actual components, mock data) — not a throwaway.

## Step 2 — Foundation (the shared skeleton, built once)

### Design system
- Theme tokens (CSS variables) for the brand: **warm charcoal base (not pure black) + amber/gold accent**; functional green/red **reserved exclusively** for bias/disconnect indicators (never decorative). Defaults set, tunable (the `globals.css` / theme-config placeholder from OWNER-TODO).
- Typography scale, spacing scale — **airy by default** (generous whitespace; the premium-gallery direction, not a dense dashboard). The gradient needs empty space to breathe; density would kill it.
- Brand via **discipline + colour, NOT literal castle theming.** Warm charcoal + amber *is* the keep translated into colour (stone + gold banner); no literal castle/medieval illustration anywhere on content pages. The logo (tower) lives in the header per ASSETS.md placeholder; pixel/playful motifs are reserved for footer/Awards/edge states — **explicitly out of scope here.**
- Read `/mnt/skills/public/frontend-design/SKILL.md` before building — it carries the environment's design-token and styling constraints.

### Shared layout
- **Header:** logo placeholder (the `[[OWNER-TODO]]` "GK" until the SVG is added), main nav (Home / Games / Topics / Upcoming / Awards / Sources — links exist even where the target page is I5b/later, degrading gracefully), global search entry (animated search affordance is fine — a baseline micro-interaction, not a "feature"), login/profile placeholder (auth is I6).
- **Footer:** About, Methodology, Contact, Privacy/GDPR, Terms (links/placeholders; full static-page content is later), social links. (The footer pixel easter-egg is a later/edge touch — leave room, don't build it now.)
- Smooth micro-interactions (hover states, transitions) as **baseline premium hygiene**, not as the "wow" — the wow is the gradient + the bias bar.

### Shared components (used by both pages now, and I5b later)
- **Bias bar** — the signature. Two bars (Influence on top, Quality below) per BLUEPRINT 2.1/3.3, showing the distribution; **hover/click reveals *why*** (consuming I4a's stored breakdown DTO). Consistent everywhere. Green/red only here + disconnect.
- **Topic card** (title, TL;DR, mini bias bar, article count, game tags, time).
- **Article row** (source + reputation, title, excerpt, bias labels, date, link).
- Mini rating / disconnect chip (for games-in-focus; full block is I5b).

### SEO infrastructure (REQUIRED — proven, not declared)
This is a top priority per CLAUDE.md (free traffic is existential for a news platform). Build it into the foundation:
- **SSR / pre-rendering** so crawlers see full content — verified by `view-source` showing the real content, not an empty JS shell.
- **Clean semantic URLs** (`/topics/<slug>`, ready for `/games/<slug>` in I5b).
- **Meta tags + Open Graph + Twitter cards** on every page (this is also what makes shared links look professional — the cheap big win).
- **Structured data / schema.org** — `NewsArticle` on articles, `AggregateRating` where ratings appear, validating on Google's Rich Results test (or schema.org validator) — show it validates.
- **Auto-generated `sitemap.xml`** + `robots.txt`.
- **Breadcrumbs** (user + SEO).
- **Canonical tags** — **critical**: we aggregate excerpts, so canonical must point correctly to avoid duplicate-content penalties (BLUEPRINT aggregation safeguard).
- Core Web Vitals / speed — already served by the cache-everything rule; keep the pages light.

### Security baseline (from CLAUDE.md)
- Secure headers, output encoding/escaping on all rendered data (we render aggregated external content — XSS surface). No secrets in the client. (Full auth/CSRF is I6; here it's safe rendering of pre-computed data.)

## Step 3 — The two pages

### Homepage (BLUEPRINT 3.1) — "newspaper front-page feel"
Modules, composed airy on the continuous gradient:
- **Hero** — the approved Step-1 hero (trending list + enlarged panel + cover + TL;DR + bias bar). The "wow."
- **Side rankings module** (3 tabs, BLUEPRINT 3.1): **Trending** / **Top Rated** / **Most Discussed** — this is where the *ratings* side peeks onto the homepage, so the page reads as news+ratings, not news-only. (Tabs configurable later; here render the three from pre-computed data.)
- **Latest news** column — newest articles, **updates** (newest on top when present), **never auto-scrolls** (updating ≠ self-scrolling; self-scroll fights reading). On mobile this moves **below the first section or two** (per owner). In demo the feed is static (processed on boot), so "latest" = newest of what exists; structured to receive a live trickle in production.
- **Main feed** — newest/active topics as cards (infinite scroll / load-more), each with a mini bias bar.
- **Games in focus** — recently rated, **controversial (big disconnect)**, upcoming highlights — this is where the **disconnect** differentiator surfaces on the homepage (bridges news ↔ catalog).
- **Newsletter subscribe** block — placeholder capture (real newsletter is I8); leave its layout slot so I8 doesn't reflow the page.
- **Ad slot** — empty, labeled **"AD"** (BLUEPRINT "every page has ≥1 slot"; no real ads).
- **Responsive:** the hero has a **distinct mobile form** (stacked, not a squeezed desktop); ~half of news traffic is mobile.

### Topic (Story) page (BLUEPRINT 3.3) — heart of the news side
- **Header:** title, TL;DR, status, type, linked games (tags → game page, which is I5b — link target degrades gracefully), date/last-update.
- **AI summary** — clearly **labeled AI-generated** (the stored I3 summary).
- **Bias bar** — two bars (Influence top, Quality below), hover for why (I4a breakdown). The topic-level distribution from I4a.
- **All articles from all sources** — each as an article row (source + reputation, title, excerpt, bias labels, date, link to original). **Sort** (by source / bias / date incl. newest-first) + **filter** ("independent only" / "influenced only" / "top quality only").
- **Timeline** (when status = Developing).
- **Community** placeholder (votes/comments/reactions are I6 — show the slot, don't build flows).
- **Related topics.**
- **Promoted-article ad slot** — same format as an article card, labeled "AD."
- **Per-article copyright:** excerpt + summary + link only — never full text (already CHECK-enforced; the page must respect it — link out to the source, attribution clear, the aggregation legal posture).

## The leak-proof moment (CRITICAL — this is the phase that proves the I4a/I4b wall)
The internal-only bias assessment field (I4a) and raw rating internals (I4b) are now rendered-adjacent for the first time. **Verify on the actual public HTML, not just the DTO:** fetch the rendered homepage + a topic page and confirm `internal_assessment` (and any internal-only value) appears **nowhere** in the served HTML/JSON. This is the exact scenario the leak-proof DTO + allowlist serializer were built for; I5a is the moment of truth. A leak here is a critical failure, not a cosmetic one.

## Out of scope (do NOT build in I5a)
- **Game page, catalog, Upcoming, Source pages — I5b.** (Build the shared rating/disconnect *chip* for games-in-focus; the full game-page rating block is I5b.)
- **Auth / login / register / real community flows (votes, comments) — I6.** Show placeholders/slots.
- **Real newsletter / ad serving — I8.** Empty labeled slots only.
- **Footer pixel easter-egg, Awards visuals, scroll-signature, live system visualizer — later/I7/I9.** No playful motion on content pages.
- Static-page *content* (About/Methodology/Privacy/Terms copy) — links/placeholders now; polished copy later (the agent may draft Methodology later per ASSETS.md, not here).
- Any recomputation on the request path — render stored DTOs only.

## Decisions you (the agent) make
The exact component architecture, the hero's precise layout + interaction, the gradient/pixel-dither implementation (CSS/canvas — must stay light + SSR-safe), the responsive breakpoints, how the modules are arranged within the airy/premium direction, the SEO/schema implementation details. Prefer restraint and clarity. The hero + gradient + dither intensity are tuned **with the owner** off the Step-1 mock.

## Constraints (from CLAUDE.md / BLUEPRINT)
- SEO baked in from the foundation (SSR, schema.org, sitemap, canonical, OG/meta, breadcrumbs) — proven, not declared.
- Premium, airy, restrained — "jaw-dropping through elegance and restraint, not clutter." Brand via colour/discipline, not castle theming.
- At most ONE signature motion per screen (the gradient/dither is it on the homepage); subtlety over spectacle.
- Nothing heavy on request — render pre-computed, cached DTOs; pages fast regardless of source speed.
- Internal fields never reach the client; render aggregated content safely (escape/encode — XSS).
- Excerpt + link only for aggregated articles; clear attribution.
- Responsive (mobile is first-class, distinct hero form).
- Accessibility not ignored (semantic HTML, contrast — the amber-on-charcoal must pass contrast; full a11y pass is I9 but don't build inaccessible).

## Verification (REQUIRED — note results in PROGRESS.md; add `verify:i5a`)
1. **Mock-first:** the Step-1 hero mock was delivered, owner-approved/tweaked, before the full page (note it in PROGRESS).
2. Fresh `demo:reset` → boot: homepage + a topic page render server-side with real seeded data (topics, bias bars, rankings, latest, games-in-focus).
3. **SSR proven:** `view-source` (or curl) of both pages shows full content in the initial HTML, not an empty JS shell.
4. **SEO proven:** schema.org (NewsArticle / AggregateRating) present and **validates**; `sitemap.xml` + `robots.txt` served; canonical + OG/meta/Twitter present on both pages; breadcrumbs present. Show the validator result.
5. **Bias bar works:** renders the I4a distribution; the hover/click "why" reveals the breakdown.
6. **Leak-proof (critical):** `internal_assessment` / internal-only values appear **nowhere** in the served HTML/JSON of either page. Show the check.
7. **Topic page:** articles list with sort + filter (independent/influenced/top-quality) working; excerpt+link only (no full text); AI summary labeled.
8. **Responsive:** hero + pages render correctly at mobile width (distinct hero form; latest-news repositioned).
9. **Premium bar:** the gradient/dither + bias bar deliver the agreed look (owner sign-off on the rendered pages, not just the mock).
10. **No regression:** `verify:i1`/`i2`/`i3`/`i4a`/`i4b` still pass. Full gate green (Node + Python). `npm run health` green. Demo boots one command, zero secrets. Lighthouse/Core-Web-Vitals sanity (no blocking regressions) — full perf pass is I9.

## Done looks like
From a fresh `demo:reset`, the stack boots and a genuinely premium homepage renders server-side: a continuous warm-charcoal→amber gradient with a subtle pixel-dither touch flowing through the hero (trending list + enlarged panel + cover + TL;DR + signature bias bar) into the rankings, latest-news, main feed, and games-in-focus (where disconnect surfaces) — airy, fast, fully crawlable. A topic page renders the full story (AI summary labeled, bias bar with hover-why, all sources' articles with sort/filter, excerpt+link only). schema.org validates, sitemap/canonical/OG are present, and `internal_assessment` is provably absent from the served HTML. The hero look was approved off a single mock and tuned with the owner. No game pages, auth, real newsletter/ads, or playful motion yet. PROGRESS.md records the mock-first approval, the SEO/leak-proof verification, and that I5b (game / upcoming / source pages) is next.

---

### Note for the next phase (I5b preview — do not build yet)
I5b builds the ratings-side public pages on this proven skeleton: **game page** (header → three-layer rating block + disconnect + sub-levels → premium analytics → our review → related topics → articles → videos/FPS/prices → related games → community), **catalog/browse**, **Upcoming** (countdown, hype-vote slot), **Source pages** (ownership + conflict + reputation + stats). All consume I5a's design system, shared components, and SEO layer + I4b's rating/disconnect/flags DTOs (with the "data exists?" distinction so empty fields never render). Schema.org `VideoGame` + `Review` + `AggregateRating` there. Nothing heavy on request — render stored DTOs.

### Note carried (so it isn't lost — media/writer awards)
Still pending for **I7**: awards for media outlets + article writers (winners published only, separate tab/page), reusing the Awards edition→category→nomination→outcome structure with a Source/Person subject. Belongs with I7.

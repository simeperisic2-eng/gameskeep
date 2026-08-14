# GamesKeep — Owner TODO

> Everything **you** (the owner) need to fill in manually. The agent adds a line here for every `[[OWNER-TODO: ...]]` placeholder it leaves in the code/content, with the exact location. Open this one file to see everything that's waiting on you.
>
> To find every placeholder in the project at once, search the codebase for: `[[OWNER-TODO`

## How to read this
- **Location** = where to put it (assets folder path, admin field, or static page).
- **Needed for** = demo or production. The demo works without production items.

| Item | Location | Needed for | Status |
|---|---|---|---|
| Logo (light) `logo.svg` | `apps/frontend/public/assets/logo.svg` (rendered in `SiteHeader.tsx` + `SiteFooter.tsx`) | demo | **Owner asset wired + enlarged** (from `/reference/gklogo.svg`). ⚠️ **CONFIRMED: the asset has a baked LIGHT background** — it shows as a visible **grey/white rectangle (box) around the tower** on the charcoal header. This is an **asset problem, not a code one** — nothing to fix in CSS. **REQUIRED for the premium finish: a true vector SVG (or transparent-background PNG) with NO baked background**, ideally a compact emblem (+ optional separate wordmark). It is also a **295 KB raster-in-SVG** (heavy per page load). The "GamesKeep" wordmark text sits beside the emblem — remove it if your new asset already includes the wordmark. |
| Logo (dark) `logo-dark.svg` | `apps/frontend/public/assets/` | demo | Not yet used |
| Favicon `favicon.ico` | `apps/frontend/public/assets/` | demo | None yet |
| **Social / OG share image** `og-default.png` (1200×630 PNG) | `apps/frontend/public/assets/og-default.png` (referenced by `apps/frontend/lib/schema.ts` → `shareImage()` and by per-page Open Graph). | demo→production | **Placeholder in use:** schema/OG currently point to `logo.svg` so structured data validates, but social cards + Google news rich results want a real raster 1200×630 share image. Drop the PNG in and switch `shareImage()` to it. |
| Brand colors & font | `apps/frontend/app/globals.css` (base CSS variables) | demo | Sensible dark + amber defaults set; tunable |
| **Hero gradient + pixel-dither intensity** (the signature look, tuned by eye) | `apps/frontend/app/(site)/site.css` → `.gk-site` block, vars flagged `[[OWNER-TUNE]]`: `--gk-dither-strength` (grain opacity), `--gk-dither-cell` (grain size), `--gk-glow-strength` (amber hero glow) | demo | Defaults set (0.5 / 4px / 0.18); tune with the agent off the rendered page |
| Company/legal name, slogan, contact email | Admin → Settings (arrives I8); contact placeholder `wrathsystems@gmail.com` | demo | Default "GamesKeep" until then |
| About / Methodology / Privacy / Terms text | Static pages (arrive I5/I8) | demo | Not built yet |
| `SESSION_SECRET` | `.env` (see `.env.example`) | **production** | Insecure demo default in code; set a real one before prod |
| `ADMIN_API_TOKEN` (guards `/admin/api`) | `.env` (see `.env.example`); demo default `demo-admin-token` | demo→**production** | Set a strong token before exposing the admin; full login/RBAC arrives I8 |
| **Owner password** (seed `admin` has none by design) | Run `docker compose exec backend npm run set-owner-password -- --username admin` (prompts hidden; or `-e OWNER_PASSWORD=…`). Argon2id-hashed, never in source — `apps/backend/src/scripts/set-owner-password.ts` | demo→**production** | Set before exposing the admin; login/RBAC live since I6 Slice 3 |
| IGDB / RAWG / Steam / YouTube / email / OAuth keys | `.env` secret fields (documented in `.env.example`) | **production** | Blank — demo runs without them |
| **IGDB game metadata (primary)** — `IGDB_CLIENT_ID` + `IGDB_CLIENT_SECRET` | `.env` (create a Twitch app at dev.twitch.tv → these are the Twitch app's Client ID + Secret; IGDB uses Twitch OAuth client-credentials) | **production** | Blank in demo. The live provider (`apps/backend/src/data-source/games/live-provider.ts`) is fully wired but dormant until set + `APP_MODE=production`. |
| **RAWG game metadata (fallback)** — `RAWG_API_KEY` | `.env` (free key from rawg.io/apidocs) | **production** | Blank in demo. Used only if IGDB fails/misses. |
| **Go live for game data** — flip `APP_MODE=production` | `.env` (the ONE seam switch — `getGameDataProvider()`); then the catalog import + auto-resolve pull from IGDB/RAWG instead of the mock dataset. Do an initial gentle catalog import (it's rate-limit-aware). | **production** | Demo stays on the mock catalog (`APP_MODE=demo`). |
| **Confirm RSS feed URLs + legal review (article aggregation)** | `apps/backend/src/data-source/articles/sources.ts` (the 10 sources' `rssUrl`). Verify each feed URL is current AND that each source's robots.txt / Terms permit feed use; complete a legal review (esp. EU) before enabling live pulls. | **production** | The live RSS provider (`apps/backend/src/data-source/articles/live-provider.ts`) is fully wired but **dormant** in demo (mock feed only). |
| **Go live for the article feed** — flip `APP_MODE=production` | `.env` (same seam switch — `getArticleSourceProvider()`); then the pipeline pulls real RSS instead of the mock feed. The clustering/embedding engine does NOT change. | **production** | Demo stays on the mock feed (`APP_MODE=demo`). |
| **Tune the bias weights** (the additive influence/quality weights) | Admin → Bias engine (`/admin/bias`), stored in `app_settings` → `bias-weights`. Agent-proposed seed values; tune on real data. | demo→production | Seeded with documented defaults (see PROGRESS I4a). All tunable, nothing hardcoded. |
| **Revisit `paywall = 0` (known-soft default)** | Admin → Bias engine, influence weight `paywall`. Arguably leans mildly negative (reader can't verify a paywalled source) rather than neutral; left at 0 pending real-data evidence. | production | Flagged soft; rounding-error call for now. |
| **Tune the gate's `minEventGapDays` (default 2)** | Admin → Bias engine → secondary gate (stored in `app_settings` → `clustering.gate`). Expected to be the FIRST knob tuned once real clustering is observed. | demo→production | Seeded at 2 days; tunable live. |
| **Tune the event-kind lexicon** (keywords that classify event kinds for the gate) | Admin → Bias engine / `app_settings` → `clustering.eventKindLexicon`. Owner-editable so retuning the gate needs no code change. | demo→production | Seeded with a sensible keyword set per kind. |
| **Source ownership → publisher data (for the COI bias signal)** | Admin → Sources (`parentCompany`) + games (`publisher`). The "source covers a game its parent publishes" influence signal only fires where BOTH are populated; in the demo's 10 outlets it's mostly dormant. | production | Implemented + correct; fill real ownership data for it to fire. |
| **Tune the community-weighting params** (credibility curve, burst detection, disconnect bands) | Admin → Rating engine (`/admin/ratings`), stored in `app_settings` → `ratings`. Agent-proposed seed values; tune on real data. | demo→production | Seeded with documented defaults (see PROGRESS I4b). |
| **Tighten burst `extremeFraction` (default 0.60) — FIRST knob to revisit** | Admin → Rating engine → burst params. 0.60 catches blunt 99%-0/10 bombs; a sophisticated bomber mixing in some 3s/4s could dodge it. Tighten on observed attack data. | production | Flagged as the first tuning target. |
| **Wire verified-playtime to Steam (community-weighting layer 3)** | `game_user_ratings.hasVerifiedPlaytime` is a structure-only slot (0 weight in demo). When Steam is connected, populate it + raise `ratings.credibility.playtime` so playtime-verified votes weigh more. | production | Modeled empty; no verification logic in demo. |
| **Per-account rate limits (auth/anti-abuse)** | Real auth (I6) adds per-user login + vote/rating rate limits. The anonymous limiter now exempts token-authenticated admin requests (so bulk staff ops aren't throttled); the public/auth surface still needs proper per-account limits + brute-force protection. | **production** | Deferred to I6 by design. |

---

### Deferred features (decided — not owner-fill, recorded so they aren't lost)
- **Light / dark theme toggle → I9 / post-launch.** Dark (warm charcoal + amber) is the brand default. The design system is built on CSS variables (`globals.css` + `(site)/site.css` tokens), so a light theme is an **additive set of token values + a toggle**, not a refactor. Add once the dark theme is polished and there's user demand.

### Expected items (from ASSETS.md — agent will pin exact locations as it builds)
- Logo (light + dark) + favicon → assets folder → demo (placeholder shown until added)
- Company/legal name, contact email, slogan → admin Settings → demo
- About / Methodology / Privacy / Terms text → static pages → demo (drafts can be agent-provided)
- Brand colors / font → theme config → demo (defaults until changed)
- IGDB, RAWG, Steam, YouTube, email, OAuth keys → secret fields → **production only**
- Cloudflare + hosting setup → infra → **production only**

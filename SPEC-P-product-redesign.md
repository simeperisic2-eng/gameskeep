# Phase P — Product redesign (change spec)

Oct 8, 2026 · @dinja123

## Context and global rules

Phase P changes what the public sees and how editors steer it; the engines stay as built. It runs as 10 slices. Each slice: delta inspection → plan → owner approval → build → verify script → adversarial self-review → report. Every existing suite (verify:i3 through verify:i8, a1, a2, b1, b2, upcoming) must stay green after every slice.

**Invariants — never break these**

- Engines compute everywhere; display is selective. Nothing is removed, only hidden behind settings.
- Prove presence, never absence. No public surface claims an outlet or article is clean; the empty state reads "No signals found".
- The Promoted label and the affiliate disclosure are render-forced. No setting, role or toggle can hide them.
- Data lists are never sold. Trending, By players, Top rated and Our picks reject paid placements at the service and DB layer, not only in the UI.
- Editorial pin ≠ Promoted. Separate mechanisms; an editorial pin never carries a paid label.
- AI never adds claims. It summarises given sources or rewrites editor text; it never introduces facts, numbers, names or links absent from its input.
- No intent is attributed to individuals. People appear as data only.
- Facts carry source + link. Estimates carry a range + method. Missing data reads "Not published".
- Community weighting stays credibility 0→1.0. Anomalies get visible flags, never silent suppression.

**Conventions**

- Every new switch lives in `app_settings` with an admin control and an audit entry. Defaults are listed per slice.
- "Editor" in this spec = moderator rank or higher, unless a slice says admin or owner.
- Demo-first: real engines, mock data. External services (Steam reviews, prices, affiliate, monitoring, backup storage) are dormant seams that activate only when their env keys exist.
- Every new public route gets SSR, schema.org, canonical and sitemap entry, unless the slice says noindex.
- Design: uniform charcoal, amber accent only; green/red stay reserved for bias and disconnect. Restraint over decoration.
- Zero nested anchors. Strict nonce-CSP stays until S10 decides otherwise.

**Slice order**

| Slice | Scope |
| --- | --- |
| S1 | Bias display, naming, review integrity, briefing stat |
| S2 | Homepage sections, admin-configurable, Promoted rules, Δ |
| S3 | Tags: content + issue families, voting gate, filters, tag pages, quick view |
| S4 | Search, news indexing rules, noise categories, editorial lists |
| S5 | Community voice (editor note, Steam reviews summary), team score toggle |
| S6 | Studios, people, financials, disconnect line |
| S7 | Where to buy (authorized + affiliate), image sources |
| S8 | Compliance: age gate, DSA reports, audit export, newsletter double opt-in |
| S9 | Ops: alerts, error monitoring, backups |
| S10 | Caching/performance decision + security review of all Phase P surfaces |

## Slices

### S1 — Bias display, naming, briefing

- **Display scope.** The full bias panel renders only on review articles and on articles with a Sponsored/paid signal. Other news shows at most a small Sponsored chip when that signal exists. The engine still runs on every article. Setting `bias.display_scope` = `reviews_and_sponsored` (default) | `all`.
- **Rename.** The public label "Independent" becomes "No signals found" everywhere: chips, source pages, tooltips, Methodology, newsletter, any structured data. Internal enum values may stay.
- **Quality axis** hidden: `bias.show_quality` = false.
- **Reader bias votes on topics** off: `community.topic_bias_votes` = false. When off, the UI is hidden and the write endpoint rejects. Existing votes are kept, not shown.
- **Review integrity block** on review articles, three rows: review copy from publisher · embargo · sponsored event or press trip. A row appears only when a signal is found, with its evidence (source snippet or editor note + date). No signals → one line "No signals found". Editors can add or confirm a signal manually (audited).
- **Reviews on game pages** sit in their own block pinned above clustered news.
- **Today's briefing** drops the "% independent coverage" stat. Replace with counts: sources today · topics today · reviews today.
- **Methodology copy**: explain the rename in one line — we can show what we found; we cannot prove what isn't there.

Acceptance:

1. A news topic with no sponsored signal renders no bias panel; a review renders the panel and the integrity block.
2. The word "Independent" as a bias label appears in no public SSR HTML (grep every public route).
3. With toggles at default, the topic bias-vote POST is rejected and no quality bar renders.
4. The briefing contains no independence percentage.

### S2 — Homepage sections, admin-configurable

Sections: Today's briefing (existing), Trending, By players, New, Featured, Our picks, Upcoming.

- **Section config** (admin UI, audited): title, enabled, page order, mode (`auto` | `manual` | `pins + auto`), item count, Δ window where relevant, and which tag families and how many tags show on cards.
- **Feed rules per section**: include/exclude by article category, tag, genre and source. This is how the owner decides which articles and tags land in which section.
- **Pins** hold an explicit position; auto fills the remaining slots by the section's rule. Saving invalidates the homepage cache.
- **Two kinds of section.** Data sections: Trending, By players, Top rated (if enabled), Our picks. Discovery sections: New, Upcoming, Featured.
- **Promoted**: only discovery sections may hold at most one Promoted item, at an admin-chosen fixed position, with the render-forced label. Data sections reject promoted placements at service and DB level.
- **Our picks** = team recommendations, never sold, neutral "Our pick" label. **Featured** = editorial discovery highlight; may carry the one Promoted slot.
- **Δ values.** Trending Δ% = topic coverage/engagement score now vs the previous window of equal length. By players Δ% = average Steam concurrent players now vs previous window, from `game_player_counts`. The window shows on the card (e.g. "7d"). Not enough history → "—", never 0% or a guess.

Acceptance:

1. Reordering sections in admin changes the homepage order after save, no deploy.
2. Attaching a Promoted placement to Trending via API is rejected (test).
3. A discovery section with a Promoted item shows the label; no setting removes it.
4. A game below the minimum data points shows "—" for Δ.
5. A pinned item keeps its position across auto refreshes.

### S3 — Tags

**Content tags** (one neutral basket, no colour coding): admin-managed taxonomy. Seed: co-op, local co-op, PvP, single-player, story-rich, open world, roguelike, horror, mature themes, LGBTQ+ content, religious themes. Tags describe content only. Ideology or stance labels are not accepted into the taxonomy; state this policy in admin help text and Methodology.

**Issue tags** (separate family): Bugs, Server problems, Cheaters, Pay-to-win, Always-online DRM, Aggressive monetization. Each instance stores first seen, last confirmed and an optional patch/version. After `tags.issue_expiry_days` (default 60) without fresh weighted votes it becomes "Past issue" with its date range, shown muted. Editors can mark it resolved with a patch reference.

- **Publication gate.** A tag goes public only when its credibility-weighted score reaches `tags.publish_threshold` AND an editor confirms. Until then it waits in the moderation queue.
- Users vote only on existing taxonomy tags, one vote per user per tag per game, withdrawable. New tag names are suggestions to a queue, never live.
- Vote spikes raise the existing anomaly flag; a published flagged tag shows "Unusual voting activity".
- **Game page**: tags grouped Content / Issues. Cards show the configured count.
- **Quick view**: a button on each card opens an accessible dialog with the three rating layers, disconnect, grouped tags and player data (current + Δ). The button sits outside the card link. Data comes from the existing public API, cached.
- **Catalog filter**: three states per tag (neutral / include / exclude), URL params `tag=` and `xtag=`. Filtered combinations are `noindex,follow` with canonical to the base catalog.
- **Tag pages** `/games/tag/[slug]`: SSR, indexable, paginated, in sitemap, schema.org CollectionPage, short admin-editable intro.

Acceptance:

1. A tag above threshold without editor confirmation is not public.
2. A brigade of low-credibility accounts cannot publish a tag and raises the flag.
3. Exclude removes games carrying that published tag; the URL round-trips; the filtered page is noindex.
4. An expired issue tag renders as "Past issue" with dates.
5. Tag pages are in the sitemap; zero nested anchors on catalog cards with quick view.

### S4 — Search, news indexing, editorial lists

**Search**

- The header search becomes real: Postgres full-text across games (title + alternative names), studios, topics and sources.
- Typeahead endpoint: minimum 2 characters, rate-limited. Results page `/search` is SSR and `noindex`.
- Semantic (pgvector) search is out of scope.

**News indexing and noise**

- All topics stay visible on the site.
- A topic is indexable when it has ≥ `seo.topic_min_sources` sources (default 2) OR it has an AI summary and a linked game. Otherwise `noindex,follow` and excluded from the sitemap.
- Per-category display mode in admin: `show` | `low` | `hide` (deals, guides, SEO listicles, etc.). `low` items go to a separate "More" stream and never into Trending or briefing counts.
- Confirm and keep: no standalone page per aggregated outlet article.

**Editorial lists** (new content type "Lists", separate from news)

- Ingestion classifies list-like articles as list candidates into an editor queue.
- Only editor-confirmed official editorial lists are published: year-end best-of, GOTY picks and similar. Everything else stays out.
- Editors match list entries to games with their rank (reuse the unmatched-game matching flow).
- **Consensus view** per year/category: games ranked by number of list appearances, then average rank.
- **Outlet deviation**: computed template lines such as "#1 at Outlet X; absent from every other outlet's top 10". Data only, no adjectives.
- Game page: "On N editorial lists", each linking out.

Acceptance:

1. A single-source topic is visible, `noindex`, absent from the sitemap; a two-source topic is indexed.
2. A category set to `hide` disappears from feeds and briefing counts.
3. An unconfirmed list candidate is never public.
4. Search finds games by partial title; the typeahead rate limit triggers.

### S5 — Community voice, team score

**Editor note "What the community says"** (game pages)

- 2–3 sentences, at least one source link required, as-of date, editor name.
- Optional "Polish with AI": AI rewrites the editor's text only. A validator rejects output containing numbers, names or links not present in the input, and shows the diff. The editor approves before publishing. Both versions are audited.

**Steam reviews summary** (dormant seam, mock data in demo)

- Weekly BullMQ job fetches the last 30 days of Steam reviews for each tracked game.
- AI writes a 2–3 sentence summary; stats (review count, % positive) display beside it.
- Label: "AI summary of N Steam reviews, last 30 days", linking to the Steam page.
- Shown only when N ≥ `steam.reviews_min` (default 50).
- Reviewer names and IDs are stripped before the AI call; no reviewer personal data is stored.
- No Reddit API.

**Team score**

- `editorial.team_score` = false by default. When on, the game page shows the GamesKeep team score as its own number, never mixed into critic or community aggregates or structured data ratings.
- `editorial.team_verdict` = false; the verdict field exists but stays hidden.
- Entered by editors, audited.

Acceptance:

1. An AI polish that introduces a new number or name is rejected.
2. A note without a source link cannot be published.
3. The Steam summary is hidden below threshold and never contains reviewer names (test).
4. With toggles off, no team score appears in SSR HTML or JSON-LD.

### S6 — Studios, people, financials, disconnect line

**Studio pages** `/studios/[slug]`

- Games (developer/publisher role), critic and community averages, disconnect history, issue-tag history, release timeline.
- SSR, schema.org Organization, sitemap. Admin CRUD and game linking.

**People** (public professional roles only)

- Admin-created only. Role whitelist: game director, creative director, lead designer, lead writer, studio head / CEO.
- Fields: name, role(s), studio, credited titles with years, source link per credit. Track record = computed data of credited titles.
- No free-text evaluation field, no photos, nothing about private life.
- A correction/removal request link feeds the moderation queue.

**Financials block** (game pages)

- Entry: metric (budget, revenue, units sold, peak players), value or low–high range, currency, as-of date, type `reported` | `estimated`.
- `reported` requires a source URL (http/https only). `estimated` requires a method note (e.g. Boxleiter method) and renders with an "Estimate" badge and the method.
- No budget entry → the block shows "Budget: Not published".

**Disconnect line** (game pages, only above the disconnect threshold)

- Admin-editable templates with placeholders only, e.g. "Critics: {critic}. Players: {players}. Steam: {steam\_pct}% positive. Player count: {players\_delta} in {window}."
- An optional closing line per template is fixed admin copy. A validator blocks person names in templates and closing lines.
- Every value comes from stored data; a missing value drops that sentence.

Acceptance:

1. A `reported` figure without source URL and an `estimated` figure without method cannot be saved.
2. The person schema has no free-text evaluation field.
3. The disconnect line appears only above threshold and uses only stored values.

### S7 — Where to buy, image sources

**Store registry** (admin-managed)

- A store renders only when marked `authorized`. Seed: Steam, Epic, GOG, PlayStation Store, Xbox Store, Nintendo eShop, Humble, Green Man Gaming, Fanatical.
- Grey-market blocklist (G2A, Kinguin, Eneba and similar key marketplaces) is enforced on save. Admins may add entries; base entries cannot be removed from the UI.
- One combined list per game.

**Affiliate**

- Global `affiliate.enabled` = false. Per store: `affiliate_enabled` + a link template whose partner ID comes from settings/env.
- When any affiliate link renders: a disclosure line above the list ("Some links are affiliate links. If you buy, we may earn a commission. It doesn't change the price or our ratings.") and an "Affiliate" marker on each such link. Both render-forced, like Promoted.
- Affiliate links carry `rel="sponsored noopener noreferrer"`.
- Order: by current price when price data exists (dormant price seam), otherwise admin-set fixed order. No commission value exists as a sort key.
- Methodology gains a "How we make money" section: Promoted placements and affiliate links; data lists are never sold.

**Image sources**

- Cover priority: Steam CDN → RAWG (with its required attribution rendered) → neutral placeholder.
- `images.igdb` = false until a partnership exists.
- `og:image` per source = off by default. When off, topic cards use the linked game's cover or the placeholder.

Acceptance:

1. Saving a blocklisted store domain fails.
2. With an affiliate link present, disclosure and marker appear in SSR; toggling every related setting cannot remove them (test).
3. Pages using RAWG images contain the attribution.

### S8 — Compliance

- **Age gate**: registration requires a checkbox "I am 16 or older" (`legal.min_age` default 16). Stored with timestamp. Existing accounts confirm once at next login before continuing. Terms placeholder gets the matching line.
- **DSA report** on every user-generated item (comments, user review text, profiles, tag suggestions):
  - Works without login: category, explanation, optional email.
  - Abuse protection: honeypot, rate limit, self-hosted proof-of-work challenge. No third-party captcha.
  - Lands in the moderation queue with a snapshot of the reported item.
  - Reporter gets an acknowledgement and the outcome if they left an email.
  - On removal or restriction, the author gets a statement of reasons (in-app + email if verified): decision, ground, date.
  - Everything is audited. `legal.contact_point_email` is shown on the Contact page.
- **Audit log export**: owner-only CSV with date range, actor and action filters. Reuse the I8 formula-injection guard and PII rules.
- **Newsletter double opt-in** before any live send: subscription activates only after the confirmation link; consent recorded with timestamp.
- **Housekeeping**: unique constraint on `game_dlc (game_id, name)`; dedupe first and report what was merged.

Acceptance:

1. Registration without the checkbox is rejected server-side.
2. An anonymous report creates a queue item; reports past the rate limit are rejected; a removal writes a statement of reasons to the author's outbox.
3. An exported CSV cell starting with "=" is neutralised.
4. Unconfirmed subscribers are excluded from every send segment.

### S9 — Ops: alerts, monitoring, backups

- **Alerts** by email to `ops.alert_email` through the existing email seam when: a background job fails repeatedly; no new articles arrive for `ops.stale_ingest_hours` (default 6); the error rate spikes. One alert per condition per hour, plus a recovery notice.
- **Error monitoring** seam: Sentry-compatible DSN from env, off when empty. Scrub cookies, emails and tokens before sending.
- **Health endpoint** `/health` for an external uptime monitor; exposes no internals.
- **Backups**: daily `pg_dump`, compressed and encrypted (public key from env), uploaded to S3-compatible storage (env). Retention 7 daily + 4 weekly. Restore script plus a short `RESTORE.md` runbook. Confirm nothing durable lives only in Redis.

Acceptance:

1. A simulated job failure produces exactly one alert in the outbox within the throttle window.
2. `verify:backup` runs dump → encrypt → restore into a scratch DB → row counts match.

### S10 — Caching decision, security review

**Problem**: the per-request CSP nonce makes HTML uncacheable at a CDN, so every visit triggers SSR and DB reads.

1. Measure homepage, topic, game and catalog: render time and DB queries per request, plus a simple load test.
2. Propose in the plan (owner reviews before build): Redis read-through cache on public read endpoints with event-based invalidation, and/or hash-based CSP on pages that allow CDN caching. `unsafe-inline` must not return.
3. Implement the approved option, re-measure, report before/after numbers and a recommended server size.

**Adversarial security review** of every Phase P surface:

- Tag voting and brigading paths; anonymous reports (abuse, stored XSS in report text, enumeration).
- Affiliate link templates and financial source URLs (scheme validation, open redirect, injection).
- Admin section config and new settings (privilege by rank).
- AI polish validator bypass.
- Search (injection, DoS); studio, people and list pages (XSS).
- Copy-registry document parser (S3b, `packages/shared/src/copy.ts` → `parseInline` / `findClose`): quadratic worst case on pathological unclosed `**` / `*` / `[` markers. Admin-only input (Control Panel → Copy, admin+), ≤ 20 000 characters per document, parsed on save and on each 10 s `/public/site` rebuild. Measure the worst case and bound it (linear scan or a per-paragraph cap) — no change before S10 (owner, after S3b).

Findings are fixed and re-verified before the phase closes.

## Verification gate

Phase P closes when `verify:p` passes and every earlier suite is still green.

- `verify:p` aggregates all slice acceptance checks above.
- Global checks: zero nested anchors on all public surfaces; strict CSP intact (or the S10-approved variant); no public HTML uses "Independent" as a bias label; every paid item carries its label; every affiliate link carries its marker.
- Report per slice: what already existed (delta), what changed, verify output, self-review findings and fixes.

## Investigate only (report, change nothing)

- Every coverage row on topic pages shows "Lead source". Explain which logic sets it, whether it works as designed, and what it should mean. Wait for the owner's decision before touching it.

## Out of scope

- Reddit API, Stripe, live price data (seam only), semantic search.
- Deployment config and real API keys (separate track).
- Public corrections log (decided: not now).

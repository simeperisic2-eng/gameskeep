# GamesKeep — Project Blueprint

> The complete plan. Read on demand (not every session). Day-to-day rules are in `CLAUDE.md`.
> This document is the source of truth for *what* to build. The agent decides *how* (frameworks, file layout, implementation), within the stack fixed in `CLAUDE.md`.

---

## 0. Reading guide

This blueprint has four parts:
1. **Vision & principles** — what GamesKeep is and the rules that shape every decision.
2. **Data models** — the six core objects, field by field.
3. **Pages & navigation** — every public page, the Control Panel, the User Panel.
4. **Implementation phases (I0–I9)** — the build order. Each phase gets its own SPEC document when it's time to build it.

When a detail here conflicts with a phase SPEC, the **phase SPEC wins** for that phase (it's more specific and more current).

**Living docs the agent maintains:** `PROGRESS.md` (short log of what's done / what's next, updated each phase) and `OWNER-TODO.md` (running list of everything the owner must fill in). See `CLAUDE.md` for the rules on both.

**Cross-cutting requirements** (not a phase — built in throughout, see `CLAUDE.md`): SEO (SSR, clean URLs, schema.org, sitemap, breadcrumbs, canonical) and Security (XSS/CSRF/injection protection, secure auth, GDPR). These are mandatory in every relevant phase, especially I5 (public pages).

---

# PART 1 — VISION & PRINCIPLES

## 1.1 What GamesKeep is

A premium, global, English-language platform about video games that does two things as co-equal primary functions:

- **News + bias analysis** (Ground News–style): aggregates articles from many gaming outlets, clusters them into topics ("stories"), shows the same event across all sources at once, and exposes **influence** and **journalistic quality** so readers see *how* games coverage is shaped.
- **Ratings + rankings** (Rotten Tomatoes / IMDb / Metacritic / OpenCritic–style): every game has its own hub with three separated rating layers, premium analytics, lists/rankings, and an annual Awards program.

The brand promise: **more professional, more accurate, more premium** than existing gaming media. Score and bias live **together** from the first second — that pairing is the core differentiator. No one does bias analysis for gaming.

## 1.2 Target user

Primary: the **enthusiast** who follows the industry and wants depth.
But the entry experience must satisfy a **casual** visitor in ~5 seconds (clear score, clear trending), then reward deeper clicks with bias analysis and source comparison for the enthusiast and the **bias-aware** reader.

Design implication: front door is fast and clear; depth is one click down, never forced.

## 1.3 The differentiator (the "wow")

Take one gaming event and show it through a **bias lens alongside the score**, simultaneously. Example homepage hero: a trending topic ("GTA 6 delay") with a TL;DR, an AI summary, and a bias bar ("15 articles → 9 independent, 6 influenced; 12 quality, 3 low-effort"). Side rankings (Trending / Top Rated / Most Discussed). Casual gets speed; enthusiast gets depth; bias-aware gets something found nowhere else.

A second signature: the **critic↔community disconnect** — when critics say 9.0 and players say 4.2, that gap is surfaced as a trust signal *with context* (why the gap exists), not just two raw numbers.

## 1.4 Core hierarchy

- **Topic (Story)** is the top of the news hierarchy — the point around which articles from many sources gather (Ground News's "story").
- **Game** is NOT the top of the hierarchy. A game is a **Subject** that gets tagged/linked to topics and articles (many-to-many). BUT every game still has its **own page** that aggregates everything where it's mentioned (topics, articles, all ratings, analytics, our review, FPS, videos, player count). The game page is a *view*, not an owner.
- **Article** belongs to one or more topics (one primary) and links to one or more games via Subjects.
- **Subject** is a generic entity (types: Game / Studio / Publisher / Platform). Only Game is populated initially; the rest are future expansion with no refactor needed.

## 1.5 Governing principles (apply everywhere)

1. **Demo-first.** A fully working offline demo with mock-but-realistic data and **real behavior**. Engines (clustering, scoring, bias) are real even in demo; only the data source is mocked, behind a swappable layer.
2. **Speed by design.** Nothing heavy on user request. Background jobs compute and store; users read cached/pre-computed results. The site is fast no matter how slow external sources are. Caching is built in from the start, not bolted on.
3. **Auto + manual override everywhere.** Automation runs with zero human input, but staff can always edit, override, move, merge, split, or delete anything — aggregated or original.
4. **Everything configurable from admin.** No hardcoded lists, thresholds, weights, or slots. Lists/rankings, clustering thresholds, rating weights, ad slots, source settings, badges, award categories — all admin-editable and extensible.
5. **Analytics everywhere.** Vote counts, ratios, geographic distribution (aggregated/anonymous only, GDPR-safe), change-over-time — wherever it makes sense.
6. **Transparency = the brand.** Paid/promoted content is always clearly labeled. We never hide sponsorship while flagging others for it. Methodology is public (summarized, not the exact formulas).
7. **Audit log.** Every staff action recorded immutably (who/what/when/old→new).
8. **Guard against bugs & edge cases.** A top priority. Validate everything, handle empty/missing/malformed data, never trust external input. Typed code, explicit null handling.
9. **Monetization-ready by design.** Ad/promoted "slots" exist from day one (empty, showing "AD" in demo) with a defined sold-state and unsold-fallback, so monetization needs no refactor later.

## 1.6 Demo ↔ production boundary

- **Real in demo:** clustering engine, bias logic, rating math, disconnect calc, all UI, admin, user system, background-job architecture, caching.
- **Mocked in demo:** the *data source* — a realistic mock feed of ~200–300 real-world-style gaming articles, a local seed of ~40–50+ real games, mock player counts/FPS where no API exists.
- **Switch to production:** replace the data-source layer (mock feed → live RSS/adapters; local seed → live IGDB/RAWG; mock counts → Steam API). Engines do not change.

---

# PART 2 — DATA MODELS

> Field lists are conceptual (the *what*). The agent designs the actual schema, types, indexes, and relations. Use the vector extension for embeddings. All timestamps tracked. All staff edits audit-logged.

## 2.1 TOPIC (Story) — top of the news hierarchy

**Identity & content**
- Title
- **TL;DR** (one sentence — for lists/cards)
- **AI summary** (longer, synthesized from all articles in the topic; clearly labeled AI-generated; neutral "what happened" overview)
- **Status:** Developing / Ongoing / Resolved — changes automatically by activity; staff can override
- **Type:** Hot Topic, Trending, Legal Issues, Controversy, Release/Launch, Update/Patch, Leak/Rumor, Business, Review Roundup — list extensible from admin
- Created / last-updated timestamps

**Linking**
- Linked to 1+ **Subjects** (games now; studios/publishers/platforms later), many-to-many
- Tagging is searchable/filterable so it's always known which game(s) a topic mentions

**Bias bar (topic-level) — the differentiator**
Two independent **public** axes, shown as two bars (Influence on top):
- **Axis 1 — Influenced ↔ Independent.** Distribution of articles across this axis. "Influenced" covers BOTH commercial influence (sponsored, affiliate, PR, review-copy) AND editorial/narrative angle (opinion/influenced framing vs straight reporting). Fed by factual signals (self-disclosed sponsored → ~99% influenced; affiliate milder) plus assessment. **Hover/click reveals *why*** an article is marked influenced (e.g. "affiliate links", "sponsored", "opinion piece") — fine detail under the hood, clean two-axis UI on top.
- **Axis 2 — Slop ↔ Top (journalistic quality).** Distribution across this axis. Quality of the journalism itself: low-effort / AI-generated filler vs quality work. Framed as a **quality** assessment (defensible as opinion/critique), not an ideological judgment. Public-facing label may be phrased professionally (e.g. "Low-effort / AI" ↔ "Quality") — internal name can stay "Slop/Top".

**Internal-only layer (NEVER shown publicly)**
- An internal assessment field for editorial use/sorting (e.g. perceived narrative/ideological push, AI-written likelihood). **This is internal sorting/insight only — it is NEVER displayed publicly as a label on an article.** Keeping it internal removes the legal/reputational risk of public ideological labeling.

**Community (topic-level)**
- Trust votes, influence/quality votes, comments, reactions

**Other**
- **Timeline** when status = Developing (chronological evolution as articles arrive)
- Related topics (same game or similar event)
- Sorting/filtering of articles: by source, by bias, by date (incl. newest-first); filters like "independent only" / "paid only"

## 2.2 ARTICLE

**Origin & type**
- **Origin:** Aggregated (auto-pulled from external source) OR **Ours** (written in our CMS, clearly badged "ours")
- Both origins are the **same object type** — same structure, same bias axes apply. Difference is the badge + that ours is full-text on our site while aggregated is excerpt + summary + link.
- "Ours" articles may have an author who is a staff writer (no external partners for now).
- **Article type:** news / review-article / opinion / preview / guide
  - NOTE: an "article" is general news/content. It is **NOT** the game-rating review. Our official game review and score live **only on the game page** (see 2.3), separate from the article feed.

**Auto-captured fields (aggregated)**
- Title, source, author (if present), publish date, URL, thumbnail/image, short excerpt (first sentences)
- **Never store full text of others' articles** (copyright). Store excerpt + AI summary + link only.
- Paywall flag (yes/no)

**Detected signals (auto, factual — not opinion)**
- Affiliate links present? (yes/no) — pushes toward "Influenced" (mild)
- Sponsored/PR labeled? (yes/no) — strong "Influenced" (~99% if self-disclosed)
- Based on publisher-provided review copy? (yes/no)
- Article type detection (news/review/opinion/preview/guide)

**Bias (two axes, per article)**
**Bias (two public axes, per article + one internal field)**
- **Axis 1 — Influenced ↔ Independent:** auto-derived from detected signals (sponsored/affiliate/PR/review-copy) + source baseline + opinion-vs-reporting framing. Commercial influence and editorial angle combine into this one axis; hover shows the specific reason(s).
- **Axis 2 — Slop ↔ Top:** journalistic quality (low-effort/AI-filler vs quality work). Framed as quality/critique.
- **Internal-only field:** editorial assessment (narrative push / AI-likelihood) for internal sorting — **never displayed publicly.**
- Public axes stored **separately** internally (may be shown combined in UI). This preserves the rare insight "independent BUT low-quality" etc.

**Linking**
- To one or more **Topics** (one marked **primary**)
- To one or more **Games** (via Subjects)

**Community (article-level)**
- **Trust vote** ("felt honest" vs "felt like paid hype"), reactions, comments (all from start)

---

*(Continued in Part 2 cont. — Game, Source, User, Awards — and Parts 3–4.)*

## 2.3 GAME — has its own page (a view that aggregates everything)

**Identity & metadata** (sourced IGDB primary / RAWG fallback; admin-editable)
- Name, cover, screenshots/gallery, genres, platforms, developer (studio), publisher
- Release date, description, engine, mode (singleplayer / multiplayer / co-op)
- Age rating (PEGI/ESRB), series/franchise, tags (e.g. "souls-like", "roguelike")
- Prices per platform/store + **discount tracking** (Steam at least)
- System requirements (min/recommended)
- Social/store links
- **Status:** Announced / In Development / Early Access / Released / Delisted — **hybrid control:** staff sets it; system *suggests* changes (e.g. "release date passed, still 'Upcoming' — update?"). Not pure-auto.
- Press / publicly-available background image where available (for page hero)

**Ratings block (the RT/IMDb part) — three separated layers, never mixed**
- **Our score** (1–10, one decimal) — editorial voice; few ratings, high authority
- **Media Critics** (1–10, aggregated + normalized from outlets like Metacritic/OpenCritic style) — auto-pulled; show how many outlets
- **Community** (1–10, weighted) — split internally into:
  - **Our community** (verified, logged-in users on our site)
  - **Across the web** (Steam % auto + editor note for Reddit/others; shown as sentiment + approximate score, labeled "estimate")
  - Shown as ONE Community block with two clearly-labeled lines (simple for the eye, transparent underneath). **Never merged into a single number.**
- **Scale:** display 1–10 one decimal everywhere; store internally 0–100 (normalize all sources to 0–100 for accurate aggregation).
- **Disconnect indicator:** visual + number + color (green=agree, red=large gap).
  - Primary: **Critics ↔ Community**
  - Sub-levels (detailed view): Our score ↔ Media Critics; Our community ↔ Internet
  - **Context tag:** when the gap is large, an optional short tag explains *why* (business/monetization anger, review-bombing, niche taste). Editor-note in demo; AI later. This is what separates us from Metacritic's bare two numbers.

**Premium analytics (our advantage — meaning, not just raw numbers)**
- Score trend over time (e.g. community dropped after a patch)
- Community rating distribution (how many 9s vs 1s)
- **Player count** (Steam where available; clearly "Steam only") — raw numbers (current/peak/history, like SteamDB/SteamCharts) **PLUS context** (cross-game percentile, weekly change, momentum/health, correlation with our topics/articles — e.g. "this dip aligns with 'bad patch 1.3' topic"). We have what they have + context they can't.
- Bias distribution of articles about this game (paid vs independent coverage)
- "How others rated" (Metacritic/OpenCritic/Steam references) + review excerpts (short quote + score + link, in Media Critics block)
- **HowLongToBeat** hours (main / completionist) where available
- **Steam completion rate** where available

**Our review** (if it exists — lives ONLY here, not in article feed)
- Structured & easy to enter/edit: verdict sentence, Pros/Cons, platform tested, hours played, author, date, full text, our score (1–10)
- Tagging to link to game(s) / other topics
- Clearly badged "ours"
- One review = one score = one game

**Linking / discovery**
- All topics where the game is mentioned (timeline/list)
- All articles mentioning the game (with bias labels)
- Related games (same genre/studio/series — discovery, don't over-complicate)

**Videos & streams**
- YouTube: 3 default (review/gameplay), auto-pulled + editor pin/override; expandable with link/embed/video options
- **Embedded live streams** per game (Twitch/YouTube live) — slot for potential partnership/revenue

**Content Flags (factual, game-level — separate from article bias)**
Player-decision signals that gamers actively want, kept factual and non-ideological:
- **AI-asset disclosure** — does the game use AI-generated art/voice/text? (yes/no/partial/unknown) — informational, not a judgment
- **Launch state** — polished / mixed / rough-at-launch (technical state, factual)
- **Monetization flags** — microtransactions, battle pass, paid loot/gacha, **pay-to-win** indicator, "predatory monetization" indicator (highly sought, almost no one tracks this systematically — a differentiator)
- **Complexity rating** — 1–5 (how easy to pick up vs hardcore/deep) — a useful factual signal for decision-making
- **DLC list** — individual DLCs with name + price (reuses the price/discount structure) — shown only where this data exists
- All admin-editable, "where known", with community-report + vote option like FPS
- **Display rule:** any flag/field shows **only when we have the data** — never render an empty/unknown field as clutter (keeps the page clean and premium)

**Community (game-level)**
- User ratings, comments, reactions

## 2.4 UPCOMING GAMES (special view)
- Pulls announced games from everywhere; countdown to release; filters (platform, genre, quarter); "most anticipated" via community hype-vote. Click → game page with upcoming status. Has its own ad slot (upcoming-card format; "AD" if sold, else default game behavior).
- **Primary fill is automatic** — upcoming games come from IGDB (status + future release date), so the page is never empty without manual work. Steam can supplement PC-specific data later.

### Discovery / new-games concept (start simple; expand only if it gains traction)
Upcoming doubles as a discovery surface for new/indie games. Kept deliberately lightweight at start — **no developer-account or submission-portal system needed**:
- **Submit a game (free)** — anyone (dev, player, or us) can suggest a missing game. It does NOT go live directly; it files into an admin queue (reuses the existing **unmatched-game queue** mechanism) → editor reviews → adds it. No need to verify who the submitter is, because nothing publishes without editor approval.
- **Promote a game (paid)** — a "Promote your game" contact form → email to us → arrangement → we manually turn on a "hot"/featured flag (reuses the existing **ad-slot** mechanism). **We don't need to verify the submitter is a real developer — payment is the filter; whoever pays gets the promotion.** MUST carry a clear **"Promoted" / "Sponsored" label** (transparency rule — promoting whoever pays is fine only when clearly labeled, or it undermines the anti-bias brand).
- Community on upcoming: hype-vote on potential, comments (already planned).
- **Future discovery features (architecturally enabled, post-launch):** follow/wishlist with release notification, "similar to games you like", per-game devlog/update feed, demo/playtest links, crowdfunding status, a "rising" list (indies gaining attention fast). Built on the existing Subject/follow/rating foundation when the time comes.
- **Build order:** the Upcoming *view* + auto IGDB fill + hype-vote/comments are I5. The submit (free→queue) and promote (paid→contact→manual feature) flows are light additions; a richer submission form is a post-launch upgrade on the existing queue mechanism.

## 2.5 SOURCE

- Name, logo, web URL, RSS/feed URL, description
- **Type:** mainstream / independent / industry / blog (extensible)
- **Ownership / parent company** (+ conflict-of-interest indicator when a source covers a game owned by its parent — transparency asset)
- Added date, status (active/paused)
- **Adapter** (how its feed is parsed) — RSS-first; per-source adapter normalizes to one standard Article shape. Adding a source = one new adapter, nothing else changes.
- **Pull settings (admin):** frequency, depth (how many back), on/off
- **Reputation baseline:** mild baseline (commercial leaning + general reputation) that **updates dynamically** from its articles / community ratings / trust votes; staff-tunable
- **Public stats** (Ground News–style source profile): "X articles here, Y% affiliate, average trust Z"
- **Own page:** all articles from that source + its stats/reputation/ownership

### The 10 initial sources
IGN, Eurogamer, GameSpot, Polygon, PC Gamer, Rock Paper Shotgun, Kotaku, VG247, GamesRadar+, GamesIndustry.biz.
(Chosen for spectrum: mainstream bias contrast (IGN, Polygon), independent poles (Eurogamer, RPS), PC/hardware (PC Gamer), industry/business (GamesIndustry.biz). Most have RSS — RSS-first.)

## 2.6 USER

**Roles (6):** Visitor (read-only) · Registered · Writer/Author (writes our articles + reviews) · Moderator · Admin · Super-admin/Owner.

**Two separate axes for identity:**
- **Level (earned, subtle — bar + name, NO numbers shown):** Newcomer → Contributor → Trusted → Veteran → Legend. Top earnable rank = Legend.
- **Roles (assigned, prominent, distinct colors):** Moderator, Admin, Editor/Writer, Verified Developer (Partner). Assigned by admin; visually distinct from levels.

**Level mechanics (internal — formula & thresholds hidden from users)**
- Driven by *quality* activity over time (not raw volume — hard to farm): account age + verified email + quality-weighted activity (ratings, reviews, comments, trust votes, weighted by how useful others find them) + community reputation. Negative signals (modded comments, suspicious vote bursts, bans) slow/reduce it.
- Users see only: current level **name** + a **progress bar** (no exact requirements), earned **badges**, and their **stats**.
- Hidden: exact formula/thresholds; that level/age affects **vote weight**; anti-abuse signals.

**What a registered user does**
- Rate games (1–10, one decimal), trust-vote articles, vote influence/quality axes, comment, react
- Follow games/topics (notifications), wishlist/backlog ("playing/finished/want")
- One rating per game, one bias-vote per topic (changeable, not multipliable)

**Community weighting (applies ONLY within community score; critics untouched)**
- Vote weight range **0 → 1.0**. New/unproven/suspicious votes **reduced** until "proven" (verified email + some activity) → full 1.0. Do NOT raise above 1.0 by seniority — instead push bots/bursts toward 0. Engagement is rewarded via reputation/badges/visibility, NOT by multiplying score.
- IMDb/Steam-style **anomaly damping** (detect & isolate review-bombing bursts) + mild reputation weighting.

**Anti-abuse (gaming-critical)**
- Cloudflare (bot/DDoS) + email verification + rate-limiting (ratings/votes per day) + suspicious-burst detection + minimum "tenure" before rating.

**Badges (like achievements)**
- Small icon next to name; hover shows name (+ short description). Extensible from admin. Examples: Verified, Top Reviewer, Early Voter, Trendsetter, Bias Hunter, Day One.

**Public profile**
- Username, avatar, joined date, level + badges, their ratings, reviews/comments, reputation, stats.

## 2.7 AWARDS (annual)

**Structure:** Annual edition → Categories → Nominated games → outcome.
- **Categories (start set, extensible from admin):** Game of the Year, Best Narrative/Story, Best Score & Music, Best Art Direction/Visuals, Best Independent Game, Best Performance, Best Ongoing Game, Most Anticipated. Genre (optional): Best RPG, Best Action, Best Multiplayer, Best Indie Debut.
- **Differentiator:** each nominee shows our **better analytics** (three scores, disconnect, player trend) so voters can actually decide — no one else gives voters data.

**Flow (5 phases, staff-controlled status like game status):** Announce → Nominations (staff curates candidates) → Voting (community votes, X days, live counter) → Reveal → Archive.

**Dual outcome per category:** **Critics' Choice** (ours/curated) AND **Community Choice** (community vote), shown separately. (Industry standard: jury vs Players' Voice. Also feeds the disconnect-as-content angle.)

**Voting**
- Registered only, one vote per category, same weighting (0→1.0) and anti-abuse as community score.
- **Analytics everywhere:** number of voters, ratios, geographic distribution (aggregated/anonymous, GDPR-safe), over-time.

**Display & legacy**
- Archive of past years (permanent). Winning game carries a badge on its game page ("Game of the Year 2026"). Sponsor slot per category (defined, empty in demo).

**Demo state:** build everything + allow full pre-configuration, but show publicly **greyed-out + "Coming Soon"** with contact + **subscribe for notifications** at the bottom. Staff can prepare it all, then "turn it on".

## 2.8 NEWSLETTER (growth engine — first-class feature)

The #1 growth/retention channel for every major gaming outlet. Our AI-summary + bias analysis is a uniquely strong newsletter product ("daily gaming briefing, with a bias lens").
- **Our system owns:** content composition, scheduling/timing, segmentation (who gets what), analytics (opens/clicks/growth), and AI-digest generation. Fully customizable from admin.
- **Sending is delegated** to a proven transactional/marketing email provider via a **swappable layer** (deliverability is hard — never build a raw mail-sender from scratch). Demo runs without it (compose & preview only; no real sends).
- **Subscribe** capture across the site (incl. Awards "notify me"). GDPR-compliant (consent, unsubscribe, data handling).
- Types: daily/weekly digest, topic/game alerts (ties into Follow), awards notifications.
- Placeholder contact for now: `wrathsystems@gmail.com` (`[[OWNER-TODO]]`).

## 2.9 PERSONALIZED FEED (retention)

Built on the existing Follow system. A "your feed" view: topics/games tailored to what the user follows and engages with (e.g. "because you follow FPS games and CD Projekt"). Starts simple (follow-based), can grow into richer personalization without refactor. Logged-in enhancement; logged-out users see the standard curated home.

## 2.10 AD / PROMOTION MANAGEMENT (revenue dashboard)

A complete management layer over the slot system (see Part 3 intro for slot rules):
- **Inventory view:** every ad slot across the whole site — including **each game page** — with sold / free / scheduled state.
- **Per-slot analytics:** impressions, clicks, (revenue later). Occupancy calendar.
- **"Free inventory" view:** admin sees all empty slots available to sell.
- Schedule (from/to), labels, sold-state vs unsold-fallback per slot.
- This is the future revenue dashboard; built as placeholders now ("AD" in demo), no real ad-serving/payment yet.

---

# PART 3 — PAGES & NAVIGATION

> Global rule: **every page has at least one ad slot**, designed to fit that page's content type (not a generic banner). Promoted content uses the SAME format as the page's organic content, just labeled. Every slot has a defined **sold-state** and **unsold-fallback** (hide or show default organic content — never an empty "ad here" box). In demo, slots show **"AD"**.

## Global navigation (every page)
- Header: logo, main menu (**Home / Games / Topics / Upcoming / Awards / Sources**), global search, login/profile, (later: language/region)
- Footer: About, **Methodology**, Contact, Privacy/GDPR, Terms, social links

## 3.1 Homepage
- **Hero** (the "wow"): biggest trending topic — title, TL;DR, **bias bar**, source count, AI summary. Plus **2–3 secondary** highlighted topics (newspaper-front-page feel).
- **Side rankings module** (3 tabs, configurable from admin):
  - **Trending** — new articles in last 24–48h + community activity + recency decay (fast/fresh)
  - **Top Rated** — combined score default (admin can split into Top by Critics / Top by Community); quality/stable
  - **Most Discussed** — volume of comments+votes+ratings over a window (e.g. 7 days)
- **Main feed** — newest/active topics as cards (title, TL;DR, mini bias bar, article count, game(s), time). Infinite scroll with "load more".
- **Games in focus** — recently rated, controversial (big disconnect), upcoming highlights (bridges news ↔ catalog).
- **Awards teaser** — when active; out of season shows last year's winners or hidden.
- **Newsletter subscribe** — capture block (AI+bias digest pitch); GDPR-compliant.
- **Personalized "Your Feed"** — for logged-in users (follow-based); logged-out see standard curated home.
- **Sponsored/promoted slot** — labeled "AD"; doubles as ad space when no event.

## 3.2 Game page
(See 2.3 for full content.) Order, top→bottom: header (with press/public bg image) → ratings block + disconnect → premium analytics → our review (if any) → related topics → articles → videos → FPS/system req/prices+discounts → related games → community. Ad slot logically placed (e.g. banner/box near videos or FPS — natural for hardware ads).

## 3.3 Topic page (Story) — heart of the news side
- Header: title, TL;DR, status, type, linked games (tags → game page), date/last-update
- AI summary (labeled AI-generated)
- **Bias bar** (two bars: Influence top, Quality below; hover for why)
- All articles from all sources — each: source (+reputation), title, excerpt, bias labels, date, link. Sort (by source/bias/date incl. **newest-first**) + filter ("independent only"/"influenced only"/"top quality only")
- Timeline (if Developing)
- Community (trust/influence/quality votes, comments, reactions)
- Related topics
- Promoted-article ad slot (same format as an article card, labeled)

## 3.4 Games catalog (Browse)
- Grid/list toggle, search, filters (genre, platform, year, rating, status), sort (Top Rated / Newest / Most Discussed)
- Ad slot = a game-card the same size as others, inserted (e.g. into a "New" section), labeled "AD". Lists are **manually arrangeable** (admin can pin a paid game to top of New/Trending).

## 3.5 Upcoming Games
(See 2.4.) Countdown, filters, most-anticipated hype-vote, upcoming-card ad slot (labeled if sold, else default).

## 3.6 Source page
(See 2.5.) Logo, description, ownership/parent (+ conflict indicator), reputation (commercial + general), stats, all its articles.

## 3.7 Awards (current edition)
(See 2.7.) Active categories, nominations, phase, voting + live counter, Critics' vs Community outcome, analytics (voters, ratios, geo), sponsor slot. **Demo: greyed "Coming Soon" + contact + subscribe.**

## 3.8 Awards archive
- Past years, permanent, winners by category.

## 3.9 Lists / Rankings
- Top 100, Trending, Most Discussed + custom lists from admin. Each list its own page. All lists configurable (weights, windows, manual pin). Nothing hardcoded.

## 3.10 Search / Results
- Global search across games, topics, articles, sources; results grouped by type; filters.

## 3.11 User public profile
(See 2.6.) Username, avatar, joined, level + badges, ratings, reviews/comments, reputation, stats.

## 3.12 Login / Register / Account
- Email register (verification), login, password reset, OAuth (Steam preferred for gaming + Google/Discord; can come later), account settings.

## 3.13 Static pages
- About, **Methodology** (how we compute bias/scores/disconnect — short, polished, transparent enough for credibility WITHOUT revealing exact formulas/weights; we frame the approach, don't share the recipe), Contact, Privacy/GDPR, Terms.

## 3.14 CONTROL PANEL (one app, permission-based)
One panel; visible sections depend on the user's role/permissions (Moderator → Admin → Super-admin see progressively more). NOT three separate apps. Sections:
1. **Dashboard** — overview + analytics (traffic, top topics, activity, source performance, background-job health)
2. **Topics/Articles** — view, edit, **clustering merge/split**, manual tagging, bias override, "unmatched game" queue
3. **Games** — create/edit, IGDB/RAWG pull, FPS/prices/videos, statuses
4. **Sources** — add, adapters, pull settings, reputation, ownership
5. **Users/Moderation** — roles, permissions, comment/vote moderation, reported content, ban/rate-limit, **audit log**
6. **Awards** — editions, categories, nominations, phases, results, sponsor slots
7. **CMS (our articles/reviews)** — write, structured review (Pros/Cons/verdict/platform/hours), tag-linking
8. **Lists/Rankings** — configure all rankings (weights, windows, manual pin)
9. **Ad / Promotion management** — inventory across the whole site (incl. every game page), sold/free/scheduled, per-slot analytics (impressions/clicks/revenue-later), occupancy calendar, free-inventory view
10. **Newsletter** — compose, schedule, segment, AI-digest generation, analytics (opens/clicks/growth), subscriber management
11. **Settings** — global (brand text, contact, API keys, clustering thresholds, language)

## 3.15 USER PANEL (separate, user-facing)
- My profile (avatar, username, bio, level + badges)
- My ratings · My reviews/comments · Followed (games/topics + notifications) · Wishlist/Backlog
- **My stats** · **My award votes** · **Level + progress bar** (visible progress, hidden requirements)
- Notifications · Account settings (email, password, privacy, GDPR delete)

---

# PART 4 — IMPLEMENTATION PHASES (I0–I9)

> Build **phase by phase**. Each phase gets its own SPEC document (named files, scope, out-of-scope, and a verification step) written when it's time to build it. Each phase must end with a check the agent runs and shows evidence for. Don't start a phase until the previous one is verified and approved.

- **I0 — Foundation:** project setup, architecture skeleton, database, demo environment that boots with ONE command. No features — just a running skeleton (main app + AI service + DB + Redis wired, health checks pass).
- **I1 — Data layer:** the 6 objects in the DB + admin CRUD. You can enter/edit data.
- **I2 — Game data + seed:** IGDB/RAWG integration (behind swappable layer), local mock seed of games, "unmatched game" handling.
- **I3 — Article pipeline + clustering:** mock feed → per-source adapters → normalize → **real clustering engine** (embeddings, similarity threshold, time window) → topics. Merge/split + threshold tuning in admin. (Real engine, mock input.)
- **I4 — Bias + rating system:** two bias axes (Influenced↔Independent, Slop↔Top) + internal field, three rating layers, normalization (0–100), disconnect calc + context tag, community weighting (0→1.0) + anomaly damping. Game-page **Content Flags** (AI-asset/launch-state/monetization).
- **I5 — Public pages:** homepage, game page, topic page, catalog, upcoming, source pages — premium UI (dark + amber), responsive, SEO + security baked in. Ad slots as "AD" placeholders. Embedded video/stream slots.
- **I6 — Users:** auth (+ optional OAuth), profiles, rating, votes, comments, levels/badges, anti-abuse (Cloudflare-ready, rate-limit, verification). **Follow + Personalized Feed.**
- **I7 — Awards:** full system + "Coming Soon" public display + subscribe.
- **I8 — Control Panel + monetization + newsletter:** full admin, analytics, audit log, **ad/promotion management dashboard** (inventory across all pages incl. game pages, per-slot analytics, free-inventory view), **newsletter system** (compose/schedule/segment/AI-digest/analytics, swappable send layer), list configuration.
- **I9 — Polish:** edge-case hardening, performance pass, accessibility, README finalization. Plus two brand touches (subtle, never at the cost of clarity):
  - **Live system visualizer** — an elegant "under the hood" window on the Methodology/About page showing the system at work (sources connecting → articles clustering into a topic → bias bar filling). **Abstract process visualization, NOT raw scrolling code and NOT literal broken-glass** (those read cheap). Premium and on-brand; builds trust. Uses mock data in demo.
  - **Optional scroll-signature element** (PC only) — a single abstract motion element that doubles as a scroll-progress guide. **Not required for now**; only add later if it strengthens the brand.
  - **Anti-overkill rule:** at most ONE signature motion per screen. Subtlety over spectacle. Every animation must serve a purpose or reinforce the brand — never decoration for its own sake.

**Parked (not built until told):** ColorGuess integration (+ real multiplayer), live scraping/APIs, real ad-serving/payment.

---

# APPENDIX — Open items to confirm before/at production
- Final domain purchase (gameskeep.com or chosen extension)
- IGDB (Twitch OAuth) + RAWG API keys
- Steam Web API key
- YouTube Data API v3 key
- Cloudflare account
- Transactional email provider (verification/notifications/subscribe/newsletter)
- OAuth apps (Steam/Google/Discord) if social login
- Hosting (Hetzner-class dedicated sufficient at start)
- Legal review of Privacy/Terms for EU/GDPR

## Aggregation legal safeguards (build in; legal review before production)
- **RSS-first:** when a source publishes an RSS feed, it invites feed use — far safer than scraping. Prefer RSS.
- **Respect robots.txt** and per-source terms; only pull from sources that permit it.
- **Excerpt + AI summary + link only — never full text** of others' articles.
- **Clear attribution + link to original** (sends traffic back; strengthens fair-use posture).
- **Opt-out:** if a publisher asks to be removed, remove quickly (admin already supports this).
- **Legal review before production**, especially for EU.

## Go-to-market notes (NOT for the agent to build — owner reminders; success depends on these more than code)
- **Positioning is existential: "transparency, not authority."** Gamers increasingly distrust rating sites and "games journalists." Our whole value (influence/quality transparency, disconnect, content flags) is the answer to that distrust — but if we're perceived as "another site telling you what's good," we're dead. We are a *tool to judge for yourself*, never a judge. This must be relentless and explicit in Methodology and brand tone.
- **Cold-start:** seed with *content*, not users — aggregation + others' ratings + Steam make pages look full from day one even with zero users. Plan the first ~1000 users deliberately.
- **Viral hook:** a periodic "GamesKeep Influence Report" (data on coverage patterns) is unique content other media may pick up and link — free reach from our own data.
- **Newsletter before launch** to collect emails while building.
- **Niche first, then broaden:** own one frustrated community, be their tool, expand.
- **Content needs people:** aggregation is automatic, but our scores, disconnect context, and quality assessments need an editorial team — an operational cost, not a software one.
- **Future (architecturally enabled, no refactor needed):** native mobile app (API-first already), richer UGC (user lists/guides), deeper video.

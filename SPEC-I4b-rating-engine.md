# SPEC — Phase I4b: Rating Engine + Disconnect + Community Weighting + Content Flags

> Read `CLAUDE.md`, `BLUEPRINT.md` (2.3 Game "Ratings block" + "Disconnect indicator" + "Content Flags", 2.6 User "Community weighting" + "Anti-abuse" + "Level mechanics", 1.3 the critic↔community disconnect, 1.5 governing principles), and `PROGRESS.md` before starting. This SPEC is the single source of truth for **this phase only**; where it conflicts with the blueprint, this SPEC wins for I4b. I0–I4a are complete and verified — build on them. The I1 schema already has the rating tables (Our score, Media Critics aggregate + outlet entries, Community aggregate + estimate, rating-summary, content-flags, player-counts) and the one-rating-per-user-per-game constraint. This phase **computes the aggregation + disconnect + weighting on top of those tables** and fills the content-flag logic. It does not redesign the schema (minor additive columns only).

## Why this is I4b (the split)
I4a built the bias engine (news side: articles/topics/sources). I4b builds the **rating engine (ratings/IMDb side: games + rating tables)** — a clean, independent surface. The two don't overlap: I4a reads article signals, I4b reads game ratings. Keeping them separate means each gets verified in isolation instead of four hard things hiding behind one "all green."

## Goal of this phase
Turn the rating tables from I1 into the **three separated rating layers** (Our score / Media Critics / Community), compute the **critic↔community disconnect** with a context tag, build a **community-weighting + anti-manipulation** model that is honest and tunable, and fill the **game-page Content Flags** logic. All 0–100 internal / 1–10 display. **Still no public game-page UI — that's I5.** Here the engine computes, stores, is inspectable + tunable + override-able in the admin.

## The hard part of THIS phase (read before planning)
Unlike I4a (no ground truth anywhere), I4b has **two different risk profiles** and you must treat them differently:

1. **Disconnect math is easy and objective** — critics 9.0 vs community 4.2 is a factual gap, arithmetic. The hard part of disconnect is the **context tag** (*why* the gap exists: review-bombing? monetization anger? niche taste? critics overrated it?). That "why" is a **judgment, not a fact** — so, exactly like I4a's "agenda" observation, it is **editor-entered, never auto-inferred.** The system surfaces the gap automatically and displays the editor's reason; it never invents the reason.

2. **Community weighting is the real battle — harder than the bias formula was.** A naive `AVG(votes)` looks fine on a clean seed and is worthless the moment someone targets a game. Review-bombing is existential in gaming (thousands of 0/10 in a day from people who never played). The verification target here is not "is the average right" — it's **"does the model resist a simulated review-bomb while leaving a legitimate score intact."** That is the I4b equivalent of I4a's direction-ordering / I3's adversarial test. Build for it.

## The community-weighting policy (DECIDED — do not redesign; implement this)
BLUEPRINT 2.6 already fixes the shape and the owner has confirmed the stance. Implement exactly this, all tunable:

- **Vote weight range 0 → 1.0. Never above 1.0.** Engagement/seniority does NOT multiply a vote above 1.0 (that would let power users dominate). Instead, **unproven/suspicious votes are pushed toward 0**; a "proven" voter (verified email + some activity/tenure) reaches the full 1.0. Reward engagement via reputation/badges/visibility, NOT by inflating score weight. (Per BLUEPRINT 2.6.)
- **Three defensive layers, in this order:**
  1. **Mild credibility weight (auto, gentle).** Weight rises 0→1.0 with account age + verified email + activity/tenure (the I1 User level inputs). A brand-new account's vote counts less until proven. Gentle — the cost is a legitimate new voter is mildly muted until they establish history; accepted.
  2. **Anomaly detection as a TRANSPARENT FLAG, not silent suppression (the owner's explicit choice).** A sudden burst (e.g. N× the normal vote rate in a short window, especially clustered at the extremes) is detected and **surfaced** — the game's rating shows an "unusual activity detected" context flag rather than the number being silently altered. This is consistent with the transparency brand: we *expose* manipulation, we don't quietly filter it. A publicly-flagged review-bomb is a better story (and more defensible) than a secretly-filtered one. The burst's weight may also be damped, but the **flag is mandatory and the damping is visible/tunable** — nothing happens invisibly.
  3. **Verified-playtime/purchase: STRUCTURE ONLY, no logic in demo.** The demo has no Steam data (CLAUDE.md). Model the field (does this voter have a verified-playtime signal?) empty, ready to wire to Steam in production. Do NOT build verification logic now — just leave the leak-proof slot.
- **All thresholds tunable** (`app_settings`, the I3/I4a pattern): credibility curve params, burst-detection window/multiplier, damping factor, the proven-voter bar. Nothing hardcoded.
- **Critics are never touched by any of this** — weighting applies ONLY within the community layer (BLUEPRINT 2.6). Our score and Media Critics aggregate are independent.

Why this exact mix: layer 1 is quiet and gentle (acceptable cost); layer 2 is **transparent rather than censorial** (matches the brand — we contextualize rage, we don't erase it); layer 3 is deferred because the demo can't verify. This deliberately avoids the worst trap: aggressive silent suppression that mutes legitimate player anger and makes the platform a quiet arbiter of whose vote counts.

## In scope (build exactly this)

### 1. The three rating layers (0–100 internal, 1–10 display)
- **Our score** — editorial; comes from the structured Our-review (one review = one score = one game, already constrained in I1). Just surface/normalize it; the review entry already exists from I1.
- **Media Critics** — aggregate + normalize from the outlet entries (each outlet: excerpt + score + link, already modeled). Normalize every outlet's native scale to 0–100, aggregate (show outlet count). Admin-editable (auto + manual override).
- **Community** — two clearly-labeled lines, **never merged into one number** (BLUEPRINT 2.3):
  - **Our community** — weighted aggregate of on-site user ratings (the weighting model above).
  - **Across the web** — Steam % auto (mock in demo) + editor note for Reddit/others; labeled "estimate."
- Normalize all to 0–100 internally; display 1–10 one decimal is an I5 concern, but store/compute correctly now.

### 2. Disconnect calc + context tag
- **Primary:** Critics ↔ Community gap (number + a green→red band by magnitude). Sub-levels (Our ↔ Media Critics; Our community ↔ Internet) computed too (BLUEPRINT 2.3).
- The gap and its band are **automatic** (arithmetic).
- The **context tag** ("monetization anger," "review-bombing," "niche taste," "critics overrated") is **editor-entered, optional, shown only when the gap is large** — never auto-inferred. Editor note in demo; AI later (out of scope). Audit-logged.
- This is the thing that separates us from Metacritic's two bare numbers — but only if the "why" is honest, so it must be a human's call, not a guess.

### 3. Community weighting + anti-manipulation
Implement the DECIDED policy above. Concretely:
- A per-vote effective weight (0→1.0) from the credibility inputs.
- The community aggregate = weighted mean of on-site ratings using those weights.
- Burst/anomaly detection → an "unusual activity" flag on the game's community rating + visible/tunable damping.
- Verified-playtime slot modeled empty.
- Everything tunable + audit-logged; editor can override the community score and clear/raise a flag with a reason.

### 4. Content Flags (factual, game-level — per BLUEPRINT 2.3)
Fill the content-flags table logic (the table exists from I1). All factual, non-ideological, admin-editable, "where known," with the community-report + vote option (like FPS):
- **AI-asset disclosure** (yes/no/partial/unknown) — informational, not a judgment.
- **Launch state** (polished / mixed / rough-at-launch) — technical, factual.
- **Monetization flags** (microtransactions, battle pass, paid loot/gacha, pay-to-win, predatory-monetization indicator).
- **Complexity rating** (1–5).
- **DLC list** (name + price, reusing the price structure) — shown only where data exists.
- **Display rule (enforce in the data/DTO now):** any flag shows **only when we have the data** — never render an empty/unknown field. Model the "has data?" distinction explicitly so I5's clean-page rule is trivial.

### 5. Rating summary + recompute path (background, cached)
- A stored per-game **rating summary** (the three layers + disconnect + flags presence) recomputed on the I3/I4a background-job pattern when a game's ratings/votes/flags change — never on the user request path (speed rule).
- Idempotent + re-runnable from admin.

### 6. Admin surface (inspect + tune + override)
- An `/admin/ratings` page (matching the I4a/clustering admin style): per-game view of the three layers, the disconnect + sub-levels, the community weighting breakdown (how many votes, how they were weighted, any burst flag), the content flags, with override + reason on every computed value, all audit-logged.
- Weighting/burst/disconnect-band params fold into the tunable settings surface.

## Out of scope (do NOT build in I4b)
- **Public game-page UI / disconnect bar / flag display — I5.** Build data + admin inspection only.
- Real Steam player counts / completion / HowLongToBeat live fetching (later) — columns exist; demo may include a little mock data, no live calls.
- Verified-playtime verification logic (structure only; needs Steam, production).
- AI-generated context tags (editor-entered only here).
- The level-progression formula itself (I6 user system) — I4b only *reads* level/tenure inputs as weighting signals; it doesn't build the level engine.
- Awards (I7), newsletter (I8), ads (I8).
- Any auto-inference of *why* a gap exists (judgmental → editor).

## Decisions you (the agent) make
The aggregation/normalization math per layer, the credibility-weight curve shape + proposed initial params (propose with reasoning — owner tunes, like the I3 threshold / I4a weights), the burst-detection window/multiplier/damping defaults, the disconnect band thresholds, how the rating summary is stored/refreshed, the admin UX, the simulated review-bomb seed for verification. Prefer transparency and defensibility over cleverness. Document the model + initial params in PROGRESS.md.

## Constraints (from CLAUDE.md / BLUEPRINT)
- Everything configurable: all weighting/burst/disconnect params in `app_settings`, admin-tunable, never hardcoded.
- Auto + manual override: every computed score/flag editor-overridable with reason, not clobbered by re-tuning (the I4a override-safe pattern).
- Audit-log every editor action.
- Nothing heavy on request: aggregation/weighting/disconnect all background, stored/cached.
- Transparency = brand: anomaly handling is a visible flag, never silent suppression. Critics never altered by community weighting.
- Vote weight never exceeds 1.0; push bad votes toward 0, don't inflate good ones.
- Validate/harden: a game with zero community votes, zero critic entries, no review → neutral/absent, never a crash or a fake number. "No data" must be representable distinctly from "score of 0."

## Verification (REQUIRED — note results in PROGRESS.md; add `verify:i4b`)
The headline test is review-bomb resistance — treat it like I3's adversarial check.

1. Fresh `demo:reset` → boot: games with seeded ratings get all three layers + disconnect + summary computed in the background. Report a few examples.
2. **Three layers stay separated** — Our / Media Critics / Community (two lines) are distinct, never merged; each normalizes to 0–100 internally. Show a game where they differ.
3. **Disconnect:** a game with critics-high / community-low shows the correct gap + band; sub-levels compute; a large gap with an editor context tag displays it; **no gap auto-explains itself** (tag only when a human set it).
4. **Review-bomb resistance (the headline):** seed a game with a legitimate score, then inject a simulated burst of extreme low votes from new/unproven accounts. Show that (a) an "unusual activity" flag is raised, (b) the weighted community score moves far less than a naive average would (report both the naive avg and the weighted score so the difference is visible), and (c) nothing was silently suppressed — the flag is public-facing data, the damping is visible/tunable. Then show a *legitimate* low score (many proven voters genuinely rating low) is NOT flagged and DOES move the score — the model must not just blanket-mute all low votes.
5. **Weighting transparency:** for a game, show the per-vote weights and how the aggregate was formed (inspectable in admin) — no opaque number.
6. **Tunability:** changing a weighting/burst param in admin measurably changes the outcome (before/after); nothing hardcoded.
7. **Override + audit:** editor overrides a community score / clears a burst flag / sets a disconnect tag with a reason → marked editor-set, audit-logged old→new, survives a re-tune.
8. **Content flags:** flags set on a game show correctly; the "only when data exists" rule is representable (a game with no flag data is distinct from one flagged "unknown"); community-report/vote slot exists.
9. **Critics untouched:** confirm community weighting does not alter Our score or Media Critics aggregate.
10. **No-data safety:** a game with no votes/critics/review doesn't crash and doesn't fabricate a number — "no data" is distinct from "0."
11. **No regression:** `verify:i1`/`i2`/`i3`/`i4a` still pass. Full gate green (Node + Python). `npm run health` green. Demo boots one command, zero secrets.

## Done looks like
From a fresh `demo:reset`, the stack boots and every seeded game carries three separated rating layers (0–100 internal), a critic↔community disconnect with band + sub-levels and an editor-set context tag where the gap is large, a community score built from transparent 0→1.0 vote weights, and factual content flags shown only where data exists. A simulated review-bomb raises a visible "unusual activity" flag and is damped far more than a naive average — while a genuine low score from proven voters is not flagged and does move the number, proving the model resists manipulation without muting legitimate anger. Critics are untouched by weighting. Every computed value is admin-inspectable, tunable, and editor-overridable with an audited reason. No public game-page UI yet — that's I5. PROGRESS.md records the rating model, the proposed weighting/burst/disconnect params + reasoning, the review-bomb test results (naive vs weighted), and that I5 (public pages) is next.

---

### Note for the next phase (I5 preview — do not build yet)
I5 builds the public-facing pages (homepage hero with bias bar, topic pages, game pages with the three-layer rating block + disconnect + content flags, Upcoming, Sources) — SSR for SEO, schema.org (VideoGame/Review/AggregateRating/NewsArticle), the "click to see why" reveals on both the bias bar (I4a's stored breakdown) and the disconnect/flags (I4b). All the engines (clustering, bias, rating, disconnect, weighting) are done and stored by end of I4b; I5 renders pre-computed data — nothing heavy on request. The public bias/disconnect reveals consume the leak-proof DTOs (I4a) and the "data exists?" flags (I4b), so internal fields can never surface.

### Note carried (so it isn't lost — media/writer awards)
Still pending for **I7**: awards for media outlets + article writers (winners published only, separate tab/page), reusing the Awards edition→category→nomination→outcome structure with a Source/Person subject. Belongs with I7, not here.

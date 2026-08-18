# SPEC I7 — Awards (annual program: full system + "Coming Soon" public display + subscribe)

> Phase goal (BLUEPRINT 2.7 / 3.7–3.8 / I7): build the **whole** annual Awards
> system — voting, weighting, outcomes, analytics, staff lifecycle, subscribe —
> but keep the public current-edition page a greyed **"Coming Soon" + subscribe**
> by default. Staff pre-configure everything, then flip one toggle to "turn it
> on". Owner decisions (this session): **phase-driven public page, Coming-Soon
> default**; **Critics' Choice = auto-suggested, staff-confirmed**.

## What already exists (delta — do NOT rebuild)
- **DB schema (I1):** `award_editions` (year, name, `phase`, description, voting
  window, `is_published`), `award_edition_categories` (+ sponsor slot),
  `award_nominations` (subject + blurb), `award_outcomes` (critics|community, one
  per edition-category per type), `award_votes` (one per user per edition-category,
  `weight` col). Enum phases: `announce → nominations → voting → reveal → archive`.
- **Admin generic CRUD (I1):** every award table is editable at `/admin/api/award-*`.
- **Seed:** one unpublished "GamesKeep Awards 2026" edition (GOTY + 1 nomination).
- **Public:** `/awards` is a `ComingSoon` stub (noindex).
- **Reusable engines:** `community/weighting.ts` `voterCredibility` (the 0→1.0
  curve, from `getRatingSettings().credibility`); `auth/guards` `requireVerified`;
  `community/rate-limit` `allowWrite`; CSRF double-submit; the `subjects`→`games`→
  `game_rating_summaries` join for the effective critics score
  (`criticsOverride ?? criticsScore`).

## The gap (this phase), in 3 slices

### Slice 1 — Voting + outcomes engine (backend) ← THIS SLICE
- **Cast/change/retract a vote** through a new `/awards` scope, gated exactly like
  a community write: **CSRF + `requireVerified` + per-user `allowWrite`** (blueprint
  "registered only, same weighting + anti-abuse as the community score"). One vote
  per (user, edition-category) enforced by the existing unique index (upsert on
  re-vote). Voting is allowed ONLY when the edition `is_published` AND `phase =
  'voting'` AND now ∈ [votingOpensAt, votingClosesAt] (null = open-ended) — the
  "turn it on" switch. A vote for a nomination not in that category is rejected.
- **Per-vote weight** = `voterCredibility` computed at **cast time** and stored in
  `award_votes.weight` (a fixed-at-cast snapshot: deterministic, one-vote-one-
  fixed-weight fairness, single source of truth — recompute-at-reveal was
  considered and rejected to avoid retroactively re-weighting cast votes).
- **Tally** (`categoryTally`): per-nominee Σweight + raw vote count + totals,
  sorted, **leak-proof** (no user identities) — the live counter + ratios.
- **Outcomes** (`computeOutcomes`, staff-triggered, audited, idempotent):
  - **Community Choice** = argmax Σweight (tie → max raw count → min id); **upsert**
    (always reflects the latest votes pre-lock). No votes → no community outcome
    (never fabricated).
  - **Critics' Choice** = argmax effective critics score among nominees; written
    **insert-if-absent** so a staff override (via `award-outcomes` CRUD) is never
    clobbered by a re-run — this IS "auto-suggested, staff-confirmed". No scored
    nominee → no suggestion.
- **Verify:** `scripts/i7-check.mjs` (`verify:i7`) — attack-proof, on its OWN
  RUN-scoped edition (never mutates the demo 2026 edition).

### Slice 2 — Subscribe capture + staff Awards control (backend + admin)
- Awards "notify me" subscribe capture (new table + migration, GDPR consent);
  full newsletter stays I8. Guarded phase transitions + "turn it on" (publish) +
  a compute-outcomes trigger + sponsor-slot management + the analytics view
  (voters, ratios, aggregated/anonymous geo, over-time). Bespoke admin surface
  (like `/admin/bias`, `/admin/ratings`).

### Slice 3 — Public Awards UI + archive + game-page badge + SEO (+ visual gate)
- Phase-aware public `/awards` (demo default → **Coming Soon + contact +
  subscribe**; when published + voting → nominees with our analytics + vote;
  reveal/archive → winners). `/awards/[year]` archive (winners by category,
  permanent, indexable). **"Game of the Year 2026" winner badge on the game page.**
  Structured data + sitemap + breadcrumbs. Desktop + mobile screenshot gate.

## Out of scope (this phase)
- Real newsletter sending / segmentation / AI-digest (I8).
- Real ad/sponsor SELLING — sponsor slot is a defined, empty label only.
- OAuth, list/ranking config, the unified Control Panel (I8).

## Verification (every slice)
Prove-the-attack-fails `verify:i7` + the from-empty regression ladder (health +
`verify:i1…b2` + `verify:i6` + `verify:i7`) + the static gate (tsc/eslint/
prettier/tests). UI slices add the desktop+mobile screenshot gate. STOP for owner
review before commit.

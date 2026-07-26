# SPEC — Phase I4a: Bias Engine + Clustering Secondary Gate

> Read `CLAUDE.md`, `BLUEPRINT.md` (1.3 the differentiator, 1.5 governing principles esp. #6 Transparency, 2.1 Topic "Bias bar", 2.2 Article "Detected signals" + "Bias (two axes)" + "Internal-only field", 2.5 Source), and `PROGRESS.md` before starting. This SPEC is the single source of truth for **this phase only**; where it conflicts with the blueprint, this SPEC wins for I4a. I0–I3 are complete and verified — build on them. I3 already **captures** the raw detected signals (affiliate / sponsored-PR / review-copy / paywall / article type) and the `article_subjects` game links; this phase **computes on top of them**. It does not re-capture or re-cluster.

## Why I4 is split
The original I4 bundled four independently-hard things (bias axes, rating aggregation, disconnect, community weighting) into one phase, each with its own "how do we even prove this is correct" problem. That's the same trap as putting clustering on self-assessment. **I4a = the bias engine (news/GroundNews side, works on articles/topics/sources). I4b = the rating engine (ratings/IMDb side, works on games/rating tables) + disconnect + community weighting + content flags.** This SPEC is I4a only. I4b is a separate later SPEC — do not build it here.

## Goal of this phase
Turn the **raw factual signals** I3 captured into the **two public bias axes** — per article, then aggregated to the topic-level "bias bar" — using a **transparent, admin-tunable, explainable** scoring model (no black box, no content-NLP, no magic). Plus: add the **clustering secondary gate** carried over from I3's adversarial finding. This is the engine behind the platform's core differentiator (bias shown alongside score). It must be defensible, because a news platform that *sells* transparency cannot ship an unexplainable bias label.

**Still no public UI.** The bias bar that users see is I5. Here the engine computes, stores (with its breakdown), and is inspectable + tunable + override-able **in the admin**. Get the model right and honest; I5 just renders it.

## The non-negotiable design principle (read this twice)
A bias score has **no external ground truth** — unlike clustering, where two articles objectively are or aren't the same event. You cannot write an adversarial test that proves "0.72 is the correct Influenced score." That means a plausible-looking formula passes verification **whether it produces sense or nonsense**, because nothing can falsify it. The only defenses are:

1. **Transparent additive scoring**, not a learned/opaque formula. Every point comes from a named signal with an admin-tunable weight. No hidden math.
2. **Stored breakdown**, not just a number. The system stores *which signals contributed and how much* alongside every score. This breakdown is the exact data I5 will render publicly ("Influenced because: affiliate links, reads as promotional"). Build it as data now.
3. **Direction + explainability are the verification target**, not the absolute number. We verify that the right signals push the right way, that every score is explainable, that weights are tunable, and that editors can override — NOT that any specific number is "right."

If at any point the model becomes something you can't explain in one sentence per score, you've built the wrong thing.

## In scope (build exactly this)

### 1. Axis 1 — Influenced ↔ Independent (mostly automatic — factual)
This axis is the strong one because its inputs are **facts**, not judgments. Compute it from the signals I3 already captured plus source baseline:

- **Factual signals (auto):** affiliate links present, sponsored/PR labeled (self-disclosed → ~99% influenced per BLUEPRINT 2.1), review-copy based, paywall, article type (opinion vs straight reporting framing where I3 captured it), **source ownership/conflict** (a source owned by the publisher of the game it covers — the `Source` conflict indicator from I1/2.5).
- **Each signal carries a named, admin-tunable weight** (in the `app_settings` table from I3, same pattern as the clustering threshold). Sponsored should dominate (near-max Influenced); affiliate is milder; etc. — but the **agent proposes the initial weights with reasoning, the owner tunes them**. Nothing hardcoded.
- The per-article Axis-1 score = transparent sum/normalization of the active signals' weights, clamped to the axis range.
- **Stored breakdown:** alongside the score, store the list of contributing signals and their weight contribution, so (a) the owner can see *why* in the admin and tune, and (b) I5 can render the human-readable "why."

### 2. Axis 2 — Slop ↔ Top (deliberately humbler — quality)
Per our decision: this axis is **consciously weaker/more editorial** than Axis 1, because "journalistic quality" is softer than "commercial influence" and the demo has **no content-NLP** (CLAUDE.md). Do NOT fake precision here.

- **Weak automatic signals only** where genuinely derivable: article type (deep analysis vs press-release-rewrite vs thin preview), source reputation baseline, presence/absence of original reporting markers I3 can cheaply detect. Keep these light.
- **Editorial input is first-class for this axis**, not a fallback. An editor can set/adjust the quality position with a short reason. The auto signal is a starting suggestion; the human is expected to matter more here.
- Same transparent, tunable, breakdown-stored structure as Axis 1.

### 3. Factual vs judgmental — the hard line (CRITICAL)
- **Factual signals → automatic** (affiliate exists or doesn't; sponsored is labeled or isn't; source has a conflict or doesn't). These mechanically feed the axes.
- **Judgmental observations** ("pushes an agenda," "all cozy-vibes, no gameplay substance," "reads as promotional") → **editor-entered only. NEVER auto-detected.** The demo cannot reliably detect these without content analysis it doesn't have, and auto-generating them would produce random, indefensible, potentially defamatory labels. The system **displays** an editor's note; it never **invents** one.
- Provide an **editor note / rationale field** per article (short free text) for exactly these judgmental observations — surfaced in the admin now, available for I5's public "why" later. This is how "gura agendu" / "cozy not gameplay" reaches the UI: a human wrote it, the system shows it.

### 4. The internal-only assessment field (legal/reputational shield — per BLUEPRINT 2.2/2.1)
- Model + populate (editor-set) the **internal-only** assessment field (perceived narrative/ideological push, AI-written likelihood) for internal sorting/insight.
- **This field is NEVER exposed publicly and must be structurally separated** from the public axes so it cannot leak into a public payload. Enforce that separation now (separate field/endpoint scoping), because retrofitting a leak-proof boundary later is exactly the kind of thing that goes wrong. Public bias output must be incapable of including this field.

### 5. Topic-level aggregation (the "bias bar" data)
- Aggregate the per-article axis scores up to the **topic level** as a distribution (BLUEPRINT 1.3 example: "15 articles → 9 independent, 6 influenced; 12 quality, 3 low-effort"). Store the topic-level distribution so I5 renders the bias bar without computing on request (speed rule).
- Recompute on the same background-job pattern as I3 (when a topic's articles change), stored/cached — never on the user request path.

### 6. Per-score explainability + editor override (auto + manual override rule)
- Every article's axis scores are **inspectable in the admin** with their stored breakdown (which signals, what each contributed). This is the owner's tuning + trust surface.
- **Editor override** on any axis score, with a reason, **audit-logged** (who/what/when/old→new). An overridden score is marked as editor-set so it's distinguishable from auto, and the auto value is retained underneath (so re-tuning weights doesn't silently clobber a human decision — same "don't overwrite editor edits" rule as I2's upserts).

### 7. Clustering secondary gate (carried from I3's adversarial finding)
I3 proved single-vector + one-threshold clustering structurally over-merges **same-game / same-register** events (the Cyberpunk "sequel pre-production" vs "30M sales" pair scored 0.68, above the 0.50 threshold, where they should separate; a true-merge pair scored 0.50, so no global threshold satisfies both). Now that game links + signals exist, add the gate:

- **A secondary check on top of the cosine merge decision**, using data already captured: e.g. *same primary-game + a configurable time gap + a different event type → resist the auto-merge* (keep as separate topics even when cosine says merge). Tunable (`app_settings`), not hardcoded.
- This is a **guard rail on the existing engine**, not a re-clustering. It only intervenes at the merge-decision point. Editor merge/split from I3 still overrides everything.
- Verify it changes the I3 over-merge case: the same-game/same-register pair that previously over-merged now stays separate, while legitimate same-game same-event articles still merge.

## Out of scope (do NOT build in I4a)
- **Rating aggregation (three layers), disconnect calc + context tag, community weighting, game-page Content Flags logic — all I4b.** (Community weighting in particular: do not build it here even though community appears as a bias signal conceptually — it's an I4b rating concept; I4a reads only what already exists.)
- **Public bias bar / hover-reveal UI — I5.** Build the data + admin inspection; do not build the public-facing rendering.
- **Any content-NLP / automatic detection of agenda, tone, AI-written-ness, "quality" beyond the light signals above.** Judgmental = editor-entered only.
- Re-capturing signals or re-running clustering (I3 owns those). I4a computes on top.
- Bias as a learned/ML model. Transparent additive only.

## Decisions you (the agent) make
The exact additive/normalization math per axis, the **initial weight values (propose with reasoning — the owner tunes)**, how the breakdown is stored (shape), the secondary-gate's default time-gap + event-type rule, the admin inspection/override UX, how topic-level distributions are stored/refreshed. Prefer transparency and explainability over cleverness. Document the model + initial weights in PROGRESS.md.

## Constraints (from CLAUDE.md)
- Everything configurable: all weights + the gate's parameters in `app_settings`, admin-tunable, never hardcoded.
- Auto + manual override: every score editor-overridable with reason; editor decisions not clobbered by re-tuning.
- Audit-log every editor action (override, note, internal-field edit).
- Nothing heavy on the request path: bias compute + topic aggregation are background, stored/cached.
- Transparency = brand: public bias output must be explainable AND must never include the internal-only field. Enforce the boundary structurally.
- Validate/harden: handle articles with no signals (→ neutral/unknown, not a crash), missing source baseline, etc.

## Verification (REQUIRED — note results in PROGRESS.md; add `verify:i4a`)
Because bias has no ground-truth number, verification targets **direction, explainability, tunability, separation, and override** — not absolute values.

1. Fresh `demo:reset` → boot: articles get Axis-1 + Axis-2 scores computed in the background; topic-level distributions stored. Report a few examples.
2. **Direction sanity (the closest thing to a correctness test):** an article with sponsored+affiliate signals scores **more Influenced** than a clean independent article; a press-release-rewrite scores **lower on Slop↔Top** than a substantive piece. Show the ordering holds. (Seed a few articles spanning the range — clean independent, affiliate-only, sponsored PR-rewrite — so the spread is visible.)
3. **Explainability:** every score has a stored breakdown; pick any article and show *why* it got its score (which signals, what each contributed). No unexplained numbers.
4. **Tunability:** changing a weight in admin measurably changes the affected scores (show before/after); nothing hardcoded.
5. **Factual vs judgmental:** confirm no judgmental label is ever auto-generated; an editor note is displayed only when a human entered it.
6. **Internal-field separation:** confirm the internal-only assessment field is populated/editable internally AND is structurally absent from the public-facing bias payload (show the public shape does not and cannot contain it).
7. **Override + audit:** an editor overrides an axis score with a reason; it's marked editor-set, audit-logged old→new, and survives a weight re-tune (not clobbered).
8. **Topic aggregation:** a multi-article topic shows a correct distribution across both axes (counts add up to its articles).
9. **Secondary gate:** the I3 same-game/same-register over-merge case now stays separate; legitimate same-game same-event still merges; the gate's params are tunable; editor merge/split still overrides.
10. **No regression:** `verify:i1` + `verify:i2` + `verify:i3` still pass. Full gate green (Node + Python). `npm run health` green. Demo boots one command, zero secrets.

## Done looks like
From a fresh `demo:reset`, the stack boots and every article carries two transparent, explainable bias scores derived from I3's factual signals (Axis 1 mostly automatic, Axis 2 humbler + editor-leaning), each with a stored breakdown of *why*; topics carry an aggregated bias distribution; the internal-only assessment field exists and is provably walled off from any public output; an editor can override any score with an audited reason that re-tuning won't clobber; weights are all admin-tunable; and the clustering secondary gate keeps the I3 same-game over-merge case separate while legitimate merges still happen. No public UI yet — that's I5. PROGRESS.md records the scoring model, the proposed initial weights + reasoning, the gate's default rule, verification results, and that I4b (rating engine + disconnect + community weighting + content flags) is next.

---

### Note for the next phase (I4b preview — do not build yet)
I4b builds the ratings/IMDb side: the three separated rating layers (Our score / Media Critics aggregate + outlets / Community aggregate + Steam estimate), all 0–100 internal / 1–10 display; the **critic↔community disconnect** calc + context tag (BLUEPRINT 1.3/2.3); **community weighting** (how community votes aggregate — deliberately deferred from I4a); and game-page **Content Flags** logic (AI-asset disclosure, launch state, monetization). It works on the Game + rating tables from I1, independent of the article/bias side built here. Structure nothing special now — I4b is a clean separate surface.

### Note for a later phase (carried so it isn't lost — media/writer awards)
The owner wants, alongside the game Awards (I7), **awards for media outlets and article writers** (e.g. Most Independent Outlet, Best Disclosure/Transparency, Highest-Quality Reviews) — **winners only published**, in a separate tab or page of the Awards UI. This reuses the I7 edition→category→nomination→outcome structure with a Source/Person subject instead of Game. **Belongs with I7, not I4.** Recorded here only so it survives; do not build it in I4a/I4b. One caution for whoever specs it: while small, publish positive winners only — never a public "worst outlet" ranking — since these are the same outlets we aggregate from.

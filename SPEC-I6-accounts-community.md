# SPEC — Phase I6: Accounts & Community

> Read `CLAUDE.md` (Security + Golden rules are first-class here), `BLUEPRINT.md` (2.6 User, community fields on 2.1/2.2/2.3, 3.11/3.12 pages), and `PROGRESS.md` before starting. This SPEC is the single source of truth for **this phase only**; where it conflicts with the blueprint, this SPEC wins for I6.
>
> **Provenance:** the original I6 SPEC was lost with the dev machine's SSD (2026-07). This document is a faithful reconstruction (2026-08-12) from the owner's locked decision record — the 13 decisions, the hardening items from the original Slice-1 adversarial security review, and the slice plan are restated verbatim in substance. This is a rebuild against locked decisions, not a fresh design.

## Goal of this phase

Light up **accounts and community**: real authentication, verified-email community writes (ratings / trust- and bias-votes / comments / reactions / hype), the credibility weighting the I4b engine already computes pointed at real users, reputation/levels/badges, follow + a basic "Your Feed", GDPR export/delete, and the public auth/account/profile UI that fills the I5 "coming with accounts" placeholders.

**This is the security-sensitive phase.** It is built **slice by slice, stopping after every slice for owner review** — nothing gets built in one pass. Verification is *prove the attack fails*, not *it renders*.

## Ground truth (delta-inspected 2026-08-12 — I6 is mostly wiring dormant slots)

I1 laid the schema with I6 in mind; the I4b engine already consumes it:

- `users`: `passwordHash` (nullable, "filled by auth in I6"), `isEmailVerified`, `reputation`, hidden `voteWeight` (0→1.0) + `levelPoints`, `roleId`→`roles` (visitor/registered/writer/moderator/admin/owner with `rank` 0–50 + `isStaff`), `levelId`→`userLevels`, `status` (active/suspended/banned). `badges`/`userBadges` exist.
- `community.ts` is schema room only: `comments` (polymorphic entity + `parentId` + `isRemoved`), `reactions`, `articleTrustVotes`, `topicBiasVotes` — tables + one-per-user uniqueness, zero logic.
- `gameUserRatings` carries `weight` + `hasVerifiedPlaytime`; **I4b's `computeCredibility`/`computeCommunity` already JOIN real users** — I6 points them at real accounts. No rating-engine redesign.
- The `/admin/api/[...path]` proxy is the BFF precursor (server-side token injection).
- **NOT present (all new here):** `sessions`, `user_tokens`, `user_identities`, `email_outbox`, `follows`, `user_consents`, `comment_reports`; any auth/session/CSRF/lockout code; `TRUST_PROXY`/`PUBLIC_SITE_URL` env.
- **Confirmed live pre-existing gaps this SPEC closes from the start** (found in the original review, still true on this trunk): `trustProxy: true` hardcoded (`server.ts`), non-constant-time admin-token compare, generic admin CRUD `.select()` returning `passwordHash`, and the admin proxy's `encodeURIComponent` not encoding `.`/`..` path segments.

Migrations continue from `0005_a2_videos` → `0006_i6_auth`, `0007_i6_email`, … per slice.

## The 13 locked decisions

1. **Sessions, not JWT.** Opaque 256-bit random token; **only its SHA-256 hash persisted** in a `sessions` table; the raw token lives solely in an **HttpOnly + SameSite=Lax (+Secure in prod)** cookie signed with `SESSION_SECRET`. **Sliding expiry with a hard absolute cap (90 days).** Revocation: logout, logout-everywhere, ban/suspend revokes all, password change/reset revokes all others. Chosen over JWT for instant revocation + clean GDPR cascade.
2. **BFF topology.** The browser never talks to Fastify directly; Next.js route handlers relay cookies both ways (mirroring the `/admin/api/[...path]` proxy). Same-origin, so SameSite=Lax + CSRF work cleanly and there is no credentialed cross-origin CORS to get wrong.
3. **Argon2id via `@node-rs/argon2`** (prebuilt Rust bindings — no node-gyp pain on Alpine/musl), OWASP parameters, store `password_algo` for future re-hash. **Never log or return a hash.**
4. **OAuth: email-only for I6.** Model `user_identities` + the seam now; defer provider wiring (Steam OpenID is non-OIDC and gaming-critical → its own pass; keys are prod-only anyway).
5. **Admin: staff-session as the primary human path** (`validSession && role.isStaff && rank ≥ required`) while **retaining `x-admin-token` as the service credential** for automation — retention is a **hard constraint** so `verify:i1…b2` stay green. Per-section rank gating (moderator 30 < admin 40 < owner 50) lands here; the unified Control Panel + full RBAC granularity remains I8.
6. **Verified-email gate.** Browse + follow allowed unverified; **rate / vote / comment require a verified email.**
7. **Account deletion: anonymize-and-tombstone.** Hard-delete PII (email, password, sessions, tokens, bio, follows, consents); detach retained content (comments → "[deleted]", ratings/votes kept but user-detached so aggregates and the disconnect math stay honest); `audit_logs` keeps its denormalized actor label. The deleted email **is freed** for re-registration (right to be forgotten).
8. **Comments: plain text + post-moderation.** Store raw, render escaped (React auto-escape; **no `dangerouslySetInnerHTML` anywhere near UGC**), safe line breaks only; report → soft-remove/restore by a moderator → **auto-hide at N reports** (tunable via `app_settings`). Full moderation dashboard is I8.
9. **Follow + basic "Your Feed" in I6**; notification delivery deferred to I8.
10. **Wishlist/backlog: deferred.**
11. **Reputation: the simple credibility-weighted-received-signal version.** Rises from received helpful-votes weighted by the **voter's own credibility** (a ring of throwaways can't farm it), accepted reports, tenure; falls on removed content/suspensions. The level engine is a background job; users see level name + progress + badges — **never** the formula, thresholds, or that level affects vote weight.
12. **CAPTCHA: dormant seam in demo, enforced in production** (Cloudflare Turnstile).
13. **Uniform 0→1.0 credibility weighting across ALL community signals** — topic bias-votes and article trust-votes get the same treatment as game ratings, so no signal is undefended.

## Hardening — built in from the start (the original review's findings)

The original build shipped Slice 1, then an adversarial review found these. This rebuild ships them **in** Slice 1, not after it:

- **HIGH — spoofable client IP.** `trustProxy: true` + a BFF forwarding `X-Forwarded-For` made `req.ip` attacker-controlled, defeating every per-IP throttle. Fix: a **`TRUST_PROXY` env (default `false`** = unspoofable socket peer; production sets hop-count/CIDR), and the **BFF must not forward `x-forwarded-for`/`x-real-ip`**.
- **HIGH — lockout bypass.** A per-account lockout keyed on the raw identifier gave `bob` / `bob@x.com` / `Bob` separate attempt budgets. Fix: **resolve the user first, key the lockout on a stable `uid:<id>`**; the verify must prove 5 mixed-form failures still lock.
- **MED — audit leak.** The generic admin CRUD `.select()` and the delete-audit snapshot both carried `passwordHash`. **Redact per-resource** in payloads and in create/update/delete audit snapshots.
- **LOW:** the BFF must reject `.`/`..` path segments (note: `encodeURIComponent` does NOT encode dots); coarsen the consent IP the same way sessions do; **fail closed in production** if `SESSION_SECRET`/`ADMIN_API_TOKEN` still hold demo defaults; **constant-time compare** for the admin token.
- **Enumeration-safety everywhere.** Login: dummy Argon2 verify on the unknown-user path → identical body **and timing**. Reset: identical response whether or not the email exists. Registration: a taken email returns the **same generic 202 "verification sent"** and emails an "account exists" notice **to the real owner, never the requester**, with a dummy hash to equalize timing. **Consequence: register does not auto-log-in** — the verify link or a password login signs them in. Only the public **username** may return a distinct 409.

## Email (Slice 2)

A swappable **`EmailSender` seam**: Mock → a dev **`email_outbox` table** in demo (zero network); Live dormant until a provider is wired. `user_tokens`: **hashed at rest, TTL'd (verify 24h / reset 1h), single-use with a race-safe conditional consume, one active per (user, purpose)**. Reset revokes **all** sessions. Resend throttled per-email and per-IP. New **`PUBLIC_SITE_URL`** env for email link bases.

## Build order — stop after EVERY slice for owner review

1. **Auth core** — `sessions` + password + cookie + CSRF (double-submit) + brute-force lockouts + login/logout/register + `/auth/me` + the BFF. Migration `0006_i6_auth`. All hardening items above included from the start.
2. **Email flows** — the seam, `user_tokens`, verify + reset, enumeration-safe registration finalized, send throttles. Migration `0007_i6_email`.
3. **RBAC + admin hardening** — `requireAuth`/`requireVerified`/`requireRole(minRank)`/`requireStaff`; staff-session admin path primary; `x-admin-token` retained for automation (hard constraint); per-section rank gating; **the owner password is set here** (the seed admin has none by design).
4. **Community writes** — ratings/trust-votes/bias-votes/comments/reactions/hype wired to real accounts; verified-email gate; uniform credibility weighting live on every signal; per-user rate limits; comment reports + auto-hide threshold.
5. **Reputation + levels + badges** — the credibility-weighted-received-signal model; level engine as a background job; badges awarded; public shows name/progress/badges only.
6. **Follow + "Your Feed"** — follow games/topics; a followed-based feed view; no notification delivery (I8).
7. **GDPR** — export (JSON of the user's data), delete (anonymize-and-tombstone per decision 7), consent records with coarsened IP.
8. **Public UI** — login/register/verify/reset/account pages + public profile + the community sections filling the I5 placeholders (topic/game/upcoming "coming with accounts" slots), on the locked design system.
9. **`verify:i6` + adversarial security review + visual gate + PROGRESS** — then the phase closes.

## Out of scope (do NOT build in I6)

- OAuth provider wiring (Steam/Google/Discord) — the `user_identities` seam only.
- Notification delivery, moderation dashboard, unified Control Panel / full RBAC granularity, newsletter — I8.
- Wishlist/backlog.
- Live CAPTCHA enforcement in demo (seam only; production flag).
- Forum-style threads beyond the modeled comments.

## Constraints

- Demo boots with zero secrets and never touches the network (Mock email, dormant CAPTCHA, no OAuth).
- Everything tunable lives in `app_settings` (lockout thresholds, report auto-hide N, throttle windows) — nothing hardcoded.
- Every staff action audit-logged; every new admin surface behind the guards.
- Leak-proof: no `passwordHash`/token/secret in any payload, log, or served HTML; internal fields (`voteWeight`, `levelPoints`, formulas) never exposed.
- UGC: store raw, render escaped; excerpt+link posture untouched.
- SSR/SEO: auth pages `noindex`; public profiles indexable; no layout regressions (visual gate on any UI slice).

## Verification (per slice + `verify:i6` at the end) — prove the attack fails

- Password only ever a hash; absent from every payload, log, and audit snapshot.
- Session stored hashed ≠ raw cookie value; cookie flags (HttpOnly/SameSite/signed; Secure in prod).
- Brute-force lockout blocks **even the correct password**; mixed-form identifiers (bob/bob@x.com/Bob) share one budget.
- Enumeration-safe login/reset/register in body **and timing**; register never auto-logs-in.
- CSRF-less mutation rejected; BFF strips spoofable IP headers; `.`/`..` BFF paths rejected.
- RBAC: registered user hitting an admin route → 403; moderator attempting admin-only actions → 403; staff session works; **service token still authorizes automation**.
- UGC: `<script>` stored raw, rendered escaped; one-per-user integrity under live flow.
- The I4b review-bomb scenario re-run with real accounts: unverified ~0 weight; verified/aged ~1.0; burst flag raises; weighted score resists; a genuine proven-voter low score still moves and is not flagged.
- GDPR: export contains the user's data; delete frees the email, detaches content, keeps aggregates honest.
- Reputation unfarmable by a self-ring of throwaway accounts.
- `verify:i1…b2` + `health` stay green throughout; static gate clean; from-empty proof at phase close.

## Done looks like

From a fresh `demo:reset`, a visitor registers (generic 202, no auto-login), verifies via the outbox link, signs in (opaque session, hashed at rest), rates a game / votes / comments (verified-gated, credibility-weighted, escaped), follows a game and sees a basic feed, exports and deletes their account (email freed, aggregates honest). Staff sign in and reach rank-gated admin sections while `x-admin-token` automation continues to pass `verify:i1…b2`. Every listed attack fails, provably, in `verify:i6`. The I5 placeholders are filled. PROGRESS records each slice and its review.

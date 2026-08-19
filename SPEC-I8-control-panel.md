# SPEC — Phase I8: Control Panel + Monetization + Newsletter

> Read `CLAUDE.md` (Golden rules — audit, everything-configurable, transparency, anti-bug — are first-class here), `BLUEPRINT.md` (§1.5 principles 3/4/5/6/7/9, §2.8 Newsletter, §2.10 Ad/Promotion, §3.14 Control Panel, §3.9 Lists/Rankings, the Part-3 slot rule), and `PROGRESS.md` before starting. This SPEC is the single source of truth for **this phase only**; where it conflicts with the blueprint, this SPEC wins for I8.
>
> **Provenance:** derived from the blueprint + the owner's locked I8 decision record (2026-08-19). Not a fresh design — a build against locked decisions. Built **slice by slice, committing + pushing each slice**, and **stopping for owner review at the gated slices** (ad-management, newsletter, and the phase-close security review). Verification is *prove the attack fails*, not *it renders*.

## Goal of this phase

Turn the API/token admin surface into a **unified, permissioned Control Panel** (a UI layer over the existing I6 RBAC — not a new permission system), and light up the two **monetization-ready** structures the blueprint has kept dormant since day one: **ad/promotion management** (every slot as real inventory, sold/free/scheduled, per-slot analytics, a "Promote a game" flow, a dormant payment seam) and the **newsletter** (compose/schedule/segment/AI-digest/analytics over a swappable send seam). Plus list/slot configuration, an account-panel polish, and a phase-close hardening pass (adversarial security review + the strict nonce-CSP deferred from I6).

**No new capabilities are invented.** No real ad-serving, no real charging, no real email sending, no new AI. Every heavy or external thing is a **dormant, swappable seam** (Mock in demo → Live behind a key), and everything is auto + manually overridable and configurable from admin.

## Ground truth (delta-inspected 2026-08-19 — most of I8 is a UI + structure over dormant slots)

**Already exists (reuse, do NOT rebuild):**
- **RBAC (I6 Slice 3):** `roles` with `rank` (visitor 0 < registered 10 < writer 20 < moderator 30 < admin 40 < owner 50) + `isStaff`; per-section rank gating in `admin/guard.ts` + `rbac.ts` (`sectionOf` decode-canonicalize, `requiredRankFor`, `SECTION_RANK_DEFAULTS`, `app_settings.rbac` overrides). The staff-session path AND the `x-admin-token` service credential both authorize the backend admin API.
- **Audit log (I1/I6):** `audit_logs` + `writeAudit` (who/what/when/old→new), written by every admin mutation.
- **Admin API (I1→I7):** generic CRUD for every model (`/admin/api/:resource`) + bespoke engine routes (bias, ratings, clustering/relations, catalog/unmatched, reputation, awards). Per-resource redaction + `minRank`.
- **Admin frontend (I1-era):** standalone pages under `/admin/*` (generic CRUD, + bias/ratings/clustering/relations/unmatched managers) and `admin/page.tsx` (a plain CRUD index that literally says "the polished Control Panel is I8"). **No shell, no nav, no dashboard, no login.**
- **Background jobs:** BullMQ + worker + heartbeat; `/health/ready` reports job/pipeline state (catalog, articles, ratings, reputation).
- **Subscribe (I7):** `newsletter_subscriptions` + explicit-opt-in subscribe/unsubscribe + `user_consents` kind='marketing' + coarsened IP; `email_outbox` dev mailbox (I6) with a swappable email seam.
- **Ad slot (placeholder):** `AdSlot` renders a static "AD" box everywhere. `articles.isSponsored` flag exists; awards carry `sponsorSlotLabel`/`sponsorSold`. `app_settings` is the generic key→JSON config store used across engines.
- **Public analytics inputs:** public queries already compute top topics/games, source stats, disconnect, etc.

**NOT present (this phase builds it):**
- A unified **Control Panel shell** (nav + chrome + dashboard) and **staff-session auth on the frontend admin**.
- A **dashboard analytics** endpoint (traffic, top topics, community activity, source performance, job health) — aggregate/anonymous only.
- Any **ad/promotion data model**: slots as configurable records, placements/orders, sold/free/scheduled state, impression/click counters, the "Promote a game" flow, the **dormant payment (Stripe) seam**, pricing in `app_settings`.
- **Newsletter campaigns**: compose/schedule/segment, AI-digest assembly from existing summaries, opens/clicks/growth analytics, subscriber management, the **swappable send seam** (Mock → outbox).
- **List/ranking + slot configuration** UI (weights/windows/manual pin; pin paid games).
- **Account-panel polish** (cosmetic).
- **Strict nonce-based CSP** (deferred from I6; public UI has now shipped).

**⚠️ Biggest delta + the security fix this phase makes (flag for owner):** the frontend admin BFF `admin/api/[...path]/route.ts` **injects `x-admin-token` server-side for every request** — so the browser admin console today has **blanket owner-level access with no login and no RBAC**. That was the acknowledged I1 stopgap ("full permissioned Control Panel + login arrive in I8"). Slice 1 closes it: the Control Panel authenticates the **human as staff via their session cookie** and the backend applies **per-section RBAC** (a moderator sees fewer sections than an admin than an owner); the service token is retained for **automation/verify only**, not for browser blanket access.

Migrations continue from `0011_i7_newsletter_subscriptions` → `0012_i8_ads`, `0013_i8_newsletter_campaigns`, … per slice.

## Locked decisions (from the owner's I8 decision record)

1. **Control Panel = UI over existing RBAC**, not a new permission system. It gives humans buttons over the API surface that already exists; visibility is driven by the logged-in staff's rank (mod 30 / admin 40 / owner 50).
2. **No on-site payment at all** (owner decision 2026-08-19, superseding the earlier dormant-Stripe-seam plan). Billing is **OFF-SITE**: a placement is arranged by email, the advertiser pays externally (invoice/transfer), and an **admin manually activates** it — sets `status → active`, which lights the labeled Promoted flag — once payment lands. Build the **placement/inventory structure** with an **admin-set status** (draft/scheduled/active/ended); **no payment gateway, no dormant Stripe adapter, no paid-status automation, no card data anywhere**. **All pricing in `app_settings`** (configurable; rises with demand). *Rationale: at our volume manual activation is faster than automated billing and avoids the whole payment/tax/advertiser-ToS surface.* **Self-serve Stripe over this same placement model is PARKED** for later (OWNER-TODO) if volume ever demands it.
3. **Every paid placement carries a visible Promoted/Sponsored label, as prominent as the bias flags** — the transparency rule is NOT relaxed for our own revenue. **Placement content is UGC** → escaped + validated (a new injection surface; treat like comments).
4. **No new AI.** AI stays exactly as-is (topic summary + factual bias signals). The newsletter **AI-digest reuses the existing summary output** — it generates nothing new.
5. **Newsletter send is a swappable seam** (Mock → `email_outbox` in demo, zero network; Live dormant). **Single opt-in for now** (double-opt-in tracked — see I7 OWNER-TODO).
6. **Everything auto + manual override; everything admin-configurable** — no hardcoded slots, lists, thresholds, or prices.
7. **Analytics are aggregate/anonymous only, GDPR-safe** — no per-user tracking, geo aggregate-only (consistent with I6/I7).

### Slice-1 login decision (CONFIRMED 2026-08-19)
Moving the Control Panel behind session RBAC means a human must **log in as staff**. Owner-confirmed: **seed demo staff logins** — `demo-moderator` / `demo-admin` / `demo-owner` with **documented demo passwords** (clearly demo-only, `[[OWNER-TODO]]` to remove before prod) — so the demo boots zero-secrets AND an operator can experience RBAC (each role sees a different Control Panel). The blanket browser token-proxy is **removed**; the `x-admin-token` service credential remains for `verify:*`/automation only. Admin **mutations now require the CSRF double-submit** (the session path, unlike the retired token path).

## Slice plan (build in order; commit + push each; gates marked)

### Slice 1 — Control Panel shell + Dashboard  ·  **[gate: screenshot review]**
Unified admin UI: a persistent nav (sections filtered by the logged-in staff's rank) + chrome wrapping the existing CRUD/manager pages, behind **staff-session auth** (redirect non-staff to login; the frontend admin BFF forwards the **session cookie**, not the blanket token). **Dashboard**: overview + analytics — traffic, top topics, community activity, source performance, background-job health — **aggregate/anonymous only** (new backend `dashboard` analytics endpoint; no per-user tracking, geo aggregate-only). Demo staff logins seeded (per the open decision). Everything read-only-safe; every existing tool reachable from one nav.

### Slice 2 — Ad / promotion management  ·  **[gate: screenshot review + new injection surface — security posture noted]**
The revenue dashboard over a real slot model — **no payment gateway** (decision 2). **`ad_slots`** (configurable records: key, page/context, format, default unsold-fallback = hide|organic, active) — every `AdSlot` on the site references a slot key. **`ad_placements`** (slot, advertiser label + contact, **UGC creative: headline/body/link — escaped + validated**, schedule from/to, price from `app_settings`, `status` draft/scheduled/active/ended **set MANUALLY by an admin after off-site payment** — no gateway, no paid automation). **Inventory view** (every slot incl. each game page, sold/free/scheduled), **free-inventory view**, **per-slot analytics** (impressions + clicks, aggregate; occupancy — mock in demo, no per-render write; production wires a batched counter). **"Promote a game" flow**: public "Promote your game" form → **email to us** (mailto, like Contact) → admin creates + **manually activates** a placement → a **labeled Promoted flag** on the game (payment is the filter, we don't verify the submitter). **Every active placement renders a Promoted/Sponsored label as prominent as a bias flag.**

### Slice 3 — Newsletter  ·  **[gate: screenshot review + GDPR check on segmentation/consent]**
**`newsletter_campaigns`** (subject, body, segment, schedule, status, analytics). **Compose/schedule/segment**; **AI-digest** assembled from the **existing topic-summary output** (no new AI). **Swappable send seam** (Mock → `email_outbox`, zero network; Live dormant). **Analytics** (opens/clicks structural until real sends; **growth = subscriber count over time from real `newsletter_subscriptions` data**). **Subscriber management** (list/search/unsubscribe/export over the I7 table). **Segmentation is GDPR-gated**: only **consented marketing** subscribers are targetable; no PII beyond the address; unsubscribe honored.

### Slice 4 — List / slot configuration
Admin arranges **lists/rankings** (Top-N, Trending, Most-Discussed — weights/windows/manual pin, all in `app_settings`) and **slot placement**; **pins paid/featured games** (auto default + manual override). Nothing hardcoded.

### Slice 5 — Account-panel polish (cosmetic, end of phase)
Simplify/clean the public `/account` panel. No new behavior; visual gate only.

### Slice 6 — Phase close  ·  **[gate: security review report to owner before closing]**
**Adversarial security review** over the whole I8 diff (ad-management + placement rendering, newsletter, Control Panel auth/RBAC) — independent code-read + live exploits, report-then-triage (the I6/I7 discipline). **Strict nonce-based CSP** (the version deferred from I6, now that public UI has shipped — drop `'unsafe-inline'` where the nonce covers it). Final **`verify:i8`**, the from-empty ladder, the visual gate, PROGRESS.

## Out of scope (deferred — recorded so they aren't lost)
- **Real charging** (Stripe Live), **real email sends**, **double-opt-in** (I7 OWNER-TODO), **real ad-serving**.
- **New AI generation** of any kind (digest reuses existing summaries only).
- **CMS** (§3.14 #7 — writing our own articles/reviews): not in this phase's plan → deferred.
- **Real-time notification delivery** (in-app/push): the newsletter is the delivery channel here; live notifications defer.
- **OAuth, wishlist/backlog** (I6 deferrals) stay deferred.

## Verification (every slice)
- **Prove-the-attack-fails `verify:i8`** (grows slice by slice): RBAC on the Control Panel (a moderator can't reach admin/owner sections; a non-staff/anon can't reach the panel at all); **placement creative is stored raw + rendered escaped** (UGC injection); **active placements always carry the Promoted label** (transparency can't be toggled off); **no payment code/gateway exists and status is admin-set only** (activation is a manual staff action, audited); newsletter **segmentation excludes non-consented** addresses and **Mock send writes only to the outbox** (zero network); dashboard/analytics expose **no per-user data**; audit rows for every staff action.
- **From-empty ladder** green (`down -v` → `up --build`): health + `verify:i1…b2` + `verify:i6` + `verify:i7` + `verify:i8`; each migration applies from empty.
- **Static gate**: tsc 0, ESLint + Prettier clean, backend + frontend unit tests.
- **Visual gate** on every UI slice: headless screenshots **desktop + mobile** (content checks read HTML, not rendering — watch the CSS-collapse trap). STOP for owner review at the gated slices.

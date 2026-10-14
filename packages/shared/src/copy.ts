/**
 * The COPY REGISTRY (Phase P S3b): every public text we publish ourselves that the
 * owner chose to control from the admin (Control Panel → Copy), with today's text
 * as the default. Stored overrides live in app_settings `copy`; anything not
 * overridden reads its default, so an empty store renders the site unchanged.
 *
 * - IDENTITY (brand name, tagline, display domain, contact emails) is owner-only.
 *   Every default below reads the brand through a `{brand}` placeholder, so a
 *   rename (GamesKeep → GamesKodex) is one settings change, not a code change.
 * - LOCKED texts are legally required (consent wording, the paid label, the
 *   Privacy / Terms pages): shown read-only in the admin, never stored; their
 *   brand / email placeholders still fill in automatically.
 * - The domain is DISPLAY text (legal text, emails, page copy). Canonical /
 *   sitemap URLs keep following the deployment config (owner decision).
 *
 * Pure (no IO) — the backend stores, fills and parses; the frontend only renders
 * the already-parsed result.
 */

export type CopyKind = 'text' | 'longtext' | 'rich' | 'doc' | 'email' | 'domain' | 'brand';

export const COPY_GROUPS = [
  'identity',
  'pages',
  'sections',
  'labels',
  'empty',
  'notes',
  'docs',
  'locked',
] as const;
export type CopyGroup = (typeof COPY_GROUPS)[number];

export const COPY_GROUP_LABELS: Record<CopyGroup, string> = {
  identity: 'Brand & contact (owner only)',
  pages: 'Page intros & meta descriptions',
  sections: 'Section eyebrows & subtitles',
  labels: 'Card & badge labels',
  empty: 'Empty states',
  notes: 'Notes',
  docs: 'Documents (About · Methodology · Promote · Contact)',
  locked: 'Locked — legally required',
};

export interface CopyDef {
  key: string;
  group: CopyGroup;
  /** What the editor sees next to the field. */
  label: string;
  kind: CopyKind;
  default: string;
  max: number;
  /** Legally required: read-only in the admin, never stored. */
  locked?: true;
  /** Brand identity: only the owner may change it. */
  ownerOnly?: true;
  /** Must be non-empty (an empty value would break the surface). */
  required?: true;
}

const T = (
  key: string,
  group: CopyGroup,
  label: string,
  def: string,
  kind: CopyKind = 'text',
  max = 300,
): CopyDef => ({ key, group, label, kind, default: def, max });

// ── documents (markdown-lite; see parseDoc) ──────────────────────────────────
const ABOUT_BODY = `## The problem

Players increasingly distrust rating sites and games media — and often for good reason. Scores arrive with no visible reasoning. Outlets that share an owner run suspiciously similar takes. A game the critics adore lands at a fraction of the community score, and nobody explains the gap. The information is out there, scattered across a dozen sites, but the **context** — who is telling you this, what shapes their coverage, and where the consensus quietly breaks down — is missing.

The usual answer is another loud verdict: one more number, one more site telling you what is good. That is not an answer. It is more of the same problem.

## What {brand} does

We aggregate games news from across the industry and lay a **bias lens** over it — the signals we find on the coverage (sponsorship, affiliate links, publisher review copies, embargoes, press trips), each shown with its evidence — so you can see the shape of the reporting, not just the headline. Alongside the news sits a **rating system** that keeps three perspectives **separate on purpose**: professional critics, our own editorial take, and the player community. When they disagree, we show the disagreement instead of blending it into a single misleading average.

Everything you read is pre-computed and cached, drawn from real engines — clustering, scoring, bias signals — running in the background. The demo runs on realistic mock data with those engines fully live; only the data source is stand-in.

## The principle

Our whole reason to exist is the answer to that distrust — so we hold ourselves to the same standard we apply to everyone else. Promoted or sponsored content is always labelled. Our methodology is public in plain language. Automated systems can always be corrected by a human, and every such correction is logged. We would rather show you a messy, honest picture than a clean, confident lie.

If we ever become “another site telling you what to think,” we have failed. The goal is the opposite: give you the lens, show our work, and trust you to draw the line.

## Read the details

Want to know exactly how we compute bias, scores and the critic–community disconnect? Our [Methodology](/methodology) explains the approach in full — transparently, without the exact formulas that would let coverage be gamed. Want to reach us or write for us? The [Contact](/contact) page is the door.`;

const METHODOLOGY_BODY = `Every number on {brand} is produced by real engines running in the background and stored for you to read instantly. This page explains what those engines are measuring and why. What it deliberately does **not** give you is the exact set of weights, thresholds and formulas behind each figure — for the same reason we hide the precise formula behind account levels. Publish the recipe and you invite people to cook to it: outlets tuning coverage to dodge a signal, campaigns engineered to move a score. The approach is public. The dials are not.

## Reading the news: what the coverage carries

We never reduce a piece of coverage to a single “bias score.” We look for concrete, checkable **signals** and show the ones we find — on reviews and on coverage carrying a sponsored signal, where they matter most.

::: card Influence signals
### What we look for
Self-disclosed **sponsored** content, **affiliate** links, publisher-provided **review copies**, and an outlet’s own **opinion** framing. On reviews we also look for an **embargo** and a **sponsored event or press trip**. Each is a fact about how the piece was produced — a label, not a verdict on its quality.
:::

::: card Evidence
### Shown with its source
A review-integrity signal appears only with its evidence: a short quote from the source article (linked) or an editor’s note, with a date. Editors confirm what the automation finds before it is shown, and can add what it missed.
:::

Where we find none of these signals we say exactly that: **“{noSignals}.”** We can show what we found; we cannot prove what isn’t there — so we never label coverage as clean.

::: when quality
### Quality, separately

A read of the craft of the reporting placed on a **scale** — depth, sourcing, transparency, care — separate from whether we agree with its conclusions. It is kept apart from the influence signals on purpose: “is this well made?” and “what is shaping it?” are different questions.
:::

## Rating games: three layers, never merged

A game is not one audience. Critics, our own editors, and the playing community routinely reach different conclusions — and each of those conclusions is legitimate on its own terms. So we keep **three separate rating layers** and present them as three, always. We never blend them into one headline average, because that average would hide the single most interesting thing on the page: where they disagree.

::: card Layer one
### Critics
Aggregated professional reviews from the outlets we track — the established critical read, with the outlet count shown so you know how much it rests on.
:::

::: card Layer two
### {brand}
Our own editorial verdict, published only where we have actually reviewed a game — one voice, clearly ours, never dressed up as consensus.
:::

::: card Layer three
### Community
The players’ score — credibility-weighted and manipulation-aware (below), so it reflects the community rather than whoever showed up to brigade.
:::

## The disconnect — shown, with context

When the critic and community layers pull apart, that gap is a story in itself, and we treat it as one. Rather than burying it, we surface the disconnect and give it **context**: how large the gap is, how much weight sits on each side, and — where our editors can add it — why the split may be happening. A beloved-by-critics, divisive-with-players game and a quietly-adored-by-players, coldly-reviewed one are different situations, and the page should let you feel that difference instead of flattening it into a number.

We are describing the gap, not adjudicating it. The context is there to help you interpret the disagreement, never to tell you which side is “right.”

## Keeping the community score honest

A raw average of user ratings is trivial to manipulate — review bombs, boosting campaigns, throwaway accounts. So the community layer is **credibility-weighted**: not every rating counts the same, and how much a rating counts depends on signals of good-faith, established participation rather than on agreeing with anyone. On top of that sits **manipulation-aware** handling designed to blunt coordinated, inorganic activity so it cannot swamp the genuine signal.

We keep the specific signals, weights and detection thresholds private — for the obvious reason that publishing them is publishing the instructions to evade them. What we will commit to in the open is the principle: the community score is built to represent the community, and to resist being captured by whoever is loudest or most organised on a given day.

::: warn Why we hold the numbers back
Transparency about the **approach** earns trust. Transparency about the exact **weights and thresholds** would hand a playbook to anyone wanting to game coverage or scores — the opposite of what this platform is for. Where we draw that line is itself part of the method: we frame how we measure, we do not publish the ruler’s markings.
:::

## Automated, always correctable

Clustering, bias signals and scores run automatically, without waiting on a human. But every automated result can be reviewed and overridden by our editors, and every override is logged — who changed what, when, and from what to what. Automation gives us speed and consistency; human correction keeps it honest; the audit trail keeps *us* honest.

Questions about any of this, or think we got a specific call wrong? Tell us on the [Contact](/contact) page — being challenged on our own methodology is exactly the accountability we are asking everyone else to accept.`;

const PROMOTE_BODY = `## How it works

Tell us what you’d like to promote and we’ll arrange a placement — a slot on the site, or a **Promoted** flag on your game’s page. Payment is handled off-site (invoice or transfer); once it’s settled, we activate the placement. There’s no self-serve checkout — at our size a quick email is faster for everyone.

## Always labeled — no exceptions

Whoever pays gets the promotion, but the reader always knows it’s paid: every placement carries a **“Promoted” / “Sponsored”** label as prominent as our bias flags. We flag other people’s undisclosed influence; we’re not going to hide our own. That’s non-negotiable — it’s what makes the rest of the site trustworthy.

## Get in touch

Send us the details and we’ll take it from there.

{{promote-form}}

::: note
Prefer to just email? Reach us at [Contact](/contact). A self-serve booking flow may come later; for now it’s personal and by arrangement.
:::`;

const CONTACT_BODY = `## Reach us

The fastest way to reach the {brand} team is email. Whether you have spotted an error in our coverage, want to challenge a bias signal or a score, have a partnership in mind, or just want to talk — write to us and a human will read it.

-> [Email {email.contact}]({mailto.contact})

::: note
Found a factual error, or think an automated call is wrong? Please say so — being correctable in the open is the whole point. Include a link to the story or game and what you think we got wrong, and we will take a look.
:::

## Write for {brand}

We are always interested in **critics and writers** who care about the same thing we do: treating readers as people who can judge for themselves. If you want to review games, dig into media influence, or report with a transparency-first mindset, we would love to hear from you.

Tell us:

- **Who you are** — and where you have written before, if anywhere (links help).
- **What you would want to cover** — the beat, angle or games that pull you.
- **Why transparency** — a line on why our “tool, not authority” stance resonates with you.

-> [Pitch to write]({mailto.pitch})

::: note
**No sign-up form yet — on purpose.** A proper contributor application and submission system, with editorial review and moderation, comes in a later phase. Until then we keep it simple and personal: email us directly and we will reply.
:::`;

const docGroup = (
  page: string,
  name: string,
  d: {
    eyebrow: string;
    title: string;
    lede: string;
    metaDescription: string;
    shareTitle: string;
    shareDescription: string;
    body: string;
  },
): CopyDef[] => [
  T(`${page}.eyebrow`, 'docs', `${name} · eyebrow`, d.eyebrow, 'text', 80),
  T(`${page}.title`, 'docs', `${name} · title`, d.title, 'text', 120),
  T(`${page}.lede`, 'docs', `${name} · intro`, d.lede, 'longtext', 600),
  T(
    `${page}.metaDescription`,
    'docs',
    `${name} · meta description`,
    d.metaDescription,
    'longtext',
    320,
  ),
  T(`${page}.shareTitle`, 'docs', `${name} · share title`, d.shareTitle, 'text', 140),
  T(
    `${page}.shareDescription`,
    'docs',
    `${name} · share description`,
    d.shareDescription,
    'longtext',
    320,
  ),
  T(`${page}.body`, 'docs', `${name} · document`, d.body, 'doc', 20000),
];

export const COPY_DEFS: readonly CopyDef[] = [
  // ── identity (owner only) ───────────────────────────────────────────────────
  {
    key: 'brand.name',
    group: 'identity',
    label: 'Brand name',
    kind: 'brand',
    default: 'GamesKeep',
    max: 40,
    ownerOnly: true,
    required: true,
  },
  {
    key: 'brand.tagline',
    group: 'identity',
    label: 'Tagline (home title)',
    kind: 'text',
    default: 'Gaming News with a Bias Lens & Honest Game Ratings',
    max: 120,
    ownerOnly: true,
    required: true,
  },
  // [[OWNER-TODO: set the public display domain in Control Panel → Copy (brand.domain)]]
  {
    key: 'brand.domain',
    group: 'identity',
    label: 'Display domain (text only — URLs follow the deployment)',
    kind: 'domain',
    default: 'gameskeep.com',
    max: 100,
    ownerOnly: true,
    required: true,
  },
  // [[OWNER-TODO: confirm the public contact / privacy / promote addresses in Control Panel → Copy]]
  {
    key: 'email.contact',
    group: 'identity',
    label: 'Contact email',
    kind: 'email',
    default: 'wrathsystems@gmail.com',
    max: 160,
    ownerOnly: true,
    required: true,
  },
  {
    key: 'email.privacy',
    group: 'identity',
    label: 'Privacy / data-rights email',
    kind: 'email',
    default: 'wrathsystems@gmail.com',
    max: 160,
    ownerOnly: true,
    required: true,
  },
  {
    key: 'email.promote',
    group: 'identity',
    label: 'Promotions email',
    kind: 'email',
    default: 'wrathsystems@gmail.com',
    max: 160,
    ownerOnly: true,
    required: true,
  },

  // ── page intros & meta descriptions ─────────────────────────────────────────
  T(
    'site.description',
    'pages',
    'Site · default meta description',
    '{brand} — premium gaming platform: news + bias analysis and ratings/rankings for video games.',
    'longtext',
    320,
  ),
  T(
    'site.shareDescription',
    'pages',
    'Site · default share description',
    'Premium gaming platform: news + bias analysis and ratings/rankings.',
    'longtext',
    320,
  ),
  T(
    'home.metaDescription',
    'pages',
    'Home · meta description',
    '{brand} clusters gaming news from many outlets into stories, shows the signals we found in the coverage (sponsorship, affiliate links, review copies), and pairs every game with separated critic and community ratings.',
    'longtext',
    320,
  ),
  T(
    'home.shareDescription',
    'pages',
    'Home · share description',
    'See the same gaming event across every outlet at once, with the coverage signals we found, alongside separated critic/community scores.',
    'longtext',
    320,
  ),
  T(
    'home.siteSummary',
    'pages',
    'Home · structured-data summary',
    'Gaming news with a bias lens and honest, separated game ratings (critic vs community).',
    'longtext',
    320,
  ),
  T(
    'games.metaDescription',
    'pages',
    'Games · meta description',
    'Discover games on {brand} — top rated, most discussed across outlets, by genre, and coming soon. Separated critic, our and community scores; the full catalog one click away.',
    'longtext',
    320,
  ),
  T(
    'games.shareDescription',
    'pages',
    'Games · share description',
    'Top rated, most discussed, by genre, and coming soon — with separated critic/community scores and the disconnect surfaced where it matters.',
    'longtext',
    320,
  ),
  T(
    'games.intro',
    'pages',
    'Games · intro',
    'Start with what’s rising, argued about, or around the corner — separated critic, our and community scores, never blended into one number.',
    'longtext',
    400,
  ),
  T(
    'browse.metaDescription',
    'pages',
    'Browse · meta description',
    'Browse every game on {brand} — separated critic, our and community ratings, the critic↔community disconnect with context, and factual content flags.',
    'longtext',
    320,
  ),
  T(
    'browse.intro',
    'pages',
    'Browse · intro',
    'Separated critic, our and community scores — never blended into one number — with the gap surfaced where it’s real.',
    'longtext',
    400,
  ),
  T(
    'sources.metaDescription',
    'pages',
    'Sources · meta description',
    'Every outlet {brand} aggregates — who owns them, where ownership is shared, and the signals we found in their coverage. Transparency on who is telling the story.',
    'longtext',
    320,
  ),
  T(
    'sources.shareDescription',
    'pages',
    'Sources · share description',
    'Ownership, shared-ownership conflicts and coverage signals for every outlet we aggregate.',
    'longtext',
    320,
  ),
  T(
    'sources.intro',
    'pages',
    'Sources · intro',
    'Who tells the story matters as much as the story. Every outlet we aggregate — its ownership, where that ownership is shared, and the signals we found in its coverage.',
    'longtext',
    400,
  ),
  T(
    'upcoming.metaDescription',
    'pages',
    'Upcoming · meta description',
    'The upcoming games slate on {brand} — release dates, live countdowns and status, plus upcoming DLC & expansions and just-released titles. Suggest a missing game.',
    'longtext',
    320,
  ),
  T(
    'upcoming.shareDescription',
    'pages',
    'Upcoming · share description',
    'Release dates, countdowns and status for games on the horizon — plus upcoming DLC & expansions and just-released titles.',
    'longtext',
    320,
  ),
  T(
    'upcoming.intro',
    'pages',
    'Upcoming · intro',
    'The slate on the horizon — release dates, live countdowns and status. Plus upcoming DLC & expansions and what just landed. Hype voting arrives with accounts.',
    'longtext',
    400,
  ),
  T(
    'awards.metaDescription',
    'pages',
    'Awards · meta description',
    'The {brand} Awards — an annual program where every nominee shows our deeper analytics (three separated scores + the critic–community disconnect) so voters can actually decide. Critics’ Choice and Community Choice, side by side.',
    'longtext',
    320,
  ),
  T(
    'awards.intro',
    'pages',
    'Awards · intro',
    'An annual program where every nominee carries **our deeper analytics** — three separated scores and the critic–community disconnect — so you can actually decide. **Critics’ Choice** and **Community Choice**, side by side, never merged.',
    'rich',
    600,
  ),
  T(
    'feed.metaDescription',
    'pages',
    'Your Feed · meta description',
    'Your personal {brand} feed — the latest from the games and topics you follow.',
    'longtext',
    320,
  ),
  T('header.sub', 'pages', 'Header · line under the brand', 'News · Bias · Ratings', 'text', 60),
  T(
    'footer.blurb',
    'pages',
    'Footer · blurb',
    'A tool to judge games coverage for yourself — news with a bias lens, ratings with honest context. Transparency, not authority.',
    'longtext',
    300,
  ),
  T(
    'footer.legal',
    'pages',
    'Footer · legal line',
    '© {year} {brand}. Demo build — mock data, real engines.',
    'text',
    200,
  ),
  T(
    'footer.attribution',
    'pages',
    'Footer · attribution line',
    'Excerpts & summaries link to each source. Full text stays with the publisher.',
    'text',
    200,
  ),

  // ── section eyebrows & subtitles ────────────────────────────────────────────
  T(
    'home.briefing.eyebrow',
    'sections',
    'Home · briefing eyebrow',
    'The story, and how it’s being told',
    'text',
    80,
  ),
  T('home.latest.eyebrow', 'sections', 'Home · latest eyebrow', 'Across the industry', 'text', 80),
  T(
    'home.focus.eyebrow',
    'sections',
    'Home · games in focus eyebrow',
    'The disconnect',
    'text',
    80,
  ),
  T(
    'home.focus.sub',
    'sections',
    'Home · games in focus subtitle',
    'Where critics and players don’t agree — the gap, with context.',
    'longtext',
    300,
  ),
  T(
    'home.topRated.eyebrow',
    'sections',
    'Home · top rated eyebrow',
    'Ratings, not just news',
    'text',
    80,
  ),
  T(
    'genres.eyebrow',
    'sections',
    'Browse by genre eyebrow (home + games)',
    'Find your lane',
    'text',
    80,
  ),
  T('home.community.eyebrow', 'sections', 'Home · community eyebrow', 'Community', 'text', 80),
  T(
    'home.community.sub',
    'sections',
    'Home · community subtitle',
    'Rate games, vote in the Awards and follow the stories you care about. Every vote is weighted for credibility, so real players are heard over bots and bombs.',
    'longtext',
    400,
  ),
  T(
    'home.community.perk1.title',
    'sections',
    'Home · community perk 1 title',
    'Rate every game',
    'text',
    80,
  ),
  T(
    'home.community.perk1.body',
    'sections',
    'Home · community perk 1 text',
    'Add your score to the community line — weighted, not gamed.',
    'text',
    200,
  ),
  T(
    'home.community.perk2.title',
    'sections',
    'Home · community perk 2 title',
    'Vote in the Awards',
    'text',
    80,
  ),
  T(
    'home.community.perk2.body',
    'sections',
    'Home · community perk 2 text',
    'Have a say in Community Choice across every category.',
    'text',
    200,
  ),
  T(
    'home.community.perk3.title',
    'sections',
    'Home · community perk 3 title',
    'Build your profile',
    'text',
    80,
  ),
  T(
    'home.community.perk3.body',
    'sections',
    'Home · community perk 3 text',
    'Earn a level and badges as your takes prove out over time.',
    'text',
    200,
  ),
  T('home.newsletter.eyebrow', 'sections', 'Home · newsletter eyebrow', 'Newsletter', 'text', 80),
  T(
    'home.newsletter.sub',
    'sections',
    'Home · newsletter subtitle',
    'A short briefing in your inbox: the biggest stories, our AI summaries, and the coverage signals we found. No hype, no spam.',
    'longtext',
    400,
  ),
  T('games.eyebrow', 'sections', 'Games + browse · eyebrow', 'Ratings & rankings', 'text', 80),
  T('games.topRated.eyebrow', 'sections', 'Games · top rated eyebrow', 'The strongest', 'text', 80),
  T(
    'games.mostDiscussed.eyebrow',
    'sections',
    'Games · most discussed eyebrow',
    'In the conversation',
    'text',
    80,
  ),
  T(
    'games.mostDiscussed.sub',
    'sections',
    'Games · most discussed subtitle',
    'The games drawing the most coverage across outlets right now.',
    'longtext',
    300,
  ),
  T(
    'games.comingSoon.eyebrow',
    'sections',
    'Games · coming soon eyebrow',
    'Around the corner',
    'text',
    80,
  ),
  T('sources.eyebrow', 'sections', 'Sources · eyebrow', 'Who’s covering games', 'text', 80),
  T(
    'sources.owners.sub',
    'sections',
    'Sources · ownership subtitle',
    'Several outlets we index share a parent company — worth knowing when their coverage lines up.',
    'longtext',
    300,
  ),
  T('upcoming.eyebrow', 'sections', 'Upcoming · eyebrow', 'What’s next', 'text', 80),
  T(
    'upcoming.dlc.sub',
    'sections',
    'Upcoming · DLC subtitle',
    'Add-ons and expansions coming to games already in the catalog.',
    'longtext',
    300,
  ),
  T(
    'upcoming.promote.sub',
    'sections',
    'Upcoming · “Making a game?” text',
    'We run clearly-labeled **Promoted** placements — the same transparency we hold everyone to. Arrange one by email; nothing is self-serve.',
    'rich',
    400,
  ),
  T('awards.eyebrow', 'sections', 'Awards · eyebrow', '{brand} Awards', 'text', 80),

  // ── card & badge labels ─────────────────────────────────────────────────────
  T('label.ourPick', 'labels', 'Our pick badge', 'Our pick', 'text', 40),
  T('label.story', 'labels', 'Story card kicker (top rated)', 'Story', 'text', 40),
  T(
    'label.criticsCommunity',
    'labels',
    'Top rated card score line',
    'Critics + community',
    'text',
    60,
  ),
  T('label.noSignals', 'labels', 'No-signals label', 'No signals found', 'text', 60),
  T(
    'label.noSignalsExplainer',
    'labels',
    'No-signals explainer',
    'We can show what we found; we cannot prove what isn’t there.',
    'text',
    200,
  ),
  T('label.flag.sponsored', 'labels', 'Signal · sponsored', 'Sponsored', 'text', 40),
  T('label.flag.affiliate', 'labels', 'Signal · affiliate', 'Affiliate', 'text', 40),
  T('label.flag.reviewCopy', 'labels', 'Signal · review copy', 'Review copy', 'text', 40),
  T('label.flag.opinion', 'labels', 'Signal · opinion', 'Opinion', 'text', 40),
  T('label.integrity.embargo', 'labels', 'Review signal · embargo', 'Embargo', 'text', 40),
  T('label.integrity.pressTrip', 'labels', 'Review signal · press trip', 'Press trip', 'text', 40),
  T('label.topic.developing', 'labels', 'Story status · developing', 'Developing', 'text', 40),
  T('label.topic.ongoing', 'labels', 'Story status · ongoing', 'Ongoing', 'text', 40),
  T('label.game.announced', 'labels', 'Game status · announced', 'Announced', 'text', 40),
  T(
    'label.game.inDevelopment',
    'labels',
    'Game status · in development',
    'In development',
    'text',
    40,
  ),
  T('label.game.earlyAccess', 'labels', 'Game status · early access', 'Early access', 'text', 40),
  T('label.game.released', 'labels', 'Game status · released', 'Released', 'text', 40),
  T('label.game.delisted', 'labels', 'Game status · delisted', 'Delisted', 'text', 40),
  T(
    'label.band.agree',
    'labels',
    'Disconnect · agree (games in focus)',
    'In agreement',
    'text',
    40,
  ),
  T('label.band.agreeShort', 'labels', 'Disconnect · agree (game tiles)', 'Aligned', 'text', 40),
  T('label.band.mild', 'labels', 'Disconnect · mild', 'Mild gap', 'text', 40),
  T('label.band.notable', 'labels', 'Disconnect · notable', 'Notable gap', 'text', 40),
  T('label.band.large', 'labels', 'Disconnect · large', 'Large gap', 'text', 40),
  T('label.indie', 'labels', 'Indie chip', 'Indie', 'text', 40),
  T('label.dateTba', 'labels', 'Release date unknown', 'Date TBA', 'text', 40),
  T('label.delta.new', 'labels', 'Δ chip · new', 'New', 'text', 20),

  // ── empty states ────────────────────────────────────────────────────────────
  T(
    'empty.home',
    'empty',
    'Home · no sections yet',
    'The homepage is being prepared — check back in a moment.',
  ),
  T(
    'empty.hero',
    'empty',
    'Home · no trending stories',
    'Stories are being clustered from the feed — check back in a moment.',
  ),
  T(
    'empty.mainFeed',
    'empty',
    'Home · latest stories empty',
    'Stories are being clustered — check back shortly.',
  ),
  T('empty.latest', 'empty', 'Home · latest news rail empty', 'No articles yet.'),
  T(
    'empty.topRated',
    'empty',
    'Games · top rated empty',
    'Ratings are computing — check back in a moment.',
  ),
  T(
    'empty.mostDiscussed',
    'empty',
    'Games · most discussed empty',
    'Coverage is still clustering — check back in a moment.',
  ),
  T(
    'empty.upcoming',
    'empty',
    'Upcoming · nothing lined up',
    'No upcoming titles are lined up right now — check back as new games are announced.',
  ),
  T(
    'empty.upcomingFiltered',
    'empty',
    'Upcoming · no filter matches',
    'No upcoming titles match these filters.',
  ),
  T(
    'empty.sources',
    'empty',
    'Sources · none configured',
    'No sources are configured yet — outlets appear here as the feed is set up.',
  ),
  T(
    'empty.feed',
    'empty',
    'Your Feed · nothing new',
    'Nothing new from your follows yet — check back after the next pull.',
  ),
  T(
    'empty.awards',
    'empty',
    'Awards · no categories',
    'Categories are being finalised — check back shortly.',
  ),
  T(
    'empty.gameScores',
    'empty',
    'Game page · no scores',
    'No scores yet — critic, our and community ratings appear here as they land.',
  ),
  T('empty.comments', 'empty', 'Comments · none yet', 'No comments yet — be the first.'),

  // ── notes ───────────────────────────────────────────────────────────────────
  T(
    'note.steamHome',
    'notes',
    'Steam-only note (home · by players)',
    'Average concurrent players on Steam over the last window, vs the window before. Steam only — consoles publish no live counts.',
    'longtext',
    400,
  ),
  T(
    'note.steamGame',
    'notes',
    'Steam-only note (game page)',
    'Steam concurrent players only (consoles don’t publish live counts) — this is the history we’ve recorded; Steam has no past-players API, we accumulate our own.',
    'longtext',
    400,
  ),

  // ── documents ───────────────────────────────────────────────────────────────
  ...docGroup('about', 'About', {
    eyebrow: 'Why we exist',
    title: 'Transparency, not authority',
    lede: '{brand} is a tool to judge games coverage for yourself — not a judge. We surface bias, ownership and the gap between critics and players, then hand you the context and get out of the way.',
    metaDescription:
      '{brand} exists to make games coverage legible — surfacing bias, media influence and the gap between critics and players, so you can judge for yourself. Transparency, not authority.',
    shareTitle: 'About {brand} — transparency, not authority',
    shareDescription:
      'Why {brand} exists: a tool to read games coverage with a bias lens and honest, separated ratings — not another site telling you what is good.',
    body: ABOUT_BODY,
  }),
  ...docGroup('methodology', 'Methodology', {
    eyebrow: 'How it works',
    title: 'Our methodology',
    lede: 'Trust is earned by showing your work. Here is exactly how we think about bias, ratings and the gap between critics and players — enough to judge whether we are being fair, without the precise recipe that would let the system be gamed.',
    metaDescription:
      'How {brand} computes bias, ratings and the critic–community disconnect — the approach explained transparently, without the exact formulas that would let the system be gamed.',
    shareTitle: 'Methodology — how {brand} measures bias and ratings',
    shareDescription:
      'Influence signals shown with their evidence, three separate rating layers kept apart on purpose, the disconnect shown with context, and manipulation-aware community weighting — the approach, in plain language.',
    body: METHODOLOGY_BODY,
  }),
  ...docGroup('promote', 'Promote', {
    eyebrow: 'Advertise with {brand}',
    title: 'Promote your game',
    lede: 'Reach players who come here to judge games for themselves. Every paid placement is clearly labeled — the same transparency we hold everyone else to.',
    metaDescription:
      'Promote your game on {brand}. Placements are always clearly labeled “Promoted” — transparency is the brand. Get in touch to arrange one.',
    shareTitle: 'Promote your game on {brand}',
    shareDescription: 'Paid placements, always clearly labeled. Arrange one by email.',
    body: PROMOTE_BODY,
  }),
  ...docGroup('contact', 'Contact', {
    eyebrow: 'Get in touch',
    title: 'Contact & join',
    lede: 'Questions, corrections, partnership ideas — or you want to write for us? There is one door, and it is open.',
    metaDescription:
      'Reach the {brand} team, or pitch to write for us. We are looking for critics and writers who care about transparency in games coverage.',
    shareTitle: 'Contact & Join {brand}',
    shareDescription:
      'Get in touch, or pitch to write for a platform built on transparency, not authority.',
    body: CONTACT_BODY,
  }),
  T(
    'contact.pitchSubject',
    'docs',
    'Contact · “Pitch to write” email subject',
    'Writing for {brand}',
    'text',
    160,
  ),
  T(
    'contact.pitchBody',
    'docs',
    'Contact · “Pitch to write” email body',
    'Hi {brand} team,\n\nI would like to write / contribute. A little about me:\n\n- Who I am:\n- Where I have written before (links):\n- What I would want to cover:\n\nThanks,',
    'longtext',
    1500,
  ),

  // ── locked (legally required; read-only, never stored) ───────────────────────
  {
    key: 'paid.label',
    group: 'locked',
    label: 'Paid-item label (render-forced on every paid item)',
    kind: 'text',
    default: 'Promoted',
    max: 40,
    locked: true,
  },
  {
    key: 'consent.newsletter',
    group: 'locked',
    label: 'Newsletter consent wording',
    kind: 'rich',
    default:
      'Email me the {brand} briefing. This is marketing consent, separate from any account — I can unsubscribe anytime (see our [Privacy notice](/privacy)).',
    max: 600,
    locked: true,
  },
  {
    key: 'consent.awards',
    group: 'locked',
    label: 'Awards sign-up consent wording',
    kind: 'rich',
    default:
      'Email me when {brand} Awards voting opens. This is marketing consent, separate from your account — I can unsubscribe anytime (see our [Privacy notice](/privacy)).',
    max: 600,
    locked: true,
  },
];

/** The Privacy / Terms pages: locked in code (legal review), brand + email filled in. */
export const LOCKED_PAGES: readonly { label: string; path: string; note: string }[] = [
  {
    label: 'Privacy & GDPR',
    path: '/privacy',
    note: 'Uses the brand name, display domain and privacy email.',
  },
  {
    label: 'Terms of Service',
    path: '/terms',
    note: 'Uses the brand name, display domain and contact email.',
  },
];

const DEF_BY_KEY = new Map(COPY_DEFS.map((d) => [d.key, d]));
export function copyDef(key: string): CopyDef | undefined {
  return DEF_BY_KEY.get(key);
}
export const COPY_DEFAULTS: Readonly<Record<string, string>> = Object.fromEntries(
  COPY_DEFS.map((d) => [d.key, d.default]),
);

// ── placeholders ─────────────────────────────────────────────────────────────
/** Placeholders every copy value may use (filled at read time). */
export const COPY_TOKENS = [
  'brand',
  'tagline',
  'domain',
  'year',
  'email.contact',
  'email.privacy',
  'email.promote',
  'mailto.contact',
  'mailto.pitch',
  'noSignals',
] as const;
const TOKEN_SET = new Set<string>(COPY_TOKENS);
// `{name}` — but never the `{{slot}}` syntax of documents.
const TOKEN_RE = /(?<!\{)\{([a-zA-Z][a-zA-Z.]*)\}(?!\})/g;

/** Replace known `{token}`s; unknown ones are left as typed (and rejected on save). */
export function fillTokens(text: string, vars: Readonly<Record<string, string>>): string {
  return text.replace(TOKEN_RE, (m, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? (vars[name] ?? m) : m,
  );
}

export function unknownTokens(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(TOKEN_RE)) if (!TOKEN_SET.has(m[1] ?? '')) out.add(`{${m[1]}}`);
  return [...out];
}

/** A `mailto:` href with a properly encoded subject / body (parentheses included). */
export function mailtoHref(email: string, subject?: string, body?: string): string {
  const enc = (s: string): string =>
    encodeURIComponent(s).replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  const q = [subject ? `subject=${enc(subject)}` : null, body ? `body=${enc(body)}` : null].filter(
    Boolean,
  );
  return `mailto:${email}${q.length ? `?${q.join('&')}` : ''}`;
}

// ── markdown-lite (safe: an AST, never HTML) ─────────────────────────────────
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] };

export type Block =
  | { t: 'h2' | 'h3' | 'p'; c: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'cta'; href: string; c: Inline[] }
  | { t: 'slot'; name: string }
  | { t: 'note'; tone: 'info' | 'warn'; label: string | null; blocks: Block[] }
  | { t: 'cards'; cards: { kicker: string | null; blocks: Block[] }[] }
  | { t: 'when'; cond: string; blocks: Block[] };

/** Conditions a `::: when` block may test (the page decides; unknown → hidden). */
export const DOC_CONDITIONS = ['quality'] as const;
/** Named slots a page fills with a live component (e.g. the Promote form). */
export const DOC_SLOTS = ['promote-form'] as const;

/** Allowed link targets: site paths, in-page anchors, http(s), mailto. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  // A backslash never belongs in a link: browsers read "/\evil.com" as
  // "//evil.com" (another site), and control characters are never valid.
  if (h.includes('\\') || hasControlChars(h)) return null;
  if (/^\/(?![/\\])[^\s]*$/.test(h)) return h;
  if (/^#[\w-]*$/.test(h)) return h;
  if (/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(h)) return h;
  if (/^mailto:[^\s@/]+@[^\s@/]+\.[^\s@/?]+(\?[^\s]*)?$/i.test(h)) return h;
  return null;
}

/** Inline parse: `**strong**`, `*em*`, `[text](href)`, `\` escapes the next character. */
export function parseInline(src: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = (): void => {
    if (buf) out.push({ t: 'text', v: buf });
    buf = '';
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;
    if (ch === '\\' && i + 1 < src.length) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (depth < 4 && src.startsWith('**', i)) {
      const end = findClose(src, '**', i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: 'strong', c: parseInline(src.slice(i + 2, end), depth + 1) });
        i = end + 2;
        continue;
      }
    }
    if (depth < 4 && ch === '*' && src[i + 1] !== '*' && src[i + 1] !== ' ') {
      const end = findClose(src, '*', i + 1);
      if (end > i + 1 && src[end - 1] !== ' ') {
        flush();
        out.push({ t: 'em', c: parseInline(src.slice(i + 1, end), depth + 1) });
        i = end + 1;
        continue;
      }
    }
    if (depth < 4 && ch === '[') {
      const close = findClose(src, ']', i + 1);
      if (close > i + 1 && src[close + 1] === '(') {
        const paren = findClose(src, ')', close + 2);
        if (paren > close + 2) {
          flush();
          out.push({
            t: 'link',
            href: unescapeMd(src.slice(close + 2, paren)),
            c: parseInline(src.slice(i + 1, close), depth + 1),
          });
          i = paren + 1;
          continue;
        }
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

function findClose(src: string, marker: string, from: number): number {
  for (let j = from; j < src.length; j += 1) {
    if (src[j] === '\\') {
      j += 1;
      continue;
    }
    if (marker === '*' && src.startsWith('**', j)) {
      j += 1;
      continue;
    }
    if (src.startsWith(marker, j)) return j;
  }
  return -1;
}

const unescapeMd = (s: string): string => s.replace(/\\(.)/g, '$1');

const CONTAINER_OPEN = /^:::\s*(note|warn|card|when)\b\s*(.*)$/;
const CONTAINER_CLOSE = /^:::\s*$/;

/**
 * Block parse. `## ` / `### ` headings, blank-line paragraphs, `- ` lists,
 * `-> [label](href)` call-to-action buttons, `{{slot}}` live components, and
 * `::: note` / `::: warn Label` / `::: card Kicker` / `::: when condition`
 * containers closed by `:::`. Consecutive cards form one card grid.
 */
export function parseDoc(src: string, depth = 0): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: Inline[][] | null = null;
  const endPara = (): void => {
    if (para.length) blocks.push({ t: 'p', c: parseInline(para.join(' ').trim()) });
    para = [];
  };
  const endList = (): void => {
    if (list?.length) blocks.push({ t: 'ul', items: list });
    list = null;
  };
  const end = (): void => {
    endPara();
    endList();
  };
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] as string;
    const line = raw.trim();
    const open = depth < 3 ? CONTAINER_OPEN.exec(line) : null;
    if (open) {
      end();
      const inner: string[] = [];
      let nest = 0;
      let j = i + 1;
      for (; j < lines.length; j += 1) {
        const l = (lines[j] as string).trim();
        if (CONTAINER_OPEN.test(l)) nest += 1;
        else if (CONTAINER_CLOSE.test(l)) {
          if (nest === 0) break;
          nest -= 1;
        }
        inner.push(lines[j] as string);
      }
      i = j; // skip past the closing fence (or to EOF when unclosed)
      const kind = open[1] as 'note' | 'warn' | 'card' | 'when';
      const arg = (open[2] ?? '').trim();
      const children = parseDoc(inner.join('\n'), depth + 1);
      if (kind === 'card') {
        const card = { kicker: arg || null, blocks: children };
        const prev = blocks[blocks.length - 1];
        if (prev && prev.t === 'cards') prev.cards.push(card);
        else blocks.push({ t: 'cards', cards: [card] });
      } else if (kind === 'when') {
        blocks.push({ t: 'when', cond: arg, blocks: children });
      } else {
        blocks.push({
          t: 'note',
          tone: kind === 'warn' ? 'warn' : 'info',
          label: arg || null,
          blocks: children,
        });
      }
      continue;
    }
    if (!line) {
      end();
      continue;
    }
    // A blank line between two cards keeps them in one grid; anything else breaks it.
    const h = /^(#{2,3})\s+(.+)$/.exec(line);
    if (h) {
      end();
      blocks.push({ t: h[1] === '##' ? 'h2' : 'h3', c: parseInline(h[2] as string) });
      continue;
    }
    const slot = /^\{\{([a-z][a-z-]*)\}\}$/.exec(line);
    if (slot) {
      end();
      blocks.push({ t: 'slot', name: slot[1] as string });
      continue;
    }
    const cta = /^->\s*\[(.+)\]\((.+)\)$/.exec(line);
    if (cta) {
      end();
      blocks.push({
        t: 'cta',
        href: unescapeMd(cta[2] as string),
        c: parseInline(cta[1] as string),
      });
      continue;
    }
    const li = /^-\s+(.+)$/.exec(line);
    if (li) {
      endPara();
      (list ??= []).push(parseInline(li[1] as string));
      continue;
    }
    endList();
    para.push(line);
  }
  end();
  return blocks;
}

// ── fill + check (after parse, so a placeholder value can never inject syntax) ─
export function fillInline(
  nodes: Inline[],
  vars: Readonly<Record<string, string>>,
  bad: string[] = [],
): Inline[] {
  return nodes.flatMap((n): Inline[] => {
    if (n.t === 'text') return [{ t: 'text', v: fillTokens(n.v, vars) }];
    if (n.t === 'link') {
      const href = safeHref(fillTokens(n.href, vars));
      if (!href) {
        // An unsafe target never renders as a link — the words stay, as text.
        bad.push(n.href);
        return fillInline(n.c, vars, bad);
      }
      return [{ t: 'link', href, c: fillInline(n.c, vars, bad) }];
    }
    return [{ ...n, c: fillInline(n.c, vars, bad) }];
  });
}

/** Fill placeholders into a parsed doc; links that are unsafe after filling degrade to text. */
export function fillDoc(
  blocks: Block[],
  vars: Readonly<Record<string, string>>,
  bad: string[] = [],
): Block[] {
  return blocks.map((b): Block => {
    switch (b.t) {
      case 'h2':
      case 'h3':
      case 'p':
        return { t: b.t, c: fillInline(b.c, vars, bad) };
      case 'ul':
        return { t: 'ul', items: b.items.map((it) => fillInline(it, vars, bad)) };
      case 'cta': {
        const href = safeHref(fillTokens(b.href, vars));
        if (!href) {
          bad.push(b.href);
          return { t: 'p', c: fillInline(b.c, vars, []) };
        }
        return { t: 'cta', href, c: fillInline(b.c, vars, bad) };
      }
      case 'slot':
        return b;
      case 'note':
        return {
          ...b,
          label: b.label ? fillTokens(b.label, vars) : null,
          blocks: fillDoc(b.blocks, vars, bad),
        };
      case 'cards':
        return {
          t: 'cards',
          cards: b.cards.map((c) => ({
            kicker: c.kicker ? fillTokens(c.kicker, vars) : null,
            blocks: fillDoc(c.blocks, vars, bad),
          })),
        };
      case 'when':
        return { ...b, blocks: fillDoc(b.blocks, vars, bad) };
    }
  });
}

function docIssues(blocks: Block[], out: string[]): void {
  for (const b of blocks) {
    if (b.t === 'slot' && !(DOC_SLOTS as readonly string[]).includes(b.name)) {
      out.push(`unknown slot {{${b.name}}} (allowed: ${DOC_SLOTS.join(', ')})`);
    }
    if (b.t === 'when') {
      if (!(DOC_CONDITIONS as readonly string[]).includes(b.cond)) {
        out.push(`unknown condition "${b.cond}" (allowed: ${DOC_CONDITIONS.join(', ')})`);
      }
      docIssues(b.blocks, out);
    }
    if (b.t === 'note') docIssues(b.blocks, out);
    if (b.t === 'cards') for (const c of b.cards) docIssues(c.blocks, out);
  }
}

/** Control characters other than tab / newline / carriage return (never valid copy). */
function hasControlChars(v: string): boolean {
  for (let i = 0; i < v.length; i += 1) {
    const c = v.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) return true;
  }
  return false;
}

/**
 * Validate one copy value for its definition. Returns human-readable problems
 * (empty = OK). `vars` are the placeholder values the save would render with,
 * so a link that only becomes unsafe after filling is caught too.
 */
export function copyValueProblems(
  def: CopyDef,
  value: string,
  vars: Readonly<Record<string, string>>,
): string[] {
  const p: string[] = [];
  if (value.length > def.max) p.push(`at most ${def.max} characters`);
  if (hasControlChars(value)) p.push('contains control characters');
  if (def.required && !value.trim()) p.push('cannot be empty');
  const multi = def.kind === 'longtext' || def.kind === 'doc';
  if (!multi && /[\r\n]/.test(value)) p.push('must be a single line');
  if (def.kind === 'brand' && !/^[\p{L}\p{N}][\p{L}\p{N} .&'’-]{0,39}$/u.test(value)) {
    p.push("letters, numbers, spaces and . & ' - only");
  }
  if (
    def.kind === 'email' &&
    !/^[^\s@<>()[\]{}"',;]+@[^\s@<>()[\]{}"',;]+\.[a-z]{2,}$/i.test(value)
  ) {
    p.push('must be an email address');
  }
  if (
    def.kind === 'domain' &&
    !/^(?=.{3,100}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(value)
  ) {
    p.push('must be a domain like example.com');
  }
  if (def.kind === 'brand' || def.kind === 'email' || def.kind === 'domain') {
    if (/[{}]/.test(value)) p.push('cannot contain placeholders');
  } else {
    const unknown = unknownTokens(value);
    if (unknown.length)
      p.push(
        `unknown placeholder ${unknown.join(', ')} (allowed: ${COPY_TOKENS.map((t) => `{${t}}`).join(' ')})`,
      );
  }
  if (def.kind === 'rich') {
    const bad: string[] = [];
    fillInline(parseInline(value), vars, bad);
    if (bad.length)
      p.push(`unsafe link ${bad.map((b) => `"${b}"`).join(', ')} (use /path, https://, mailto:)`);
  }
  if (def.kind === 'doc') {
    const blocks = parseDoc(value);
    const bad: string[] = [];
    fillDoc(blocks, vars, bad);
    if (bad.length)
      p.push(`unsafe link ${bad.map((b) => `"${b}"`).join(', ')} (use /path, https://, mailto:)`);
    docIssues(blocks, p);
  }
  return p;
}

/** Flatten parsed inline content to plain text (meta tags, previews). */
export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === 'text' ? n.v : inlineText(n.c))).join('');
}

// ── the assembled public copy (backend payload + frontend fallback) ──────────
/** Placeholder values for a set of raw copy values. */
export function copyVars(
  values: Readonly<Record<string, string>>,
  now = new Date(),
): Record<string, string> {
  const base: Record<string, string> = {
    brand: values['brand.name'] ?? '',
    tagline: values['brand.tagline'] ?? '',
    domain: values['brand.domain'] ?? '',
    year: String(now.getUTCFullYear()),
    'email.contact': values['email.contact'] ?? '',
    'email.privacy': values['email.privacy'] ?? '',
    'email.promote': values['email.promote'] ?? '',
    noSignals: values['label.noSignals'] ?? '',
  };
  return {
    ...base,
    'mailto.contact': mailtoHref(base['email.contact'] ?? ''),
    'mailto.pitch': mailtoHref(
      base['email.contact'] ?? '',
      fillTokens(values['contact.pitchSubject'] ?? '', base),
      fillTokens(values['contact.pitchBody'] ?? '', base),
    ),
  };
}

export interface SiteCopy {
  brand: string;
  tagline: string;
  domain: string;
  emails: { contact: string; privacy: string; promote: string };
  mailto: { contact: string; pitch: string; promote: string };
  /** Plain texts, placeholders filled. */
  text: Record<string, string>;
  /** Inline-formatted texts (bold / links), parsed + filled. */
  rich: Record<string, Inline[]>;
  /** Documents, parsed + filled. */
  docs: Record<string, Block[]>;
}

/** Every copy key, resolved: locked keys always read their default. */
export function buildSiteCopy(
  values: Readonly<Record<string, string>>,
  now = new Date(),
): SiteCopy {
  const vars = copyVars(values, now);
  const text: Record<string, string> = {};
  const rich: Record<string, Inline[]> = {};
  const docs: Record<string, Block[]> = {};
  for (const def of COPY_DEFS) {
    const raw = def.locked ? def.default : (values[def.key] ?? def.default);
    if (def.kind === 'doc') docs[def.key] = fillDoc(parseDoc(raw), vars);
    else if (def.kind === 'rich') rich[def.key] = fillInline(parseInline(raw), vars);
    else text[def.key] = fillTokens(raw, vars);
  }
  return {
    brand: vars.brand ?? '',
    tagline: vars.tagline ?? '',
    domain: vars.domain ?? '',
    emails: {
      contact: vars['email.contact'] ?? '',
      privacy: vars['email.privacy'] ?? '',
      promote: vars['email.promote'] ?? '',
    },
    mailto: {
      contact: vars['mailto.contact'] ?? '',
      pitch: vars['mailto.pitch'] ?? '',
      promote: mailtoHref(vars['email.promote'] ?? ''),
    },
    text,
    rich,
    docs,
  };
}

import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { db } from './client';
import {
  articles,
  articleSubjects,
  articleTopics,
  awardCategories,
  awardEditionCategories,
  awardEditions,
  awardNominations,
  badges,
  gameContentFlags,
  gameCriticReviews,
  gameDlc,
  gameExternalRatings,
  gamePlayerCounts,
  gamePrices,
  gameRatingSummaries,
  gameReviews,
  games,
  gameSystemRequirements,
  gameUserRatings,
  gameVideos,
  roles,
  sources,
  sourceTypes,
  subjects,
  topics,
  topicSubjects,
  topicTypes,
  users,
  userLevels,
} from './schema';

/**
 * Minimal idempotent demo seed (SPEC I1 §5). Runs on every demo boot; every
 * insert ignores conflicts so re-running is safe. Keep it TINY — the real game
 * seed (IGDB/RAWG) is I2 and the article mock feed is I3. This just proves the
 * models, relations and admin CRUD work end-to-end. NO external calls.
 */

type Row = Record<string, unknown>;

/** Insert if absent (ignore conflicts), then return the row matched by `where`. */
async function ensure(table: PgTable, values: Row, where: SQL): Promise<Row> {
  await db
    .insert(table)
    .values(values as never)
    .onConflictDoNothing();
  const [row] = await db.select().from(table).where(where).limit(1);
  if (!row) throw new Error('seed: row missing after insert');
  return row as Row;
}

export async function seedDemo(): Promise<void> {
  // ── extensible lists (starter values; admins extend these later) ──────────
  const roleDefs = [
    { key: 'visitor', label: 'Visitor', rank: 0, isStaff: false },
    { key: 'registered', label: 'Registered', rank: 10, isStaff: false },
    { key: 'writer', label: 'Writer / Author', rank: 20, isStaff: true },
    { key: 'moderator', label: 'Moderator', rank: 30, isStaff: true },
    { key: 'admin', label: 'Admin', rank: 40, isStaff: true },
    { key: 'owner', label: 'Super-admin / Owner', rank: 50, isStaff: true },
  ];
  for (const r of roleDefs) await ensure(roles, r, eq(roles.key, r.key));

  const levelDefs = [
    { key: 'newcomer', label: 'Newcomer', rank: 0 },
    { key: 'contributor', label: 'Contributor', rank: 10 },
    { key: 'trusted', label: 'Trusted', rank: 20 },
    { key: 'veteran', label: 'Veteran', rank: 30 },
    { key: 'legend', label: 'Legend', rank: 40 },
  ];
  for (const l of levelDefs) await ensure(userLevels, l, eq(userLevels.key, l.key));

  const topicTypeDefs: [string, string][] = [
    ['hot-topic', 'Hot Topic'],
    ['trending', 'Trending'],
    ['legal-issues', 'Legal Issues'],
    ['controversy', 'Controversy'],
    ['release-launch', 'Release / Launch'],
    ['update-patch', 'Update / Patch'],
    ['leak-rumor', 'Leak / Rumor'],
    ['business', 'Business'],
    ['review-roundup', 'Review Roundup'],
  ];
  for (const [key, label] of topicTypeDefs)
    await ensure(topicTypes, { key, label }, eq(topicTypes.key, key));

  const sourceTypeDefs: [string, string][] = [
    ['mainstream', 'Mainstream'],
    ['independent', 'Independent'],
    ['industry', 'Industry'],
    ['blog', 'Blog'],
  ];
  for (const [key, label] of sourceTypeDefs)
    await ensure(sourceTypes, { key, label }, eq(sourceTypes.key, key));

  const badgeDefs: [string, string][] = [
    ['verified', 'Verified'],
    ['top-reviewer', 'Top Reviewer'],
    ['early-voter', 'Early Voter'],
    ['trendsetter', 'Trendsetter'],
    ['bias-hunter', 'Bias Hunter'],
    ['day-one', 'Day One'],
  ];
  for (const [key, label] of badgeDefs) await ensure(badges, { key, label }, eq(badges.key, key));

  const categoryDefs: [string, string][] = [
    ['game-of-the-year', 'Game of the Year'],
    ['best-narrative', 'Best Narrative / Story'],
    ['best-score-music', 'Best Score & Music'],
    ['best-art-direction', 'Best Art Direction / Visuals'],
    ['best-independent', 'Best Independent Game'],
    ['best-performance', 'Best Performance'],
    ['best-ongoing', 'Best Ongoing Game'],
    ['most-anticipated', 'Most Anticipated'],
  ];
  for (const [key, label] of categoryDefs)
    await ensure(awardCategories, { key, label }, eq(awardCategories.key, key));

  // ── demo admin user ───────────────────────────────────────────────────────
  const ownerRole = await ensure(roles, roleDefs[5]!, eq(roles.key, 'owner'));
  const legendLevel = await ensure(userLevels, levelDefs[4]!, eq(userLevels.key, 'legend'));
  await ensure(
    users,
    {
      username: 'admin',
      email: 'admin@gameskeep.local',
      displayName: 'GamesKeep Owner',
      roleId: ownerRole.id,
      levelId: legendLevel.id,
      isEmailVerified: true,
      // No password yet — real auth lands in I6.
      // [[OWNER-TODO: set a real owner account + password before launch (demo seeds username "admin")]]
    },
    eq(users.username, 'admin'),
  );

  // ── a couple of games (Subject specialization) ────────────────────────────
  async function ensureGame(opts: {
    slug: string;
    name: string;
    developer: string;
    publisher: string;
    genres: string[];
    platforms: string[];
    steamAppId: number;
    summary: string;
  }): Promise<Row> {
    const subject = await ensure(
      subjects,
      { type: 'game', slug: opts.slug, name: opts.name },
      eq(subjects.slug, opts.slug),
    );
    return ensure(
      games,
      {
        subjectId: subject.id,
        status: 'released',
        developer: opts.developer,
        publisher: opts.publisher,
        genres: opts.genres,
        platforms: opts.platforms,
        steamAppId: opts.steamAppId,
        summary: opts.summary,
      },
      eq(games.subjectId, subject.id as string),
    );
  }

  const cyberpunk = await ensureGame({
    slug: 'cyberpunk-2077',
    name: 'Cyberpunk 2077',
    developer: 'CD Projekt Red',
    publisher: 'CD Projekt',
    genres: ['RPG', 'Action'],
    platforms: ['PC', 'PS5', 'Xbox Series'],
    steamAppId: 1091500,
    summary: 'Open-world action RPG set in the dystopian Night City.',
  });
  const baldursGate3 = await ensureGame({
    slug: 'baldurs-gate-3',
    name: "Baldur's Gate 3",
    developer: 'Larian Studios',
    publisher: 'Larian Studios',
    genres: ['RPG', 'Turn-Based'],
    platforms: ['PC', 'PS5', 'Xbox Series'],
    steamAppId: 1086940,
    summary: 'A party-based RPG set in the world of Dungeons & Dragons.',
  });
  // A deliberate critic↔community DISCONNECT example (critics high, community low).
  const starbound = await ensureGame({
    slug: 'stellar-drifter',
    name: 'Stellar Drifter',
    developer: 'Voidlight Studios',
    publisher: 'Nova Interactive',
    genres: ['RPG', 'Space'],
    platforms: ['PC', 'Xbox Series'],
    steamAppId: 1999990,
    summary: 'An ambitious space RPG that critics loved and many players found shallow.',
  });
  const cyberpunkSubjectId = cyberpunk.subjectId as string;

  // A spread of additional rated games (I5a) so the homepage's Top-rated and
  // Games-in-focus surface DIFFERENT titles (high-agreement vs big-disconnect).
  const eldenRing = await ensureGame({
    slug: 'elden-ring',
    name: 'Elden Ring',
    developer: 'FromSoftware',
    publisher: 'Bandai Namco',
    genres: ['RPG', 'Action'],
    platforms: ['PC', 'PS5', 'Xbox Series'],
    steamAppId: 1245620,
    summary: 'An open-world action RPG set in the Lands Between.',
  });
  const witcher3 = await ensureGame({
    slug: 'the-witcher-3-wild-hunt',
    name: 'The Witcher 3: Wild Hunt',
    developer: 'CD Projekt Red',
    publisher: 'CD Projekt',
    genres: ['RPG', 'Action'],
    platforms: ['PC', 'PS5', 'Xbox Series'],
    steamAppId: 292030,
    summary: 'A story-driven open-world RPG following Geralt of Rivia.',
  });
  const hades2 = await ensureGame({
    slug: 'hades-ii',
    name: 'Hades II',
    developer: 'Supergiant Games',
    publisher: 'Supergiant Games',
    genres: ['Roguelike', 'Action'],
    platforms: ['PC'],
    steamAppId: 1145350,
    summary: 'The roguelike sequel to Hades, starring the Princess of the Underworld.',
  });
  const helldivers2 = await ensureGame({
    slug: 'helldivers-2',
    name: 'Helldivers 2',
    developer: 'Arrowhead Game Studios',
    publisher: 'Sony Interactive Entertainment',
    genres: ['Shooter', 'Co-op'],
    platforms: ['PC', 'PS5'],
    steamAppId: 553850,
    summary: 'A co-op third-person shooter spreading managed democracy across the galaxy.',
  });
  const finalFantasy16 = await ensureGame({
    slug: 'final-fantasy-xvi',
    name: 'Final Fantasy XVI',
    developer: 'Square Enix',
    publisher: 'Square Enix',
    genres: ['RPG', 'Action'],
    platforms: ['PC', 'PS5'],
    steamAppId: 2515020,
    summary: 'An action-driven entry in the Final Fantasy series set in Valisthea.',
  });

  // ── rating data so the I4b engine has differing layers to compute ────────────
  await seedRatings({
    cyberpunkId: cyberpunk.id as string,
    bg3Id: baldursGate3.id as string,
    stellarId: starbound.id as string,
    eldenId: eldenRing.id as string,
    witcher3Id: witcher3.id as string,
    hades2Id: hades2.id as string,
    helldivers2Id: helldivers2.id as string,
    ffxviId: finalFantasy16.id as string,
    registeredRoleId: (await ensure(roles, roleDefs[1]!, eq(roles.key, 'registered'))).id as string,
    trustedLevelId: (await ensure(userLevels, levelDefs[2]!, eq(userLevels.key, 'trusted')))
      .id as string,
  });

  // ── a source or two ───────────────────────────────────────────────────────
  const mainstream = await ensure(
    sourceTypes,
    { key: 'mainstream', label: 'Mainstream' },
    eq(sourceTypes.key, 'mainstream'),
  );
  const independent = await ensure(
    sourceTypes,
    { key: 'independent', label: 'Independent' },
    eq(sourceTypes.key, 'independent'),
  );
  const ign = await ensure(
    sources,
    {
      slug: 'ign',
      name: 'IGN',
      websiteUrl: 'https://www.ign.com',
      rssUrl: 'https://feeds.ign.com/ign/games-all',
      typeId: mainstream.id,
      parentCompany: 'Ziff Davis',
    },
    eq(sources.slug, 'ign'),
  );
  await ensure(
    sources,
    {
      slug: 'eurogamer',
      name: 'Eurogamer',
      websiteUrl: 'https://www.eurogamer.net',
      rssUrl: 'https://www.eurogamer.net/feed',
      typeId: independent.id,
      parentCompany: 'IGN Entertainment',
    },
    eq(sources.slug, 'eurogamer'),
  );

  // ── one topic + two articles, fully linked ────────────────────────────────
  const updatePatch = await ensure(
    topicTypes,
    { key: 'update-patch', label: 'Update / Patch' },
    eq(topicTypes.key, 'update-patch'),
  );
  const topic = await ensure(
    topics,
    {
      slug: 'cyberpunk-2077-2-0-overhaul',
      title: 'Cyberpunk 2077 2.0 Update Overhauls the Game',
      tldr: 'A free 2.0 update rebuilds skills, police and driving — widely seen as the redemption arc.',
      status: 'ongoing',
      typeId: updatePatch.id,
    },
    eq(topics.slug, 'cyberpunk-2077-2-0-overhaul'),
  );
  await ensure(
    topicSubjects,
    { topicId: topic.id, subjectId: cyberpunkSubjectId },
    eq(topicSubjects.topicId, topic.id as string),
  );

  const article1 = await ensure(
    articles,
    {
      slug: 'cyberpunk-2-0-transforms-the-game',
      sourceId: ign.id,
      origin: 'aggregated',
      articleType: 'news',
      title: "Cyberpunk 2077's 2.0 Update Transforms the Game",
      author: 'Staff',
      url: 'https://www.ign.com/articles/cyberpunk-2077-2-0',
      excerpt: 'The overhaul touches nearly every system, from perks to the police.',
      hasAffiliateLinks: true,
      publishDate: new Date('2026-05-01T10:00:00Z'),
    },
    eq(articles.slug, 'cyberpunk-2-0-transforms-the-game'),
  );
  const article2 = await ensure(
    articles,
    {
      slug: 'why-cyberpunks-comeback-matters',
      origin: 'ours',
      articleType: 'opinion',
      title: "Why Cyberpunk's Comeback Matters",
      author: 'GamesKeep Editorial',
      excerpt: 'A rare example of a studio earning back trust through work, not words.',
      body: 'Full opinion text lives here because this is our own article (copyright-safe).',
      publishDate: new Date('2026-05-03T09:00:00Z'),
    },
    eq(articles.slug, 'why-cyberpunks-comeback-matters'),
  );

  // article1 → topic (PRIMARY); article2 → topic (secondary)
  await ensure(
    articleTopics,
    { articleId: article1.id, topicId: topic.id, isPrimary: true },
    eq(articleTopics.articleId, article1.id as string),
  );
  await ensure(
    articleTopics,
    { articleId: article2.id, topicId: topic.id, isPrimary: false },
    eq(articleTopics.articleId, article2.id as string),
  );
  for (const a of [article1, article2]) {
    await ensure(
      articleSubjects,
      { articleId: a.id, subjectId: cyberpunkSubjectId },
      eq(articleSubjects.articleId, a.id as string),
    );
  }

  // ── one award edition + category + nomination ─────────────────────────────
  const edition = await ensure(
    awardEditions,
    {
      year: 2026,
      name: 'GamesKeep Awards 2026',
      phase: 'announce',
      description: 'The inaugural GamesKeep Awards (demo — shown as Coming Soon publicly).',
    },
    eq(awardEditions.year, 2026),
  );
  const goty = await ensure(
    awardCategories,
    { key: 'game-of-the-year', label: 'Game of the Year' },
    eq(awardCategories.key, 'game-of-the-year'),
  );
  const editionCategory = await ensure(
    awardEditionCategories,
    { editionId: edition.id, categoryId: goty.id },
    eq(awardEditionCategories.editionId, edition.id as string),
  );
  await ensure(
    awardNominations,
    { editionCategoryId: editionCategory.id, subjectId: cyberpunkSubjectId },
    eq(awardNominations.editionCategoryId, editionCategory.id as string),
  );
}

/**
 * Seed rating data (I4b) so the rating engine has real, DIFFERING layers to
 * compute at boot: BG3 = critics+community agree (high), Cyberpunk = a mild gap,
 * Stellar Drifter = a LARGE critic↔community disconnect (critics high, community
 * low). Includes a few proven community voters (verified, with reputation) whose
 * votes are spread over the past weeks (so nothing reads as a burst at boot). All
 * idempotent — guarded by existence checks since some tables have no unique key.
 */
async function seedRatings(opts: {
  cyberpunkId: string;
  bg3Id: string;
  stellarId: string;
  eldenId: string;
  witcher3Id: string;
  hades2Id: string;
  helldivers2Id: string;
  ffxviId: string;
  registeredRoleId: string;
  trustedLevelId: string;
}): Promise<void> {
  const now = Date.now();
  const daysAgo = (d: number): Date => new Date(now - d * 86_400_000);

  // ── proven community voters (verified + reputation, joined long ago) ────────
  const voterIds: string[] = [];
  for (let i = 1; i <= 8; i += 1) {
    const username = `gk_voter${i}`;
    const row = await ensure(
      users,
      {
        username,
        email: `${username}@demo.gameskeep.local`,
        displayName: `Community Voter ${i}`,
        roleId: opts.registeredRoleId,
        levelId: opts.trustedLevelId,
        isEmailVerified: true,
        reputation: 80,
        // Backdate so the account-age credibility term is satisfied in demo.
        createdAt: daysAgo(200),
      },
      eq(users.username, username),
    );
    voterIds.push(row.id as string);
  }

  async function hasRows(
    table: typeof gameCriticReviews | typeof gameExternalRatings,
    gameId: string,
  ): Promise<boolean> {
    const [row] = await db
      .select({ id: table.id })
      .from(table)
      .where(eq(table.gameId, gameId))
      .limit(1);
    return Boolean(row);
  }

  async function review(gameId: string, ourScore: number, verdict: string): Promise<void> {
    await db
      .insert(gameReviews)
      .values({ gameId, ourScore, verdict, publishedAt: daysAgo(120) })
      .onConflictDoNothing();
  }

  async function critics(
    gameId: string,
    entries: { outlet: string; score: number; native?: [number, number] }[],
  ): Promise<void> {
    if (await hasRows(gameCriticReviews, gameId)) return;
    for (const e of entries) {
      await db.insert(gameCriticReviews).values({
        gameId,
        outletName: e.outlet,
        score: e.score,
        nativeScore: e.native?.[0] ?? null,
        nativeScaleMax: e.native?.[1] ?? null,
        reviewDate: '2026-01-15',
      });
    }
  }

  async function votes(gameId: string, scores: number[]): Promise<void> {
    for (let i = 0; i < scores.length; i += 1) {
      const userId = voterIds[i];
      if (!userId) continue;
      await db
        .insert(gameUserRatings)
        .values({ gameId, userId, score: scores[i]!, ratedAt: daysAgo(60 - i * 5) })
        .onConflictDoNothing();
    }
  }

  async function external(gameId: string, label: string, score: number): Promise<void> {
    if (await hasRows(gameExternalRatings, gameId)) return;
    await db
      .insert(gameExternalRatings)
      .values({ gameId, kind: 'steam', label, score, isEstimate: true, sampleSize: 50_000 });
  }

  async function flags(
    gameId: string,
    v: {
      aiAssets?: 'unknown' | 'no' | 'partial' | 'yes';
      launchState?: 'unknown' | 'polished' | 'mixed' | 'rough';
      mtx?: boolean;
      predatory?: boolean;
      complexity?: number;
    },
  ): Promise<void> {
    await db
      .insert(gameContentFlags)
      .values({
        gameId,
        aiAssets: v.aiAssets ?? 'unknown',
        launchState: v.launchState ?? 'unknown',
        hasMicrotransactions: v.mtx ?? false,
        predatoryMonetization: v.predatory ?? false,
        complexityRating: v.complexity ?? null,
      })
      .onConflictDoNothing();
  }

  // BG3 — critics + community agree (high). Polished.
  await review(opts.bg3Id, 96, 'A landmark RPG — generous, reactive, unforgettable.');
  await critics(opts.bg3Id, [
    { outlet: 'IGN', score: 96, native: [9.6, 10] },
    { outlet: 'GameSpot', score: 95 },
    { outlet: 'Eurogamer', score: 94 },
    { outlet: 'PC Gamer', score: 93 },
    { outlet: 'Polygon', score: 95 },
  ]);
  await votes(opts.bg3Id, [92, 95, 90, 94, 91, 96, 89, 93]);
  await external(opts.bg3Id, 'Steam — Overwhelmingly Positive', 96);
  await flags(opts.bg3Id, { aiAssets: 'no', launchState: 'polished', complexity: 4 });

  // Cyberpunk — a mild gap (a redemption arc; community a touch cooler).
  await review(opts.cyberpunkId, 78, 'After years of fixes, finally the game it promised to be.');
  await critics(opts.cyberpunkId, [
    { outlet: 'IGN', score: 80, native: [8, 10] },
    { outlet: 'GameSpot', score: 76 },
    { outlet: 'PC Gamer', score: 82 },
    { outlet: 'VG247', score: 75 },
    { outlet: 'GamesRadar+', score: 79 },
  ]);
  await votes(opts.cyberpunkId, [62, 58, 65, 55, 60, 63, 57, 61]);
  await external(opts.cyberpunkId, 'Steam — Very Positive', 80);
  await flags(opts.cyberpunkId, {
    aiAssets: 'no',
    launchState: 'mixed',
    mtx: false,
    complexity: 3,
  });

  // Stellar Drifter — LARGE disconnect: critics loved it, players found it shallow.
  await review(opts.stellarId, 70, 'Gorgeous and ambitious, but thin once the novelty fades.');
  await critics(opts.stellarId, [
    { outlet: 'IGN', score: 90, native: [9, 10] },
    { outlet: 'GameSpot', score: 88 },
    { outlet: 'Eurogamer', score: 86 },
    { outlet: 'Polygon', score: 89 },
    { outlet: 'PC Gamer', score: 85 },
  ]);
  await votes(opts.stellarId, [44, 40, 48, 42, 46, 38, 50, 45]);
  await external(opts.stellarId, 'Steam — Mixed', 52);
  await flags(opts.stellarId, {
    aiAssets: 'partial',
    launchState: 'mixed',
    mtx: true,
    predatory: false,
    complexity: 2,
  });

  // ── high-agreement, high-scoring titles → the Top-rated rail ────────────────
  // Elden Ring — universally acclaimed.
  await review(opts.eldenId, 96, 'A landmark open world that rewards curiosity at every turn.');
  await critics(opts.eldenId, [
    { outlet: 'IGN', score: 96, native: [9.6, 10] },
    { outlet: 'GameSpot', score: 95 },
    { outlet: 'Eurogamer', score: 94 },
    { outlet: 'Polygon', score: 96 },
    { outlet: 'PC Gamer', score: 93 },
  ]);
  await votes(opts.eldenId, [94, 92, 95, 90, 93, 96, 91, 94]);
  await external(opts.eldenId, 'Steam — Overwhelmingly Positive', 95);
  await flags(opts.eldenId, { aiAssets: 'no', launchState: 'mixed', complexity: 5 });

  // The Witcher 3 — a beloved modern classic.
  await review(opts.witcher3Id, 94, 'Still the high-water mark for open-world storytelling.');
  await critics(opts.witcher3Id, [
    { outlet: 'IGN', score: 93, native: [9.3, 10] },
    { outlet: 'GameSpot', score: 94 },
    { outlet: 'Eurogamer', score: 92 },
    { outlet: 'Polygon', score: 95 },
    { outlet: 'PC Gamer', score: 91 },
  ]);
  await votes(opts.witcher3Id, [95, 93, 96, 94, 92, 95, 90, 94]);
  await external(opts.witcher3Id, 'Steam — Overwhelmingly Positive', 96);
  await flags(opts.witcher3Id, { aiAssets: 'no', launchState: 'polished', complexity: 3 });

  // Hades II — a rare sequel that outdoes the original.
  await review(opts.hades2Id, 93, 'Sharper, deeper, and impossibly hard to put down.');
  await critics(opts.hades2Id, [
    { outlet: 'IGN', score: 94, native: [9.4, 10] },
    { outlet: 'GameSpot', score: 95 },
    { outlet: 'Eurogamer', score: 92 },
    { outlet: 'PC Gamer', score: 93 },
    { outlet: 'Polygon', score: 94 },
  ]);
  await votes(opts.hades2Id, [93, 91, 95, 92, 90, 94, 89, 93]);
  await external(opts.hades2Id, 'Steam — Overwhelmingly Positive', 95);
  await flags(opts.hades2Id, { aiAssets: 'no', launchState: 'polished', complexity: 3 });

  // ── more disconnect cases → Games-in-focus (distinct from the Top-rated set) ──
  // Helldivers 2 — critics loved it; community soured on monetization/PSN friction.
  await review(
    opts.helldivers2Id,
    82,
    'Brilliant co-op, undermined by off-the-battlefield decisions.',
  );
  await critics(opts.helldivers2Id, [
    { outlet: 'IGN', score: 82, native: [8.2, 10] },
    { outlet: 'GameSpot', score: 84 },
    { outlet: 'Eurogamer', score: 80 },
    { outlet: 'PC Gamer', score: 83 },
    { outlet: 'GamesRadar+', score: 81 },
  ]);
  await votes(opts.helldivers2Id, [55, 50, 58, 52, 48, 60, 53, 49]);
  await external(opts.helldivers2Id, 'Steam — Mixed', 58);
  await flags(opts.helldivers2Id, {
    aiAssets: 'no',
    launchState: 'mixed',
    mtx: true,
    complexity: 3,
  });

  // Final Fantasy XVI — a milder gap (action pivot divided long-time fans).
  await review(opts.ffxviId, 85, 'A bold, action-forward turn that not every fan asked for.');
  await critics(opts.ffxviId, [
    { outlet: 'IGN', score: 88, native: [8.8, 10] },
    { outlet: 'GameSpot', score: 87 },
    { outlet: 'Eurogamer', score: 89 },
    { outlet: 'Polygon', score: 86 },
    { outlet: 'PC Gamer', score: 88 },
  ]);
  await votes(opts.ffxviId, [76, 74, 78, 72, 75, 77, 73, 76]);
  await external(opts.ffxviId, 'Steam — Very Positive', 80);
  await flags(opts.ffxviId, { aiAssets: 'no', launchState: 'polished', complexity: 3 });

  // ── player-facing data slots (BLUEPRINT 2.3) ────────────────────────────────
  // DEMO-FIRST: realistic MOCK values (no live calls — demo has no network), the
  // structure Steam fills in production. Clearly labeled "sample/estimate" in the
  // UI. Player-facing only (how many play, how long, sys-reqs, price, reviews) —
  // never SteamDB-style dev internals. Idempotent: child rows guarded by hasAny,
  // metadata set once (where still null) so a later editor edit is never clobbered.
  async function hasAny(
    table:
      | typeof gamePrices
      | typeof gameSystemRequirements
      | typeof gamePlayerCounts
      | typeof gameVideos
      | typeof gameDlc,
    gameId: string,
  ): Promise<boolean> {
    const [row] = await db
      .select({ n: sql<number>`1` })
      .from(table)
      .where(eq(table.gameId, gameId))
      .limit(1);
    return Boolean(row);
  }

  /** One-time metadata enrichment (only fills columns left null at creation). */
  async function meta(
    gameId: string,
    v: {
      releaseDate: string;
      engine?: string;
      ageSystem?: string;
      ageValue?: string;
      series?: string;
      mode?: string[];
      tags?: string[];
      hltbMain?: number;
      hltbComplete?: number;
      steamCompletion?: number;
    },
  ): Promise<void> {
    await db
      .update(games)
      .set({
        releaseDate: v.releaseDate,
        engine: v.engine ?? null,
        ageRatingSystem: v.ageSystem ?? null,
        ageRatingValue: v.ageValue ?? null,
        series: v.series ?? null,
        mode: v.mode ?? null,
        tags: v.tags ?? null,
        hltbMainHours: v.hltbMain ?? null,
        hltbCompletionistHours: v.hltbComplete ?? null,
        steamCompletionRate: v.steamCompletion ?? null,
      })
      .where(and(eq(games.id, gameId), isNull(games.releaseDate)));
  }

  /**
   * A2 "Where to buy": outbound store links + price + discount per store. The
   * Steam URL is built from the game's PUBLIC steam_app_id (read off the row —
   * no duplication); Epic/GOG rows are seeded only where the store genuinely
   * carries the title (GOG = DRM-free-friendly), so the demo reads authentically.
   * Outbound links only (attribution + utility) — never embedded store content.
   */
  async function price(
    gameId: string,
    cents: number,
    discPct = 0,
    storeOpts: { epicSlug?: string; gogSlug?: string } = {},
  ): Promise<void> {
    if (await hasAny(gamePrices, gameId)) return;
    const [g] = await db
      .select({ steamAppId: games.steamAppId })
      .from(games)
      .where(eq(games.id, gameId))
      .limit(1);
    const onSale = discPct > 0;
    const paid = onSale ? Math.round(cents * (1 - discPct / 100)) : cents;
    const base = {
      gameId,
      platform: 'PC',
      currency: 'USD',
      priceCents: paid,
      discountPct: discPct,
      isOnSale: onSale,
    };
    const rows = [
      {
        ...base,
        store: 'Steam',
        url: g?.steamAppId ? `https://store.steampowered.com/app/${g.steamAppId}/` : null,
      },
    ];
    if (storeOpts.epicSlug) {
      rows.push({
        ...base,
        store: 'Epic Games',
        url: `https://store.epicgames.com/en-US/p/${storeOpts.epicSlug}`,
      });
    }
    if (storeOpts.gogSlug) {
      rows.push({ ...base, store: 'GOG', url: `https://www.gog.com/en/game/${storeOpts.gogSlug}` });
    }
    await db.insert(gamePrices).values(rows);
  }

  /**
   * A2 videos: mock YouTube entries (title + channel; thumbnail null → the
   * frontend's designed placeholder, so nothing breaks offline). These seeded
   * rows ARE the demo's curated list; production autofill (YouTube Data API)
   * only ever proposes into EMPTY slots, never over curation.
   */
  async function videos(
    gameId: string,
    entries: { id: string; title: string; channel: string; kind: string }[],
  ): Promise<void> {
    if (await hasAny(gameVideos, gameId)) return;
    await db.insert(gameVideos).values(
      entries.map((e, i) => ({
        gameId,
        provider: 'youtube' as const,
        videoUrl: `https://www.youtube.com/watch?v=${e.id}`,
        title: e.title,
        channel: e.channel,
        kind: e.kind,
        sort: i,
      })),
    );
  }

  /** A2 DLC slot: name + price + date (+ outbound Steam DLC page where known). */
  async function dlc(
    gameId: string,
    entries: { name: string; cents: number; date: string; steamAppId?: number }[],
  ): Promise<void> {
    if (await hasAny(gameDlc, gameId)) return;
    await db.insert(gameDlc).values(
      entries.map((e) => ({
        gameId,
        name: e.name,
        priceCents: e.cents,
        currency: 'USD',
        releaseDate: e.date,
        url: e.steamAppId ? `https://store.steampowered.com/app/${e.steamAppId}/` : null,
      })),
    );
  }

  /** A min + recommended PC requirement pair (one of three weight templates). */
  async function sysreq(gameId: string, tier: 'light' | 'mid' | 'heavy'): Promise<void> {
    if (await hasAny(gameSystemRequirements, gameId)) return;
    const specs = {
      light: {
        min: { cpu: 'Intel Core i3-8100', gpu: 'GTX 1050', ramGb: 8, storageGb: 20 },
        rec: { cpu: 'Intel Core i5-9400', gpu: 'GTX 1660', ramGb: 16, storageGb: 20 },
      },
      mid: {
        min: { cpu: 'Intel Core i5-8400', gpu: 'GTX 1060 6GB', ramGb: 12, storageGb: 70 },
        rec: { cpu: 'Intel Core i7-10700', gpu: 'RTX 2070', ramGb: 16, storageGb: 70 },
      },
      heavy: {
        min: { cpu: 'Intel Core i7-8700', gpu: 'RTX 2060', ramGb: 16, storageGb: 100 },
        rec: { cpu: 'Intel Core i7-12700', gpu: 'RTX 3080', ramGb: 32, storageGb: 100 },
      },
    }[tier];
    await db.insert(gameSystemRequirements).values([
      { gameId, platform: 'PC', kind: 'minimum', os: 'Windows 10 64-bit', ...specs.min },
      { gameId, platform: 'PC', kind: 'recommended', os: 'Windows 11 64-bit', ...specs.rec },
    ]);
  }

  /**
   * Steam player-count series (B2) — ~26 WEEKLY points (~6 months) in a
   * realistic launch → decay → content-bump → settle shape, so the dated
   * area chart has a real form to draw in the demo. The latest row carries
   * the recorded `peak`. This seeds the SAME `game_player_counts` store the
   * production sweep appends to — Steam has no past-players API, so history
   * only ever accumulates from recording the current number over time.
   */
  async function players(gameId: string, current: number, peak: number): Promise<void> {
    if (await hasAny(gamePlayerCounts, gameId)) return;
    // 26 weekly multipliers of the settled `current`: launch spike, long decay,
    // a mid-life content-patch bump, then settle around 1.0.
    const shape = [
      5.8, 4.6, 3.6, 2.9, 2.35, 1.95, 1.68, 1.48, 1.34, 1.24, 1.16, 1.1, 1.05, 1.01, 0.98, 0.96,
      1.72, 1.5, 1.28, 1.13, 1.05, 0.99, 0.96, 0.94, 0.97, 1.0,
    ];
    const rows = shape.map((f, i) => ({
      gameId,
      source: 'steam',
      currentPlayers: Math.round(current * f),
      peakPlayers: i === shape.length - 1 ? peak : null,
      capturedAt: new Date(now - (shape.length - 1 - i) * 7 * 86_400_000),
    }));
    await db.insert(gamePlayerCounts).values(rows);
  }

  /** Add a Steam review % (sentiment) + sample size to the existing web rating. */
  async function steamPct(gameId: string, pct: number, sample: number): Promise<void> {
    await db
      .update(gameExternalRatings)
      .set({ sentimentPct: pct, sampleSize: sample })
      .where(and(eq(gameExternalRatings.gameId, gameId), isNull(gameExternalRatings.sentimentPct)));
  }

  // Baldur's Gate 3 — beloved, polished, steady.
  await meta(opts.bg3Id, {
    releaseDate: '2023-08-03',
    engine: 'Divinity 4.0',
    ageSystem: 'ESRB',
    ageValue: 'M',
    series: "Baldur's Gate",
    mode: ['singleplayer', 'co-op'],
    tags: ['crpg', 'turn-based', 'choices-matter'],
    hltbMain: 70,
    hltbComplete: 140,
    steamCompletion: 31,
  });
  await price(opts.bg3Id, 5999, 0, { gogSlug: 'baldurs_gate_iii' });
  await sysreq(opts.bg3Id, 'mid');
  await players(opts.bg3Id, 68_000, 95_000);
  await steamPct(opts.bg3Id, 96, 742_000);
  await videos(opts.bg3Id, [
    {
      id: 'gkbg3trailr',
      title: "Baldur's Gate 3 — Launch Trailer",
      channel: 'Larian Studios',
      kind: 'trailer',
    },
    { id: 'gkbg3review', title: "Baldur's Gate 3 Review", channel: 'GameSpot', kind: 'review' },
    {
      id: 'gkbg3guide1',
      title: "Baldur's Gate 3 — Beginner's Guide to Act One",
      channel: 'Fextralife',
      kind: 'gameplay',
    },
  ]);

  // Cyberpunk 2077 — recovered, frequently discounted.
  await meta(opts.cyberpunkId, {
    releaseDate: '2020-12-10',
    engine: 'REDengine 4',
    ageSystem: 'ESRB',
    ageValue: 'M',
    mode: ['singleplayer'],
    tags: ['open-world', 'cyberpunk', 'story-rich'],
    hltbMain: 25,
    hltbComplete: 62,
    steamCompletion: 42,
  });
  await price(opts.cyberpunkId, 5999, 50, {
    epicSlug: 'cyberpunk-2077',
    gogSlug: 'cyberpunk_2077',
  });
  await sysreq(opts.cyberpunkId, 'heavy');
  await players(opts.cyberpunkId, 31_000, 58_000);
  await steamPct(opts.cyberpunkId, 85, 680_000);
  await videos(opts.cyberpunkId, [
    {
      id: 'gkcp77trail',
      title: 'Cyberpunk 2077 — Official 2.0 Trailer',
      channel: 'CD PROJEKT RED',
      kind: 'trailer',
    },
    {
      id: 'gkcp77revw1',
      title: 'Cyberpunk 2077: Phantom Liberty Review',
      channel: 'IGN',
      kind: 'review',
    },
    {
      id: 'gkcp77play1',
      title: 'Cyberpunk 2077 2.0 — One Hour in Night City',
      channel: 'Night City Central',
      kind: 'gameplay',
    },
  ]);
  await dlc(opts.cyberpunkId, [
    { name: 'Phantom Liberty', cents: 2999, date: '2023-09-26', steamAppId: 2138330 },
  ]);

  // Stellar Drifter — the big-disconnect demo title (monetization friction).
  await meta(opts.stellarId, {
    releaseDate: '2025-11-12',
    engine: 'Unreal Engine 5',
    ageSystem: 'ESRB',
    ageValue: 'T',
    series: 'Stellar',
    mode: ['singleplayer', 'multiplayer'],
    tags: ['space', 'sci-fi', 'exploration'],
    hltbMain: 18,
    hltbComplete: 40,
    steamCompletion: 22,
  });
  await price(opts.stellarId, 4999, 0, { gogSlug: 'stellar_drifter' });
  await sysreq(opts.stellarId, 'heavy');
  await players(opts.stellarId, 4_200, 9_800);
  await steamPct(opts.stellarId, 58, 41_000);
  await videos(opts.stellarId, [
    {
      id: 'gksdrftrail',
      title: 'Stellar Drifter — Launch Trailer',
      channel: 'Voidlight Studios',
      kind: 'trailer',
    },
    {
      id: 'gksdrfrevw1',
      title: 'Stellar Drifter Review — Ambition vs Depth',
      channel: 'Frame & Verdict',
      kind: 'review',
    },
    {
      id: 'gksdrfplay1',
      title: '30 Minutes of Stellar Drifter Deep-Space Exploration',
      channel: 'Orbit Notes',
      kind: 'gameplay',
    },
  ]);

  // Elden Ring — huge, enduring audience.
  await meta(opts.eldenId, {
    releaseDate: '2022-02-25',
    engine: 'In-house',
    ageSystem: 'ESRB',
    ageValue: 'M',
    series: 'Elden Ring',
    mode: ['singleplayer', 'co-op'],
    tags: ['souls-like', 'open-world', 'difficult'],
    hltbMain: 58,
    hltbComplete: 133,
    steamCompletion: 38,
  });
  await price(opts.eldenId, 5999);
  await sysreq(opts.eldenId, 'mid');
  await players(opts.eldenId, 112_000, 184_000);
  await steamPct(opts.eldenId, 92, 690_000);
  await videos(opts.eldenId, [
    {
      id: 'gkeldntrail',
      title: 'Elden Ring: Shadow of the Erdtree — Story Trailer',
      channel: 'BANDAI NAMCO Europe',
      kind: 'trailer',
    },
    { id: 'gkeldnrevw1', title: 'Elden Ring Review', channel: 'IGN', kind: 'review' },
    {
      id: 'gkeldnplay1',
      title: 'Elden Ring — Limgrave Done Right (No Summons)',
      channel: 'Tarnished Academy',
      kind: 'gameplay',
    },
  ]);
  await dlc(opts.eldenId, [
    { name: 'Shadow of the Erdtree', cents: 3999, date: '2024-06-21', steamAppId: 2778580 },
  ]);

  // The Witcher 3 — evergreen, deeply discounted.
  await meta(opts.witcher3Id, {
    releaseDate: '2015-05-19',
    engine: 'REDengine 3',
    ageSystem: 'ESRB',
    ageValue: 'M',
    series: 'The Witcher',
    mode: ['singleplayer'],
    tags: ['open-world', 'story-rich', 'atmospheric'],
    hltbMain: 51,
    hltbComplete: 172,
    steamCompletion: 35,
  });
  await price(opts.witcher3Id, 3999, 80, {
    epicSlug: 'the-witcher-3-wild-hunt',
    gogSlug: 'the_witcher_3_wild_hunt_game',
  });
  await sysreq(opts.witcher3Id, 'light');
  await players(opts.witcher3Id, 28_000, 45_000);
  await steamPct(opts.witcher3Id, 97, 820_000);
  await videos(opts.witcher3Id, [
    {
      id: 'gkw3trailer',
      title: 'The Witcher 3: Wild Hunt — Killing Monsters Trailer',
      channel: 'The Witcher',
      kind: 'trailer',
    },
    {
      id: 'gkw3review1',
      title: 'The Witcher 3: Wild Hunt Review',
      channel: 'GameSpot',
      kind: 'review',
    },
    {
      id: 'gkw3playth1',
      title: 'The Witcher 3 in 2026 — Still the Benchmark?',
      channel: 'Kaer Morhen Files',
      kind: 'gameplay',
    },
  ]);
  await dlc(opts.witcher3Id, [
    { name: 'Hearts of Stone', cents: 999, date: '2015-10-13', steamAppId: 378648 },
    { name: 'Blood and Wine', cents: 1999, date: '2016-05-31', steamAppId: 378649 },
  ]);

  // Hades II — early access darling.
  await meta(opts.hades2Id, {
    releaseDate: '2024-05-06',
    engine: 'In-house',
    ageSystem: 'ESRB',
    ageValue: 'T',
    series: 'Hades',
    mode: ['singleplayer'],
    tags: ['roguelike', 'action', 'early-access'],
    hltbMain: 25,
    hltbComplete: 60,
    steamCompletion: 28,
  });
  await price(opts.hades2Id, 2999, 0, { epicSlug: 'hades-ii' });
  await sysreq(opts.hades2Id, 'light');
  await players(opts.hades2Id, 22_000, 41_000);
  await steamPct(opts.hades2Id, 96, 95_000);
  await videos(opts.hades2Id, [
    {
      id: 'gkhd2trailr',
      title: 'Hades II — The Unseen Update Trailer',
      channel: 'Supergiant Games',
      kind: 'trailer',
    },
    {
      id: 'gkhd2review',
      title: 'Hades II Review — Supergiant Sticks the Landing',
      channel: 'Eurogamer',
      kind: 'review',
    },
    {
      id: 'gkhd2playt1',
      title: 'Hades II — Melinoë Full Run (Fear 16)',
      channel: 'Underworld Lab',
      kind: 'gameplay',
    },
  ]);

  // Helldivers 2 — live co-op, monetization friction (mixed community).
  await meta(opts.helldivers2Id, {
    releaseDate: '2024-02-08',
    engine: 'Autodesk Stingray',
    ageSystem: 'ESRB',
    ageValue: 'M',
    series: 'Helldivers',
    mode: ['co-op', 'multiplayer'],
    tags: ['co-op', 'shooter', 'live-service'],
    hltbMain: 30,
    hltbComplete: 90,
    steamCompletion: 19,
  });
  await price(opts.helldivers2Id, 3999);
  await sysreq(opts.helldivers2Id, 'mid');
  await players(opts.helldivers2Id, 35_000, 78_000);
  await steamPct(opts.helldivers2Id, 60, 510_000);
  await videos(opts.helldivers2Id, [
    {
      id: 'gkhd2trail2',
      title: 'Helldivers 2 — Omens of Tyranny Trailer',
      channel: 'PlayStation',
      kind: 'trailer',
    },
    { id: 'gkhdvreview', title: 'Helldivers 2 Review', channel: 'IGN', kind: 'review' },
    {
      id: 'gkhdvplayt1',
      title: 'Helldivers 2 — Helldive Difficulty, No Deaths',
      channel: 'Managed Democracy',
      kind: 'gameplay',
    },
  ]);

  // Final Fantasy XVI — newer PC port.
  await meta(opts.ffxviId, {
    releaseDate: '2024-09-17',
    engine: 'In-house',
    ageSystem: 'ESRB',
    ageValue: 'M',
    series: 'Final Fantasy',
    mode: ['singleplayer'],
    tags: ['action-rpg', 'story-rich', 'cinematic'],
    hltbMain: 35,
    hltbComplete: 75,
    steamCompletion: 45,
  });
  await price(opts.ffxviId, 4999, 20, { epicSlug: 'final-fantasy-xvi' });
  await sysreq(opts.ffxviId, 'heavy');
  await players(opts.ffxviId, 9_000, 21_000);
  await steamPct(opts.ffxviId, 82, 38_000);
  await videos(opts.ffxviId, [
    {
      id: 'gkff16trail',
      title: 'FINAL FANTASY XVI — PC Launch Trailer',
      channel: 'FINAL FANTASY',
      kind: 'trailer',
    },
    { id: 'gkff16revw1', title: 'Final Fantasy XVI Review', channel: 'GameSpot', kind: 'review' },
    {
      id: 'gkff16play1',
      title: 'FF16 — Eikon Battles Ranked (Spoiler-Light)',
      channel: 'Crystal Codex',
      kind: 'gameplay',
    },
  ]);

  // Seed ONE disconnect context tag (editor-entered) so the "why the gap" feature
  // — a key differentiator — is visible in the demo. Stellar Drifter is the large-
  // gap case. Insert-or-fill (recompute preserves the editor tag; survives a
  // re-tune), and only when not already set so a real editor note is never lost.
  await db
    .insert(gameRatingSummaries)
    .values({
      gameId: opts.stellarId,
      disconnectContextTag:
        'Players cite a thin endgame and monetization added after launch; several critic reviews ran on pre-release builds.',
    })
    .onConflictDoUpdate({
      target: gameRatingSummaries.gameId,
      set: {
        disconnectContextTag:
          'Players cite a thin endgame and monetization added after launch; several critic reviews ran on pre-release builds.',
      },
      setWhere: isNull(gameRatingSummaries.disconnectContextTag),
    });
}

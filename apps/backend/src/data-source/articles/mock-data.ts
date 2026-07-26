import type { ArticleType } from '@gameskeep/shared/constants';
import type { RawFeedItem } from './types';

/**
 * Local MOCK ARTICLE FEED (SPEC I3 §1) — the realistic dataset the
 * MockFeedProvider serves in DEMO mode. NO network is ever touched: this bundled
 * data IS the "external source" in demo. In production the LiveFeedProvider
 * (per-source RSS adapters) replaces it (BLUEPRINT 1.6); the clustering engine
 * does not change.
 *
 * ⚠️  MOCK DATA. Headlines/excerpts are real-world-STYLE (believable gaming news)
 * but invented — not real articles. Excerpts only, never full text (copyright).
 *
 * Why it's shaped as EVENTS: clustering can only be judged if the input has real
 * groupings to find. Most items belong to a multi-source "event" (the same story
 * covered by several outlets → should collapse into ONE topic); the rest are
 * standalone (→ their own topic). Distinct events that share a game's vocabulary
 * (e.g. the three separate GTA 6 stories) are kept genuinely different in wording
 * so a good engine separates them — the owner's "too many / too few topics" fear.
 *
 * Verify-critical structures (scripts/i3-check.mjs relies on the stable guids):
 *   - `gta6-delay-*`         → one multi-source topic (6 outlets, one event)
 *   - `gta6-delay/-trailer/-mapleak` → THREE distinct topics (same game, 3 events)
 *   - `helldivers-window-old` vs `helldivers-window-*` → split by TIME WINDOW
 *   - an article referencing an unknown game → exercises I2 resolveOrQueue
 */

interface EventArticle {
  source: string;
  title: string;
  excerpt: string;
  type?: ArticleType;
  affiliate?: boolean;
  sponsored?: boolean;
  reviewCopy?: boolean;
  paywall?: boolean;
}

interface FeedEvent {
  key: string;
  gameRefs: string[];
  /** Base publish day (YYYY-MM-DD); each article is offset a few hours apart. */
  date: string;
  type?: ArticleType;
  articles: EventArticle[];
}

// "now" in the demo world is mid-2026 (see CLAUDE.md currentDate). Events sit in
// the weeks before it; the window-test "old" item is deliberately ~17 months back.
const EVENTS: FeedEvent[] = [
  // ── GTA 6: ONE game, THREE separate events (the core separation test) ────────
  {
    key: 'gta6-delay',
    gameRefs: ['Grand Theft Auto VI'],
    date: '2026-06-02',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: 'Grand Theft Auto VI Delayed to 2027, Rockstar Confirms',
        excerpt:
          'Rockstar Games has pushed Grand Theft Auto VI from late 2026 into 2027, saying the extra months are needed for polish.',
      },
      {
        source: 'eurogamer',
        title: 'GTA 6 release date slips into 2027 as Rockstar asks for more time',
        excerpt:
          'The Grand Theft Auto VI delay was confirmed in a short statement; the studio apologised to fans waiting on the open-world sequel.',
      },
      {
        source: 'gamespot',
        title: 'Rockstar pushes back Grand Theft Auto VI to 2027',
        excerpt:
          'GTA 6 will now launch in 2027. Rockstar said the delay lets the team finish the game to the standard players expect.',
      },
      {
        source: 'vg247',
        title: 'GTA 6 has been delayed to 2027',
        excerpt:
          'Another year to wait: Grand Theft Auto VI moves to 2027 across all platforms, Rockstar announced today.',
      },
      {
        source: 'gamesradar',
        title: 'Grand Theft Auto 6 delayed again, now coming in 2027',
        excerpt:
          'Rockstar confirmed a new GTA 6 release window of 2027, citing the scale of the project and a desire to avoid crunch.',
      },
      {
        source: 'gamesindustry-biz',
        title: 'Take-Two shares dip as Grand Theft Auto VI slips to 2027',
        excerpt:
          'Take-Two investors reacted to the Grand Theft Auto VI delay; analysts still expect record first-week sales when it arrives in 2027.',
        type: 'news',
        paywall: false,
      },
    ],
  },
  {
    key: 'gta6-trailer',
    gameRefs: ['Grand Theft Auto VI'],
    date: '2026-05-06',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: 'GTA 6 Trailer 2 Breaks YouTube View Record in 24 Hours',
        excerpt:
          'The second Grand Theft Auto VI trailer racked up record-breaking views overnight, returning players to a neon-lit Vice City.',
      },
      {
        source: 'polygon',
        title: 'The new Grand Theft Auto VI trailer sets a viewership record',
        excerpt:
          'Rockstar’s second GTA 6 trailer became the most-watched game trailer ever within a day of release.',
      },
      {
        source: 'gamesradar',
        title: 'GTA 6’s second trailer is the biggest game trailer launch in history',
        excerpt:
          'Grand Theft Auto VI trailer 2 shattered viewership records, showing off Lucia, Jason and a modern Vice City.',
      },
      {
        source: 'vg247',
        title: 'Watch the record-breaking second GTA 6 trailer',
        excerpt:
          'The new Grand Theft Auto VI trailer set a fresh viewership record and gave the best look yet at the map.',
      },
      {
        source: 'kotaku',
        title: 'Everyone is talking about the new GTA 6 trailer',
        excerpt:
          'The second Grand Theft Auto VI trailer dominated social feeds, breaking the record for trailer views in 24 hours.',
      },
    ],
  },
  {
    key: 'gta6-mapleak',
    gameRefs: ['Grand Theft Auto VI'],
    date: '2026-05-21',
    type: 'news',
    articles: [
      {
        source: 'kotaku',
        title: 'Leaked GTA 6 Map Points to a Much Bigger Vice City',
        excerpt:
          'A leaked Grand Theft Auto VI map circulating online suggests an expanded Vice City and surrounding Leonida state.',
        type: 'news',
      },
      {
        source: 'pc-gamer',
        title: 'That GTA 6 map leak, explained',
        excerpt:
          'An alleged Grand Theft Auto VI map leak has fans mapping out neighbourhoods; Rockstar has not commented on its authenticity.',
      },
      {
        source: 'vg247',
        title: 'GTA 6 map appears to leak online',
        excerpt:
          'A supposed Grand Theft Auto VI map leak spread across forums, hinting at the size of the new Vice City.',
      },
      {
        source: 'rock-paper-shotgun',
        title: 'A GTA 6 map has leaked and the internet is busy zooming in',
        excerpt:
          'The latest Grand Theft Auto VI leak is a full map image; treat it as unverified, but it lines up with the trailers.',
      },
    ],
  },

  // ── Cyberpunk: sequel news + a separate patch event (same studio, 2 events) ──
  {
    key: 'cyberpunk-sequel',
    gameRefs: ['Cyberpunk 2077'],
    date: '2026-05-12',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: 'CD Projekt’s Cyberpunk Sequel “Project Orion” Enters Full Production',
        excerpt:
          'The Cyberpunk 2077 follow-up, codenamed Project Orion, has moved into full production at CD Projekt’s North American studio.',
      },
      {
        source: 'eurogamer',
        title: 'Cyberpunk sequel Project Orion is now in full production',
        excerpt:
          'CD Projekt confirmed the next Cyberpunk game has ramped up, building on the engine shift to Unreal Engine 5.',
      },
      {
        source: 'pc-gamer',
        title: 'The Cyberpunk 2077 sequel has entered full production',
        excerpt:
          'Project Orion, the Cyberpunk sequel, is officially in full production, CD Projekt said in an earnings update.',
      },
      {
        source: 'gamesradar',
        title: 'Cyberpunk’s sequel Project Orion ramps up development',
        excerpt:
          'CD Projekt’s Cyberpunk sequel is now in full production, with a larger team than Cyberpunk 2077 had.',
      },
      {
        source: 'vg247',
        title: 'Project Orion, the Cyberpunk sequel, is in full production',
        excerpt:
          'The next Cyberpunk game has entered full production, CD Projekt confirmed, though release is years away.',
      },
    ],
  },
  {
    key: 'cyberpunk-patch',
    gameRefs: ['Cyberpunk 2077'],
    date: '2026-05-28',
    type: 'news',
    articles: [
      {
        source: 'pc-gamer',
        title: 'Cyberpunk 2077 Update 2.3 Adds New Vehicles and Fixes',
        excerpt:
          'Patch 2.3 for Cyberpunk 2077 introduces several new cars, an auto-drive feature and a long list of bug fixes.',
      },
      {
        source: 'gamesradar',
        title: 'Cyberpunk 2077 patch 2.3 is out now with new cars',
        excerpt:
          'CD Projekt’s Cyberpunk 2077 update 2.3 adds vehicles and quality-of-life fixes for Night City drivers.',
      },
      {
        source: 'vg247',
        title: 'Cyberpunk 2077’s 2.3 update brings new rides to Night City',
        excerpt:
          'The Cyberpunk 2077 2.3 patch is live, adding cars, an auto-drive option and assorted fixes.',
      },
      {
        source: 'rock-paper-shotgun',
        title: 'Cyberpunk 2077 keeps getting better with update 2.3',
        excerpt:
          'Cyberpunk 2077 patch 2.3 continues the game’s long redemption arc with new vehicles and fixes.',
      },
    ],
  },

  // ── Elden Ring: DLC (review-roundup) + a deals post (same game, 2 events) ────
  {
    key: 'eldenring-dlc',
    gameRefs: ['Elden Ring'],
    date: '2026-05-09',
    type: 'review',
    articles: [
      {
        source: 'ign',
        title: 'Elden Ring: Shadow of the Erdtree Review – A Towering Expansion',
        excerpt:
          'FromSoftware’s Elden Ring expansion delivers brutal bosses and a dense new region that rivals the base game.',
        reviewCopy: true,
      },
      {
        source: 'eurogamer',
        title: 'Elden Ring’s expansion is FromSoftware at its most confident',
        excerpt:
          'The Elden Ring DLC adds a vast Land of Shadow, packing in some of the studio’s toughest fights yet.',
        reviewCopy: true,
      },
      {
        source: 'gamespot',
        title: 'Elden Ring DLC Review: Shadow of the Erdtree',
        excerpt:
          'Shadow of the Erdtree expands Elden Ring with new weapons, bosses and a sprawling region to explore.',
        reviewCopy: true,
      },
      {
        source: 'pc-gamer',
        title: 'The Elden Ring expansion is enormous and brutally hard',
        excerpt:
          'Elden Ring’s Shadow of the Erdtree is a massive DLC that demands everything you learned in the base game.',
        reviewCopy: true,
      },
      {
        source: 'rock-paper-shotgun',
        title: 'Elden Ring: Shadow of the Erdtree is a fittingly huge send-off',
        excerpt:
          'FromSoftware’s Elden Ring expansion is dense, beautiful and punishing — a worthy farewell to the Lands Between.',
        reviewCopy: true,
      },
      {
        source: 'gamesradar',
        title: 'Elden Ring DLC review: a masterclass in difficulty',
        excerpt:
          'Shadow of the Erdtree rounds out Elden Ring with memorable bosses and a region stuffed with secrets.',
        reviewCopy: true,
      },
    ],
  },
  {
    key: 'eldenring-deals',
    gameRefs: ['Elden Ring'],
    date: '2026-06-05',
    type: 'guide',
    articles: [
      {
        source: 'gamesradar',
        title: 'The best Elden Ring deals and discounts this week',
        excerpt:
          'Looking to start Elden Ring before the expansion? Here are the cheapest prices we’ve found across stores.',
        affiliate: true,
      },
      {
        source: 'pc-gamer',
        title: 'Where to buy Elden Ring for the lowest price right now',
        excerpt:
          'We round up the best Elden Ring deals, including the base game and the Shadow of the Erdtree bundle.',
        affiliate: true,
      },
      {
        source: 'ign',
        title: 'Elden Ring is on sale — here’s the best price',
        excerpt:
          'Elden Ring has dropped in price ahead of the weekend; our deals team tracked the lowest offers.',
        affiliate: true,
      },
    ],
  },

  // ── Baldur's Gate 3: official mod support ────────────────────────────────────
  {
    key: 'bg3-mods',
    gameRefs: ["Baldur's Gate 3"],
    date: '2026-05-15',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: 'Baldur’s Gate 3 Gets Official Mod Support and Toolkit',
        excerpt:
          'Larian rolled out official modding tools for Baldur’s Gate 3, with in-game browsing on PC and consoles.',
      },
      {
        source: 'eurogamer',
        title: 'Baldur’s Gate 3 mod tools are here, and they’re generous',
        excerpt:
          'Larian’s Baldur’s Gate 3 modding toolkit lets creators add classes, items and more, curated in-game.',
      },
      {
        source: 'pc-gamer',
        title: 'Baldur’s Gate 3’s official mod support has arrived',
        excerpt:
          'Official Baldur’s Gate 3 mod support brings a toolkit and in-game mod manager to all platforms.',
      },
      {
        source: 'rock-paper-shotgun',
        title: 'You can now mod Baldur’s Gate 3 officially',
        excerpt:
          'Larian shipped official mod tools for Baldur’s Gate 3, opening the door to community classes and campaigns.',
      },
      {
        source: 'gamesradar',
        title: 'Baldur’s Gate 3 adds full mod support across platforms',
        excerpt:
          'The Baldur’s Gate 3 modding update includes console support and a curated in-game browser.',
      },
    ],
  },

  // ── Hades II 1.0 launch (review roundup, review copies) ──────────────────────
  {
    key: 'hades2-launch',
    gameRefs: ['Hades II'],
    date: '2026-05-19',
    type: 'review',
    articles: [
      {
        source: 'ign',
        title: 'Hades 2 Review: Supergiant Sticks the Landing',
        excerpt:
          'Hades II leaves early access as a polished, generous sequel that deepens the original’s combat and story.',
        reviewCopy: true,
      },
      {
        source: 'eurogamer',
        title: 'Hades 2 is a glorious 1.0 release',
        excerpt:
          'Supergiant’s Hades II hits 1.0 with new weapons, gods and a confident expansion of the roguelike formula.',
        reviewCopy: true,
      },
      {
        source: 'polygon',
        title: 'Hades 2 review: a worthy successor',
        excerpt:
          'The full release of Hades II refines everything that made the first game a hit, from the combat to the cast.',
        reviewCopy: true,
      },
      {
        source: 'pc-gamer',
        title: 'Hades 2’s 1.0 launch is everything fans hoped for',
        excerpt:
          'After a long early access, Hades II launches in full with a satisfying ending and more to do than ever.',
        reviewCopy: true,
      },
      {
        source: 'gamesradar',
        title: 'Hades 2 review: Supergiant does it again',
        excerpt:
          'Hades II’s 1.0 version is a deep, beautiful roguelike that builds smartly on its predecessor.',
        reviewCopy: true,
      },
      {
        source: 'rock-paper-shotgun',
        title: 'Hades 2 leaves early access in superb shape',
        excerpt:
          'The 1.0 launch of Hades II is a triumph, with reworked systems and a fittingly grand finale.',
        reviewCopy: true,
      },
    ],
  },

  // ── Helldivers 2 balance controversy ─────────────────────────────────────────
  {
    key: 'helldivers-balance',
    gameRefs: ['Helldivers 2'],
    date: '2026-05-24',
    type: 'news',
    articles: [
      {
        source: 'pc-gamer',
        title: 'Helldivers 2 Players Revolt Over the Latest Balance Patch',
        excerpt:
          'A Helldivers 2 balance patch nerfed several favourite weapons, and the community is review-bombing in protest.',
      },
      {
        source: 'kotaku',
        title: 'Helldivers 2’s nerf patch has fans furious',
        excerpt:
          'The newest Helldivers 2 balance update weakened popular guns, prompting a wave of negative Steam reviews.',
      },
      {
        source: 'vg247',
        title: 'Arrowhead responds to Helldivers 2 balance backlash',
        excerpt:
          'After the Helldivers 2 nerf patch, Arrowhead promised changes following days of community anger.',
      },
      {
        source: 'gamesradar',
        title: 'Helldivers 2 balance patch sparks another community storm',
        excerpt:
          'The latest Helldivers 2 weapon nerfs reignited debate about balance, with players demanding a rollback.',
      },
    ],
  },

  // ── TIME-WINDOW test: same wording, but one item is ~17 months older ─────────
  // Processed oldest-first, the old item seeds its own topic; the recent cluster
  // is outside the time window from it, so they must NOT merge (SPEC verify #3).
  {
    key: 'helldivers-window-old',
    gameRefs: ['Helldivers 2'],
    date: '2025-01-10',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: 'Helldivers 2 major order succeeds as players liberate a key planet',
        excerpt:
          'The Helldivers 2 community completed a galaxy-wide major order, liberating a contested planet after a long campaign.',
      },
    ],
  },
  {
    key: 'helldivers-window-new',
    gameRefs: ['Helldivers 2'],
    date: '2026-06-09',
    type: 'news',
    articles: [
      {
        source: 'pc-gamer',
        title: 'Helldivers 2 major order succeeds as players liberate a key planet',
        excerpt:
          'A galaxy-wide Helldivers 2 major order wrapped up this week as players liberated a heavily defended planet.',
      },
      {
        source: 'gamesradar',
        title: 'Helldivers 2 players win the latest major order and free a planet',
        excerpt:
          'The newest Helldivers 2 major order succeeded, with the community liberating a key planet from the enemy.',
      },
    ],
  },

  // ── Hollow Knight: Silksong release date ─────────────────────────────────────
  {
    key: 'silksong-date',
    gameRefs: ['Hollow Knight: Silksong'],
    date: '2026-05-04',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: 'Hollow Knight: Silksong Finally Gets a Release Date',
        excerpt:
          'After years of waiting, Team Cherry announced a firm Hollow Knight: Silksong release date and a new trailer.',
      },
      {
        source: 'eurogamer',
        title: 'Silksong has a release date at last',
        excerpt:
          'Hollow Knight: Silksong will launch this year, Team Cherry confirmed, ending one of gaming’s longest waits.',
      },
      {
        source: 'polygon',
        title: 'Hollow Knight: Silksong release date revealed',
        excerpt:
          'Team Cherry finally dated Hollow Knight: Silksong, showing Hornet’s journey through a new haunted kingdom.',
      },
      {
        source: 'pc-gamer',
        title: 'Silksong is real and it has a date',
        excerpt:
          'Hollow Knight: Silksong got a release date and a fresh trailer after a famously long development.',
      },
      {
        source: 'vg247',
        title: 'Hollow Knight: Silksong lands a release date',
        excerpt:
          'Team Cherry revealed when Hollow Knight: Silksong arrives, alongside new gameplay of Hornet.',
      },
      {
        source: 'gamesradar',
        title: 'Silksong finally has a release date and we can’t believe it',
        excerpt:
          'The long wait is nearly over: Hollow Knight: Silksong has a confirmed release date and a new trailer.',
      },
    ],
  },

  // ── Death Stranding 2 reviews ────────────────────────────────────────────────
  {
    key: 'ds2-reviews',
    gameRefs: ['Death Stranding 2: On the Beach'],
    date: '2026-05-26',
    type: 'review',
    articles: [
      {
        source: 'ign',
        title: 'Death Stranding 2: On the Beach Review',
        excerpt:
          'Kojima’s Death Stranding 2 doubles down on its strange delivery gameplay with a bigger world and bolder story.',
        reviewCopy: true,
      },
      {
        source: 'gamespot',
        title: 'Death Stranding 2 review: weirder and better',
        excerpt:
          'Death Stranding 2: On the Beach refines the original’s traversal while leaning into Kojima’s eccentric storytelling.',
        reviewCopy: true,
      },
      {
        source: 'polygon',
        title: 'Death Stranding 2 is a stranger, grander sequel',
        excerpt:
          'On the Beach expands Death Stranding with new tools and set-pieces, anchored by a typically Kojima plot.',
        reviewCopy: true,
      },
      {
        source: 'eurogamer',
        title: 'Death Stranding 2: On the Beach review',
        excerpt:
          'Death Stranding 2 is a more confident game than the first, with improved combat and a haunting world.',
        reviewCopy: true,
      },
      {
        source: 'vg247',
        title: 'Death Stranding 2 delivers, literally and figuratively',
        excerpt:
          'On the Beach builds on Death Stranding’s foundations with smoother traversal and a memorable cast.',
        reviewCopy: true,
      },
    ],
  },

  // ── The Elder Scrolls 6 tease ────────────────────────────────────────────────
  {
    key: 'tes6-tease',
    gameRefs: ['The Elder Scrolls VI'],
    date: '2026-06-01',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: 'Bethesda Teases The Elder Scrolls 6 Setting',
        excerpt:
          'Bethesda offered a small new tease for The Elder Scrolls 6, though a release date remains far off.',
      },
      {
        source: 'gamespot',
        title: 'The Elder Scrolls 6 gets a rare update from Bethesda',
        excerpt:
          'Todd Howard shared a brief Elder Scrolls 6 update, asking fans for patience as development continues.',
      },
      {
        source: 'pc-gamer',
        title: 'The Elder Scrolls 6 is still years away, Bethesda admits',
        excerpt:
          'A new Elder Scrolls 6 tease confirmed the long-awaited RPG is progressing, but not coming soon.',
      },
      {
        source: 'vg247',
        title: 'Bethesda drops a tiny Elder Scrolls 6 tease',
        excerpt:
          'The Elder Scrolls 6 remains deep in development; Bethesda’s latest tease gave fans little but hope.',
      },
    ],
  },

  // ── Diablo 4 expansion ───────────────────────────────────────────────────────
  {
    key: 'diablo4-expansion',
    gameRefs: ['Diablo IV'],
    date: '2026-05-30',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: 'Diablo 4’s Next Expansion Adds a New Class',
        excerpt:
          'Blizzard revealed Diablo 4’s next expansion, introducing a fresh class and a sprawling new region.',
      },
      {
        source: 'gamespot',
        title: 'Diablo 4 expansion announced with new class',
        excerpt:
          'The upcoming Diablo 4 expansion brings a new playable class, zone and endgame systems, Blizzard said.',
      },
      {
        source: 'pc-gamer',
        title: 'Diablo 4’s second expansion is on the way',
        excerpt:
          'Blizzard detailed the next Diablo 4 expansion, promising a new class and a continuation of the campaign.',
      },
      {
        source: 'gamesradar',
        title: 'Diablo 4 expansion teases a returning fan-favourite class',
        excerpt:
          'Diablo 4’s new expansion adds a class fans have wanted for years, plus a new region to grind.',
      },
    ],
  },

  // ── Counter-Strike 2 major update ────────────────────────────────────────────
  {
    key: 'cs2-update',
    gameRefs: ['Counter-Strike 2'],
    date: '2026-05-17',
    type: 'news',
    articles: [
      {
        source: 'pc-gamer',
        title: 'Counter-Strike 2 Overhauls Its Ranking System',
        excerpt:
          'Valve’s big Counter-Strike 2 update reworks competitive ranks and adds a new map to the active pool.',
      },
      {
        source: 'vg247',
        title: 'Counter-Strike 2 gets a major competitive update',
        excerpt:
          'The latest Counter-Strike 2 patch changes ranking, tweaks economy and rotates the map pool.',
      },
      {
        source: 'gamesradar',
        title: 'CS2’s new update changes how ranks work',
        excerpt:
          'Counter-Strike 2 players are digging into a major update that overhauls the competitive ranking system.',
      },
    ],
  },

  // ── Industry: studio layoffs (business; no clear single game) ────────────────
  {
    key: 'industry-layoffs',
    gameRefs: [],
    date: '2026-06-04',
    type: 'news',
    articles: [
      {
        source: 'gamesindustry-biz',
        title: 'Major Publisher Announces Another Round of Layoffs',
        excerpt:
          'A major games publisher confirmed hundreds of layoffs this week, the latest in a difficult year for the industry.',
      },
      {
        source: 'eurogamer',
        title: 'Studio layoffs hit the games industry again',
        excerpt:
          'Fresh layoffs were confirmed at a large publisher, renewing concerns about job security across games.',
      },
      {
        source: 'polygon',
        title: 'The games industry’s layoff wave continues',
        excerpt:
          'Another round of layoffs was announced, adding to thousands of games-industry job losses over the past year.',
      },
      {
        source: 'kotaku',
        title: 'More layoffs rock the games industry',
        excerpt:
          'A publisher confirmed significant layoffs, with several projects reportedly affected by the cuts.',
      },
    ],
  },

  // ── Business: acquisition (no single game) ───────────────────────────────────
  {
    key: 'acquisition',
    gameRefs: [],
    date: '2026-05-11',
    type: 'news',
    articles: [
      {
        source: 'gamesindustry-biz',
        title: 'Publisher Acquires Veteran Studio in $1bn Deal',
        excerpt:
          'A major publisher announced the acquisition of a long-running studio in a deal valued at around $1 billion.',
      },
      {
        source: 'eurogamer',
        title: 'Another big studio acquisition shakes up the industry',
        excerpt:
          'The latest studio acquisition adds a respected developer to an already-large publishing portfolio.',
      },
      {
        source: 'vg247',
        title: 'Studio bought in a billion-dollar acquisition',
        excerpt:
          'A billion-dollar acquisition brought a veteran studio under a major publisher, pending regulatory approval.',
      },
    ],
  },

  // ── more multi-source events (broaden the feed; distinct games → clean split) ─
  {
    key: 'nms-update',
    gameRefs: ["No Man's Sky"],
    date: '2026-05-06',
    type: 'news',
    articles: [
      {
        source: 'pc-gamer',
        title: 'No Man’s Sky’s Huge New Update Adds Living Ships and Worlds',
        excerpt:
          'Hello Games dropped another massive free No Man’s Sky update, overhauling planets and adding organic ships.',
      },
      {
        source: 'eurogamer',
        title: 'No Man’s Sky just got another enormous free update',
        excerpt:
          'The latest No Man’s Sky update continues Hello Games’ long redemption story with reworked worlds.',
      },
      {
        source: 'gamesradar',
        title: 'No Man’s Sky adds living worlds in its biggest update yet',
        excerpt:
          'Hello Games’ new No Man’s Sky patch adds organic ships and rebuilt planet generation, free for all.',
      },
      {
        source: 'rock-paper-shotgun',
        title: 'No Man’s Sky keeps giving with a giant new update',
        excerpt:
          'Another free No Man’s Sky update lands, expanding the universe with new worlds and ships.',
      },
      {
        source: 'vg247',
        title: 'No Man’s Sky’s new update is its most ambitious',
        excerpt:
          'Hello Games’ newest No Man’s Sky update reworks planets and adds living ships at no cost.',
      },
    ],
  },
  {
    key: 'ff16-pc',
    gameRefs: ['Final Fantasy XVI'],
    date: '2026-05-13',
    type: 'review',
    articles: [
      {
        source: 'ign',
        title: 'Final Fantasy 16 PC Review: A Strong but Demanding Port',
        excerpt:
          'Final Fantasy XVI arrives on PC with high-end visuals and tough hardware requirements, but it runs well tuned.',
        reviewCopy: true,
      },
      {
        source: 'pc-gamer',
        title: 'Final Fantasy 16 on PC is gorgeous if you have the rig',
        excerpt:
          'The Final Fantasy XVI PC port shines on powerful hardware, with extensive graphics options.',
        reviewCopy: true,
      },
      {
        source: 'gamespot',
        title: 'Final Fantasy 16 PC port review',
        excerpt:
          'Final Fantasy XVI’s PC version delivers Clive’s story with sharper visuals and uncapped frame rates.',
        reviewCopy: true,
      },
      {
        source: 'gamesradar',
        title: 'Final Fantasy 16 finally hits PC',
        excerpt:
          'Square Enix’s Final Fantasy XVI lands on PC with strong performance on capable machines.',
        reviewCopy: true,
      },
    ],
  },
  {
    key: 'doom-dark-ages',
    gameRefs: ['DOOM'],
    date: '2026-05-18',
    type: 'review',
    articles: [
      {
        source: 'ign',
        title: 'Doom: The Dark Ages Review – Heavy Metal Mayhem',
        excerpt:
          'id Software’s Doom prequel trades speed for a heavier, grounded combat loop and it mostly thrills.',
        reviewCopy: true,
      },
      {
        source: 'eurogamer',
        title: 'Doom: The Dark Ages is a brutal new direction',
        excerpt:
          'The new Doom leans into a slower, shield-driven combat style while keeping the series’ heavy-metal energy.',
        reviewCopy: true,
      },
      {
        source: 'pc-gamer',
        title: 'Doom: The Dark Ages review',
        excerpt:
          'id’s Doom prequel adds a shield and parries, reshaping the demon-slaying formula in interesting ways.',
        reviewCopy: true,
      },
      {
        source: 'gamesradar',
        title: 'Doom: The Dark Ages is loud, heavy and great',
        excerpt:
          'The latest Doom delivers a meatier, more deliberate take on id Software’s demon-slaying combat.',
        reviewCopy: true,
      },
      {
        source: 'vg247',
        title: 'Doom: The Dark Ages rips and tears differently',
        excerpt: 'Doom: The Dark Ages slows the pace with a shield and melee focus, and it works.',
        reviewCopy: true,
      },
    ],
  },
  {
    key: 'zelda-movie',
    gameRefs: ['The Legend of Zelda'],
    date: '2026-05-20',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: 'Live-Action Legend of Zelda Movie Reveals Its Cast',
        excerpt:
          'Nintendo and Sony revealed the cast for the live-action Legend of Zelda film, with a director attached.',
      },
      {
        source: 'polygon',
        title: 'The live-action Zelda movie has found its Link and Zelda',
        excerpt:
          'Casting for the Legend of Zelda movie was announced, sparking immediate debate among fans.',
      },
      {
        source: 'kotaku',
        title: 'Zelda movie casting revealed and fans have thoughts',
        excerpt:
          'The live-action Legend of Zelda film’s casting drew strong reactions across social media.',
      },
      {
        source: 'gamesradar',
        title: 'The Legend of Zelda movie casts its leads',
        excerpt:
          'Nintendo’s live-action Legend of Zelda movie revealed its lead actors and a target release year.',
      },
    ],
  },
  {
    key: 'stardew-16',
    gameRefs: ['Stardew Valley'],
    date: '2026-05-22',
    type: 'news',
    articles: [
      {
        source: 'pc-gamer',
        title: 'Stardew Valley’s 1.6 Update Comes to Consoles',
        excerpt:
          'ConcernedApe’s big Stardew Valley 1.6 update finally reached consoles and mobile with new content.',
      },
      {
        source: 'eurogamer',
        title: 'Stardew Valley 1.6 lands on consoles at last',
        excerpt:
          'The long-awaited Stardew Valley 1.6 update is now on consoles, adding festivals, items and secrets.',
      },
      {
        source: 'kotaku',
        title: 'Stardew Valley 1.6 is finally on consoles',
        excerpt:
          'Console players can now dig into Stardew Valley’s 1.6 update, months after the PC release.',
      },
      {
        source: 'gamesradar',
        title: 'Stardew Valley’s 1.6 update reaches more players',
        excerpt:
          'ConcernedApe brought the Stardew Valley 1.6 update to consoles and mobile, with cross-platform parity.',
      },
    ],
  },
  {
    key: 'sot-season',
    gameRefs: ['Sea of Thieves'],
    date: '2026-05-27',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: 'Sea of Thieves Launches a New Season of Adventures',
        excerpt:
          'Rare’s latest Sea of Thieves season adds fresh voyages, rewards and a new world event.',
      },
      {
        source: 'vg247',
        title: 'Sea of Thieves’ new season sets sail',
        excerpt:
          'The newest Sea of Thieves season brings new cosmetics, voyages and a recurring world event.',
      },
      {
        source: 'gamesradar',
        title: 'Sea of Thieves kicks off another big season',
        excerpt:
          'Rare’s new Sea of Thieves season adds content and rewards for pirates old and new.',
      },
    ],
  },
  {
    key: 'lol-worlds',
    gameRefs: ['League of Legends'],
    date: '2026-05-29',
    type: 'news',
    articles: [
      {
        source: 'polygon',
        title: 'League of Legends Worlds Breaks Viewership Records Again',
        excerpt:
          'Riot’s League of Legends World Championship set new peak viewership numbers in a dramatic final.',
      },
      {
        source: 'kotaku',
        title: 'League of Legends Worlds final was a nail-biter',
        excerpt:
          'The League of Legends Worlds final drew record crowds and a tense five-game series.',
      },
      {
        source: 'vg247',
        title: 'League of Legends Worlds smashes viewing records',
        excerpt:
          'This year’s League of Legends World Championship peaked higher than any previous esports event.',
      },
      {
        source: 'gamesradar',
        title: 'A record-breaking League of Legends Worlds wraps up',
        excerpt:
          'Riot’s League of Legends Worlds delivered record viewership and a memorable champion.',
      },
    ],
  },
  {
    key: 'genshin-update',
    gameRefs: ['Genshin Impact'],
    date: '2026-06-01',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: 'Genshin Impact’s New Region and Characters Detailed',
        excerpt:
          'HoYoverse revealed Genshin Impact’s next region, several new characters and a major story chapter.',
      },
      {
        source: 'pc-gamer',
        title: 'Genshin Impact’s next update adds a sprawling new region',
        excerpt:
          'The upcoming Genshin Impact update introduces a new area, characters and quests, HoYoverse said.',
      },
      {
        source: 'vg247',
        title: 'Genshin Impact reveals its next big chapter',
        excerpt:
          'HoYoverse detailed Genshin Impact’s next update, with a new region and playable characters.',
      },
      {
        source: 'gamesradar',
        title: 'Genshin Impact’s new region looks stunning',
        excerpt:
          'Genshin Impact’s next update expands the world with a new region and several characters.',
      },
    ],
  },
  {
    key: 'forza-update',
    gameRefs: ['Forza Horizon 5'],
    date: '2026-06-03',
    type: 'news',
    articles: [
      {
        source: 'pc-gamer',
        title: 'Forza Horizon 5 Adds a New Map Expansion',
        excerpt:
          'Playground Games revealed a new Forza Horizon 5 expansion with fresh roads, cars and events.',
      },
      {
        source: 'gamesradar',
        title: 'Forza Horizon 5’s new expansion adds more to drive',
        excerpt:
          'The latest Forza Horizon 5 expansion brings a new area and a batch of cars to collect.',
      },
      {
        source: 'vg247',
        title: 'Forza Horizon 5 expands its world again',
        excerpt:
          'Forza Horizon 5’s new map expansion adds events and vehicles for the open-world racer.',
      },
    ],
  },
  {
    key: 'witcher4-ue5',
    gameRefs: ['The Witcher IV'],
    date: '2026-06-05',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: 'The Witcher 4 Shows First Gameplay Running on Unreal Engine 5',
        excerpt:
          'CD Projekt revealed the first The Witcher 4 gameplay tech demo, built in Unreal Engine 5 with Ciri as lead.',
      },
      {
        source: 'eurogamer',
        title: 'The Witcher 4’s Unreal Engine 5 demo is striking',
        excerpt:
          'CD Projekt’s The Witcher 4 tech demo showed off Unreal Engine 5 visuals and a new protagonist.',
      },
      {
        source: 'pc-gamer',
        title: 'The Witcher 4 runs on Unreal Engine 5 and it looks the part',
        excerpt:
          'A The Witcher 4 tech demo demonstrated Unreal Engine 5 rendering, though release is far off.',
      },
      {
        source: 'gamesradar',
        title: 'The Witcher 4 gameplay tech demo impresses',
        excerpt:
          'CD Projekt’s first The Witcher 4 demo highlighted Unreal Engine 5 and Ciri as the new lead.',
      },
    ],
  },
  {
    key: 'mariokart-dlc',
    gameRefs: ['Mario Kart 8 Deluxe'],
    date: '2026-06-07',
    type: 'news',
    articles: [
      {
        source: 'polygon',
        title: 'Mario Kart 8 Deluxe Gets Surprise New Tracks',
        excerpt:
          'Nintendo surprised players with a fresh batch of Mario Kart 8 Deluxe tracks and characters.',
      },
      {
        source: 'kotaku',
        title: 'Mario Kart 8 Deluxe just added more courses',
        excerpt: 'A surprise Mario Kart 8 Deluxe update added new tracks years after launch.',
      },
      {
        source: 'gamesradar',
        title: 'Mario Kart 8 Deluxe keeps on giving with new tracks',
        excerpt: 'Nintendo dropped a surprise wave of Mario Kart 8 Deluxe courses and racers.',
      },
    ],
  },
  {
    key: 'rdr2-anniversary',
    gameRefs: ['Red Dead Redemption 2'],
    date: '2026-06-08',
    type: 'opinion',
    articles: [
      {
        source: 'eurogamer',
        title: 'Red Dead Redemption 2 Still Sets the Open-World Bar',
        excerpt:
          'Years on, Red Dead Redemption 2’s detail and pacing remain unmatched among open-world games.',
      },
      {
        source: 'rock-paper-shotgun',
        title: 'Why Red Dead Redemption 2 is still the benchmark',
        excerpt:
          'Revisiting Red Dead Redemption 2 shows how far ahead Rockstar’s world-building was.',
      },
      {
        source: 'gamesradar',
        title: 'Red Dead Redemption 2 holds up beautifully',
        excerpt:
          'Red Dead Redemption 2 remains a high point for open-world design and storytelling.',
      },
    ],
  },
  {
    key: 'destiny-expansion',
    gameRefs: ['Destiny 2'],
    date: '2026-05-07',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: 'Destiny 2’s Next Expansion Promises a Fresh Start',
        excerpt:
          'Bungie detailed Destiny 2’s next expansion, pitching it as an on-ramp for lapsed and new Guardians.',
      },
      {
        source: 'pc-gamer',
        title: 'Destiny 2’s new expansion overhauls the new-player experience',
        excerpt:
          'The upcoming Destiny 2 expansion reworks onboarding alongside a new destination and raid.',
      },
      {
        source: 'vg247',
        title: 'Destiny 2 reveals its next big expansion',
        excerpt:
          'Bungie’s next Destiny 2 expansion adds a destination, raid and a revamped intro for newcomers.',
      },
      {
        source: 'gamesradar',
        title: 'Destiny 2’s expansion wants lapsed players back',
        excerpt:
          'Destiny 2’s new expansion focuses on welcoming returning and new players with a fresh start.',
      },
      {
        source: 'kotaku',
        title: 'Destiny 2 is trying to win players back again',
        excerpt:
          'Bungie’s newest Destiny 2 expansion leans on a streamlined start to recapture lapsed Guardians.',
      },
    ],
  },
  {
    key: 'cod-season',
    gameRefs: ['Call of Duty: Modern Warfare'],
    date: '2026-05-25',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: 'Call of Duty’s New Season Adds Maps and an Anti-Cheat Update',
        excerpt:
          'The latest Call of Duty season brings new maps, weapons and a substantial anti-cheat overhaul.',
      },
      {
        source: 'vg247',
        title: 'Call of Duty’s new season targets cheaters',
        excerpt:
          'Activision’s new Call of Duty season pairs fresh content with a major anti-cheat push.',
      },
      {
        source: 'gamesradar',
        title: 'Call of Duty season adds maps and weapons',
        excerpt:
          'The new Call of Duty season delivers maps, weapons and ranked tweaks alongside anti-cheat fixes.',
      },
      {
        source: 'pc-gamer',
        title: 'Call of Duty’s anti-cheat gets a big upgrade this season',
        excerpt:
          'The latest Call of Duty season focuses heavily on anti-cheat improvements for PC players.',
      },
    ],
  },
  {
    key: 'smash-dlc',
    gameRefs: ['Super Smash Bros. Ultimate'],
    date: '2026-06-06',
    type: 'news',
    articles: [
      {
        source: 'polygon',
        title: 'A Surprise Super Smash Bros. Ultimate Update Appears',
        excerpt:
          'Nintendo shadow-dropped a small Super Smash Bros. Ultimate update with balance changes.',
      },
      {
        source: 'kotaku',
        title: 'Super Smash Bros. Ultimate gets a surprise patch',
        excerpt: 'A surprise Super Smash Bros. Ultimate patch tweaked several fighters’ balance.',
      },
      {
        source: 'gamesradar',
        title: 'Smash Ultimate’s surprise update shifts the meta',
        excerpt:
          'The unexpected Super Smash Bros. Ultimate balance patch shook up the competitive meta.',
      },
    ],
  },
  {
    key: 'rust-update',
    gameRefs: ['Rust'],
    date: '2026-06-11',
    type: 'news',
    articles: [
      {
        source: 'pc-gamer',
        title: 'Rust’s Monthly Update Adds a New Monument',
        excerpt:
          'Facepunch’s latest Rust update adds a sprawling new monument and balance changes.',
      },
      {
        source: 'rock-paper-shotgun',
        title: 'Rust’s new monument is a death trap, and that’s the point',
        excerpt:
          'The newest Rust update introduces a dangerous monument packed with high-tier loot.',
      },
      {
        source: 'vg247',
        title: 'Rust’s monthly update lands with new content',
        excerpt: 'Facepunch’s monthly Rust update adds a monument, items and balance tweaks.',
      },
    ],
  },
  {
    key: 'borderlands-deals',
    gameRefs: ['Borderlands 3'],
    date: '2026-06-13',
    type: 'guide',
    articles: [
      {
        source: 'gamesradar',
        title: 'The best Borderlands 3 deals ahead of the next game',
        excerpt:
          'With a new Borderlands on the horizon, here are the cheapest Borderlands 3 prices we found.',
        affiliate: true,
      },
      {
        source: 'pc-gamer',
        title: 'Where to buy Borderlands 3 cheap right now',
        excerpt: 'Our deals team tracked the lowest Borderlands 3 prices across stores this week.',
        affiliate: true,
      },
      {
        source: 'ign',
        title: 'Borderlands 3 is heavily discounted this week',
        excerpt: 'Borderlands 3 dropped to a new low price ahead of the series’ next entry.',
        affiliate: true,
      },
    ],
  },

  // ── I4a SECONDARY-GATE test pair (verify-critical, stable guids) ─────────────
  // Same game (Cyberpunk 2077), same celebratory register → high cosine, so a
  // single threshold OVER-MERGES them. But they're genuinely DIFFERENT events
  // (a production/business update vs a sales milestone) ~3 days apart, so the
  // secondary gate keeps them as TWO topics. Placed >14 days after the existing
  // Cyberpunk events so those out-of-window topics don't interfere. With the gate
  // OFF, cosine merges these into one (proving the gate is what separates them).
  {
    key: 'cyberpunk-orion',
    gameRefs: ['Cyberpunk 2077'],
    date: '2026-06-13',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title:
          'CD Projekt celebrates a landmark Cyberpunk moment as Project Orion enters full production',
        excerpt:
          'CD Projekt says the Cyberpunk franchise is in great shape and momentum is strong, with the next game now moving forward as the studio expands its team.',
      },
    ],
  },
  {
    key: 'cyberpunk-sales',
    gameRefs: ['Cyberpunk 2077'],
    date: '2026-06-16',
    type: 'news',
    articles: [
      {
        source: 'eurogamer',
        title:
          'CD Projekt celebrates a landmark Cyberpunk moment as the game passes 30 million copies sold',
        excerpt:
          'CD Projekt says the Cyberpunk franchise is in great shape and momentum is strong, with total sales now beyond thirty million copies sold worldwide.',
      },
    ],
  },

  // ── I4a BIAS direction-spanning articles (verify-critical, stable guids) ─────
  // Three articles that span the influence range so the verify can assert the
  // ordering holds (sponsored+affiliate > affiliate > clean) WITHOUT asserting
  // absolute numbers. Distinct games so they each form their own topic.
  {
    key: 'bias-clean',
    gameRefs: ['Pseudoregalia'],
    date: '2026-06-14',
    type: 'review',
    articles: [
      {
        source: 'rock-paper-shotgun',
        title: 'Pseudoregalia review: a confident, hand-crafted 3D platformer',
        excerpt:
          'A thoughtful, original take on the collectathon that earns its place — no strings attached, just careful design and a clear point of view.',
        reviewCopy: true,
      },
    ],
  },
  {
    key: 'bias-affiliate',
    gameRefs: [],
    date: '2026-06-14',
    type: 'guide',
    articles: [
      {
        source: 'pc-gamer',
        title: 'The best graphics cards for gaming in 2026, ranked',
        excerpt:
          'Our pick of the best GPUs this year, with current prices and the best deals we could find across stores.',
        affiliate: true,
      },
    ],
  },
  {
    key: 'bias-sponsored',
    gameRefs: ['NovaStrike Arena'],
    date: '2026-06-14',
    type: 'preview',
    articles: [
      {
        source: 'ign',
        title: 'Sponsored: an early look at NovaStrike Arena’s flashy new season',
        excerpt:
          'In partnership with the publisher, we preview NovaStrike Arena’s new season and its premium battle pass, with deals on starter bundles.',
        sponsored: true,
        affiliate: true,
      },
    ],
  },
];

// ── standalone single-source articles (each should form its OWN topic) ─────────
interface StandaloneArticle {
  source: string;
  title: string;
  excerpt: string;
  date: string;
  gameRefs?: string[];
  type?: ArticleType;
  affiliate?: boolean;
  sponsored?: boolean;
  reviewCopy?: boolean;
  paywall?: boolean;
}

const STANDALONE: StandaloneArticle[] = [
  {
    source: 'rock-paper-shotgun',
    title: 'The 25 best RPGs you can play right now',
    excerpt:
      'Our updated list of the best role-playing games spans classics and modern hits across every platform.',
    date: '2026-05-02',
    type: 'guide',
    gameRefs: ["Baldur's Gate 3", 'Disco Elysium'],
  },
  {
    source: 'ign',
    title: 'Stardew Valley creator teases his next game',
    excerpt:
      'ConcernedApe shared a small look at his next project, separate from the ongoing Stardew Valley updates.',
    date: '2026-05-03',
    gameRefs: ['Stardew Valley'],
  },
  {
    source: 'pc-gamer',
    title: 'Best gaming mouse 2026: our top picks',
    excerpt:
      'We tested dozens of gaming mice to find the best options for every budget and grip style.',
    date: '2026-05-05',
    type: 'guide',
    affiliate: true,
  },
  {
    source: 'eurogamer',
    title: 'Why I keep coming back to Disco Elysium',
    excerpt:
      'A personal reflection on Disco Elysium’s writing and how its choices linger long after the credits.',
    date: '2026-05-07',
    type: 'opinion',
    gameRefs: ['Disco Elysium'],
  },
  {
    source: 'polygon',
    title: 'Terraria’s final update is bigger than expected',
    excerpt:
      'Re-Logic released another “final” Terraria update, adding content fans have requested for years.',
    date: '2026-05-08',
    gameRefs: ['Terraria'],
  },
  {
    source: 'gamespot',
    title: 'Resident Evil 4 remake is still the gold standard',
    excerpt:
      'Revisiting the Resident Evil 4 remake shows why it remains a benchmark for how to redo a classic.',
    date: '2026-05-10',
    type: 'opinion',
    gameRefs: ['Resident Evil 4'],
  },
  {
    source: 'kotaku',
    title: 'Animal Crossing players are building incredible islands',
    excerpt:
      'The Animal Crossing: New Horizons community continues to share astonishing island designs.',
    date: '2026-05-13',
    gameRefs: ['Animal Crossing: New Horizons'],
  },
  {
    source: 'vg247',
    title: 'Monster Hunter World is still worth playing in 2026',
    excerpt: 'Years on, Monster Hunter: World remains a fantastic entry point into the series.',
    date: '2026-05-14',
    type: 'opinion',
    gameRefs: ['Monster Hunter: World'],
  },
  {
    source: 'gamesradar',
    title: 'Sponsored: Build the ultimate gaming PC with these parts',
    excerpt:
      'In partnership with our sponsor, here’s a guide to assembling a high-end gaming PC for 2026.',
    date: '2026-05-16',
    type: 'guide',
    sponsored: true,
    affiliate: true,
  },
  {
    source: 'ign',
    title: 'God of War remains a high point for the PlayStation era',
    excerpt:
      'Looking back at God of War and how its reinvention reshaped Sony’s first-party output.',
    date: '2026-05-18',
    type: 'opinion',
    gameRefs: ['God of War'],
  },
  {
    source: 'pc-gamer',
    title: 'The best Steam Deck games to play this month',
    excerpt:
      'From cozy sims to demanding shooters, here are great Steam Deck picks for the month ahead.',
    date: '2026-05-20',
    type: 'guide',
    affiliate: true,
  },
  {
    source: 'eurogamer',
    title: 'Horizon Forbidden West on PC is a stunning port',
    excerpt:
      'The PC version of Horizon Forbidden West runs beautifully and shows off the lush open world.',
    date: '2026-05-22',
    type: 'review',
    gameRefs: ['Horizon Forbidden West'],
    reviewCopy: true,
  },
  {
    source: 'polygon',
    title: 'Fortnite’s new season leans into a fan-favourite theme',
    excerpt: 'The latest Fortnite season introduces a new map, weapons and a much-requested theme.',
    date: '2026-05-23',
    gameRefs: ['Fortnite'],
  },
  {
    source: 'gamespot',
    title: 'Minecraft’s next update focuses on mobs',
    excerpt:
      'Mojang detailed Minecraft’s upcoming update, which adds new creatures and biome tweaks.',
    date: '2026-05-25',
    gameRefs: ['Minecraft'],
  },
  {
    source: 'rock-paper-shotgun',
    title: 'Frostpunk is the best city-builder about hard choices',
    excerpt:
      '11 bit’s Frostpunk forces brutal decisions, and that’s exactly what makes it special.',
    date: '2026-05-27',
    type: 'opinion',
    gameRefs: ['Frostpunk'],
  },
  {
    source: 'kotaku',
    title: 'VALORANT’s new agent shakes up the meta',
    excerpt: 'Riot’s latest VALORANT agent is already changing how high-level matches play out.',
    date: '2026-05-29',
    gameRefs: ['VALORANT'],
  },
  {
    source: 'vg247',
    title: 'Tekken 8’s latest fighter is a returning legend',
    excerpt: 'Bandai Namco added a beloved returning character to Tekken 8 in the newest update.',
    date: '2026-05-31',
    gameRefs: ['Tekken 8'],
  },
  {
    source: 'gamesradar',
    title: 'Street Fighter 6 keeps getting better a year on',
    excerpt: 'New characters and modes have kept Street Fighter 6 fresh well past its launch.',
    date: '2026-06-02',
    type: 'opinion',
    gameRefs: ['Street Fighter 6'],
  },
  {
    source: 'ign',
    title: 'Alan Wake 2 is even better with its new mode',
    excerpt:
      'Remedy’s Alan Wake 2 added a new mode that gives fans a reason to dive back into Bright Falls.',
    date: '2026-06-03',
    gameRefs: ['Alan Wake 2'],
  },
  {
    source: 'pc-gamer',
    title: 'The best CPUs for gaming in 2026',
    excerpt:
      'Our hardware team ranks the best gaming CPUs across price points after extensive benchmarking.',
    date: '2026-06-06',
    type: 'guide',
    affiliate: true,
  },
  {
    source: 'eurogamer',
    title: 'Subnautica still does underwater horror best',
    excerpt:
      'Returning to Subnautica is a reminder of how tense and beautiful its ocean depths remain.',
    date: '2026-06-07',
    type: 'opinion',
    gameRefs: ['Subnautica'],
  },
  {
    source: 'polygon',
    title: 'Control is the strangest game I recommend most',
    excerpt:
      'Remedy’s Control blends weird architecture and combat into something that sticks with you.',
    date: '2026-06-08',
    type: 'opinion',
    gameRefs: ['Control'],
  },
  {
    source: 'gamespot',
    title: 'NieR: Automata remains a one-of-a-kind experience',
    excerpt: 'Years later, NieR: Automata’s mix of action and philosophy is still unmatched.',
    date: '2026-06-10',
    type: 'opinion',
    gameRefs: ['NieR: Automata'],
  },
  {
    source: 'kotaku',
    title: 'A new indie darling is climbing the charts',
    excerpt:
      'A surprise indie hit, the card-battler Balatro, continues to dominate streamers’ schedules.',
    date: '2026-06-11',
    gameRefs: ['Balatro'],
  },
  {
    source: 'vg247',
    title: 'Hands-on with an upcoming open-world RPG',
    excerpt:
      'We went hands-on with Chronowraith Saga IX, an ambitious upcoming open-world RPG from a new studio.',
    date: '2026-06-12',
    type: 'preview',
    // Intentionally references a game NOT in the catalog → exercises resolveOrQueue.
    gameRefs: ['Chronowraith Saga IX'],
  },
  {
    source: 'rock-paper-shotgun',
    title: 'The case for shorter games',
    excerpt:
      'An argument that gaming’s best experiences are often the ones that respect your time.',
    date: '2026-06-13',
    type: 'opinion',
  },
  {
    source: 'gamesindustry-biz',
    title: 'Live-service fatigue is reshaping publisher strategy',
    excerpt:
      'Analysts say a glut of live-service games is pushing publishers back toward single-player bets.',
    date: '2026-06-14',
    type: 'news',
    paywall: true,
  },
  {
    source: 'ign',
    title: 'Hands-on with the new Resident Evil Village mode',
    excerpt:
      'We tried the new Resident Evil Village content and came away impressed by its tension.',
    date: '2026-05-04',
    type: 'preview',
    gameRefs: ['Resident Evil Village'],
  },
  {
    source: 'eurogamer',
    title: 'The quiet brilliance of Inside, years later',
    excerpt: 'Playdead’s Inside remains a masterclass in atmosphere and minimalist storytelling.',
    date: '2026-05-05',
    type: 'opinion',
    gameRefs: ['Inside'],
  },
  {
    source: 'pc-gamer',
    title: 'Best gaming headsets in 2026',
    excerpt: 'Our audio team ranks the best gaming headsets across wired and wireless options.',
    date: '2026-05-06',
    type: 'guide',
    affiliate: true,
  },
  {
    source: 'polygon',
    title: 'Why Hollow Knight endures as an indie landmark',
    excerpt: 'Hollow Knight’s world and combat keep drawing new players years after release.',
    date: '2026-05-09',
    type: 'opinion',
    gameRefs: ['Hollow Knight'],
  },
  {
    source: 'gamespot',
    title: 'Revisiting Half-Life 2 two decades on',
    excerpt: 'Half-Life 2 still feels remarkably modern, a testament to Valve’s design.',
    date: '2026-05-11',
    type: 'opinion',
    gameRefs: ['Half-Life 2'],
  },
  {
    source: 'kotaku',
    title: 'Phasmophobia’s new map is genuinely terrifying',
    excerpt: 'The latest Phasmophobia update adds a sprawling, frightening new location.',
    date: '2026-05-12',
    gameRefs: ['Phasmophobia'],
  },
  {
    source: 'vg247',
    title: 'Civilization 5 is still many fans’ favourite',
    excerpt: 'Despite newer entries, Sid Meier’s Civilization V retains a devoted community.',
    date: '2026-05-14',
    type: 'opinion',
    gameRefs: ['Sid Meier’s Civilization V'],
  },
  {
    source: 'gamesradar',
    title: 'The best co-op games to play with friends',
    excerpt: 'From A Way Out to Left 4 Dead 2, here are great co-op picks for any group.',
    date: '2026-05-15',
    type: 'guide',
    gameRefs: ['A Way Out', 'Left 4 Dead 2'],
  },
  {
    source: 'rock-paper-shotgun',
    title: 'RimWorld remains the best storytelling sandbox',
    excerpt: 'RimWorld’s emergent stories still outclass almost anything else in the genre.',
    date: '2026-05-17',
    type: 'opinion',
    gameRefs: ['RimWorld'],
  },
  {
    source: 'ign',
    title: 'Dark Souls 3 retrospective: FromSoftware’s farewell to a series',
    excerpt: 'Dark Souls III closed the trilogy with some of the studio’s most memorable bosses.',
    date: '2026-05-19',
    type: 'opinion',
    gameRefs: ['Dark Souls III'],
  },
  {
    source: 'eurogamer',
    title: 'Pizza Tower is the most fun I’ve had all year',
    excerpt: 'Pizza Tower’s frantic energy and expressive animation make it a standout indie.',
    date: '2026-05-21',
    type: 'opinion',
    gameRefs: ['Pizza Tower'],
  },
  {
    source: 'pc-gamer',
    title: 'Best graphics cards for 1440p gaming in 2026',
    excerpt: 'We benchmark the best GPUs for high-refresh 1440p play across budgets.',
    date: '2026-05-23',
    type: 'guide',
    affiliate: true,
  },
  {
    source: 'polygon',
    title: 'Titanfall 2’s campaign is still a masterpiece',
    excerpt: 'Years later, Titanfall 2’s single-player campaign remains a benchmark for the genre.',
    date: '2026-05-24',
    type: 'opinion',
    gameRefs: ['Titanfall 2'],
  },
  {
    source: 'gamespot',
    title: 'Metroid Dread shows 2D Metroid still works',
    excerpt: 'Metroid Dread proved the classic 2D formula remains thrilling on modern hardware.',
    date: '2026-05-26',
    type: 'opinion',
    gameRefs: ['Metroid Dread'],
  },
  {
    source: 'kotaku',
    title: 'Splatoon 3’s latest Splatfest was chaos',
    excerpt: 'The newest Splatoon 3 Splatfest drew huge turnout and plenty of ink.',
    date: '2026-05-28',
    gameRefs: ['Splatoon 3'],
  },
  {
    source: 'vg247',
    title: 'Yakuza 0 is still the best place to start the series',
    excerpt: 'Yakuza 0 remains the ideal entry point, blending drama and absurd side content.',
    date: '2026-05-30',
    type: 'opinion',
    gameRefs: ['Yakuza 0'],
  },
  {
    source: 'gamesradar',
    title: 'The best handheld gaming PCs compared',
    excerpt: 'We pit the leading handheld gaming PCs against each other to find the best buy.',
    date: '2026-06-01',
    type: 'guide',
    affiliate: true,
  },
  {
    source: 'rock-paper-shotgun',
    title: 'Disco Elysium remains unmatched in writing',
    excerpt: 'No game since has matched Disco Elysium’s density and quality of prose.',
    date: '2026-06-02',
    type: 'opinion',
    gameRefs: ['Disco Elysium'],
  },
  {
    source: 'ign',
    title: 'Hunt: Showdown’s new event is its tensest yet',
    excerpt: 'The latest Hunt: Showdown event ups the tension with new rules and rewards.',
    date: '2026-06-04',
    gameRefs: ['Hunt: Showdown'],
  },
  {
    source: 'eurogamer',
    title: 'Why Bastion still resonates after all these years',
    excerpt: 'Supergiant’s Bastion endures thanks to its narration and heartfelt story.',
    date: '2026-06-05',
    type: 'opinion',
    gameRefs: ['Bastion'],
  },
  {
    source: 'polygon',
    title: 'Firewatch and the art of the short story game',
    excerpt: 'Firewatch shows how much a tightly-focused narrative game can achieve.',
    date: '2026-06-06',
    type: 'opinion',
    gameRefs: ['Firewatch'],
  },
  {
    source: 'gamespot',
    title: 'XCOM 2 is still the king of turn-based tactics',
    excerpt: 'XCOM 2’s tense, punishing tactics keep it at the top of the genre.',
    date: '2026-06-09',
    type: 'opinion',
    gameRefs: ['XCOM 2'],
  },
  {
    source: 'pc-gamer',
    title: 'Best SSDs for gaming in 2026',
    excerpt: 'Fast load times matter — here are the best gaming SSDs we’ve tested this year.',
    date: '2026-06-10',
    type: 'guide',
    affiliate: true,
  },
  {
    source: 'kotaku',
    title: 'Lethal Company is still the funniest game with friends',
    excerpt: 'Lethal Company’s mix of horror and comedy keeps lobbies laughing and screaming.',
    date: '2026-06-12',
    gameRefs: ['Lethal Company'],
  },
  {
    source: 'eurogamer',
    title: 'Control 2 can’t come soon enough',
    excerpt: 'After revisiting Control, the wait for Remedy’s sequel feels longer than ever.',
    date: '2026-05-08',
    type: 'opinion',
    gameRefs: ['Control'],
  },
  {
    source: 'gamespot',
    title: 'Nioh 2 is the best the series has ever been',
    excerpt: 'Nioh 2 sharpens the formula with deeper combat and a stronger structure.',
    date: '2026-05-13',
    type: 'opinion',
    gameRefs: ['Nioh 2'],
  },
  {
    source: 'vg247',
    title: 'Kingdom Come: Deliverance is worth another look',
    excerpt: 'Kingdom Come: Deliverance’s grounded RPG systems reward patience and curiosity.',
    date: '2026-05-16',
    type: 'opinion',
    gameRefs: ['Kingdom Come: Deliverance'],
  },
  {
    source: 'polygon',
    title: 'Tunic is a puzzle box disguised as an action game',
    excerpt: 'Tunic hides one of the best puzzle designs of recent years behind its cute exterior.',
    date: '2026-05-20',
    type: 'opinion',
    gameRefs: ['Tunic'],
  },
  {
    source: 'rock-paper-shotgun',
    title: 'Anno 1800 is the city-builder I can’t put down',
    excerpt: 'Anno 1800’s intricate supply chains make for an endlessly absorbing builder.',
    date: '2026-05-24',
    type: 'opinion',
    gameRefs: ['Anno 1800'],
  },
  {
    source: 'ign',
    title: 'Devil May Cry 5 still has the best action combat',
    excerpt: 'Devil May Cry 5’s stylish combat remains the high-water mark for the genre.',
    date: '2026-05-29',
    type: 'opinion',
    gameRefs: ['Devil May Cry 5'],
  },
  {
    source: 'gamesradar',
    title: 'The best racing games to play in 2026',
    excerpt:
      'From arcade thrills to sim depth, here are the racing games worth your time this year.',
    date: '2026-06-03',
    type: 'guide',
    affiliate: true,
  },
  {
    source: 'kotaku',
    title: 'Fall Guys’ latest season is pure chaos',
    excerpt: 'The new Fall Guys season adds rounds and cosmetics for the party platformer.',
    date: '2026-06-11',
    gameRefs: ['Fall Guys'],
  },
];

// ── flatten EVENTS + STANDALONE → the bundled feed ────────────────────────────
function offsetHours(dateYmd: string, hours: number): string {
  const base = new Date(`${dateYmd}T08:00:00Z`);
  base.setUTCHours(base.getUTCHours() + hours);
  return base.toISOString();
}

// ── EVENTS_EXTRA (I5a density pass) ──────────────────────────────────────────
// More multi-source events across the same catalog + the full 10 sources, so the
// homepage feed/latest fill naturally. Same clustering engine, same idempotent
// guid scheme (`${key}-${source}`). Real catalog game names so articles attach.
const EVENTS_EXTRA: FeedEvent[] = [
  {
    key: 'elden-ring-sales',
    gameRefs: ['Elden Ring'],
    date: '2026-05-28',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: 'Elden Ring Surpasses 30 Million Copies Sold',
        excerpt:
          'FromSoftware and Bandai Namco confirmed Elden Ring has now sold more than 30 million copies worldwide.',
      },
      {
        source: 'eurogamer',
        title: 'Elden Ring passes 30 million sales as the open-world giant keeps selling',
        excerpt:
          'Three years on, Elden Ring continues to move millions of copies, buoyed by its acclaimed expansion.',
      },
      {
        source: 'gamespot',
        title: 'Elden Ring Hits a New Sales Milestone of 30 Million',
        excerpt:
          'The figure cements Elden Ring as one of the best-selling games of its generation.',
      },
      {
        source: 'vg247',
        title: 'Elden Ring is still a phenomenon: 30 million copies and counting',
        excerpt:
          'Bandai Namco shared the milestone in its latest earnings call alongside DLC performance.',
      },
      {
        source: 'pc-gamer',
        title: 'Elden Ring sells 30 million as Shadow of the Erdtree drives a long tail',
        excerpt:
          'The expansion gave the base game a fresh sales bump on PC storefronts, the publisher said.',
      },
    ],
  },
  {
    key: 'witcher4-gameplay',
    gameRefs: ['The Witcher IV'],
    date: '2026-06-05',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: 'The Witcher 4 Reveals Its First In-Engine Gameplay',
        excerpt:
          'CD Projekt Red showed an extended look at The Witcher IV running on Unreal Engine 5, starring Ciri.',
      },
      {
        source: 'gamespot',
        title: 'The Witcher 4 gameplay reveal puts Ciri front and centre',
        excerpt:
          'The studio walked through traversal, combat and a new region in its first proper gameplay showcase.',
      },
      {
        source: 'polygon',
        title: 'The Witcher 4 finally shows gameplay — and it looks the part',
        excerpt:
          'After years of teases, CD Projekt Red gave fans a substantial first look at the next Witcher.',
        type: 'preview',
      },
      {
        source: 'gamesradar',
        title: 'Everything shown in the first Witcher 4 gameplay reveal',
        excerpt:
          'Here is every detail from the reveal, from the new combat stances to the rebuilt signs system.',
      },
      {
        source: 'eurogamer',
        title: 'The Witcher 4 hands-off preview: cautious optimism after Cyberpunk',
        excerpt:
          'The reveal was confident, but the real test is whether the launch avoids a repeat of 2020.',
        type: 'opinion',
      },
      {
        source: 'vg247',
        title: 'The Witcher 4 gameplay: release window still a mystery',
        excerpt:
          'CD Projekt Red declined to give a date, saying only that the game is "deep in production".',
      },
    ],
  },
  {
    key: 'helldivers2-warbond',
    gameRefs: ['Helldivers 2'],
    date: '2026-06-09',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: "Helldivers 2's New Warbond Adds Mechs and a Fresh Front",
        excerpt:
          'Arrowhead detailed the latest premium Warbond, bringing new stratagems and a contested planet.',
      },
      {
        source: 'pc-gamer',
        title: 'Helldivers 2 escalates the galactic war with its biggest update yet',
        excerpt:
          'The new content drop adds enemy types, weapons and a community objective spanning the sector.',
      },
      {
        source: 'rock-paper-shotgun',
        title: 'Helldivers 2 keeps the live war feeling alive with another smart update',
        excerpt:
          'It is the kind of evolving content cadence that other live-service games struggle to match.',
        type: 'opinion',
      },
      {
        source: 'vg247',
        title: 'Helldivers 2 patch notes: every change in the new Warbond',
        excerpt: 'The full breakdown of weapons, armour passives and balance tweaks.',
      },
      {
        source: 'gamesradar',
        title: 'Best Helldivers 2 loadouts for the new Warbond gear',
        excerpt: 'Our picks for the strongest stratagem and weapon combos in the latest update.',
        type: 'guide',
        affiliate: true,
      },
    ],
  },
  {
    key: 'hades2-milestone',
    gameRefs: ['Hades II'],
    date: '2026-06-13',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: 'Hades 2 Passes 5 Million Players After Its 1.0 Launch',
        excerpt:
          'Supergiant confirmed the sequel reached the milestone within weeks of leaving early access.',
      },
      {
        source: 'eurogamer',
        title: 'Hades 2 is another runaway hit for Supergiant, crossing 5 million players',
        excerpt:
          'The studio said word of mouth drove a steep climb in the days after the full release.',
      },
      {
        source: 'gamespot',
        title: 'Hades 2 Crosses 5 Million Players',
        excerpt: 'The roguelike sequel keeps building on a strong early-access foundation.',
      },
      {
        source: 'pc-gamer',
        title: 'Hades 2 sales milestone caps a stellar early-access run',
        excerpt: 'Five million players in, the 1.0 launch looks like an unqualified success.',
      },
      {
        source: 'vg247',
        title: 'Hades 2 hits 5 million players',
        excerpt: 'Supergiant shared the figure as the sequel rides post-launch momentum.',
      },
    ],
  },
  {
    key: 'cs2-anticheat',
    gameRefs: ['Counter-Strike 2'],
    date: '2026-05-21',
    type: 'news',
    articles: [
      {
        source: 'pc-gamer',
        title: 'Valve Bans 90,000 Counter-Strike 2 Accounts in Anti-Cheat Sweep',
        excerpt:
          'The latest VAC Live wave targeted spinbotters and a popular external cheat provider.',
      },
      {
        source: 'rock-paper-shotgun',
        title: 'Counter-Strike 2 anti-cheat finally lands a meaningful blow',
        excerpt:
          'Players welcomed the bans, though many argued the underlying problem is far from solved.',
        type: 'opinion',
      },
      {
        source: 'vg247',
        title: 'Counter-Strike 2 ban wave hits 90,000 cheaters overnight',
        excerpt: 'Valve confirmed the figure as part of its renewed anti-cheat push.',
      },
      {
        source: 'kotaku',
        title: 'CS2 players cheer a 90,000-account ban wave',
        excerpt: "It is one of the largest single anti-cheat actions in the game's history.",
      },
    ],
  },
  {
    key: 'dragons-dogma2-mtx',
    gameRefs: ['Dragon’s Dogma 2'],
    date: '2026-05-16',
    type: 'news',
    articles: [
      {
        source: 'kotaku',
        title: "Dragon's Dogma 2 Microtransactions Spark Launch-Day Backlash",
        excerpt:
          'Players criticised paid items for fast-travel and character edits added at release.',
      },
      {
        source: 'pc-gamer',
        title: "Dragon's Dogma 2's monetization overshadows a great RPG",
        excerpt:
          'The storefront items are largely cosmetic or earnable in-game, but the optics drew anger.',
        type: 'opinion',
      },
      {
        source: 'eurogamer',
        title: "Dragon's Dogma 2 review-bombed over microtransactions and performance",
        excerpt:
          'Steam reviews turned "Mostly Negative" within a day despite strong critic scores.',
      },
      {
        source: 'vg247',
        title: "Capcom responds to Dragon's Dogma 2 monetization complaints",
        excerpt: 'The publisher said most paid items can be earned through normal play.',
      },
      {
        source: 'polygon',
        title: "Dragon's Dogma 2 and the microtransaction trust problem",
        excerpt:
          'The backlash says more about player wariness than about this specific storefront.',
        type: 'opinion',
      },
    ],
  },
  {
    key: 'nomanssky-worlds2',
    gameRefs: ['No Man’s Sky'],
    date: '2026-05-30',
    type: 'news',
    articles: [
      {
        source: 'pc-gamer',
        title: "No Man's Sky's Worlds Part II Update Reinvents Planets Again",
        excerpt:
          'Hello Games shipped another free update overhauling terrain, water and gas giants.',
      },
      {
        source: 'rock-paper-shotgun',
        title: "No Man's Sky keeps redefining the redemption-arc playbook",
        excerpt:
          "Years of free updates have turned a rocky launch into one of gaming's great comebacks.",
        type: 'opinion',
      },
      {
        source: 'ign',
        title: "No Man's Sky Worlds Part II adds deeper, stranger planets",
        excerpt: 'The update massively increases planetary variety and view distance.',
      },
      {
        source: 'eurogamer',
        title: "No Man's Sky's latest free update is its most ambitious yet",
        excerpt: 'Hello Games continues to expand the universe at no extra cost.',
      },
    ],
  },
  {
    key: 'crimson-desert-date',
    gameRefs: ['Crimson Desert'],
    date: '2026-06-07',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: 'Crimson Desert Finally Locks a 2026 Release Date',
        excerpt:
          'Pearl Abyss confirmed a firm launch window after years of delays for its open-world epic.',
      },
      {
        source: 'gamespot',
        title: 'Crimson Desert gets a release date and a new gameplay deep dive',
        excerpt: 'The action RPG showed off bosses, traversal and a sprawling hand-built world.',
      },
      {
        source: 'eurogamer',
        title: 'Crimson Desert hands-on: ambitious, dense, and nearly here',
        excerpt: 'After a long road, the game is shaping up into a genuine open-world contender.',
        type: 'preview',
      },
      {
        source: 'vg247',
        title: 'Crimson Desert release date confirmed for late 2026',
        excerpt: 'Pearl Abyss says the wait is almost over for its big single-player bet.',
      },
      {
        source: 'gamesradar',
        title: 'Crimson Desert looks stunning in its latest showcase',
        excerpt: 'Everything revealed in the new Crimson Desert gameplay presentation.',
      },
    ],
  },
  {
    key: 'pragmata-delay',
    gameRefs: ['Pragmata'],
    date: '2026-05-19',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: 'Capcom Delays Pragmata Again, Now Targeting 2027',
        excerpt:
          'The long-mysterious sci-fi project slips once more as Capcom asks for additional time.',
      },
      {
        source: 'vg247',
        title: 'Pragmata pushed back yet again — a familiar story',
        excerpt: 'The game has now been delayed multiple times since its 2020 reveal.',
      },
      {
        source: 'eurogamer',
        title: 'Pragmata delayed into 2027 as Capcom stays quiet on details',
        excerpt: 'Still little is known about the project beyond its striking trailers.',
      },
      {
        source: 'gamespot',
        title: 'Pragmata Slips to 2027 in Latest Capcom Delay',
        excerpt: 'The publisher reaffirmed the game is still in active development.',
      },
    ],
  },
  {
    key: 'balatro-mobile',
    gameRefs: ['Balatro'],
    date: '2026-05-24',
    type: 'news',
    articles: [
      {
        source: 'pc-gamer',
        title: "Balatro's Mobile Port Tops the App Store Charts",
        excerpt: 'The breakout poker roguelike found a huge new audience on phones within days.',
      },
      {
        source: 'rock-paper-shotgun',
        title: 'Balatro on mobile is dangerously good',
        excerpt: 'The one-more-run loop is even harder to put down in your pocket.',
        type: 'opinion',
      },
      {
        source: 'kotaku',
        title: "Balatro is eating everyone's commute now",
        excerpt: "The indie sensation's mobile launch is another runaway success.",
      },
      {
        source: 'vg247',
        title: 'Balatro mobile review: the perfect port',
        excerpt: 'Nothing is lost in the move to touchscreens — if anything it is better.',
        reviewCopy: true,
      },
    ],
  },
  {
    key: 'destiny2-frontiers',
    gameRefs: ['Destiny 2'],
    date: '2026-06-03',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: 'Destiny 2: Frontiers Expansion Sets a Bold New Direction',
        excerpt:
          'Bungie detailed its next major expansion and a reworked seasonal model for the year ahead.',
      },
      {
        source: 'pc-gamer',
        title: 'Destiny 2 Frontiers wants to win back lapsed Guardians',
        excerpt: 'The expansion promises a fresh destination and a less grindy progression.',
      },
      {
        source: 'vg247',
        title: 'Everything we know about Destiny 2: Frontiers',
        excerpt: 'Release window, story setup and the new endgame, explained.',
      },
      {
        source: 'gamesradar',
        title: 'Destiny 2 Frontiers: every reveal from the showcase',
        excerpt: 'Bungie laid out its roadmap after a turbulent year for the studio.',
      },
      {
        source: 'eurogamer',
        title: 'Can Destiny 2: Frontiers steady a shaky live service?',
        excerpt: 'The reveal was promising, but trust will be earned at launch.',
        type: 'opinion',
      },
    ],
  },
  {
    key: 'sf6-year3',
    gameRefs: ['Street Fighter 6'],
    date: '2026-05-26',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: 'Street Fighter 6 Reveals Its Year 3 Fighters',
        excerpt:
          'Capcom announced the next season pass roster, including two long-requested returns.',
      },
      {
        source: 'gamespot',
        title: 'Street Fighter 6 Year 3 character pass detailed',
        excerpt: 'The new fighters arrive across the coming months alongside balance updates.',
      },
      {
        source: 'gamesradar',
        title: 'Best Street Fighter 6 fight stick deals for the new season',
        excerpt: 'Where to find the best prices on arcade sticks before Year 3 begins.',
        type: 'guide',
        affiliate: true,
      },
      {
        source: 'vg247',
        title: 'Street Fighter 6 Year 3: release dates for every fighter',
        excerpt: 'The full schedule for the upcoming character drops.',
      },
    ],
  },
  {
    key: 'alanwake2-profit',
    gameRefs: ['Alan Wake 2'],
    date: '2026-05-14',
    type: 'news',
    articles: [
      {
        source: 'gamesindustry-biz',
        title: 'Alan Wake 2 Has Finally Recouped Its Costs, Remedy Confirms',
        excerpt:
          'The acclaimed horror sequel turned profitable on the back of strong digital and DLC sales.',
        paywall: true,
      },
      {
        source: 'eurogamer',
        title: 'Alan Wake 2 is now profitable after a slow-burn success',
        excerpt: 'Remedy said the game crossed the line thanks to expansions and discounts.',
      },
      {
        source: 'vg247',
        title: 'Remedy: Alan Wake 2 has recouped development and marketing costs',
        excerpt: 'A milestone for a critically beloved but commercially cautious release.',
      },
      {
        source: 'polygon',
        title: "Alan Wake 2's long road to profitability, explained",
        excerpt: 'How a digital-only horror sequel eventually found its audience.',
        type: 'opinion',
      },
    ],
  },
  {
    key: 'industry-layoffs-2026',
    gameRefs: [],
    date: '2026-06-04',
    type: 'news',
    articles: [
      {
        source: 'gamesindustry-biz',
        title: 'Another Wave of Games-Industry Layoffs Hits Major Studios',
        excerpt:
          'Several large publishers confirmed restructuring and job cuts amid rising development costs.',
        paywall: true,
      },
      {
        source: 'eurogamer',
        title: "The games industry's layoff crisis shows no sign of slowing",
        excerpt: 'Thousands of roles have been lost across the sector in the past year.',
      },
      {
        source: 'kotaku',
        title: "More studio layoffs as the industry's rough stretch continues",
        excerpt: 'Workers and advocates renewed calls for better job security and unionisation.',
      },
      {
        source: 'polygon',
        title: 'Why games-industry layoffs keep happening',
        excerpt: 'The structural reasons behind a brutal couple of years for developers.',
        type: 'opinion',
      },
      {
        source: 'vg247',
        title: 'Latest games-industry layoffs: who is affected',
        excerpt: 'A rundown of the studios and teams hit by the newest cuts.',
      },
    ],
  },
  {
    key: 'genshin-anniversary',
    gameRefs: ['Genshin Impact'],
    date: '2026-05-23',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: "Genshin Impact's Anniversary Patch Opens a Whole New Region",
        excerpt:
          'HoYoverse celebrated the milestone with a large free region, characters and events.',
      },
      {
        source: 'vg247',
        title: 'Genshin Impact anniversary update: every new character and banner',
        excerpt: "The patch is one of the biggest content drops in the game's history.",
      },
      {
        source: 'gamesradar',
        title: 'Genshin Impact anniversary rewards, explained',
        excerpt: 'What players get to log in for during the celebration.',
        type: 'guide',
      },
      {
        source: 'polygon',
        title: "Genshin Impact's anniversary finally answers a long-running complaint",
        excerpt: 'HoYoverse expanded login rewards after years of community pressure.',
        type: 'opinion',
      },
    ],
  },
  {
    key: 'sea-of-thieves-s14',
    gameRefs: ['Sea of Thieves'],
    date: '2026-05-18',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: 'Sea of Thieves Season 14 Adds New World Events',
        excerpt:
          'Rare detailed fresh emergent encounters and cosmetics for the long-running pirate game.',
      },
      {
        source: 'vg247',
        title: 'Sea of Thieves Season 14 patch notes',
        excerpt: 'Everything changing in the latest season of the shared-world adventure.',
      },
      {
        source: 'gamesradar',
        title: 'Sea of Thieves keeps finding new ways to surprise its crews',
        excerpt: 'The new world events add welcome unpredictability to voyages.',
        type: 'opinion',
      },
      {
        source: 'pc-gamer',
        title: 'Sea of Thieves Season 14 brings its best emergent content yet',
        excerpt: 'The update leans into the chaos that made the game a sleeper hit.',
      },
    ],
  },
  {
    key: 'totk-sales',
    gameRefs: ['The Legend of Zelda: Tears of the Kingdom'],
    date: '2026-05-12',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: 'Tears of the Kingdom Passes 25 Million Copies Sold',
        excerpt: 'Nintendo confirmed the milestone, cementing the sequel as a generational hit.',
      },
      {
        source: 'vg247',
        title: 'Zelda: Tears of the Kingdom crosses 25 million sales',
        excerpt: 'The figure puts it among the best-selling entries in the series.',
      },
      {
        source: 'gamespot',
        title: 'Tears of the Kingdom Hits 25 Million as Nintendo Reports Strong Year',
        excerpt: 'The sequel continues to sell long after its launch window.',
      },
      {
        source: 'polygon',
        title: "Tears of the Kingdom's sales prove Nintendo's sequel gamble paid off",
        excerpt: 'The follow-up matched and in places exceeded Breath of the Wild commercially.',
        type: 'opinion',
      },
    ],
  },
  {
    key: 'metroid-dread2-leak',
    gameRefs: ['Metroid Dread'],
    date: '2026-06-01',
    type: 'news',
    articles: [
      {
        source: 'eurogamer',
        title: 'A Metroid Dread Sequel Is Reportedly in Development',
        excerpt: 'Sources claim MercurySteam has begun work on a follow-up to the 2021 hit.',
      },
      {
        source: 'vg247',
        title: 'Metroid Dread 2 rumours gather steam',
        excerpt: 'Nothing is confirmed, but multiple reports point to an early-stage sequel.',
      },
      {
        source: 'ign',
        title: 'Report: A New 2D Metroid Is in the Works',
        excerpt: "The unconfirmed project would continue Samus's story after Dread.",
      },
      {
        source: 'kotaku',
        title: 'Fans are already dreaming up a Metroid Dread sequel',
        excerpt: 'The rumours have reignited hopes for more 2D Metroid.',
        type: 'opinion',
      },
    ],
  },
  {
    key: 'lethal-company-v60',
    gameRefs: ['Lethal Company'],
    date: '2026-05-27',
    type: 'news',
    articles: [
      {
        source: 'pc-gamer',
        title: "Lethal Company's v60 Update Adds New Moons and Monsters",
        excerpt: 'The solo-dev co-op horror hit keeps growing with another big free update.',
      },
      {
        source: 'rock-paper-shotgun',
        title: 'Lethal Company remains the best terrible-idea generator in co-op',
        excerpt: 'The new moons add fresh ways for your friends to get you killed.',
        type: 'opinion',
      },
      {
        source: 'vg247',
        title: 'Lethal Company v60 patch notes: everything new',
        excerpt: 'A full list of the monsters, moons and tools added in the update.',
      },
    ],
  },
  {
    key: 'ffxvi-dlc',
    gameRefs: ['Final Fantasy XVI'],
    date: '2026-05-20',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: "Final Fantasy 16's Echoes of the Fallen Expansion Lands",
        excerpt: "The first story DLC adds a new dungeon, boss and weapons to Clive's journey.",
      },
      {
        source: 'gamespot',
        title: 'Final Fantasy 16 DLC review: a focused, combat-heavy detour',
        excerpt: "Echoes of the Fallen is short but delivers some of the game's best fights.",
        reviewCopy: true,
      },
      {
        source: 'vg247',
        title: 'Final Fantasy 16 Echoes of the Fallen: how to start the DLC',
        excerpt: 'A quick guide to accessing the new content.',
        type: 'guide',
      },
    ],
  },
  {
    key: 'splatoon3-finalfest',
    gameRefs: ['Splatoon 3'],
    date: '2026-05-31',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: "Splatoon 3's Final Splatfest Breaks Participation Records",
        excerpt: "Nintendo's send-off event drew the largest turnout in the game's history.",
      },
      {
        source: 'polygon',
        title: 'Splatoon 3 says goodbye with a record-breaking Splatfest',
        excerpt: 'The community turned out in force for the colourful finale.',
      },
      {
        source: 'kotaku',
        title: "Splatoon 3's last Splatfest was a fittingly chaotic farewell",
        excerpt: 'Three years of updates wrapped up with a celebration.',
      },
      {
        source: 'gamesradar',
        title: 'Splatoon 3 final Splatfest results, explained',
        excerpt: 'Which team came out on top in the last big event.',
      },
    ],
  },
  {
    key: 'frostpunk-survival',
    gameRefs: ['Frostpunk'],
    date: '2026-05-15',
    type: 'news',
    articles: [
      {
        source: 'pc-gamer',
        title: "Frostpunk's New Survival Mode Raises the Stakes",
        excerpt:
          '11 bit studios added a brutal endless mode that pushes city-builders to the brink.',
      },
      {
        source: 'rock-paper-shotgun',
        title: "Frostpunk's survival mode is gloriously, cruelly hard",
        excerpt: 'If you wanted the frozen apocalypse to hurt more, here you go.',
        type: 'opinion',
      },
      {
        source: 'gamesradar',
        title: 'Frostpunk survival mode tips for staying warm',
        excerpt: 'How to keep your city alive in the punishing new mode.',
        type: 'guide',
      },
    ],
  },
  {
    key: 'like-a-dragon-review',
    gameRefs: ['Like a Dragon: Infinite Wealth'],
    date: '2026-05-10',
    type: 'review',
    articles: [
      {
        source: 'ign',
        title: 'Like a Dragon: Infinite Wealth Review',
        excerpt: 'RGG Studio delivers a huge, heartfelt and frequently hilarious RPG epic.',
        reviewCopy: true,
      },
      {
        source: 'gamespot',
        title: 'Like a Dragon: Infinite Wealth is a generous, joyful giant',
        excerpt: 'Two protagonists, two countries, and dozens of brilliant distractions.',
        reviewCopy: true,
      },
      {
        source: 'eurogamer',
        title: 'Like a Dragon: Infinite Wealth review: the series at its best',
        excerpt: 'A sprawling adventure that balances melodrama and absurdity beautifully.',
        reviewCopy: true,
      },
      {
        source: 'pc-gamer',
        title: 'Like a Dragon: Infinite Wealth review — an embarrassment of riches',
        excerpt: 'There is simply an enormous amount of great game here.',
        reviewCopy: true,
      },
    ],
  },
  {
    key: 'gamepass-price',
    gameRefs: [],
    date: '2026-06-06',
    type: 'news',
    articles: [
      {
        source: 'gamesindustry-biz',
        title: 'Microsoft Restructures Game Pass Tiers and Raises Prices',
        excerpt:
          'The subscription service gains a new top tier as existing plans see price increases.',
        paywall: true,
      },
      {
        source: 'vg247',
        title: 'Game Pass price hike: what every tier now costs',
        excerpt: 'A breakdown of the new pricing and what changes for subscribers.',
      },
      {
        source: 'eurogamer',
        title: 'Game Pass raises prices again — is the value still there?',
        excerpt: "The increases reignite the debate over subscription gaming's sustainability.",
        type: 'opinion',
      },
      {
        source: 'ign',
        title: 'Xbox Game Pass Adds a New Tier and Higher Prices',
        excerpt: 'Microsoft says the changes reflect the value of day-one first-party releases.',
      },
    ],
  },
  {
    key: 'best-rpgs-guide',
    gameRefs: ['Elden Ring', 'Baldur’s Gate 3'],
    date: '2026-06-08',
    type: 'guide',
    articles: [
      {
        source: 'gamesradar',
        title: 'The Best RPGs to Play Right Now (2026 Deals)',
        excerpt:
          'Our regularly updated list of the best role-playing games, with the latest prices.',
        affiliate: true,
      },
      {
        source: 'ign',
        title: 'Best RPG Deals This Week',
        excerpt: "Where to find the biggest discounts on the genre's heavy hitters.",
        affiliate: true,
      },
      {
        source: 'vg247',
        title: 'The RPGs worth your time in 2026',
        excerpt: 'A curated shortlist for anyone catching up on the genre.',
      },
    ],
  },
  {
    key: 'tekken8-season',
    gameRefs: ['Tekken 8'],
    date: '2026-05-22',
    type: 'news',
    articles: [
      {
        source: 'ign',
        title: 'Tekken 8 Season 2 Overhauls the Cast in a Big Balance Patch',
        excerpt: 'Bandai Namco shipped sweeping changes alongside a new fighter and stage.',
      },
      {
        source: 'gamesradar',
        title: 'Tekken 8 Season 2 patch notes: every character change',
        excerpt: 'The full rundown of buffs, nerfs and system tweaks.',
      },
      {
        source: 'eurogamer',
        title: "Tekken 8's Season 2 tries to answer a divided community",
        excerpt: 'The patch addresses long-standing complaints about aggression and defence.',
        type: 'opinion',
      },
    ],
  },
];

function buildFeed(): RawFeedItem[] {
  const items: RawFeedItem[] = [];

  for (const event of [...EVENTS, ...EVENTS_EXTRA]) {
    event.articles.forEach((article, index) => {
      items.push({
        guid: `${event.key}-${article.source}`,
        sourceSlug: article.source,
        title: article.title,
        excerpt: article.excerpt,
        // Spread an event's articles a few hours apart (developing-story feel).
        publishedAt: offsetHours(event.date, index * 5),
        articleType: article.type ?? event.type ?? 'news',
        gameRefs: event.gameRefs,
        hasAffiliateLinks: article.affiliate ?? false,
        isSponsored: article.sponsored ?? false,
        basedOnReviewCopy: article.reviewCopy ?? false,
        isPaywalled: article.paywall ?? false,
      });
    });
  }

  STANDALONE.forEach((article, index) => {
    items.push({
      guid: `standalone-${article.source}-${index}`,
      sourceSlug: article.source,
      title: article.title,
      excerpt: article.excerpt,
      publishedAt: offsetHours(article.date, 0),
      articleType: article.type ?? 'news',
      gameRefs: article.gameRefs ?? [],
      hasAffiliateLinks: article.affiliate ?? false,
      isSponsored: article.sponsored ?? false,
      basedOnReviewCopy: article.reviewCopy ?? false,
      isPaywalled: article.paywall ?? false,
    });
  });

  return items;
}

export const MOCK_FEED_ITEMS: RawFeedItem[] = buildFeed();

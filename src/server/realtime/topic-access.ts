// ---------------------------------------------------------------------------
// Server-side authorization for which realtime topics a connection may join.
//
// The `/api/live` route NEVER trusts the client's requested topic list as-is.
// It passes the request through `computeAllowedTopics` and only subscribes the
// connection to `requested ∩ allowed`. A user is always force-subscribed to
// their own `user:{id}` inbox (where presence/DM/activity/notification deltas
// are fanned out).
// ---------------------------------------------------------------------------
import { isConversationMember } from '@/server/social/messaging';
import { MULTIPLAYER_GAME_CONFIG, type MultiplayerGameType } from '@/server/arcade/multiplayer';

// ---------------------------------------------------------------------------
// Per-game realtime topic slugs.
//
// Realtime topics are named `<slug><Kind>` (e.g. `chessLobby`, `poolMatch`)
// and `<slug>:{entityId}` for per-match/table channels. The slug is NOT always
// the `MultiplayerGameType` value — `8-ball` broadcasts under `pool*`. This map
// is the single source of truth; extend it when a game ships new topic names.
// ---------------------------------------------------------------------------
const GAME_TOPIC_SLUGS: Record<MultiplayerGameType, string> = {
  '8-ball': 'pool',
  chess: 'chess',
  blackjack: 'blackjack',
  'typing-test': 'typing',
  'connect-four': 'connectFour',
  checkers: 'checkers',
  reversi: 'reversi',
  battleship: 'battleship',
  // Derby races: `derbyRace:{raceId}` and `derbyRaceLobby`. Royale's `derby`
  // round loop stays the static global topic below.
  derby: 'derbyRace',
};

/** The topic-name suffixes each game may broadcast under. `<slug>Lobby`,
 *  `<slug>Match`, and the `<slug>:` entity prefix are the contract minimum;
 *  the rest keep already-shipped chess/pool channels (chat/challenge/etc.)
 *  working and cover the same surfaces for the other games additively. */
const GAME_TOPIC_KINDS = [
  'Lobby',
  'Match',
  'Chat',
  'Challenge',
  'Analysis',
  'Tournament',
] as const;

/** Build the union of every registered game's global topic names, plus the
 *  static always-on channels. Generated additively so every existing chess/
 *  pool topic name keeps resolving exactly as before. */
function buildPublicGlobalTopics(): Set<string> {
  // `derby` is Derby Royale's single site-wide round-loop channel. It is a
  // plain global topic (not a per-match `<slug>Lobby`/`<slug>Match` family) and
  // spectating is allowed without an account, so it lives in the static seed
  // here rather than in GAME_TOPIC_SLUGS (which is keyed by MultiplayerGameType,
  // and derby is not a versus/matchmade game).
  const topics = new Set<string>(['gameLeaderboards', 'derby', 'social:lobby']);
  for (const gameType of Object.keys(MULTIPLAYER_GAME_CONFIG) as MultiplayerGameType[]) {
    const slug = GAME_TOPIC_SLUGS[gameType];
    if (!slug) continue;
    for (const kind of GAME_TOPIC_KINDS) topics.add(`${slug}${kind}`);
  }
  return topics;
}

/** Global channels any authenticated user may subscribe to (lobby/leaderboard/
 *  tournament/match-broadcast notices — already broadcast to everyone today). */
const PUBLIC_GLOBAL_TOPICS = buildPublicGlobalTopics();

/** Per-entity public prefixes (e.g. `pool:{matchId}`, `chess:{matchId}`,
 *  `chessAnalysis:{matchId}`). Match notices are not secret and are already
 *  exposed via the global sibling channels. Derived from every registered
 *  game's slug so Tier B games' `<slug>:{id}` channels resolve too.
 *
 *  BOTH the mapped slug prefix (`connectFour:`) AND the raw `MultiplayerGameType`
 *  prefix (`connect-four:`) are allowlisted for every game. Per-match entity
 *  topics are broadcast under the RAW gameType (`broadcast(['connect-four:{id}',
 *  'connectFourMatch'], …)`); allowing only the camelCase slug prefix silently
 *  dropped those entity channels for hyphenated game types. Listing both keeps
 *  every already-shipped channel (chess/pool, whose slug == gameType or maps
 *  cleanly) resolving exactly as before while unblocking the raw entity topics. */
const PUBLIC_TOPIC_PREFIXES = Array.from(
  new Set<string>([
    'chessAnalysis:',
    ...(Object.entries(GAME_TOPIC_SLUGS) as [MultiplayerGameType, string][]).flatMap(
      ([gameType, slug]) => [`${slug}:`, `${gameType}:`],
    ),
  ]),
);

const MAX_ALLOWED_TOPICS = 64;

export async function computeAllowedTopics(
  userId: string,
  requested: string[],
): Promise<string[]> {
  const selfInbox = `user:${userId}`;
  const allowed = new Set<string>([selfInbox]);

  for (const raw of requested) {
    if (allowed.size >= MAX_ALLOWED_TOPICS) break;
    const topic = raw.trim();
    if (!topic || topic.length > 200) continue;

    if (topic === selfInbox) {
      allowed.add(topic);
      continue;
    }
    // Another user's private inbox — never.
    if (topic.startsWith('user:')) continue;

    // Direct-message channels require conversation membership.
    if (topic.startsWith('dm:')) {
      if (await isConversationMember(topic.slice(3), userId)) allowed.add(topic);
      continue;
    }

    if (PUBLIC_GLOBAL_TOPICS.has(topic)) {
      allowed.add(topic);
      continue;
    }
    if (PUBLIC_TOPIC_PREFIXES.some((prefix) => topic.startsWith(prefix))) {
      allowed.add(topic);
      continue;
    }
    // Anything else is dropped silently.
  }

  return [...allowed];
}

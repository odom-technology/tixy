/* The rev. 2 rename map. Off until the legal answer is in (PLAN.md, "Names to
   change"). While GAME_RENAMES_ENABLED is false every helper returns what it
   was given, so nothing a player sees changes.

   The switch: set NEXT_PUBLIC_GAME_RENAMES=1 in env/.env.local and rebuild.
   It is read at build time (next.config.ts and the client bundle both
   inline it), so a running server never changes mid-session.

   A rename changes the display name and the route only. The slug, the game
   type, the registry href and every stored key stay as they are.

   How the route moves, when the flag is on:
   - next.config.ts redirects the old route and everything under it to the new
     route, permanently, with the query string kept (308).
   - next.config.ts rewrites the new route and everything under it back to
     the old page, so no game code moves and /api/games/<old> stays put.
   - The browser then reports the new path, so code that matches a path to a
     registry href runs it through canonicalGamePath() first.

   Every helper takes an optional `enabled` so scripts/verify-floor-registry.ts
   can check both states in one run. Callers leave it out. */

export const GAME_RENAMES_ENABLED: boolean = process.env.NEXT_PUBLIC_GAME_RENAMES === '1';

export type GameRename = {
  /* Lowercase, as shown to players. */
  name: string;
  /* The old route, which stays the registry href and the page's real path. */
  from: string;
  /* The new route players see. */
  route: string;
  /* Matches the old name in running text. */
  pattern: RegExp;
};

/* Keyed by the registry slug, which never changes. */
export const GAME_RENAMES: Readonly<Record<string, GameRename>> = {
  'skee-ball': { name: 'ring roll', from: '/skee-ball', route: '/ring-roll', pattern: /skee[- ]?ball/gi },
  plinko: { name: 'peg drop', from: '/plinko', route: '/peg-drop', pattern: /plinko/gi },
  'connect-four': { name: 'four up', from: '/connect-four', route: '/four-up', pattern: /connect[- ](?:four|4)/gi },
  battleship: { name: 'fleet', from: '/battleship', route: '/fleet', pattern: /battleship/gi },
  tetris: { name: 'blockfall', from: '/tetris', route: '/blockfall', pattern: /tetris/gi },
  breakout: { name: 'brick bash', from: '/breakout', route: '/brick-bash', pattern: /breakout/gi },
  'flappy-bird': { name: 'flap', from: '/flappy-bird', route: '/flap', pattern: /flappy(?: bird)?/gi },
};

const titleCase = (name: string) => name.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

export function getGameRename(slug: string, enabled: boolean = GAME_RENAMES_ENABLED): GameRename | null {
  return enabled ? GAME_RENAMES[slug] ?? null : null;
}

/* The name to show for a game: the renamed one when renames are on, else the
   title the caller already has. Lowercase, for the tixy surfaces. */
export function getGameDisplayName(slug: string, currentTitle: string, enabled: boolean = GAME_RENAMES_ENABLED): string {
  return getGameRename(slug, enabled)?.name ?? currentTitle;
}

/* The same, in title case, for surfaces that still use the registry's title
   case ("Ring Roll | Arcade", leaderboard rows, store labels). */
export function getGameTitle(slug: string, currentTitle: string, enabled: boolean = GAME_RENAMES_ENABLED): string {
  const rename = getGameRename(slug, enabled);
  return rename ? titleCase(rename.name) : currentTitle;
}

/* The route to link to: the renamed one when renames are on, else the current
   href. */
export function getGameDisplayRoute(slug: string, currentHref: string, enabled: boolean = GAME_RENAMES_ENABLED): string {
  return getGameRename(slug, enabled)?.route ?? currentHref;
}

/* A path or url path that starts with an old game route, moved to the new
   route with the rest (match id, query) kept. Anything else is returned as
   given. Use it where code builds a link or a share url from a literal. */
export function renamedPath(path: string, enabled: boolean = GAME_RENAMES_ENABLED): string {
  if (!enabled) return path;
  for (const rename of Object.values(GAME_RENAMES)) {
    if (!path.startsWith(rename.from)) continue;
    const rest = path.slice(rename.from.length);
    if (rest === '' || /^[/?#]/.test(rest)) return rename.route + rest;
  }
  return path;
}

/* The reverse, for a path the browser reports: /four-up/12 becomes
   /connect-four/12, which is what the registry, the nav and the ad and
   availability rules know. */
export function canonicalGamePath(pathname: string, enabled: boolean = GAME_RENAMES_ENABLED): string {
  if (!enabled) return pathname;
  for (const rename of Object.values(GAME_RENAMES)) {
    if (pathname === rename.route || pathname.startsWith(`${rename.route}/`)) {
      return rename.from + pathname.slice(rename.route.length);
    }
  }
  return pathname;
}

/* Old game names inside a sentence ("Play 3 rounds of Tetris") become the new
   names, keeping the capital letter. For display text only, never for keys. */
export function renameGameNamesInText(text: string, enabled: boolean = GAME_RENAMES_ENABLED): string {
  if (!enabled) return text;
  let result = text;
  for (const rename of Object.values(GAME_RENAMES)) {
    result = result.replace(rename.pattern, (match) => {
      if (match.length > 1 && match === match.toUpperCase()) return rename.name.toUpperCase();
      return match[0] !== match[0]!.toLowerCase() ? titleCase(rename.name) : rename.name;
    });
  }
  return result;
}

/* The redirects and rewrites next.config.ts adds. Empty while the flag is off. */
export function gameRenameRoutes(enabled: boolean = GAME_RENAMES_ENABLED) {
  const rules = enabled ? Object.values(GAME_RENAMES) : [];
  return {
    redirects: rules.map((rename) => ({
      source: `${rename.from}/:path*`,
      destination: `${rename.route}/:path*`,
      permanent: true,
    })),
    rewrites: rules.map((rename) => ({
      source: `${rename.route}/:path*`,
      destination: `${rename.from}/:path*`,
    })),
  };
}

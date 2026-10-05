import type { NextConfig } from 'next';

import { gameRenameRoutes } from './src/features/arcade/lib/game-renames';

const ADSENSE_DOMAINS = [
  'https://pagead2.googlesyndication.com',
  'https://www.googletagservices.com',
  'https://googleads.g.doubleclick.net',
  'https://securepubads.g.doubleclick.net',
  'https://tpc.googlesyndication.com',
  'https://securepubads.g.doubleclick.net',
  'https://www.googletagservices.com',
].join(' ');
const CLOUDFLARE_INSIGHTS_SCRIPT = 'https://static.cloudflareinsights.com';
const CLOUDFLARE_INSIGHTS_CONNECT = 'https://cloudflareinsights.com';
// AdSense's SODAR invalid-traffic check fetches its config from this host.
const ADSENSE_SODAR_CONNECT = 'https://ep1.adtrafficquality.google';
const ADSENSE_SODAR_SCRIPT = 'https://ep2.adtrafficquality.google';
const ADSENSE_CSI_CONNECT = 'https://csi.gstatic.com';

// Comma-separated development hosts, without a scheme or port.
const ALLOWED_DEV_ORIGINS = (process.env.ARCADE_ALLOWED_DEV_ORIGINS ?? 'localhost,127.0.0.1')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const DEV_SCRIPT_EVAL = process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'";

// 'unsafe-inline' for scripts is a deliberate tradeoff: the Next.js inline
// runtime has no nonce plumbing here. https: in img-src keeps user-supplied
// avatar URLs working; gleitz.github.io serves the Tetris soundfont samples;
// worker-src blob: covers the Tetris music scheduler worker.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${DEV_SCRIPT_EVAL} ${ADSENSE_DOMAINS} ${ADSENSE_SODAR_SCRIPT} ${CLOUDFLARE_INSIGHTS_SCRIPT}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  `connect-src 'self' ${ADSENSE_DOMAINS} ${ADSENSE_SODAR_CONNECT} ${ADSENSE_SODAR_SCRIPT} ${ADSENSE_CSI_CONNECT} ${CLOUDFLARE_INSIGHTS_CONNECT} https://gleitz.github.io`,
  'frame-src https://googleads.g.doubleclick.net https://securepubads.g.doubleclick.net https://tpc.googlesyndication.com https://ep2.adtrafficquality.google https://www.google.com',
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

// Rev. 2 game renames. Empty unless NEXT_PUBLIC_GAME_RENAMES=1 at build time
// (src/features/arcade/lib/game-renames.ts). On: each old route and everything
// under it redirects permanently to the new route with its query string, and
// the new route is rewritten back to the old page, so no game code moves.
const gameRenames = gameRenameRoutes();

const nextConfig: NextConfig = {
  compress: true,
  output: 'standalone',
  images: {
    localPatterns: [{ pathname: '/**' }],
    qualities: [72, 75, 78],
  },
  // Dev-only: allow other machines on the LAN to load Next dev resources
  // (HMR + client runtime) so the app is testable over WiFi. No prod effect.
  allowedDevOrigins: ALLOWED_DEV_ORIGINS,
  turbopack: {
    root: process.cwd(),
  },
  outputFileTracingExcludes: {
    '/*': [
      './node_modules/stockfish/bin/stockfish.js',
      './node_modules/stockfish/bin/stockfish.wasm',
      './node_modules/stockfish/bin/stockfish-18.js',
      './node_modules/stockfish/bin/stockfish-18.wasm',
      './node_modules/stockfish/bin/stockfish-18-single.js',
      './node_modules/stockfish/bin/stockfish-18-single.wasm',
      './node_modules/stockfish/bin/stockfish-18-lite.js',
      './node_modules/stockfish/bin/stockfish-18-lite.wasm',
      './node_modules/stockfish/bin/stockfish-18-asm.js',
    ],
  },
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  typedRoutes: false,
  serverExternalPackages: ['stockfish'],
  async rewrites() {
    return gameRenames.rewrites;
  },
  async redirects() {
    // Social surfaces consolidated into the /social hub; /onboarding folded into settings.
    return [
      ...gameRenames.redirects,
      { source: '/friends', destination: '/social?tab=friends', permanent: false },
      { source: '/notifications', destination: '/social?view=alerts', permanent: false },
      { source: '/activity', destination: '/social?view=alerts', permanent: false },
      { source: '/onboarding', destination: '/settings', permanent: false },

      // Rev. 2 retired games (docs/game-catalog.json).
      // Page routes only, never /api/...: scores, leaderboards, wagers and
      // inventory keep their endpoints and stored keys. Temporary (307)
      // because a later phase may change a target. None of these games has a
      // sub-route, so exact sources cover every page.
      //
      // Only a game that no live system still points at redirects now. The
      // rest are off the floor and out of every list but keep their page, and
      // each has its redirect ready below with the condition that unblocks it.
      // scripts/verify-floor-registry.ts fails if an active redirect is named
      // by the quest pools, the featured pool, the tour pool, achievements,
      // the store catalog or the monthly leaderboard awards.
      { source: '/cases', destination: '/store', permanent: false },
      // { source: '/connections', destination: '/word-grid', permanent: false },
      //   Once the four connections cosmetics (scripts/seed-cosmetics.ts) are
      //   off the store catalog and rotation, and the monthly award for the
      //   connections leaderboard (rewards/payouts.ts) is retired.
      // { source: '/swerve', destination: '/', permanent: false },
      //   Once season 0's weekly swerve quest (w4-swerve-6) is complete for
      //   every player (run scripts/complete-quests-for-game.ts swerve the day
      //   this goes live) and the swerve-score achievement is retired. The
      //   daily quest, featured and tour pools no longer name swerve.
      // { source: '/gunrush', destination: '/', permanent: false },
      //   Once the gunrush-score achievement is retired. The quest, featured
      //   and tour pools no longer name gunrush (they switch to the floor's
      //   games on FLOOR_POOLS_FROM, src/server/arcade/floor-pools.ts).
      // { source: '/packs', destination: '/store', permanent: false },
      //   Once a read-only view of the card collection exists elsewhere. The
      //   collection can only be viewed on /packs today.
      // { source: '/stoplight', destination: '/prize-wheel', permanent: false },
      //   Once prize wheel takes over lucky wheel (PLAN.md lists only the five
      //   scrapped games for phase 2).
      // { source: '/reaction-time', destination: '/ticket-stop', permanent: false },
      //   /ticket-stop exists (phase 3). Once reaction time is out of the
      //   achievements (its series in achievements/registry.ts), the store
      //   catalog (its cosmetics in scripts/seed-cosmetics.ts) and the
      //   monthly leaderboard awards (rewards/payouts.ts).
      // { source: '/tumbler', destination: '/ticket-stop', permanent: false },
      //   Once tumbler is out of the featured pool, the tour pool, the
      //   achievements and the store catalog.
    ];
  },
  async headers() {
    return [
      {
        // Every path but the player card embed, which other sites frame.
        source: '/:path((?!u/[^/]+/embed$).*)',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
        ],
      },
      {
        // The player card embed (src/app/u/[identifier]/embed): a bare page
        // with one image and one link, no scripts, framed by any site.
        source: '/u/:identifier/embed',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Content-Security-Policy',
            value: "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors *",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

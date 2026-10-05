// ---------------------------------------------------------------------------
// Custom HTTP server: Next.js + the realtime/anti-cheat WebSocket on /ws.
//
// `next dev` / `next start` / the standalone server.js never call
// attachGameWs, which leaves the /ws endpoint dead (game clients fall back
// to HTTP-only and reaction-time cannot run rounds). This server owns the
// HTTP upgrade so /ws reaches the game WebSocket server while every other
// upgrade (dev HMR) is passed through to Next.
//
// Run through the repo scripts so env files and path aliases are handled:
//   dev:   npm run dev   [-- -H 0.0.0.0 -p 3000]
//   prod:  npm run build && npm start   (see Dockerfile, docs/deploy.md)
// ---------------------------------------------------------------------------

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import next, { type NextConfig } from 'next';
import { WebSocketServer } from 'ws';
import { attachGameWs } from './src/server/arcade/realtime/ws';
import { startDerbyEngine } from './src/server/arcade/derby/engine';
import { attachBumperCarsWs, startBumperCarsServer } from './src/server/arcade/bumper-cars/ws';
import {
  getMaintenanceModeSettings,
  getSiteAvailabilitySettings,
  getMaintenanceModeStatusForRoles,
} from './src/server/site-settings';

const readFlag = (names: string[]): string | undefined => {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length - 1; i += 1) {
    if (names.includes(argv[i])) return argv[i + 1];
  }
  return undefined;
};

const dev = process.env.NODE_ENV !== 'production';
const hostname =
  readFlag(['-H', '--hostname']) ?? process.env.HOSTNAME ?? 'localhost';
const port = Number(readFlag(['-p', '--port']) ?? process.env.PORT ?? 3000);
const maxRequestBodyBytes = (() => {
  const configured = Number.parseInt(process.env.MAX_HTTP_BODY_BYTES ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 1024 * 1024;
})();

function installBuiltConfig(): void {
  if (dev) return;
  const manifestPath = path.join(process.cwd(), '.next', 'required-server-files.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    config?: NextConfig;
  };
  if (!manifest.config) {
    throw new Error(`Next build config is missing from ${manifestPath}`);
  }

  // Next's custom-server wrapper does not forward `conf` into its production
  // request handlers. Standalone output uses this serialized handoff instead.
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(manifest.config);
}

// The runtime image deliberately contains build output rather than
// next.config.ts. Pass the serialized build config back to Next so runtime-only
// services (notably the image optimizer) use the exact options that produced
// the release instead of silently falling back to framework defaults.
installBuiltConfig();
const app = next({ dev, hostname, port });
const handleRequest = app.getRequestHandler();

await app.prepare();

// Next 16: the upgrade handler can only be created after prepare().
const handleUpgrade = app.getUpgradeHandler();

const wss = new WebSocketServer({ noServer: true });
attachGameWs(wss);

// Bumper cars: its own socket on /ws/bumper-cars and its room loop.
const bumperCarsWss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
attachBumperCarsWs(bumperCarsWss);
startBumperCarsServer();

const isMaintenanceActive = async () => {
  const settings = await getMaintenanceModeSettings();
  return getMaintenanceModeStatusForRoles({
    config: settings.config,
    roles: null,
  }).isActive;
};

// Close existing game sockets when maintenance starts, including connections
// that were established before the setting changed.
setInterval(() => {
  void isMaintenanceActive().then((active) => {
    if (!active) return;
    for (const client of wss.clients) client.close(1012, 'Maintenance');
    for (const client of bumperCarsWss.clients) client.close(1012, 'Maintenance');
  }).catch((error) => {
    console.error('Failed to check maintenance mode for game sockets:', error);
  });
}, 5000).unref();

// Derby Royale — the continuous shared round loop. Idempotent (globalThis-pinned
// singleton), so this only ever boots one engine even across module reloads.
startDerbyEngine();

// Derby races: start due lobbies, settle decided races and retry payouts even
// when no phone is asking. Also globalThis-pinned, so one per process. Loaded
// after prepare(): the race service reaches the wallet and auth modules, which
// need Next's request storage to exist first.
void import('./src/server/arcade/derby-race/service')
  .then((derbyRaces) => derbyRaces.ensureDerbySweeper())
  .catch((error) => console.error('Failed to start the derby race sweeper:', error));

// Weekly paid boards: pay every closed week that has no completed run, at
// boot and every 15 minutes. Idempotent, so a missed week catches up.
void import('./src/server/arcade/rewards/weekly-boards')
  .then((weekly) => weekly.ensureWeeklyBoardsSweeper())
  .catch((error) => console.error('Failed to start the weekly boards sweeper:', error));

const server = createServer(
  {
    maxHeaderSize: 16 * 1024,
    headersTimeout: 15_000,
    requestTimeout: 30_000,
    keepAliveTimeout: 5_000,
  },
  (req, res) => {
    // Next renders an App Router rewrite with HTTP 200 even when the proxy
    // supplies 503. Preserve temporary closure status at the HTTP boundary.
    const writeHead = res.writeHead;
    res.writeHead = (function (this: typeof res, ...args: Parameters<typeof res.writeHead>) {
      if (args[0] === 200 && this.getHeader('X-Arcade-Unavailable')) args[0] = 503;
      return writeHead.apply(this, args);
    }) as typeof res.writeHead;
    const contentLength = Number(req.headers['content-length'] ?? 0);
    if (Number.isFinite(contentLength) && contentLength > maxRequestBodyBytes) {
      res.writeHead(413, {
        'Content-Type': 'application/json; charset=utf-8',
        Connection: 'close',
      });
      res.end(JSON.stringify({ error: 'Payload too large.' }));
      return;
    }
    void handleRequest(req, res);
  },
);
server.maxRequestsPerSocket = 1000;

server.on('upgrade', (req, socket, head) => {
  let pathname = '/';
  try {
    pathname = new URL(req.url ?? '/', 'http://internal').pathname;
  } catch {
    socket.destroy();
    return;
  }
  if (pathname === '/ws/bumper-cars') {
    void Promise.all([isMaintenanceActive(), getSiteAvailabilitySettings()]).then(([active, availability]) => {
      if (active || !availability.config.sections.games) {
        socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        return;
      }
      bumperCarsWss.handleUpgrade(req, socket, head, (ws) => {
        bumperCarsWss.emit('connection', ws, req);
      });
    }).catch((error) => {
      console.error('Failed to check maintenance mode for the bumper cars socket:', error);
      socket.destroy();
    });
    return;
  }
  if (pathname === '/ws') {
    void Promise.all([isMaintenanceActive(), getSiteAvailabilitySettings()]).then(([active, availability]) => {
      if (active || !availability.config.sections.games) {
        socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    }).catch((error) => {
      console.error('Failed to check maintenance mode for game socket:', error);
      socket.destroy();
    });
    return;
  }
  // Non-/ws upgrades (e.g. Next dev HMR) must reach Next or hot reload dies.
  void handleUpgrade(req, socket, head);
});

server.listen(port, hostname, () => {
  console.log(`> Arcade ready on http://${hostname}:${port} (game ws on /ws)`);
});

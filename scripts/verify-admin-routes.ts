/**
 * Every admin route goes through withAdmin, and every one turns away a visitor
 * who is not an admin.
 *
 *   npm run test:admin-routes                      static check only
 *   QA_BASE_URL=http://127.0.0.1:3000 npm run test:admin-routes   static, then live
 *
 * Static: walks src/app/api/admin and src/app/api/account/admin, plus the
 * dev grant-items route; every exported HTTP method must be
 * `export const METHOD = withAdmin(`. Also checks that src/app/admin/layout.tsx
 * calls requireAdminPage.
 *
 * Live (when QA_BASE_URL is set): for each route and method, with dynamic
 * segments filled by a zero UUID, no cookie must give 401 and a signed-in plain
 * player must give 403. Then each page under src/app/admin, opened as that
 * player, must end up outside /admin. The player is QA_PLAYER_EMAIL and
 * QA_PLAYER_PASSWORD (default radm-player@example.com / RadmPlayer!2026) and is
 * registered through /api/account/register if it does not exist.
 *
 * Prints one line per check and a total. Exits 1 on any failure.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ZERO_ID = '00000000-0000-0000-0000-000000000000';
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ROUTE_DIRS = ['src/app/api/admin', 'src/app/api/account/admin'];
// An admin-only route that lives outside those folders. The other dev tools
// are open to any signed-in player in development and refuse in production.
const EXTRA_ROUTE_FILES = ['src/app/api/devtools/grant-items/route.ts'];

type RouteMethod = { file: string; url: string; method: string };

let checks = 0;
let failures = 0;
const pass = (name: string) => {
  checks += 1;
  console.log(`ok    ${name}`);
};
const fail = (name: string, why: string) => {
  checks += 1;
  failures += 1;
  console.log(`FAIL  ${name}: ${why}`);
};

function walk(dir: string, name: string): string[] {
  const full = path.join(root, dir);
  if (!existsSync(full)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(rel, name));
    else if (entry.name === name) found.push(rel);
  }
  return found.sort();
}

const urlFor = (file: string, tail: string) =>
  `/${path
    .dirname(file)
    .split(path.sep)
    .slice(2)
    .join('/')}`
    .replace(/\[\.\.\.[^\]]+\]|\[[^\]]+\]/g, ZERO_ID)
    .replace(/\/$/, '') + tail;

// ── Static ───────────────────────────────────────────────────────────────────

function staticChecks(): RouteMethod[] {
  const found: RouteMethod[] = [];
  const files = [...ROUTE_DIRS.flatMap((dir) => walk(dir, 'route.ts')), ...EXTRA_ROUTE_FILES];
  for (const file of files) {
    const text = readFileSync(path.join(root, file), 'utf8');
    const methods = new Set<string>();
    for (const method of METHODS) {
      const declared = new RegExp(
        `export\\s+(?:async\\s+)?(?:function|const|let|var)\\s+${method}\\b|export\\s*\\{[^}]*\\b${method}\\b[^}]*\\}`,
      );
      if (declared.test(text)) methods.add(method);
    }
    if (methods.size === 0) {
      fail(`${file}`, 'exports no HTTP method');
      continue;
    }
    for (const method of methods) {
      const guarded = new RegExp(`export\\s+const\\s+${method}\\s*=\\s*withAdmin\\s*(?:<[^>(]*>)?\\s*\\(`);
      if (guarded.test(text)) {
        pass(`${file} ${method} uses withAdmin`);
        found.push({ file, url: urlFor(file, ''), method });
      } else {
        fail(`${file} ${method}`, 'is not `export const ' + method + ' = withAdmin(`');
      }
    }
  }
  const layout = path.join(root, 'src/app/admin/layout.tsx');
  if (existsSync(layout) && /requireAdminPage\s*\(/.test(readFileSync(layout, 'utf8'))) {
    pass('src/app/admin/layout.tsx calls requireAdminPage');
  } else {
    fail('src/app/admin/layout.tsx', 'does not call requireAdminPage');
  }
  return found;
}

// ── Live ─────────────────────────────────────────────────────────────────────

function cookieFrom(response: Response) {
  return response.headers
    .getSetCookie()
    .map((line) => line.split(';')[0])
    .filter(Boolean)
    .join('; ');
}

async function signIn(base: string, email: string, password: string) {
  const attempt = () =>
    fetch(`${base}/api/account/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ emailOrUsername: email, password }),
    });
  let response = await attempt();
  if (!response.ok) {
    const username = email.split('@')[0]!.replace(/[^a-z0-9-]/gi, '').slice(0, 20);
    const registered = await fetch(`${base}/api/account/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, username, password }),
    });
    if (!registered.ok) throw new Error(`could not register ${email}: HTTP ${registered.status}`);
    response = await attempt();
  }
  if (!response.ok) throw new Error(`could not sign in as ${email}: HTTP ${response.status}`);
  const cookie = cookieFrom(response);
  if (!cookie) throw new Error(`no session cookie for ${email}`);
  return cookie;
}

async function call(base: string, route: RouteMethod, cookie: string | null) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  const init: RequestInit = { method: route.method, headers, redirect: 'manual' };
  if (WRITE.has(route.method)) {
    headers['content-type'] = 'application/json';
    init.body = '{}';
  }
  return fetch(base + route.url, init);
}

async function liveChecks(base: string, routes: RouteMethod[]) {
  const email = process.env.QA_PLAYER_EMAIL ?? 'radm-player@example.com';
  const password = process.env.QA_PLAYER_PASSWORD ?? 'RadmPlayer!2026';
  for (const route of routes) {
    const label = `${route.method} ${route.url}`;
    const anonymous = await call(base, route, null);
    if (anonymous.status === 401) pass(`${label} signed out gives 401`);
    else fail(`${label} signed out`, `expected 401, got ${anonymous.status}`);
  }
  const cookie = await signIn(base, email, password);
  for (const route of routes) {
    const label = `${route.method} ${route.url}`;
    const response = await call(base, route, cookie);
    if (response.status === 403) pass(`${label} as a player gives 403`);
    else fail(`${label} as a player`, `expected 403, got ${response.status}`);
  }
  const pages = walk('src/app/admin', 'page.tsx');
  for (const file of pages) {
    const url = urlFor(file, '');
    const response = await fetch(`${base}${url || '/'}`, { headers: { cookie }, redirect: 'follow' });
    const finalPath = new URL(response.url).pathname;
    if (finalPath === '/admin' || finalPath.startsWith('/admin/')) {
      fail(`page ${url}`, `a player ended up at ${finalPath}`);
    } else {
      pass(`page ${url} sends a player to ${finalPath}`);
    }
  }
}

const routes = staticChecks();
const base = process.env.QA_BASE_URL?.replace(/\/$/, '');
if (base) {
  try {
    await liveChecks(base, routes);
  } catch (error) {
    fail('live checks', error instanceof Error ? error.message : String(error));
  }
} else {
  console.log('skip  live checks (QA_BASE_URL is not set)');
}

console.log(`\n${checks - failures} of ${checks} checks passed.`);
process.exit(failures > 0 ? 1 : 0);

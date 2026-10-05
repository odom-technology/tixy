/**
 * Checks every arcade theme (src/features/arcade/lib/arcade-themes.ts):
 *
 * - Contrast. Every text pair a scheme creates clears 4.5:1; control edges,
 *   the focus ring and the red dot clear 3:1 (WCAG 1.4.3 and 1.4.11). The
 *   pairs inside a cabinet are checked against the cabinet palette, which
 *   every scheme keeps.
 * - Sync. globals.css declares the same token values as the definitions:
 *   the default palette in the `:root` brand block and in the cabinet
 *   reset, and each scheme in its `:root[data-tixy-scheme='<id>']` block.
 * - Boardwalk's own Midway text tokens on its own grounds.
 *
 *   npm run test:themes
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ARCADE_THEMES,
  TIXY_DEFAULT_TOKENS,
  arcadeThemeScheme,
  type TixySchemeTokens,
} from '../src/features/arcade/lib/arcade-themes';

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

/* ── colour maths ─────────────────────────────────────────────────── */

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c: number[]) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
/** `top` at `alpha` over `ground`. */
const over = (top: string, ground: string, alpha: number) =>
  toHex(rgb(top).map((v, i) => v * alpha + rgb(ground)[i] * (1 - alpha)));
const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/* The cabinet: its tones and text never change with the scheme. */
const CABINET = {
  rail: '#2b2119',
  screen: '#2a231d',
  'screen-2': '#3a3029',
  paper: TIXY_DEFAULT_TOKENS.paper,
  'on-ink-2': '#c9c1b4',
  'on-ink-3': '#b0a89d',
  'on-ink-red': '#dd9484',
  ticket: TIXY_DEFAULT_TOKENS.ticket,
};

type Pair = { fg: string; bg: string; use: string; min: number };

/** The pairs a tixy palette puts on the floor (outside any cabinet). */
function floorPairs(t: TixySchemeTokens): Pair[] {
  const youRow = over(t.ticket, t['paper-3'], 0.3);
  const text = 4.5;
  const ui = 3;
  return [
    { fg: 'ink', bg: 'paper', use: 'body text', min: text },
    { fg: 'ink', bg: 'paper-2', use: 'text on a panel', min: text },
    { fg: 'ink', bg: 'paper-3', use: 'text on a row, secondary button', min: text },
    { fg: 'ink-2', bg: 'paper', use: 'muted text', min: text },
    { fg: 'ink-2', bg: 'paper-2', use: 'muted text on a panel', min: text },
    { fg: 'ink-2', bg: 'paper-3', use: 'muted text on a row', min: text },
    { fg: 'ink-3', bg: 'paper', use: 'faint text', min: text },
    { fg: 'ink-3', bg: 'paper-2', use: 'faint text on a panel', min: text },
    { fg: 'red', bg: 'paper', use: 'red text on the ground', min: text },
    { fg: 'red-text', bg: 'paper', use: 'danger text', min: text },
    { fg: 'red-text', bg: 'paper-2', use: 'danger text on a panel', min: text },
    { fg: 'red-text', bg: 'paper-3', use: 'danger text on a row', min: text },
    { fg: 'paper', bg: 'ink', use: 'primary button, active segment', min: text },
    { fg: 'on-ticket', bg: 'ticket', use: 'ticket stub, price', min: text },
    { fg: 'on-red', bg: 'red', use: 'red button, your turn', min: text },
    { fg: 'ink', bg: `you-row ${youRow}`, use: 'your row (ticket 30% on paper 3)', min: text },
    { fg: 'ink-3', bg: 'paper', use: 'control edge', min: ui },
    { fg: 'ink-3', bg: 'paper-2', use: 'control edge on a panel', min: ui },
    { fg: 'ink-3', bg: 'paper-3', use: 'control edge on a row', min: ui },
    { fg: 'ink', bg: 'paper-3', use: 'focus ring', min: ui },
    { fg: 'red', bg: 'paper-2', use: 'the dot on a panel', min: ui },
  ];
}

/** Pairs inside a cabinet: the cabinet palette on this scheme's cabinet. */
function cabinetPairs(): Pair[] {
  return [
    { fg: 'paper', bg: 'cabinet', use: 'text on the cabinet', min: 4.5 },
    { fg: 'on-ink-2', bg: 'cabinet', use: 'muted text on the cabinet', min: 4.5 },
    { fg: 'on-ink-3', bg: 'cabinet', use: 'faint text on the cabinet', min: 4.5 },
    { fg: 'ticket', bg: 'cabinet', use: 'tickets on the cabinet', min: 4.5 },
    { fg: 'on-ink-red', bg: 'cabinet', use: 'red text on the cabinet', min: 4.5 },
    { fg: 'paper', bg: 'screen-2', use: 'text on a screen key', min: 4.5 },
    { fg: 'on-ink-2', bg: 'screen-2', use: 'muted text on a screen key', min: 4.5 },
    { fg: 'on-ink-3', bg: 'screen-2', use: 'faint text on a screen key', min: 4.5 },
    { fg: 'on-ink-red', bg: 'screen-2', use: 'red text on a screen key', min: 4.5 },
    { fg: 'ticket', bg: 'screen', use: 'tickets on the screen', min: 4.5 },
    { fg: 'paper', bg: 'rail', use: 'text on the rail', min: 4.5 },
  ];
}

/* Pairs nobody draws, printed for reference only. */
function referencePairs(): Pair[] {
  return [
    { fg: 'ticket', bg: 'paper', use: 'a stub as a shape on the ground (its text carries it)', min: 0 },
    { fg: 'cabinet', bg: 'paper', use: 'a cabinet on the ground', min: 0 },
    { fg: 'ink-3', bg: 'paper-3', use: 'faint text on a row (not used; ink 2 there)', min: 0 },
  ];
}

/* ── css parsing ──────────────────────────────────────────────────── */

/** The --tixy-* declarations of the first rule whose selector starts with
    `selector` and that declares any. */
function block(selector: string): Record<string, string> | null {
  for (let at = css.indexOf(selector); at >= 0; at = css.indexOf(selector, at + 1)) {
    const next = css[at + selector.length];
    if (next !== ' ' && next !== ',' && next !== '{') continue;
    const open = css.indexOf('{', at);
    const close = css.indexOf('}', open);
    const body = css.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, '');
    const out: Record<string, string> = {};
    for (const [, name, value] of body.matchAll(/--tixy-([a-z0-9-]+):\s*([^;]+);/g)) {
      out[name] = value.trim().toLowerCase();
    }
    if (Object.keys(out).length) return out;
  }
  return null;
}

/* ── run ──────────────────────────────────────────────────────────── */

let failures = 0;
const lines: string[] = [];
const fail = (message: string) => {
  failures += 1;
  lines.push(`FAIL  ${message}`);
};

function checkPairs(label: string, pairs: Pair[], colours: Record<string, string>) {
  lines.push(`\n${label}`);
  for (const pair of pairs) {
    const [bgName, bgValue] = pair.bg.split(' ');
    const fg = colours[pair.fg];
    const bg = bgValue ?? colours[bgName];
    if (!fg || !bg) {
      fail(`${label}: no colour for ${pair.fg} or ${pair.bg}`);
      continue;
    }
    const r = contrast(fg, bg);
    const ok = r >= pair.min;
    if (!ok) failures += 1;
    const min = pair.min ? `${pair.min}`.padStart(3) : '  -';
    lines.push(
      `${ok ? '    ' : 'FAIL'}  ${pair.fg.padEnd(9)} on ${bgName.padEnd(8)} ${r.toFixed(2).padStart(5)}:1  min ${min}  ${pair.use}`,
    );
  }
}

for (const theme of ARCADE_THEMES) {
  const t = theme.tokens;
  checkPairs(`${theme.id} (${theme.label}), floor`, floorPairs(t), t);
  checkPairs(`${theme.id}, inside a cabinet`, cabinetPairs(), { ...CABINET, cabinet: t.cabinet });
  checkPairs(`${theme.id}, reference only`, referencePairs(), t);

  // Sync with globals.css.
  const scheme = arcadeThemeScheme(theme.id);
  const declared = scheme ? block(`:root[data-tixy-scheme='${scheme}']`) : block(':root');
  if (!declared) {
    fail(`${theme.id}: no token block in globals.css`);
    continue;
  }
  for (const [name, value] of Object.entries(t)) {
    if (declared[name] !== value.toLowerCase()) {
      fail(`${theme.id}: globals.css has --tixy-${name}: ${declared[name] ?? '(missing)'}, the definition says ${value}`);
    }
  }
}

// The cabinet reset puts the default palette back inside cabinets.
const reset = block(':root[data-tixy-scheme] :is(.arc-stage');
if (!reset) {
  fail('globals.css has no cabinet reset block (:root[data-tixy-scheme] :is(.arc-stage, ...))');
} else {
  for (const [name, value] of Object.entries(TIXY_DEFAULT_TOKENS)) {
    if (name === 'cabinet') continue;
    if (reset[name] !== value) fail(`cabinet reset: --tixy-${name} is ${reset[name] ?? '(missing)'}, should be ${value}`);
  }
}

// Boardwalk's Midway text tokens on its own grounds.
{
  const midway: Record<string, string> = {};
  const rootAt = css.indexOf(':root {');
  const body = css.slice(rootAt, css.indexOf('}', rootAt));
  for (const [, name, value] of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)) {
    midway[name] = value.toLowerCase();
  }
  const pairs: Pair[] = [];
  for (const fg of ['text-strong', 'text-body', 'text-muted']) {
    for (const bg of ['bg', 'surface-panel', 'surface-raised', 'surface-well']) {
      pairs.push({ fg, bg, use: 'Midway text', min: 4.5 });
    }
  }
  for (const bg of ['bg', 'surface-panel', 'surface-raised']) {
    pairs.push({ fg: 'text-faint', bg, use: 'Midway labels and meta', min: 4.5 });
  }
  pairs.push(
    { fg: 'key-face-on', bg: 'key-face', use: 'the cream key', min: 4.5 },
    { fg: 'enamel-primary-on', bg: 'enamel-primary', use: 'red enamel button', min: 4.5 },
    { fg: 'enamel-tickets-on', bg: 'enamel-tickets', use: 'ticket stub', min: 4.5 },
    { fg: 'enamel-primary-text', bg: 'surface-panel', use: 'red text on a panel', min: 4.5 },
    { fg: 'enamel-tickets-text', bg: 'surface-panel', use: 'ticket text on a panel', min: 4.5 },
  );
  checkPairs('boardwalk, Midway tokens', pairs, midway);
}

console.log(lines.join('\n'));
console.log(failures ? `\n${failures} failure(s)` : `\nall ${ARCADE_THEMES.length} themes pass`);
process.exit(failures ? 1 : 0);

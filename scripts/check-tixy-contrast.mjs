#!/usr/bin/env node
/**
 * Checks every text colour the `tixy` theme puts on a ground against
 * WCAG 4.5:1, and control edges against 3:1 (WCAG 1.4.11). Colours are
 * read from the --tixy-* tokens in src/app/globals.css, so a token
 * change is checked as it lands. Pairs listed under "never used" are
 * printed for reference and don't fail the run.
 *
 *   node scripts/check-tixy-contrast.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'src/app/globals.css'), 'utf8');

const tokens = {};
for (const [, name, hex] of css.matchAll(/--tixy-([a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)) {
  tokens[name] ??= hex.toLowerCase();
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, weightA) => toHex(rgb(a).map((v, i) => v * weightA + rgb(b)[i] * (1 - weightA)));
const channel = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const [r, g, b] = rgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const t = (name) => {
  if (!tokens[name]) throw new Error(`--tixy-${name} is not defined in globals.css`);
  return tokens[name];
};
const youRow = mix(t('ticket'), t('paper-3'), 0.3);

// [scope, use, text token, ground name, ground colour, minimum]
const pairs = [
  ['paper', 'text-strong, text-body', 'ink', 'paper', t('paper')],
  ['paper', 'text-strong, text-body', 'ink', 'paper-2', t('paper-2')],
  ['paper', 'text-strong, text-body', 'ink', 'paper-3', t('paper-3')],
  ['paper', 'text-muted, text-faint', 'ink-2', 'paper', t('paper')],
  ['paper', 'text-muted, text-faint', 'ink-2', 'paper-2', t('paper-2')],
  ['paper', 'text-muted, text-faint', 'ink-2', 'paper-3', t('paper-3')],
  ['paper', 'ink 3 (named token only)', 'ink-3', 'paper', t('paper')],
  ['paper', 'ink 3 (named token only)', 'ink-3', 'paper-2', t('paper-2')],
  ['paper', 'red text on paper', 'red', 'paper', t('paper')],
  ['paper', 'danger-text', 'red-text', 'paper', t('paper')],
  ['paper', 'danger-text', 'red-text', 'paper-2', t('paper-2')],
  ['paper', 'danger-text', 'red-text', 'paper-3', t('paper-3')],
  ['paper', 'primary-on, active segment', 'paper', 'ink', t('ink')],
  ['paper', 'key-face-on, info-on', 'ink', 'paper-3', t('paper-3')],
  ['paper', 'tickets-on, prize-on', 'ink', 'ticket', t('ticket')],
  ['paper', 'danger-on', 'paper', 'red', t('red')],
  ['paper', 'your row (ticket 30% on paper 3)', 'ink', 'you-row', youRow],
  ['ink', 'text-strong, text-body', 'paper', 'ink', t('ink')],
  ['ink', 'text-strong, text-body', 'paper', 'rail', t('rail')],
  ['ink', 'text-strong, text-body', 'paper', 'screen', t('screen')],
  ['ink', 'text-strong, key-face-on', 'paper', 'screen-2', t('screen-2')],
  ['ink', 'text-muted, info-text', 'on-ink-2', 'rail', t('rail')],
  ['ink', 'text-muted, info-text', 'on-ink-2', 'screen', t('screen')],
  ['ink', 'text-muted, info-text', 'on-ink-2', 'screen-2', t('screen-2')],
  ['ink', 'text-faint', 'on-ink-3', 'rail', t('rail')],
  ['ink', 'text-faint', 'on-ink-3', 'screen', t('screen')],
  ['ink', 'text-faint', 'on-ink-3', 'screen-2', t('screen-2')],
  ['ink', 'tickets-text, prize-text', 'ticket', 'ink', t('ink')],
  ['ink', 'tickets-text, prize-text', 'ticket', 'rail', t('rail')],
  ['ink', 'tickets-text, prize-text', 'ticket', 'screen', t('screen')],
  ['ink', 'tickets-text, prize-text', 'ticket', 'screen-2', t('screen-2')],
  ['ink', 'danger-text', 'on-ink-red', 'rail', t('rail')],
  ['ink', 'danger-text', 'on-ink-red', 'screen', t('screen')],
  ['ink', 'danger-text', 'on-ink-red', 'screen-2', t('screen-2')],
  ['ink', 'primary-on (paper button)', 'ink', 'paper', t('paper')],
  ['paper', 'border-control (input, switch edge)', 'ink-3', 'paper', t('paper'), 3],
  ['paper', 'border-control (input, switch edge)', 'ink-3', 'paper-2', t('paper-2'), 3],
  ['paper', 'border-control (input, switch edge)', 'ink-3', 'paper-3', t('paper-3'), 3],
  ['ink', 'border-control (input, switch edge)', 'on-ink-3', 'screen', t('screen'), 3],
  ['ink', 'border-control (input, switch edge)', 'on-ink-3', 'screen-2', t('screen-2'), 3],
  ['ink', 'focus ring', 'paper', 'screen-2', t('screen-2'), 3],
  ['paper', 'focus ring', 'ink', 'paper-3', t('paper-3'), 3],
];

// Pairs the theme never creates. Muted text never sits on ticket: text on
// a ticket fill is always ink (tickets-on, prize-on).
const neverUsed = [
  ['paper', 'muted text on ticket', 'ink-2', 'ticket', t('ticket')],
];

const row = (scope, fg, groundName, r, min, note) =>
  `${scope.padEnd(6)} ${fg.padEnd(13)} ${groundName.padEnd(10)} ${r.toFixed(2).padStart(5)}:1 ${String(min).padStart(3)}  ${note}`;

let failed = 0;
console.log('scope  colour        ground     ratio   min  use');
for (const [scope, use, fg, groundName, ground, min = 4.5] of pairs) {
  const r = ratio(t(fg), ground);
  const ok = r >= min;
  if (!ok) failed += 1;
  console.log(row(scope, fg, groundName, r, min, `${ok ? '' : 'FAIL '}${use}`));
}
console.log('\nnever used, for reference');
for (const [scope, use, fg, groundName, ground] of neverUsed) {
  const r = ratio(t(fg), ground);
  console.log(row(scope, fg, groundName, r, 4.5, `${r >= 4.5 ? '' : 'under 4.5 '}${use}`));
}
console.log(failed ? `\n${failed} of ${pairs.length} pairs under their minimum` : `\nall ${pairs.length} pairs pass`);
process.exit(failed ? 1 : 0);

import 'server-only';

/* The player card (docs/design/tixy-rebrand/PROFILES.md): one 1200 x 630
   image a player can drop anywhere, also the profile's Open Graph image.
   Borrowed from Hunter's Hatchdle and Aimperion cards: a plain model of only
   public facts, a hash of that model as the ETag and the `v` on the URL, so
   a card is drawn once per change and every share link stays current.

   Drawn with next/og (satori and resvg). Satori reads static TTFs only, so
   public/fonts/card holds static cuts of the two tixy faces made from the
   variable woff2 files (Gabarito 800 and 600, Big Shoulders 800 at the
   display size). Art comes from public/ as data URIs; an avatar that is not
   a local file falls back to the initial, so the card never fetches. */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ImageResponse } from 'next/og';

import type { ProfileView } from '@/server/arcade/player-profile-view';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
/** Bump when the drawing changes, so every card URL and ETag moves with it. */
const CARD_DESIGN = 1;

const C = {
  paper: '#F4EBDC',
  paper2: '#EADFCB',
  paper3: '#DED0B7',
  ink: '#1F1A16',
  ink2: '#54483D',
  ink3: '#6B5E51',
  ticket: '#F2A33C',
  amberDark: '#C47B1E',
  onInk2: '#C9C1B4',
  rail: '#2B2119',
};

export type PlayerCardModel = {
  name: string;
  title: string | null;
  level: number;
  /** Local art paths under public/. */
  avatar: string | null;
  frame: string | null;
  namecard: string | null;
  nameColor: string | null;
  featured: { game: string; value: number; label: string; rank: number | null; of: number | null } | null;
  season: { name: string; tier: number; maxTier: number } | null;
  achievements: { unlocked: number; total: number };
  playedMs: number;
  games: number;
  /** "tixy.lol/u/name", for the foot of the card. */
  url: string;
};

const SAFE_PUBLIC_PATH = /^\/(?:art|cosmetics)\/[a-zA-Z0-9/_-]+\.(?:svg|png|jpe?g)$/;

const hostOf = (origin: string) => {
  try {
    return new URL(origin).host;
  } catch {
    return 'tixy.lol';
  }
};

/* A namecard equipped as a plain background (the season card's prizes are,
   and older banners) arrives as CSS: take its image if it is a local file. */
function backgroundImage(background: string | null) {
  const url = background?.match(/url\('([^']+)'\)/)?.[1] ?? null;
  return url && SAFE_PUBLIC_PATH.test(url) ? url : null;
}

/** Only public facts: the same ones the public profile shows. */
export function playerCardModel(view: ProfileView, origin: string): PlayerCardModel {
  const avatar = view.account.imageUrl && SAFE_PUBLIC_PATH.test(view.account.imageUrl) ? view.account.imageUrl : null;
  const featured = view.featured;
  const nameColor = view.flair.nameColor ?? (view.details.accentColor || null);
  return {
    name: view.name,
    title: view.flair.title,
    level: view.level.level,
    avatar,
    frame: view.flair.frameArt ? `/art/frames/frame-${view.flair.frameArt}.svg` : null,
    namecard: view.flair.namecardArt ? `/art/namecards/namecard-${view.flair.namecardArt}.svg` : backgroundImage(view.flair.background),
    nameColor: nameColor && /^#[0-9a-fA-F]{6}$/.test(nameColor) ? nameColor : null,
    featured: featured
      ? {
          game: featured.name,
          value: featured.value,
          label: featured.label,
          rank: featured.rank?.rank ?? null,
          of: featured.rank?.of ?? null,
        }
      : null,
    season: view.data.season
      ? { name: view.data.season.name, tier: view.data.season.tier, maxTier: view.data.season.maxTier }
      : null,
    achievements: { unlocked: view.achievements.unlocked, total: view.achievements.total },
    playedMs: view.data.summary.totalMs,
    games: view.data.summary.gamesPlayed,
    url: `${hostOf(origin)}${view.href}`,
  };
}

export function playerCardHash(model: PlayerCardModel) {
  return createHash('sha256').update(`${CARD_DESIGN}:${JSON.stringify(model)}`).digest('hex').slice(0, 16);
}

/* ── files, read once per process ─────────────────────────────────────── */

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const files = new Map<string, Promise<Buffer | null>>();

function publicFile(relative: string): Promise<Buffer | null> {
  let pending = files.get(relative);
  if (!pending) {
    const full = path.join(PUBLIC_DIR, relative);
    pending = full.startsWith(PUBLIC_DIR + path.sep) ? readFile(full).catch(() => null) : Promise.resolve(null);
    files.set(relative, pending);
  }
  return pending;
}

const MIME: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

async function dataUri(relative: string | null): Promise<string | null> {
  if (!relative) return null;
  const bytes = await publicFile(relative);
  const ext = relative.split('.').pop() ?? '';
  return bytes && MIME[ext] ? `data:${MIME[ext]};base64,${bytes.toString('base64')}` : null;
}

async function fonts() {
  const [gabarito800, gabarito600, bigShoulders] = await Promise.all([
    publicFile('fonts/card/gabarito-800.ttf'),
    publicFile('fonts/card/gabarito-600.ttf'),
    publicFile('fonts/card/big-shoulders-800.ttf'),
  ]);
  if (!gabarito800 || !gabarito600 || !bigShoulders) throw new Error('player card fonts are missing');
  return [
    { name: 'Gabarito', data: gabarito800, weight: 800 as const, style: 'normal' as const },
    { name: 'Gabarito', data: gabarito600, weight: 600 as const, style: 'normal' as const },
    { name: 'Big Shoulders', data: bigShoulders, weight: 800 as const, style: 'normal' as const },
  ];
}

/* ── the drawing ───────────────────────────────────────────────────────── */

const formatNumber = (value: number) => new Intl.NumberFormat('en-US').format(Math.round(value));

function hours(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return { value: String(minutes), unit: 'min' };
  return { value: (Math.round(ms / 360_000) / 10).toFixed(1), unit: 'h' };
}

function suffix(n: number) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return 'th';
  return ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
}

/* The name is set as large as it fits on one line: Gabarito 800 averages
   about 0.58 em per character for these names. */
function nameSize(name: string, width: number) {
  return Math.max(44, Math.min(84, Math.floor(width / (Math.max(name.length, 4) * 0.58))));
}

async function drawPlayerCard(model: PlayerCardModel, scale: 1 | 2): Promise<ImageResponse> {
  const s = (n: number) => n * scale;
  const [avatar, frame, namecard, logo, fontList] = await Promise.all([
    dataUri(model.avatar),
    dataUri(model.frame),
    dataUri(model.namecard),
    dataUri('/brand/tixy/logo.svg'),
    fonts(),
  ]);

  const stats: { label: string; value: string; unit?: string }[] = [
    { label: 'achievements', value: formatNumber(model.achievements.unlocked), unit: `of ${formatNumber(model.achievements.total)}` },
  ];
  if (model.featured && model.season) {
    stats.push({ label: `${model.season.name} tier`, value: String(model.season.tier), unit: `of ${model.season.maxTier}` });
  }
  const time = hours(model.playedMs);
  stats.push({ label: 'on the floor', value: time.value, unit: time.unit });
  stats.push({ label: 'games played', value: formatNumber(model.games) });

  const nameWidth = 1200 - 300 - 64 - 236;
  const size = nameSize(model.name, nameWidth);
  const text = { display: 'flex', fontFamily: 'Gabarito' } as const;
  const num = { display: 'flex', fontFamily: 'Big Shoulders', fontWeight: 800 } as const;

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          position: 'relative',
          width: s(CARD_WIDTH),
          height: s(CARD_HEIGHT),
          background: C.paper,
          color: C.ink,
          fontFamily: 'Gabarito',
        }}
      >
        {/* The band: the namecard, or paper 3. */}
        <div style={{ display: 'flex', position: 'absolute', left: 0, top: 0, width: s(1200), height: s(176), background: C.paper3, overflow: 'hidden' }}>
          {namecard ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={namecard} width={s(1200)} height={s(300)} style={{ objectFit: 'cover', objectPosition: 'left top' }} alt='' />
          ) : null}
        </div>

        {/* The avatar, on a paper ring over the band. */}
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            left: s(56),
            top: s(84),
            width: s(216),
            height: s(216),
            borderRadius: s(108),
            background: C.paper,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              display: 'flex',
              position: 'relative',
              width: s(196),
              height: s(196),
              borderRadius: s(98),
              background: C.paper2,
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} width={s(196)} height={s(196)} alt='' />
            ) : (
              <span style={{ ...text, fontSize: s(96), fontWeight: 800 }}>{model.name.slice(0, 1).toLowerCase()}</span>
            )}
          </div>
          {frame ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={frame} width={s(196)} height={s(196)} style={{ position: 'absolute', left: s(10), top: s(10) }} alt='' />
          ) : null}
        </div>

        {/* The name and title. */}
        <div style={{ display: 'flex', flexDirection: 'column', position: 'absolute', left: s(300), top: s(184), width: s(nameWidth) }}>
          <span
            style={{
              ...text,
              fontSize: s(size),
              fontWeight: 800,
              letterSpacing: -0.02 * s(size),
              lineHeight: 1,
              color: model.nameColor ?? C.ink,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {model.name}
          </span>
          {model.title ? (
            <span style={{ ...text, marginTop: s(10), fontSize: s(30), fontWeight: 600, color: C.ink2, lineHeight: 1.1 }}>{model.title}</span>
          ) : null}
        </div>

        {/* The level badge: an ink disc, an amber rim, the number. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            position: 'absolute',
            right: s(64),
            top: s(188),
          }}
        >
          <span style={{ ...text, marginRight: s(14), fontSize: s(28), fontWeight: 600, color: C.ink2 }}>level</span>
          <div
            style={{
              display: 'flex',
              width: s(124),
              height: s(124),
              borderRadius: s(62),
              background: C.ink,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                display: 'flex',
                width: s(108),
                height: s(108),
                borderRadius: s(54),
                border: `${s(8)}px solid ${model.level >= 20 ? C.paper3 : C.amberDark}`,
                background: model.level >= 20 ? C.paper : C.paper2,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ ...num, fontSize: s(String(model.level).length > 2 ? 46 : 58), lineHeight: 1, color: C.ink }}>{model.level}</span>
            </div>
          </div>
        </div>

        {/* The lead: the featured score, or the season. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            position: 'absolute',
            left: s(64),
            top: s(330),
            width: s(560),
            height: s(220),
            padding: `0 ${s(36)}px`,
            borderRadius: s(22),
            background: C.ink,
            color: C.paper,
          }}
        >
          {model.featured ? (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ ...text, fontSize: s(32), fontWeight: 800, lineHeight: 1.1 }}>{model.featured.game}</span>
              <div style={{ display: 'flex', alignItems: 'flex-end', marginTop: s(4) }}>
                <span style={{ ...num, fontSize: s(112), lineHeight: 0.95, color: C.ticket }}>{formatNumber(model.featured.value)}</span>
                <span style={{ ...text, fontSize: s(28), fontWeight: 600, color: C.onInk2, marginLeft: s(14), marginBottom: s(12) }}>
                  {model.featured.label}
                </span>
              </div>
              {model.featured.rank && model.featured.of ? (
                <span style={{ ...text, fontSize: s(24), fontWeight: 600, color: C.onInk2, marginTop: s(6) }}>
                  {`${model.featured.rank}${suffix(model.featured.rank)} of ${formatNumber(model.featured.of)} on the board`}
                </span>
              ) : null}
            </div>
          ) : model.season ? (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ ...text, fontSize: s(32), fontWeight: 800, lineHeight: 1.1 }}>{model.season.name}</span>
              <div style={{ display: 'flex', alignItems: 'flex-end', marginTop: s(4) }}>
                <span style={{ ...text, fontSize: s(32), fontWeight: 600, color: C.onInk2, marginRight: s(14), marginBottom: s(14) }}>tier</span>
                <span style={{ ...num, fontSize: s(112), lineHeight: 0.95, color: C.ticket }}>{model.season.tier}</span>
                <span style={{ ...text, fontSize: s(28), fontWeight: 600, color: C.onInk2, marginLeft: s(14), marginBottom: s(14) }}>
                  {`of ${model.season.maxTier}`}
                </span>
              </div>
            </div>
          ) : (
            <span style={{ ...text, fontSize: s(32), fontWeight: 800 }}>{model.url}</span>
          )}
        </div>

        {/* Three numbers, on paper 2. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            position: 'absolute',
            left: s(648),
            top: s(330),
            width: s(488),
            height: s(220),
            borderRadius: s(22),
            background: C.paper2,
            padding: `${s(10)}px ${s(28)}px`,
            justifyContent: 'space-around',
          }}
        >
          {stats.slice(0, 3).map((stat) => (
            <div key={stat.label} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <span style={{ ...text, fontSize: s(26), fontWeight: 600, color: C.ink2 }}>{stat.label}</span>
              <div style={{ display: 'flex', alignItems: 'baseline' }}>
                <span style={{ ...num, fontSize: s(54), lineHeight: 1 }}>{stat.value}</span>
                {stat.unit ? (
                  <span style={{ ...text, fontSize: s(24), fontWeight: 600, color: C.ink3, marginLeft: s(8) }}>{stat.unit}</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {/* The foot: the mark and the address. */}
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            left: s(64),
            right: s(64),
            bottom: s(26),
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} width={s(170)} height={s(38)} alt='' />
          ) : (
            <span style={{ ...text, fontSize: s(30), fontWeight: 800 }}>tixy.lol</span>
          )}
          <span style={{ ...text, fontSize: s(24), fontWeight: 600, color: C.ink3 }}>{model.url}</span>
        </div>
      </div>
    ),
    {
      width: s(CARD_WIDTH),
      height: s(CARD_HEIGHT),
      fonts: fontList,
    },
  );
}

/* next/og hands satori's SVG to sharp when sharp is installed, and Next's
   image optimizer blocks sharp's SVG loader for the whole process the first
   time it runs (a libvips setting, so it reaches every copy of sharp). After
   that every card fails with "unsupported image format". So the SVG loader
   is opened for the length of a draw, only for buffers, and closed again
   when the last draw in flight ends. The optimizer refuses SVG sources
   before they reach sharp, so the block is a second lock, not the only one. */
type SharpBlock = { block: (o: { operation: string[] }) => void; unblock: (o: { operation: string[] }) => void };
const SVG_BUFFER_LOADER = { operation: ['VipsForeignLoadSvgBuffer'] };
let sharpModule: Promise<SharpBlock | null> | null = null;
let drawsInFlight = 0;

function loadSharp() {
  sharpModule ??= import(/* webpackIgnore: true */ 'sharp' as string)
    .then((mod: { default?: SharpBlock }) => mod.default ?? null)
    .catch(() => null);
  return sharpModule;
}

/** The card as PNG bytes. */
export async function renderPlayerCard(model: PlayerCardModel, scale: 1 | 2 = 1): Promise<ArrayBuffer> {
  const sharp = await loadSharp();
  drawsInFlight += 1;
  sharp?.unblock(SVG_BUFFER_LOADER);
  try {
    const image = await drawPlayerCard(model, scale);
    return await image.arrayBuffer();
  } finally {
    drawsInFlight -= 1;
    if (drawsInFlight === 0) sharp?.block(SVG_BUFFER_LOADER);
  }
}

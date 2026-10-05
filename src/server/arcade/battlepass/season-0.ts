// ───────────────────────────────────────────────────────────────────────────
// The OLD season 0, "Grand Opening" (key `season-0`): free + premium tracks, 32
// tiers of 600 XP, the fixed weekly ladder and the season quests. It was
// replaced by a restart: the live season is the card in season-card.ts, shown as
// "Season 0" under the key `season-0-r2`. Nothing here is the live season.
//
// This file stays because its rows are still in the database (never read for the
// live season), the items it paid are still owned and equippable, and shared
// pieces live here: the participation XP taper, the daily quest counts and the
// QuestTemplate type. Stored keys never change, so `season-0` stays as it is.
// ───────────────────────────────────────────────────────────────────────────

import type { RewardGameType } from '@/features/arcade/lib/rewards';

/** The stored key of the old season 0's progress, claims and quests. Not the live season's key. */
export const SEASON_KEY = 'season-0';
/**
 * When the old season 0 was due to close, 31 October 2026 at 00:00 UTC. Only the
 * retired close job (close-season-0.ts) reads it. The season no longer closes.
 */
export const SEASON_0_END = new Date('2026-10-31T00:00:00.000Z');
export const SEASON_NAME = 'Season 0 · Grand Opening';
export const XP_PER_TIER = 600;
export const MAX_TIER = 32;
/** Daily quests shown per day, and how many individual rerolls a player gets. */
export const DAILY_QUEST_COUNT = 3;
export const DAILY_QUEST_REROLLS = 2;

// ─── Participation XP (battlepass XP that survives the daily ticket cap) ──────
// Season XP from credits is great while you're still earning (1 XP / ticket),
// but drops to 0 once you hit the daily ticket cap. To keep the pass moving for
// people who keep playing — without making the cap meaningless — every game
// also grants a small "participation" XP that TAPERS with each play and is
// itself capped per day. Curve: BASE * DECAY^(gamesToday-1), floored, then
// clamped to the remaining daily participation budget.
// Tuned so a full day of play earns ~1.2 tiers (720 XP) from participation
// alone; stacked with the 3 daily quests (~0.9 tiers) that's ~2.1 tiers/day,
// before any credit XP — i.e. the 2–2.5 tiers/day target.
export const BP_PARTICIPATION_BASE = 60;
export const BP_PARTICIPATION_DECAY = 0.85;
export const BP_PARTICIPATION_FLOOR = 25;
export const BP_PARTICIPATION_DAILY_CAP = 720; // 1.2 × XP_PER_TIER (600)

/** Tapering participation XP for the Nth game of the day (1-indexed). */
export const participationXpForGame = (
  gamesToday: number,
  participationSoFar: number,
): number => {
  if (participationSoFar >= BP_PARTICIPATION_DAILY_CAP) return 0;
  const raw = Math.round(
    BP_PARTICIPATION_BASE * Math.pow(BP_PARTICIPATION_DECAY, Math.max(0, gamesToday - 1)),
  );
  const xp = Math.max(BP_PARTICIPATION_FLOOR, raw);
  return Math.min(xp, BP_PARTICIPATION_DAILY_CAP - participationSoFar);
};

export type SeasonReward =
  | { kind: 'tickets'; amount: number }
  | { kind: 'item'; itemId: string };

export type SeasonTier = {
  tier: number;
  free: SeasonReward;
  premium: SeasonReward;
};

// ─── Exclusive cosmetics (seeded inactive, season_tag = 'season-0') ──────────
// These are only obtainable via the battlepass — `active: false` keeps them out
// of the purchasable store rotation. asset_ref keys match each game's theme
// reader so equipping actually re-skins the game.
export type SeasonItem = {
  id: string;
  name: string;
  gameType: RewardGameType;
  slot: string;
  rarity: 'rare' | 'epic' | 'legendary';
  assetRef: Record<string, unknown>;
};

const pv = (start: string, end: string) => ({
  previewBgEnabled: true,
  previewBgStart: start,
  previewBgEnd: end,
});

export const SEASON_0_ITEMS: SeasonItem[] = [
  // Profile cosmetics — flair reader expects color/emoji/text keys.
  { id: 's0-badge-founder', name: 'Founder Crown', gameType: 'profile', slot: 'badge', rarity: 'legendary', assetRef: { emoji: '👑', imageUrl: '/cosmetics/badges/s0-badge-founder.png', ...pv('#1a1407', '#fbbf24') } },
  { id: 's0-badge-rocket', name: 'Launch Rocket', gameType: 'profile', slot: 'badge', rarity: 'epic', assetRef: { emoji: '🚀', imageUrl: '/cosmetics/badges/s0-badge-rocket.png', ...pv('#0a0f1a', '#38bdf8') } },
  { id: 's0-title-pioneer', name: 'Season 0 Pioneer', gameType: 'profile', slot: 'title', rarity: 'epic', assetRef: { text: 'Pioneer', ...pv('#150724', '#a855f7') } },
  { id: 's0-title-legend', name: 'Season 0 Legend', gameType: 'profile', slot: 'title', rarity: 'legendary', assetRef: { text: 'S0 Legend', ...pv('#1a1407', '#fbbf24') } },
  { id: 's0-name-holo', name: 'Holo Name', gameType: 'profile', slot: 'nameColor', rarity: 'epic', assetRef: { color: '#22d3ee', ...pv('#03212b', '#22d3ee') } },
  { id: 's0-frame-prism', name: 'Prism Frame', gameType: 'profile', slot: 'frame', rarity: 'epic', assetRef: { color: '#c084fc', ...pv('#150724', '#c084fc') } },
  { id: 's0-bg-aurora', name: 'S0 Aurora', gameType: 'profile', slot: 'background', rarity: 'epic', assetRef: { bgStyle: 'gradient', bgStart: '#0ea5e9', bgEnd: '#4c1d95', imageUrl: '/cosmetics/banners/s0-bg-aurora.png', ...pv('#0b1120', '#0ea5e9') } },
  { id: 's0-bg-carbon', name: 'S0 Carbon', gameType: 'profile', slot: 'background', rarity: 'rare', assetRef: { bgStyle: 'gradient', bgStart: '#1f2937', bgEnd: '#030712', imageUrl: '/cosmetics/banners/s0-bg-carbon.png', ...pv('#030712', '#1f2937') } },
  { id: 's0-bg-sunburst', name: 'S0 Sunburst', gameType: 'profile', slot: 'background', rarity: 'legendary', assetRef: { bgStyle: 'gradient', bgStart: '#f97316', bgEnd: '#7c2d12', imageUrl: '/cosmetics/banners/s0-bg-sunburst.png', ...pv('#1a0d04', '#f97316') } },
  // Game skins
  { id: 's0-snake-prism', name: 'S0 Prism Snake', gameType: 'snake', slot: 'body', rarity: 'epic', assetRef: { bodyPrimary: '#a855f7', bodySecondary: '#22d3ee', bodyGradient: 'combined', bodyGlowEnabled: true, bodyGlowColor: '#a855f7', bodyGlowStyle: 'pulse', ...pv('#150724', '#a855f7') } },
  { id: 's0-flappy-phoenix', name: 'S0 Phoenix', gameType: 'flappy-bird', slot: 'bird', rarity: 'epic', assetRef: { birdPrimary: '#f97316', birdSecondary: '#dc2626', birdGlow: '#f97316', ...pv('#1a0d04', '#f97316') } },
  { id: 's0-tetris-synth', name: 'S0 Synthwave', gameType: 'tetris', slot: 'blocks', rarity: 'epic', assetRef: { colorI: '#22d3ee', colorO: '#f472b6', colorT: '#a855f7', colorS: '#34d399', colorZ: '#f43f5e', colorJ: '#818cf8', colorL: '#fbbf24', blockShading: 'neon', blockGlowEnabled: true, blockGlowColor: '#f472b6', blockGlowSize: 50, ...pv('#150724', '#f472b6') } },
  { id: 's0-gopher-gold', name: 'S0 Golden Gopher', gameType: 'gopher', slot: 'gopher', rarity: 'legendary', assetRef: { gopherBody: '#fbbf24', gopherBodyHi: '#fde68a', gopherBodyLo: '#b45309', gopherEdge: '#78350f', gopherNose: '#451a03', gopherPaw: '#fde68a', gopherGlowEnabled: true, gopherGlowColor: '#fbbf24', ...pv('#1a1004', '#fbbf24') } },
  { id: 's0-swerve-chrome', name: 'S0 Chrome Cart', gameType: 'swerve', slot: 'cart', rarity: 'epic', assetRef: { cartPrimary: '#e2e8f0', cartSecondary: '#94a3b8', cartGlow: '#38bdf8', cartGlowIntensity: 0.5, ...pv('#0a0f1a', '#e2e8f0') } },
  // Tier 31–32 finale rewards (art-free: name color + gradient background).
  { id: 's0-name-ember', name: 'Ember Name', gameType: 'profile', slot: 'nameColor', rarity: 'epic', assetRef: { color: '#fb923c', ...pv('#1a0d04', '#fb923c') } },
  { id: 's0-bg-vortex', name: 'S0 Vortex', gameType: 'profile', slot: 'background', rarity: 'legendary', assetRef: { bgStyle: 'gradient', bgStart: '#7c3aed', bgEnd: '#0b1120', ...pv('#0b1120', '#7c3aed') } },
  // Battlepass-EXCLUSIVE avatars (slot 'avatar' → equipping sets image_url).
  { id: 's0-avatar-aurora', name: 'Aurora Spirit', gameType: 'profile', slot: 'avatar', rarity: 'rare', assetRef: { imageUrl: '/cosmetics/avatars/s0-avatar-aurora.png', ...pv('#04140e', '#34d399') } },
  { id: 's0-avatar-prism', name: 'Prism', gameType: 'profile', slot: 'avatar', rarity: 'epic', assetRef: { imageUrl: '/cosmetics/avatars/s0-avatar-prism.png', ...pv('#0b1120', '#22d3ee') } },
  { id: 's0-avatar-mecha', name: 'Mecha Hero', gameType: 'profile', slot: 'avatar', rarity: 'epic', assetRef: { imageUrl: '/cosmetics/avatars/s0-avatar-mecha.png', ...pv('#0a0f1a', '#22d3ee') } },
  { id: 's0-avatar-galaxy', name: 'Galaxy', gameType: 'profile', slot: 'avatar', rarity: 'epic', assetRef: { imageUrl: '/cosmetics/avatars/s0-avatar-galaxy.png', ...pv('#0b1120', '#a855f7') } },
  { id: 's0-avatar-phoenix', name: 'Phoenix', gameType: 'profile', slot: 'avatar', rarity: 'legendary', assetRef: { imageUrl: '/cosmetics/avatars/s0-avatar-phoenix.png', ...pv('#1a0d04', '#f97316') } },
  { id: 's0-avatar-founder', name: 'Founder', gameType: 'profile', slot: 'avatar', rarity: 'legendary', assetRef: { imageUrl: '/cosmetics/avatars/s0-avatar-founder.png', ...pv('#1a1407', '#fbbf24') } },
];

const itemById = new Map(SEASON_0_ITEMS.map((it) => [it.id, it]));
export const getSeasonItem = (id: string) => itemById.get(id) ?? null;

// ─── Tier ladder ─────────────────────────────────────────────────────────────
const T = (
  tier: number,
  free: SeasonReward,
  premium: SeasonReward,
): SeasonTier => ({ tier, free, premium });
const tix = (amount: number): SeasonReward => ({ kind: 'tickets', amount });
const item = (itemId: string): SeasonReward => ({ kind: 'item', itemId });

export const SEASON_0_TIERS: SeasonTier[] = [
  T(1, tix(75), item('s0-badge-rocket')),
  T(2, tix(75), tix(150)),
  T(3, tix(100), item('s0-bg-carbon')),
  T(4, tix(100), tix(150)),
  T(5, item('s0-name-holo'), item('s0-flappy-phoenix')),
  T(6, tix(100), item('s0-avatar-aurora')),
  T(7, tix(125), tix(175)),
  T(8, tix(125), item('s0-snake-prism')),
  T(9, tix(125), tix(200)),
  T(10, item('s0-title-pioneer'), item('s0-bg-aurora')),
  T(11, tix(150), item('s0-avatar-prism')),
  T(12, tix(150), tix(200)),
  T(13, tix(150), item('s0-swerve-chrome')),
  T(14, tix(150), tix(225)),
  T(15, item('s0-frame-prism'), item('s0-tetris-synth')),
  T(16, tix(175), item('s0-avatar-mecha')),
  T(17, tix(175), tix(225)),
  T(18, tix(175), tix(250)),
  T(19, tix(175), tix(250)),
  T(20, tix(200), item('s0-badge-founder')),
  T(21, tix(200), item('s0-avatar-galaxy')),
  T(22, tix(200), tix(275)),
  T(23, tix(200), tix(275)),
  T(24, tix(225), tix(275)),
  T(25, tix(225), item('s0-gopher-gold')),
  T(26, tix(225), item('s0-avatar-phoenix')),
  T(27, tix(250), tix(300)),
  T(28, tix(250), tix(350)),
  T(29, tix(250), item('s0-avatar-founder')),
  T(30, tix(500), item('s0-title-legend')),
  T(31, tix(300), item('s0-name-ember')),
  T(32, tix(600), item('s0-bg-vortex')),
];

export const getTierFromXp = (xp: number) =>
  Math.max(0, Math.min(MAX_TIER, Math.floor(Math.max(0, xp) / XP_PER_TIER)));

/** XP into the current tier and how much the next tier needs (for the bar). */
export const tierProgress = (xp: number) => {
  const tier = getTierFromXp(xp);
  const into = Math.max(0, xp) - tier * XP_PER_TIER;
  const atMax = tier >= MAX_TIER;
  return {
    tier,
    into: atMax ? XP_PER_TIER : into,
    need: XP_PER_TIER,
    atMax,
  };
};

// ─── Daily quest pool ────────────────────────────────────────────────────────
export type QuestKind = 'play_any' | 'play_game' | 'earn_tickets' | 'score_game';

export type QuestTemplate = {
  key: string;
  kind: QuestKind;
  label: string;
  goal: number;
  rewardXp: number;
  rewardTickets: number;
  targetGame?: string;
};

// The daily quest pool lives in ./daily-quests.ts.

// ─── Weekly quests ───────────────────────────────────────────────────────────
// Season 0 shipped the week of the 0026_battlepass migration commit (2026-06-25,
// a Thursday); we anchor the weekly-quest calendar to the MONDAY of that week,
// 2026-06-22 00:00 LOCAL. Weeks unlock as real time passes (one per calendar
// week), but every week that has EVER unlocked stays open and completable for the
// rest of the season — retro-completing a missed past week is an explicit product
// requirement, so weeklies never expire. The anchor is computed at module load in
// server-local time so week boundaries line up with the local `date_key`s the
// rest of the season code already uses.
export const SEASON_0_START_MS = new Date(2026, 5, 22, 0, 0, 0, 0).getTime();
export const SEASON_0_TOTAL_WEEKS = 8;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** 1-based season week for a date, clamped to [1, SEASON_0_TOTAL_WEEKS]. */
export const seasonWeekForDate = (date: Date): number => {
  const elapsed = date.getTime() - SEASON_0_START_MS;
  const week = Math.floor(elapsed / WEEK_MS) + 1;
  return Math.max(1, Math.min(SEASON_0_TOTAL_WEEKS, week));
};

/** Local-time epoch ms at which a given 1-based week unlocks (week 1 = anchor). */
export const weekUnlockMs = (week: number): number =>
  SEASON_0_START_MS + (Math.max(1, week) - 1) * WEEK_MS;

// Fixed weekly quest ladder — SAME for every user (no sampling, no rerolls),
// 8 weeks × 3 quests. Each week mixes one play-volume quest, one tickets/play
// quest, and one score quest, reusing only the existing quest kinds so the
// gameplay hook (recordGameRunForSeason) advances them with zero new semantics.
// Goals are ~3–4× the daily scale; score_game goals use this PR's calibrated
// tier-1/2 targets. Rewards sit in the 300–450 XP / 100–150 ticket band; the
// full 24-quest set is deliberately kept as a modest slice of the 32-tier pass
// (see the total in the PR notes) so clearing weeklies accelerates the pass
// without handing it to you.
export const SEASON_0_WEEKLY_QUESTS: { week: number; quests: QuestTemplate[] }[] = [
  {
    week: 1,
    quests: [
      { key: 'w1-play-15', kind: 'play_any', label: 'Week 1 · Play 15 games', goal: 15, rewardXp: 300, rewardTickets: 100 },
      { key: 'w1-earn-500', kind: 'earn_tickets', label: 'Week 1 · Earn 500 tickets', goal: 500, rewardXp: 300, rewardTickets: 110 },
      { key: 'w1-snake-300', kind: 'score_game', label: 'Week 1 · Score 300 in Snake', goal: 300, rewardXp: 350, rewardTickets: 120, targetGame: 'snake' },
    ],
  },
  {
    week: 2,
    quests: [
      { key: 'w2-play-15', kind: 'play_any', label: 'Week 2 · Play 15 games', goal: 15, rewardXp: 300, rewardTickets: 100 },
      { key: 'w2-gopher-6', kind: 'play_game', label: 'Week 2 · Whack 6 rounds of Gopher', goal: 6, rewardXp: 300, rewardTickets: 110, targetGame: 'gopher' },
      { key: 'w2-flappy-30', kind: 'score_game', label: 'Week 2 · Score 30 in Flappy Bird', goal: 30, rewardXp: 350, rewardTickets: 120, targetGame: 'flappy-bird' },
    ],
  },
  {
    week: 3,
    quests: [
      { key: 'w3-play-18', kind: 'play_any', label: 'Week 3 · Play 18 games', goal: 18, rewardXp: 300, rewardTickets: 100 },
      { key: 'w3-earn-600', kind: 'earn_tickets', label: 'Week 3 · Earn 600 tickets', goal: 600, rewardXp: 300, rewardTickets: 110 },
      { key: 'w3-breakout-3000', kind: 'score_game', label: 'Week 3 · Score 3000 in Breakout', goal: 3000, rewardXp: 350, rewardTickets: 120, targetGame: 'breakout' },
    ],
  },
  {
    week: 4,
    quests: [
      { key: 'w4-play-15', kind: 'play_any', label: 'Week 4 · Play 15 games', goal: 15, rewardXp: 300, rewardTickets: 100 },
      { key: 'w4-swerve-6', kind: 'play_game', label: 'Week 4 · Play 6 rounds of Swerve', goal: 6, rewardXp: 300, rewardTickets: 110, targetGame: 'swerve' },
      { key: 'w4-gopher-600', kind: 'score_game', label: 'Week 4 · Score 600 in Gopher', goal: 600, rewardXp: 350, rewardTickets: 120, targetGame: 'gopher' },
    ],
  },
  {
    week: 5,
    quests: [
      { key: 'w5-play-18', kind: 'play_any', label: 'Week 5 · Play 18 games', goal: 18, rewardXp: 300, rewardTickets: 100 },
      { key: 'w5-earn-700', kind: 'earn_tickets', label: 'Week 5 · Earn 700 tickets', goal: 700, rewardXp: 300, rewardTickets: 110 },
      { key: 'w5-2048-2000', kind: 'score_game', label: 'Week 5 · Score 2000 in 2048', goal: 2000, rewardXp: 350, rewardTickets: 120, targetGame: '2048' },
    ],
  },
  {
    week: 6,
    quests: [
      { key: 'w6-play-15', kind: 'play_any', label: 'Week 6 · Play 15 games', goal: 15, rewardXp: 300, rewardTickets: 100 },
      { key: 'w6-ricochet-6', kind: 'play_game', label: 'Week 6 · Play 6 rounds of Ricochet', goal: 6, rewardXp: 300, rewardTickets: 110, targetGame: 'ricochet' },
      { key: 'w6-gem-swap-3000', kind: 'score_game', label: 'Week 6 · Score 3000 in Gem Swap', goal: 3000, rewardXp: 350, rewardTickets: 120, targetGame: 'gem-swap' },
    ],
  },
  {
    week: 7,
    quests: [
      { key: 'w7-play-18', kind: 'play_any', label: 'Week 7 · Play 18 games', goal: 18, rewardXp: 300, rewardTickets: 100 },
      { key: 'w7-earn-800', kind: 'earn_tickets', label: 'Week 7 · Earn 800 tickets', goal: 800, rewardXp: 300, rewardTickets: 110 },
      { key: 'w7-stack-25', kind: 'score_game', label: 'Week 7 · Score 25 in Stack', goal: 25, rewardXp: 350, rewardTickets: 120, targetGame: 'stack' },
    ],
  },
  {
    week: 8,
    quests: [
      { key: 'w8-play-20', kind: 'play_any', label: 'Week 8 · Play 20 games', goal: 20, rewardXp: 300, rewardTickets: 100 },
      { key: 'w8-breakout-6', kind: 'play_game', label: 'Week 8 · Play 6 rounds of Breakout', goal: 6, rewardXp: 300, rewardTickets: 110, targetGame: 'breakout' },
      { key: 'w8-sky-climber-300', kind: 'score_game', label: 'Week 8 · Score 300 in Sky Climber', goal: 300, rewardXp: 400, rewardTickets: 150, targetGame: 'sky-climber' },
    ],
  },
];

const weeklyQuestByKey = new Map(
  SEASON_0_WEEKLY_QUESTS.flatMap((w) => w.quests.map((q) => [q.key, q] as const)),
);
export const getWeeklyQuestTemplate = (key: string) => weeklyQuestByKey.get(key) ?? null;

// ─── Season quests ───────────────────────────────────────────────────────────
// A small fixed ladder of long-horizon quests, ALL unlocked at season start, the
// SAME for every user (no sampling, no rerolls), that never expire within the
// season. Slots 0..N-1 are stable — the (user_id, slot_index) key mirrors the
// weekly table (see 0037_season_quests.sql). Reuses ONLY the four existing quest
// kinds so the gameplay hook (recordGameRunForSeason) advances them with zero new
// semantics — same LEAST/GREATEST clamping and quest_key/claimed guards.
//
// Budget (season quests are the "big rewards" grind, sized as a deliberate slice
// of the 32-tier / 19,200-XP pass, sitting BELOW the ~40% weeklies own):
//   XP:      700+700+650+650+700+750+750+700 = 5,600 XP  → 29.2% of 19,200
//            (inside the 4,800–6,200 / 25–32% guardrail; each quest 650–750 XP,
//             inside the 500–1,000 band).
//   Tickets: 250+300+250+250+300+350+350+300 = 2,350     → ≤ 2,500 cap
//            (each 250–350, inside the 150–400 band; weeklies total ≈ 2,670).
// Score goals use the post-2026-07 rescale scales — season-long "big single
// run" stretch targets calibrated off each game's weekly goal (breakout weekly
// 3,000 → 6,000; stack weekly 25 → 40; sky-climber weekly 300 → 500). Play
// quests spread across games the daily/weekly ladders under-serve — the mix is
// two generic grinds, three play-N-rounds games, and three score stretches, so
// the season set reads "general" rather than repeating the daily targets.
export const SEASON_0_SEASON_QUESTS: QuestTemplate[] = [
  { key: 'sq-play-100', kind: 'play_any', label: 'Season · Play 100 games', goal: 100, rewardXp: 700, rewardTickets: 250 },
  { key: 'sq-earn-5000', kind: 'earn_tickets', label: 'Season · Earn 5,000 tickets', goal: 5000, rewardXp: 700, rewardTickets: 300 },
  { key: 'sq-ricochet-play-15', kind: 'play_game', label: 'Season · Play 15 rounds of Ricochet', goal: 15, rewardXp: 650, rewardTickets: 250, targetGame: 'ricochet' },
  { key: 'sq-bubble-play-15', kind: 'play_game', label: 'Season · Play 15 rounds of Gumball Drop', goal: 15, rewardXp: 650, rewardTickets: 250, targetGame: 'bubble-shooter' },
  { key: 'sq-breakout-6000', kind: 'score_game', label: 'Season · Score 6,000 in Breakout', goal: 6000, rewardXp: 700, rewardTickets: 300, targetGame: 'breakout' },
  { key: 'sq-stack-40', kind: 'score_game', label: 'Season · Stack 40 in Stack', goal: 40, rewardXp: 750, rewardTickets: 350, targetGame: 'stack' },
  { key: 'sq-sky-climber-500', kind: 'score_game', label: 'Season · Score 500 in Sky Climber', goal: 500, rewardXp: 750, rewardTickets: 350, targetGame: 'sky-climber' },
  { key: 'sq-gemswap-play-20', kind: 'play_game', label: 'Season · Play 20 rounds of Gem Swap', goal: 20, rewardXp: 700, rewardTickets: 300, targetGame: 'gem-swap' },
];

const seasonQuestByKey = new Map(SEASON_0_SEASON_QUESTS.map((q) => [q.key, q] as const));
export const getSeasonQuestTemplate = (key: string) => seasonQuestByKey.get(key) ?? null;

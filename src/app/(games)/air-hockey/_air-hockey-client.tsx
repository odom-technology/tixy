'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleDot, Users, Bot, ArrowLeft } from 'lucide-react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { PageHeader } from '@/features/arcade/components/shell/page-header';
import { GamesRouteSwitcher } from '@/features/arcade/components/games-route-switcher';
import { MuteButton } from '@/features/arcade/components/mute-button';
import {
  usePreventGameGestures,
  useIsTouchDevice,
} from '@/features/arcade/lib/game-mobile-utils';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import {
  createGameFrameLoop,
  createAdaptiveGameQuality,
  gameCanvasDpr,
  getGame2dContext,
  type GameFrameLoop,
  type GameFrameInfo,
} from '@/features/arcade/lib/game-frame-loop';

import {
  BASE_W,
  BASE_H,
  WALL,
  PUCK_R,
  MALLET_R,
  WIN_SCORE,
  SERVE_SPEED,
  SERVE_SPREAD,
  MALLET_CENTER_OVERLAP,
  FIXED_DT,
  FIXED_DT_MS,
  GOAL_HALF,
  GOAL_X_MIN,
  GOAL_X_MAX,
  AI_PROFILES,
  type Difficulty,
  type GameMode,
} from './_air-hockey-constants';
import {
  stepPuck,
  clampMallet,
  type Puck,
  type MalletBody,
} from './_air-hockey-physics';
import {
  createPuckHistory,
  recordPuck,
  computeAiTarget,
  moveMalletToward,
} from './_air-hockey-ai';

import './_air-hockey-midway.css';

// ── Phases of the client UI ──
type Phase = 'menu' | 'playing' | 'gameover';

// A mallet tracked through the sim. `tx/ty` is the desired (target) center the
// player/AI is steering toward; the real center eases toward it each step so a
// fast flick imparts momentum but the body never teleports through the puck.
type Mallet = {
  x: number;
  y: number;
  tx: number;
  ty: number;
  vx: number; // velocity used this step (px/s) — feeds puck momentum
  vy: number;
  side: 'top' | 'bottom';
};

// Decorative goal-flash (hard enamel flash, no glow) + serve countdown.
type FlashState = { side: 'top' | 'bottom'; t: number } | null;

// ── Presentation-only FX (read sim state, never feed back into it) ──
// An enamel chip knocked loose by an impact. No gravity — the table is viewed
// top-down — just a quick drag so chips settle. Self-decaying via `life`.
type ChipParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // seconds remaining
  maxLife: number;
  size: number;
  color: string;
};
// An expanding contact ring (mallet hits, goal bursts).
type PulseRing = {
  x: number;
  y: number;
  r: number;
  vr: number; // radial expansion speed (px/s)
  life: number;
  maxLife: number;
  color: string;
};

// FX caps + thresholds (table-space). Everything is small, bounded and
// self-decaying so the render loop never accumulates work.
const MAX_CHIPS = 72;
const MAX_RINGS = 10;
const TRAIL_MAX = 10; // echo samples kept behind a fast puck
const TRAIL_MIN_SPEED = 650; // puck speed (px/s) before the trail shows
const SHAKE_MIN_DV = 900; // mallet-hit velocity change that earns a shake
const WALL_SPARK_DV = 550; // wall-bounce velocity change that earns a spark

function pushChip(arr: ChipParticle[], chip: ChipParticle): void {
  if (arr.length >= MAX_CHIPS) arr.shift(); // drop the oldest, stay bounded
  arr.push(chip);
}

function pushRing(arr: PulseRing[], ring: PulseRing): void {
  if (arr.length >= MAX_RINGS) arr.shift();
  arr.push(ring);
}

const HOME_TOP = WALL + MALLET_R + 30;
const HOME_BOTTOM = BASE_H - WALL - MALLET_R - 30;

// Max mallet ease toward its target per fixed step (player mallets). Keeps the
// human-controlled mallet from snapping instantly across the table, which both
// feels physical and bounds the momentum it can dump into the puck.
const PLAYER_MALLET_SPEED = 26; // exponential-approach rate (1/s)

// Deterministic enamel-confetti pieces for the match-win ceremony (module-level
// so the array is stable across renders — no per-render allocation). CSS drives
// the fall; reduced motion hides the whole strip.
const WIN_CONFETTI = Array.from({ length: 16 }, (_, i) => {
  const palette = ['#c73538', '#2fb8a6', '#f6eddc', '#e8b04b'];
  return {
    left: `${(i * 6.1 + 4) % 96}%`,
    color: palette[i % palette.length]!,
    delay: `${(i % 6) * 90}ms`,
    dur: `${1300 + (i % 5) * 130}ms`,
  };
});

function makePuck(): Puck {
  return { x: BASE_W / 2, y: BASE_H / 2, vx: 0, vy: 0 };
}

function makeMallet(side: 'top' | 'bottom'): Mallet {
  const y = side === 'top' ? HOME_TOP : HOME_BOTTOM;
  return { x: BASE_W / 2, y, tx: BASE_W / 2, ty: y, vx: 0, vy: 0, side };
}

export default function AirHockeyClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<Phase>('menu');
  const [mode, setMode] = useState<GameMode>('ai');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  // Mirrored to React only for the HUD overlay / win screen.
  const [scoreTop, setScoreTop] = useState(0);
  const [scoreBottom, setScoreBottom] = useState(0);
  const [winner, setWinner] = useState<'top' | 'bottom' | null>(null);
  const [canvasSize, setCanvasSize] = useState({
    width: BASE_W,
    height: BASE_H,
    dpr: 1,
  });

  usePreventGameGestures(phase === 'playing');

  // ── Sim refs (no re-render) ──
  const phaseRef = useRef<Phase>('menu');
  const modeRef = useRef<GameMode>('ai');
  const difficultyRef = useRef<Difficulty>('medium');
  const puckRef = useRef<Puck>(makePuck());
  const malletTopRef = useRef<Mallet>(makeMallet('top'));
  const malletBottomRef = useRef<Mallet>(makeMallet('bottom'));
  const scoreTopRef = useRef(0);
  const scoreBottomRef = useRef(0);
  const flashRef = useRef<FlashState>(null);
  // Serve hold: after a goal/kickoff the puck waits this many seconds (frozen
  // at center) before launching, so neither side is caught off guard.
  const serveHoldRef = useRef(0);
  const serveDirRef = useRef<'top' | 'bottom'>('bottom');

  // ── FX refs (visual only; advance in the render loop, never in stepSim) ──
  const chipsRef = useRef<ChipParticle[]>([]);
  const ringsRef = useRef<PulseRing[]>([]);
  const trailRef = useRef<{ x: number; y: number }[]>([]);
  const shakeRef = useRef(0); // current canvas shake magnitude (table px)
  // Dedicated render-only PRNG. Visual particles/shake must never consume the
  // Math.random stream used by serves and AI aim jitter.
  const fxSeedRef = useRef(0x6d2b79f5);
  const fxRandom = useCallback(() => {
    let x = fxSeedRef.current | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    fxSeedRef.current = x >>> 0;
    return fxSeedRef.current / 0x100000000;
  }, []);

  const gameLoopRef = useRef<GameFrameLoop | null>(null);
  const simClockRef = useRef<number>(0); // total simulated seconds
  const scaleRef = useRef(1);
  const reducedMotionRef = useRef(false);
  const qualityRef = useRef(createAdaptiveGameQuality());

  // Pointer tracking: pointerId -> which mallet it controls. On desktop the
  // mouse drives whichever half it's in; on touch, two fingers each own a half.
  const pointerMalletRef = useRef<Map<number, 'top' | 'bottom'>>(new Map());
  // Latest pointer-driven target per mallet (table-space). null = no pointer.
  const pointerTargetRef = useRef<{
    top: { x: number; y: number } | null;
    bottom: { x: number; y: number } | null;
  }>({ top: null, bottom: null });

  // Keyboard target offsets (desktop). W/A/S/D nudges the TOP mallet, arrows
  // the BOTTOM mallet. Held keys accumulate a velocity each step.
  const keysRef = useRef<Record<string, boolean>>({});

  // AI history buffer.
  const aiHistoryRef = useRef(createPuckHistory());

  // ── Serve the puck toward `toward` (the conceding side gets possession). ──
  const serve = useCallback((toward: 'top' | 'bottom') => {
    const puck = puckRef.current;
    puck.x = BASE_W / 2;
    puck.y = BASE_H / 2;
    puck.vx = 0;
    puck.vy = 0;
    serveDirRef.current = toward;
    serveHoldRef.current = 0.85; // brief freeze before launch
  }, []);

  const resetMatch = useCallback(() => {
    puckRef.current = makePuck();
    malletTopRef.current = makeMallet('top');
    malletBottomRef.current = makeMallet('bottom');
    scoreTopRef.current = 0;
    scoreBottomRef.current = 0;
    setScoreTop(0);
    setScoreBottom(0);
    setWinner(null);
    flashRef.current = null;
    chipsRef.current = [];
    ringsRef.current = [];
    trailRef.current = [];
    shakeRef.current = 0;
    simClockRef.current = 0;
    pointerMalletRef.current.clear();
    pointerTargetRef.current = { top: null, bottom: null };
    keysRef.current = {};
    aiHistoryRef.current = createPuckHistory();
    qualityRef.current.reset();
    // Kick off toward a random side.
    serve(Math.random() < 0.5 ? 'top' : 'bottom');
  }, [serve]);

  // ── Advance the human/keyboard mallet targets for one fixed step ──
  const applyPlayerInput = useCallback((dtSec: number) => {
    const top = malletTopRef.current;
    const bottom = malletBottomRef.current;
    const keys = keysRef.current;
    const KB_SPEED = 760; // px/s for keyboard steering

    // Pointer targets take priority for whichever half has an active pointer.
    const pTop = pointerTargetRef.current.top;
    const pBottom = pointerTargetRef.current.bottom;

    // ── TOP mallet target ──
    if (pTop) {
      top.tx = pTop.x;
      top.ty = pTop.y;
    } else if (modeRef.current === 'local') {
      // Keyboard W/A/S/D nudges the target around (only relevant in local 2P;
      // in vs-AI the top mallet is the AI's, handled elsewhere).
      let dx = 0;
      let dy = 0;
      if (keys['KeyA']) dx -= 1;
      if (keys['KeyD']) dx += 1;
      if (keys['KeyW']) dy -= 1;
      if (keys['KeyS']) dy += 1;
      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy) || 1;
        top.tx += (dx / len) * KB_SPEED * dtSec;
        top.ty += (dy / len) * KB_SPEED * dtSec;
      }
    }

    // ── BOTTOM mallet target ──
    if (pBottom) {
      bottom.tx = pBottom.x;
      bottom.ty = pBottom.y;
    } else {
      // Arrow keys steer the bottom mallet (the human in BOTH modes).
      let dx = 0;
      let dy = 0;
      if (keys['ArrowLeft']) dx -= 1;
      if (keys['ArrowRight']) dx += 1;
      if (keys['ArrowUp']) dy -= 1;
      if (keys['ArrowDown']) dy += 1;
      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy) || 1;
        bottom.tx += (dx / len) * KB_SPEED * dtSec;
        bottom.ty += (dy / len) * KB_SPEED * dtSec;
      }
    }

    // Clamp targets into each half so the eased body stays put.
    const ctClamped = clampMallet(top.tx, top.ty, 'top', MALLET_CENTER_OVERLAP);
    top.tx = ctClamped.x;
    top.ty = ctClamped.y;
    const cbClamped = clampMallet(bottom.tx, bottom.ty, 'bottom', MALLET_CENTER_OVERLAP);
    bottom.tx = cbClamped.x;
    bottom.ty = cbClamped.y;
  }, []);

  // ── Ease a player mallet body toward its target, recording the velocity it
  //    moved at (for puck momentum), and clamping to its half. ──
  const easePlayerMallet = useCallback((m: Mallet, dtSec: number) => {
    const prevX = m.x;
    const prevY = m.y;
    const k = 1 - Math.exp(-PLAYER_MALLET_SPEED * dtSec);
    let nx = m.x + (m.tx - m.x) * k;
    let ny = m.y + (m.ty - m.y) * k;
    const clamped = clampMallet(nx, ny, m.side, MALLET_CENTER_OVERLAP);
    nx = clamped.x;
    ny = clamped.y;
    m.vx = dtSec > 0 ? (nx - prevX) / dtSec : 0;
    m.vy = dtSec > 0 ? (ny - prevY) / dtSec : 0;
    m.x = nx;
    m.y = ny;
  }, []);

  // ── FX spawners (presentation only). All strength scaling keys off `dv`,
  //    the puck's velocity change across the step the contact fired on. ──

  // Mallet contact: a small enamel-chip burst + a brief flash ring. Only a
  // genuinely hard hit (big dv) earns a canvas shake — dribbles stay calm.
  const spawnImpact = useCallback((x: number, y: number, dv: number) => {
    const colors = ['#f6eddc', '#ffffff', '#b9ad95'];
    const n = Math.max(
      1,
      Math.round(
        Math.min(9, 1 + Math.floor(dv / 220)) * qualityRef.current.particleScale(),
      ),
    );
    const speed = 60 + Math.min(320, dv * 0.25);
    for (let i = 0; i < n; i += 1) {
      const ang = fxRandom() * Math.PI * 2;
      const sp = speed * (0.4 + fxRandom() * 0.8);
      const life = 0.25 + fxRandom() * 0.25;
      pushChip(chipsRef.current, {
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life,
        maxLife: life,
        size: 2 + fxRandom() * 2.5,
        color: colors[i % colors.length]!,
      });
    }
    pushRing(ringsRef.current, {
      x,
      y,
      r: PUCK_R + 2,
      vr: 120,
      life: 0.18,
      maxLife: 0.18,
      color: '#ffffff',
    });
    if (dv > SHAKE_MIN_DV) {
      // 2–4px, decaying per frame (see gameLoop).
      const mag = 2 + Math.min(2, (dv - SHAKE_MIN_DV) / 350);
      shakeRef.current = Math.max(shakeRef.current, mag);
    }
  }, [fxRandom]);

  // Hard wall bounce: a much smaller spark (no ring, no shake).
  const spawnWallSpark = useCallback((x: number, y: number, dv: number) => {
    const colors = ['#e8b04b', '#f6eddc'];
    const n = Math.max(
      1,
      Math.round(
        (2 + Math.min(2, Math.floor(dv / 700))) *
          qualityRef.current.particleScale(),
      ),
    );
    for (let i = 0; i < n; i += 1) {
      const ang = fxRandom() * Math.PI * 2;
      const sp = 40 + fxRandom() * 120;
      const life = 0.15 + fxRandom() * 0.15;
      pushChip(chipsRef.current, {
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life,
        maxLife: life,
        size: 1.5 + fxRandom() * 1.5,
        color: colors[i % colors.length]!,
      });
    }
  }, [fxRandom]);

  // Non-final goal: ring burst + chip spray from the scored mouth, back onto
  // the field. (The match-winning goal keeps the confetti overlay instead.)
  const spawnGoalBurst = useCallback((side: 'top' | 'bottom') => {
    const x = BASE_W / 2;
    const y = side === 'top' ? WALL : BASE_H - WALL;
    const dir = side === 'top' ? 1 : -1; // spray inward, away from the wall
    const colors = ['#c73538', '#2fb8a6', '#f6eddc', '#e8b04b'];
    const particleCount = Math.max(
      6,
      Math.round(16 * qualityRef.current.particleScale()),
    );
    for (let i = 0; i < particleCount; i += 1) {
      const ang = (fxRandom() - 0.5) * 1.6; // spread around the inward axis
      const sp = 140 + fxRandom() * 260;
      const life = 0.35 + fxRandom() * 0.35;
      pushChip(chipsRef.current, {
        x: x + (fxRandom() - 0.5) * GOAL_HALF,
        y,
        vx: Math.sin(ang) * sp,
        vy: dir * Math.cos(ang) * sp,
        life,
        maxLife: life,
        size: 2 + fxRandom() * 3,
        color: colors[i % colors.length]!,
      });
    }
    pushRing(ringsRef.current, {
      x,
      y,
      r: 10,
      vr: 260,
      life: 0.35,
      maxLife: 0.35,
      color: '#ffffff',
    });
  }, [fxRandom]);

  // ── One fixed physics step ──
  const stepSim = useCallback(() => {
    const dt = FIXED_DT;
    simClockRef.current += dt;
    const now = simClockRef.current;

    // Player input → targets, then ease the human mallets.
    applyPlayerInput(dt);
    easePlayerMallet(malletBottomRef.current, dt);

    // TOP mallet: AI in vs-AI, human (keyboard/pointer) in local 2P.
    if (modeRef.current === 'ai') {
      const profile = AI_PROFILES[difficultyRef.current];
      const top = malletTopRef.current;
      recordPuck(aiHistoryRef.current, puckRef.current, now);
      const target = computeAiTarget(
        puckRef.current,
        profile,
        aiHistoryRef.current,
        now,
        Math.random,
      );
      const moved = moveMalletToward(top.x, top.y, target.x, target.y, profile, dt);
      const clamped = clampMallet(moved.x, moved.y, 'top', MALLET_CENTER_OVERLAP);
      top.vx = dt > 0 ? (clamped.x - top.x) / dt : 0;
      top.vy = dt > 0 ? (clamped.y - top.y) / dt : 0;
      top.x = clamped.x;
      top.y = clamped.y;
    } else {
      easePlayerMallet(malletTopRef.current, dt);
    }

    // Serve hold: keep the puck frozen at center, then launch.
    if (serveHoldRef.current > 0) {
      serveHoldRef.current -= dt;
      puckRef.current.x = BASE_W / 2;
      puckRef.current.y = BASE_H / 2;
      puckRef.current.vx = 0;
      puckRef.current.vy = 0;
      if (serveHoldRef.current <= 0) {
        // Launch toward the conceding side at a shallow random angle.
        const dir = serveDirRef.current === 'top' ? -1 : 1;
        const ang = (Math.random() - 0.5) * 2 * SERVE_SPREAD;
        puckRef.current.vx = Math.sin(ang) * SERVE_SPEED;
        puckRef.current.vy = dir * Math.cos(ang) * SERVE_SPEED;
      }
      return; // no puck physics while the serve is held
    }

    const topBody: MalletBody = {
      x: malletTopRef.current.x,
      y: malletTopRef.current.y,
      vx: malletTopRef.current.vx,
      vy: malletTopRef.current.vy,
    };
    const bottomBody: MalletBody = {
      x: malletBottomRef.current.x,
      y: malletBottomRef.current.y,
      vx: malletBottomRef.current.vx,
      vy: malletBottomRef.current.vy,
    };

    const puck = puckRef.current;
    // Velocity change across the step feeds the impact FX below (read-only —
    // the sim gets the exact same inputs as before).
    const preVx = puck.vx;
    const preVy = puck.vy;
    const events = stepPuck(puck, topBody, bottomBody, dt);

    if (events.malletHit) SoundManager.play('hit', { volume: 0.7 });
    if (events.wallHit) SoundManager.play('cushionHit', { volume: 0.5 });

    // Impact FX derived from the events + velocity delta this step.
    if (!reducedMotionRef.current && (events.malletHit || events.wallHit)) {
      const dv = Math.hypot(puck.vx - preVx, puck.vy - preVy);
      if (events.malletHit) {
        if (dv > 120) spawnImpact(puck.x, puck.y, dv);
      } else if (dv > WALL_SPARK_DV) {
        spawnWallSpark(puck.x, puck.y, dv);
      }
    }

    if (events.goal) {
      // The puck entered `events.goal`'s net → the OTHER side scored.
      const scorer = events.goal === 'top' ? 'bottom' : 'top';
      if (scorer === 'top') {
        scoreTopRef.current += 1;
        setScoreTop(scoreTopRef.current);
      } else {
        scoreBottomRef.current += 1;
        setScoreBottom(scoreBottomRef.current);
      }
      SoundManager.play('score');
      flashRef.current = { side: events.goal, t: 1 };

      if (
        scoreTopRef.current >= WIN_SCORE ||
        scoreBottomRef.current >= WIN_SCORE
      ) {
        const w = scoreTopRef.current >= WIN_SCORE ? 'top' : 'bottom';
        phaseRef.current = 'gameover';
        setWinner(w);
        setPhase('gameover');
        SoundManager.play('win');
        // The loop stops here — drop any in-flight FX so nothing freezes
        // mid-frame behind the win overlay.
        chipsRef.current = [];
        ringsRef.current = [];
        trailRef.current = [];
        shakeRef.current = 0;
        return;
      }
      // Non-final goal: ring burst + chip spray from the scored mouth.
      if (!reducedMotionRef.current) spawnGoalBurst(events.goal);
      // Serve to the side that was just scored on (they conceded).
      serve(events.goal);
    }
  }, [applyPlayerInput, easePlayerMallet, serve, spawnImpact, spawnWallSpark, spawnGoalBurst]);

  // ── Render (decoupled from sim). `timeSec` drives ambient idle motion. ──
  const draw = useCallback((ctx: CanvasRenderingContext2D, timeSec: number) => {
    // ── Lacquered wood rink frame ──
    const frame = ctx.createLinearGradient(0, 0, 0, BASE_H);
    frame.addColorStop(0, '#6b4a26');
    frame.addColorStop(0.5, '#5a3e20');
    frame.addColorStop(1, '#4a3219');
    ctx.fillStyle = frame;
    ctx.fillRect(0, 0, BASE_W, BASE_H);
    // Hard top bevel highlight + bottom shade on the frame.
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(0, 0, BASE_W, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fillRect(0, BASE_H - 3, BASE_W, 3);

    // ── Cream playfield well (inside the wood frame) ──
    const fieldX = WALL;
    const fieldY = WALL;
    const fieldW = BASE_W - WALL * 2;
    const fieldH = BASE_H - WALL * 2;
    // Offset shadow under the playfield lip (hard, no blur).
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(fieldX + 2, fieldY + 3, fieldW, fieldH);
    const felt = ctx.createLinearGradient(0, fieldY, 0, fieldY + fieldH);
    felt.addColorStop(0, '#efe6d2');
    felt.addColorStop(1, '#e2d6bd');
    ctx.fillStyle = felt;
    ctx.fillRect(fieldX, fieldY, fieldW, fieldH);
    // Inner edge bevel: bright top-left, dark bottom-right (hard strips).
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(fieldX, fieldY, fieldW, 2);
    ctx.fillRect(fieldX, fieldY, 2, fieldH);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(fieldX, fieldY + fieldH - 2, fieldW, 2);
    ctx.fillRect(fieldX + fieldW - 2, fieldY, 2, fieldH);

    // ── Ambient sheen sweep across the felt (idle/menu only, very faint).
    //    Reduced motion flattens it to a static band parked mid-field. ──
    if (phaseRef.current !== 'playing') {
      const sweep = reducedMotionRef.current ? 0.5 : (timeSec % 7) / 7;
      const bandW = fieldW * 0.45;
      const cx = fieldX - bandW + sweep * (fieldW + bandW * 2);
      ctx.save();
      ctx.beginPath();
      ctx.rect(fieldX, fieldY, fieldW, fieldH);
      ctx.clip();
      ctx.translate(cx, fieldY + fieldH / 2);
      ctx.rotate(-0.35);
      const sheen = ctx.createLinearGradient(-bandW / 2, 0, bandW / 2, 0);
      sheen.addColorStop(0, 'rgba(255,255,255,0)');
      sheen.addColorStop(0.5, 'rgba(255,255,255,0.08)');
      sheen.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sheen;
      ctx.fillRect(-bandW / 2, -fieldH, bandW, fieldH * 2);
      ctx.restore();
    }

    // ── Painted center line + center circle (teal enamel) ──
    const midY = BASE_H / 2;
    ctx.strokeStyle = '#1d8579';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(fieldX, midY);
    ctx.lineTo(fieldX + fieldW, midY);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(BASE_W / 2, midY, 64, 0, Math.PI * 2);
    ctx.stroke();
    // Center dot.
    ctx.fillStyle = '#c73538';
    ctx.beginPath();
    ctx.arc(BASE_W / 2, midY, 5, 0, Math.PI * 2);
    ctx.fill();

    // ── Goals (painted mouths in the short walls) ──
    const drawGoal = (gy: number, flashOn: boolean) => {
      // The goal mouth: a recessed dark slot with red enamel posts.
      ctx.fillStyle = flashOn ? '#ffffff' : '#1a120a';
      ctx.fillRect(GOAL_X_MIN, gy, GOAL_HALF * 2, WALL);
      // Red enamel posts at each end of the mouth.
      ctx.fillStyle = '#c73538';
      ctx.fillRect(GOAL_X_MIN - 4, gy, 4, WALL);
      ctx.fillRect(GOAL_X_MAX, gy, 4, WALL);
    };
    const flash = flashRef.current;
    drawGoal(0, flash?.side === 'top' && flash.t > 0.5);
    drawGoal(BASE_H - WALL, flash?.side === 'bottom' && flash.t > 0.5);

    // ── Goal-line accent on the field (teal arc in front of each net) ──
    ctx.strokeStyle = 'rgba(29,133,121,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(BASE_W / 2, fieldY, 70, 0, Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(BASE_W / 2, fieldY + fieldH, 70, Math.PI, Math.PI * 2);
    ctx.stroke();

    // ── Mallets (enamel: red top, teal bottom) with hard bevel + offset shadow ──
    const drawMallet = (m: Mallet, fill: string, edge: string) => {
      // Offset shadow.
      ctx.fillStyle = 'rgba(0,0,0,0.38)';
      ctx.beginPath();
      ctx.arc(m.x + 2, m.y + 3, MALLET_R, 0, Math.PI * 2);
      ctx.fill();
      // Body.
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(m.x, m.y, MALLET_R, 0, Math.PI * 2);
      ctx.fill();
      // Enamel ring edge (dark) + inner knob.
      ctx.lineWidth = 4;
      ctx.strokeStyle = edge;
      ctx.beginPath();
      ctx.arc(m.x, m.y, MALLET_R - 2, 0, Math.PI * 2);
      ctx.stroke();
      // Inner cap (lighter) — the grip knob.
      ctx.fillStyle = edge;
      ctx.beginPath();
      ctx.arc(m.x, m.y, MALLET_R * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(m.x, m.y, MALLET_R * 0.36, 0, Math.PI * 2);
      ctx.fill();
      // Hard top-left highlight (no glow).
      ctx.fillStyle = 'rgba(255,255,255,0.32)';
      ctx.beginPath();
      ctx.arc(m.x - MALLET_R * 0.34, m.y - MALLET_R * 0.34, MALLET_R * 0.22, 0, Math.PI * 2);
      ctx.fill();
    };
    drawMallet(malletTopRef.current, '#c73538', '#7e2225');
    drawMallet(malletBottomRef.current, '#2fb8a6', '#1b7466');

    // ── Puck speed trail (fading echoes; only sampled above TRAIL_MIN_SPEED) ──
    const trail = trailRef.current;
    if (trail.length > 1) {
      for (let i = 0; i < trail.length; i += 1) {
        const k = (i + 1) / trail.length; // oldest sample = faintest
        ctx.globalAlpha = k * 0.22;
        ctx.fillStyle = '#f6eddc';
        ctx.beginPath();
        ctx.arc(trail[i]!.x, trail[i]!.y, PUCK_R * (0.3 + 0.55 * k), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // ── Puck (cream chip, hard offset shadow, no glow) ──
    const puck = puckRef.current;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.arc(puck.x + 2, puck.y + 3, PUCK_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f6eddc';
    ctx.beginPath();
    ctx.arc(puck.x, puck.y, PUCK_R, 0, Math.PI * 2);
    ctx.fill();
    // Edge ring + top highlight.
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#b9ad95';
    ctx.beginPath();
    ctx.arc(puck.x, puck.y, PUCK_R - 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(puck.x - PUCK_R * 0.3, puck.y - PUCK_R * 0.3, PUCK_R * 0.32, 0, Math.PI * 2);
    ctx.fill();

    // ── Serve countdown telegraph on the frozen puck. Reads the existing
    //    0.85s hold timer (1 → 0); the hold itself is untouched. ──
    if (phaseRef.current === 'playing' && serveHoldRef.current > 0) {
      const frac = serveHoldRef.current / 0.85;
      const num = Math.max(1, Math.ceil(frac * 3));
      ctx.save();
      if (reducedMotionRef.current) {
        // Static cue: fixed ring + numeral, no shrinking/pulsing.
        ctx.strokeStyle = 'rgba(199,53,56,0.8)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(puck.x, puck.y, PUCK_R + 12, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // A ring closing in on the puck as the launch nears.
        ctx.strokeStyle = `rgba(199,53,56,${0.35 + 0.45 * (1 - frac)})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(puck.x, puck.y, PUCK_R + 6 + frac * 26, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.font =
        "600 22px var(--font-mono-arcade, 'Spline Sans Mono'), ui-monospace, monospace";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(8,7,4,0.85)';
      ctx.fillText(String(num), puck.x + 1, puck.y - PUCK_R - 19);
      ctx.fillStyle = '#c73538';
      ctx.fillText(String(num), puck.x, puck.y - PUCK_R - 20);
      ctx.restore();
    }

    // ── Impact FX: pulse rings + enamel chips (advanced in the render loop) ──
    for (const ring of ringsRef.current) {
      ctx.globalAlpha = Math.max(0, ring.life / ring.maxLife) * 0.8;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const chip of chipsRef.current) {
      ctx.globalAlpha = Math.max(0, chip.life / chip.maxLife);
      ctx.fillStyle = chip.color;
      ctx.fillRect(chip.x - chip.size / 2, chip.y - chip.size / 2, chip.size, chip.size);
    }
    ctx.globalAlpha = 1;

    // ── Score readout — two big mono numerals near each goal, hard offset
    //    shadow, NO glow. Top score sits below the top goal; bottom above the
    //    bottom goal, both rotated so each player reads their own upright. ──
    ctx.save();
    ctx.font =
      "600 30px var(--font-mono-arcade, 'Spline Sans Mono'), ui-monospace, monospace";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Bottom player's score (upright), bottom-left of the field.
    const bScore = scoreBottomRef.current.toString();
    ctx.fillStyle = 'rgba(8,7,4,0.85)';
    ctx.fillText(bScore, fieldX + 34, midY + 40);
    ctx.fillStyle = '#1b7466';
    ctx.fillText(bScore, fieldX + 32, midY + 38);
    // Top player's score (rotated 180° so it's upright from the top side).
    const tScore = scoreTopRef.current.toString();
    ctx.translate(fieldX + fieldW - 32, midY - 38);
    ctx.rotate(Math.PI);
    ctx.fillStyle = 'rgba(8,7,4,0.85)';
    ctx.fillText(tScore, 2, 2);
    ctx.fillStyle = '#7e2225';
    ctx.fillText(tScore, 0, 0);
    ctx.restore();
  }, []);

  // Decay the goal flash each rendered frame (visual only).
  const decayFlash = useCallback(() => {
    const flash = flashRef.current;
    if (flash) {
      // Reduced motion: skip the flash entirely (drop it immediately).
      flash.t -= reducedMotionRef.current ? 1 : 0.05;
      if (flash.t <= 0) flashRef.current = null;
    }
  }, []);

  // Advance the visual FX one rendered frame (visual only, frame-rate dt).
  const updateFx = useCallback((dtSec: number) => {
    const chips = chipsRef.current;
    for (let i = chips.length - 1; i >= 0; i -= 1) {
      const c = chips[i]!;
      c.life -= dtSec;
      if (c.life <= 0) {
        chips.splice(i, 1);
        continue;
      }
      c.x += c.vx * dtSec;
      c.y += c.vy * dtSec;
      const drag = Math.pow(0.06, dtSec); // quick settle on the felt
      c.vx *= drag;
      c.vy *= drag;
    }
    const rings = ringsRef.current;
    for (let i = rings.length - 1; i >= 0; i -= 1) {
      const r = rings[i]!;
      r.life -= dtSec;
      r.r += r.vr * dtSec;
      if (r.life <= 0) rings.splice(i, 1);
    }
    // Canvas shake decays fast (~0.8×/frame at 60fps), like the goal flash.
    shakeRef.current *= 0.8;
    if (shakeRef.current < 0.15) shakeRef.current = 0;

    // Puck trail: sample while fast, bleed off one echo per frame when slow.
    const puck = puckRef.current;
    const speed = Math.hypot(puck.vx, puck.vy);
    const trail = trailRef.current;
    if (
      !reducedMotionRef.current &&
      speed > TRAIL_MIN_SPEED &&
      serveHoldRef.current <= 0
    ) {
      trail.push({ x: puck.x, y: puck.y });
      if (trail.length > TRAIL_MAX) trail.shift();
    } else if (trail.length > 0) {
      trail.shift();
    }
  }, []);

  const renderGameFrame = useCallback(
    (frame: GameFrameInfo) => {
      const canvas = canvasRef.current;
      const ctx = canvas ? getGame2dContext(canvas) : null;
      if (!canvas || !ctx) return;

      qualityRef.current.sample(frame.deltaMs, frame.nowMs);
      decayFlash();
      updateFx(frame.deltaMs / 1000);

      ctx.save();
      ctx.scale(scaleRef.current, scaleRef.current);
      // Tiny canvas shake on hard mallet hits (never under reduced motion).
      if (shakeRef.current > 0 && !reducedMotionRef.current) {
        ctx.translate(
          (fxRandom() * 2 - 1) * shakeRef.current,
          (fxRandom() * 2 - 1) * shakeRef.current,
        );
      }
      draw(ctx, frame.nowMs / 1000);
      ctx.restore();
    },
    [decayFlash, updateFx, draw, fxRandom],
  );

  useEffect(() => {
    const loop = createGameFrameLoop({
      stepMs: FIXED_DT_MS,
      simulate: () => {
        stepSim();
        return phaseRef.current === 'playing';
      },
      render: (_alpha, frame) => renderGameFrame(frame),
    });
    gameLoopRef.current = loop;
    return () => {
      loop.destroy();
      if (gameLoopRef.current === loop) gameLoopRef.current = null;
    };
  }, [renderGameFrame, stepSim]);

  const startGame = useCallback(
    (m: GameMode, diff: Difficulty) => {
      modeRef.current = m;
      difficultyRef.current = diff;
      setMode(m);
      setDifficulty(diff);
      resetMatch();
      phaseRef.current = 'playing';
      setPhase('playing');
      SoundManager.play('arcadeBet');
      gameLoopRef.current?.stop();
      gameLoopRef.current?.start();
    },
    [resetMatch],
  );

  const backToMenu = useCallback(() => {
    gameLoopRef.current?.stop();
    flashRef.current = null; // drop any lingering goal flash before the idle draw
    chipsRef.current = [];
    ringsRef.current = [];
    trailRef.current = [];
    shakeRef.current = 0;
    phaseRef.current = 'menu';
    setPhase('menu');
    setWinner(null);
  }, []);

  // ── Pointer input ──
  const pointerToTable = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: BASE_W / 2, y: BASE_H / 2 };
    const rect = canvas.getBoundingClientRect();
    const rx = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
    const ry = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
    return {
      x: Math.max(0, Math.min(1, rx)) * BASE_W,
      y: Math.max(0, Math.min(1, ry)) * BASE_H,
    };
  }, []);

  const assignPointer = useCallback(
    (e: React.PointerEvent) => {
      const pt = pointerToTable(e.clientX, e.clientY);
      // Which half did the pointer land in?
      const half: 'top' | 'bottom' = pt.y < BASE_H / 2 ? 'top' : 'bottom';
      // In vs-AI the top half is the AI's — a pointer there is ignored so the
      // human can only drive the bottom mallet.
      if (modeRef.current === 'ai' && half === 'top') return;
      pointerMalletRef.current.set(e.pointerId, half);
      pointerTargetRef.current[half] = pt;
    },
    [pointerToTable],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (phaseRef.current !== 'playing') return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      try {
        (e.target as Element).setPointerCapture?.(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
      assignPointer(e);
    },
    [assignPointer],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (phaseRef.current !== 'playing') return;
      const side = pointerMalletRef.current.get(e.pointerId);
      if (side) {
        // This pointer already owns a mallet — keep steering it (even if the
        // finger crosses the center line, it stays bound to its half's mallet).
        pointerTargetRef.current[side] = pointerToTable(e.clientX, e.clientY);
        return;
      }
      // A moving mouse with no button is still allowed to steer its half so the
      // desktop player can use hover-to-move.
      if (e.pointerType === 'mouse') {
        const pt = pointerToTable(e.clientX, e.clientY);
        const half: 'top' | 'bottom' = pt.y < BASE_H / 2 ? 'top' : 'bottom';
        if (modeRef.current === 'ai' && half === 'top') return;
        pointerTargetRef.current[half] = pt;
      }
    },
    [pointerToTable],
  );

  const releasePointer = useCallback((e: React.PointerEvent) => {
    const side = pointerMalletRef.current.get(e.pointerId);
    if (side) {
      pointerMalletRef.current.delete(e.pointerId);
      // Clear this half's target only if no OTHER pointer still owns it (two
      // fingers could share a half briefly). Then the human mallet eases to a
      // stop and keyboard control can resume.
      let stillOwned = false;
      pointerMalletRef.current.forEach((s) => {
        if (s === side) stillOwned = true;
      });
      if (!stillOwned) pointerTargetRef.current[side] = null;
      return;
    }
    // A hovering mouse (never pressed → not in the map) leaving the canvas:
    // release any hover-driven target so arrow keys can take over. Touch
    // pointers are tracked in the map above, so this only affects the mouse.
    if (e.pointerType === 'mouse') {
      pointerTargetRef.current.top = null;
      pointerTargetRef.current.bottom = null;
    }
  }, []);

  // ── Keyboard input ──
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (phaseRef.current !== 'playing') return;
      const tracked = [
        'KeyW',
        'KeyA',
        'KeyS',
        'KeyD',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
      ];
      if (tracked.includes(e.code)) {
        keysRef.current[e.code] = true;
        e.preventDefault();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      keysRef.current[e.code] = false;
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  // ── Reduced motion ──
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      reducedMotionRef.current = mq.matches;
    };
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // ── Responsive sizing — the rink fills the wide stage (portrait table) ──
  useEffect(() => {
    const updateSize = () => {
      const container = containerRef.current;
      if (!container) return;
      const reservedVertical = window.innerHeight < 700 ? 200 : 250;
      const maxWidth = Math.min(window.innerWidth - 24, 560);
      const maxHeight = Math.min(window.innerHeight - reservedVertical, BASE_H);
      const scale = Math.min(maxWidth / BASE_W, maxHeight / BASE_H, 1.15);
      const dpr = gameCanvasDpr(BASE_W * scale, BASE_H * scale);
      scaleRef.current = scale * dpr;
      setCanvasSize({
        width: Math.floor(BASE_W * scale),
        height: Math.floor(BASE_H * scale),
        dpr,
      });
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // ── Idle render when not playing (so the menu shows the rink). Runs a light
  //    rAF loop for the ambient sheen; reduced motion draws one static frame. ──
  useEffect(() => {
    if (phase === 'playing') return;
    const canvas = canvasRef.current;
    const ctx = canvas ? getGame2dContext(canvas) : null;
    if (!canvas || !ctx) return;
    let raf = 0;
    const renderIdle = (timeMs: number) => {
      ctx.save();
      ctx.scale(scaleRef.current, scaleRef.current);
      draw(ctx, timeMs / 1000);
      ctx.restore();
      // No ambient motion under reduced motion — one static frame is enough.
      if (!reducedMotionRef.current) raf = requestAnimationFrame(renderIdle);
    };
    raf = requestAnimationFrame(renderIdle);
    return () => cancelAnimationFrame(raf);
  }, [phase, canvasSize, draw]);

  const touch = useIsTouchDevice();

  // Static header card (local game — no wallet/score submission).
  const walletCard = null;

  return (
    <div className='airhockey-midway arc-game-flow'>
      <div className='w-full space-y-3 sm:space-y-4'>
        <div className='mx-auto w-full max-w-3xl'>
          <div className='hidden sm:block'>
            <PageHeader
              eyebrow='tixy'
              title='Air Hockey'
              subtitle='Hot-seat two-player or take on the house. First to 7 wins.'
              wallet={walletCard}
            />
          </div>
          <div className='sm:hidden'>
            <h1 className='arcade-display text-center text-2xl text-strong uppercase'>
              Air Hockey
            </h1>
          </div>
        </div>
        <GamesRouteSwitcher />

        <div ref={containerRef} className='relative touch-none flex justify-center'>
          <div
            className='airhockey-stage relative'
            style={{ width: canvasSize.width, height: canvasSize.height }}
          >
            <canvas
              ref={canvasRef}
              width={Math.floor(canvasSize.width * canvasSize.dpr)}
              height={Math.floor(canvasSize.height * canvasSize.dpr)}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={releasePointer}
              onPointerCancel={releasePointer}
              onPointerLeave={releasePointer}
              className='block touch-none rounded-well border-2 border-ink'
              style={{
                touchAction: 'none',
                width: canvasSize.width,
                height: canvasSize.height,
                cursor: phase === 'playing' ? 'none' : 'default',
              }}
            />

            {/* In-play live score chips above each goal (React overlay, no glow). */}
            {phase === 'playing' && (
              <div className='pointer-events-none absolute inset-0'>
                <div
                  key={`top-${scoreTop}`}
                  className='airhockey-score-punch absolute left-1/2 top-2 -translate-x-1/2 rounded-tag border border-ink bg-[color-mix(in_srgb,var(--shadow-color)_55%,transparent)] px-2 py-0.5'
                >
                  <span className='arcade-num text-sm font-semibold text-danger-text'>
                    {mode === 'ai' ? 'CPU' : 'P1'} {scoreTop}
                  </span>
                </div>
                <div
                  key={`bottom-${scoreBottom}`}
                  className='airhockey-score-punch absolute bottom-2 left-1/2 -translate-x-1/2 rounded-tag border border-ink bg-[color-mix(in_srgb,var(--shadow-color)_55%,transparent)] px-2 py-0.5'
                >
                  <span className='arcade-num text-sm font-semibold text-prize-text'>
                    YOU {scoreBottom}
                  </span>
                </div>
              </div>
            )}

            {/* ── Mode select overlay ── */}
            {phase === 'menu' && (
              <div
                className='airhockey-overlay absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-well px-5 text-center'
                style={{
                  background:
                    'color-mix(in srgb, var(--scrim) 80%, transparent)',
                }}
              >
                <CircleDot size={52} className='text-prize-text' />
                <h2 className='arcade-display text-2xl text-strong uppercase sm:text-3xl'>
                  Air Hockey
                </h2>
                <p className='max-w-xs text-sm text-body'>
                  Knock the puck into your opponent&apos;s goal. First to{' '}
                  <span className='arcade-num text-strong'>{WIN_SCORE}</span> takes
                  the match.
                </p>

                <div className='flex w-full max-w-xs flex-col gap-2'>
                  <ArcadeButton
                    tone='prize'
                    size='lg'
                    className='w-full justify-center gap-2'
                    onClick={() => startGame('ai', difficulty)}
                  >
                    <Bot size={18} /> Vs Computer
                  </ArcadeButton>

                  {/* Difficulty selector (applies to vs-Computer). */}
                  <div className='flex w-full items-stretch gap-1.5'>
                    {(['easy', 'medium', 'hard'] as const).map((d) => (
                      <ArcadeButton
                        key={d}
                        tone={difficulty === d ? 'tickets' : 'ghost'}
                        size='sm'
                        pressed={difficulty === d}
                        className='flex-1 justify-center capitalize'
                        onClick={() => setDifficulty(d)}
                      >
                        {d}
                      </ArcadeButton>
                    ))}
                  </div>

                  <ArcadeButton
                    tone='primary'
                    size='lg'
                    className='mt-1 w-full justify-center gap-2'
                    onClick={() => startGame('local', difficulty)}
                  >
                    <Users size={18} /> 2 Players
                  </ArcadeButton>
                </div>

                <p className='max-w-xs text-xs text-faint'>
                  {touch
                    ? '2 Players: each player drags on their own half (two fingers work at once).'
                    : '2 Players: top uses W A S D, bottom uses the arrow keys (or drag with the mouse).'}
                </p>
              </div>
            )}

            {/* ── Win overlay ── */}
            {phase === 'gameover' && (
              <div
                className='airhockey-overlay absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-well px-5 text-center'
                style={{
                  background:
                    'color-mix(in srgb, var(--scrim) 82%, transparent)',
                }}
              >
                <div className='airhockey-confetti' aria-hidden>
                  {WIN_CONFETTI.map((c, i) => (
                    <span
                      key={i}
                      style={{
                        left: c.left,
                        background: c.color,
                        animationDelay: c.delay,
                        animationDuration: c.dur,
                      }}
                    />
                  ))}
                </div>
                <h2 className='airhockey-win-pop arcade-display text-2xl text-strong uppercase sm:text-3xl'>
                  {mode === 'ai'
                    ? winner === 'bottom'
                      ? 'You win!'
                      : 'CPU wins'
                    : winner === 'top'
                      ? 'Player 1 wins!'
                      : 'Player 2 wins!'}
                </h2>
                <p className='text-xl text-strong sm:text-2xl'>
                  <span className='arcade-num font-semibold text-danger-text'>
                    {scoreTop}
                  </span>
                  <span className='mx-2 text-faint'>—</span>
                  <span className='arcade-num font-semibold text-prize-text'>
                    {scoreBottom}
                  </span>
                </p>
                <div className='mt-1 flex flex-col gap-2'>
                  <ArcadeButton
                    tone='prize'
                    size='lg'
                    className='justify-center'
                    onClick={() => startGame(mode, difficulty)}
                  >
                    Rematch
                  </ArcadeButton>
                  <ArcadeButton
                    tone='ghost'
                    size='md'
                    className='justify-center gap-2'
                    onClick={backToMenu}
                  >
                    <ArrowLeft size={16} /> Change mode
                  </ArcadeButton>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Controls hint + actions */}
        <p className='mt-3 text-center text-xs text-faint sm:text-sm'>
          {phase === 'playing'
            ? mode === 'ai'
              ? touch
                ? 'Drag on the lower half to move your mallet'
                : 'Arrow keys or mouse-in-the-lower-half move your mallet'
              : touch
                ? 'Each player drags on their own half'
                : 'Top: W A S D · Bottom: arrow keys'
            : 'Pick a mode to start'}
        </p>

        <div className='mt-4 flex flex-col items-center gap-3 sm:mt-6 sm:gap-4'>
          <div className='flex w-full flex-wrap items-center justify-center gap-2 pb-1 sm:gap-4'>
            {phase === 'playing' ? (
              <ArcadeButton
                tone='ghost'
                size='sm'
                className='h-10 gap-1.5 px-3 py-0 text-xs sm:text-sm'
                onClick={backToMenu}
              >
                <ArrowLeft size={16} /> Quit
              </ArcadeButton>
            ) : null}
            <MuteButton />
          </div>
        </div>
      </div>
    </div>
  );
}

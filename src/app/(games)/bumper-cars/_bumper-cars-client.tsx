'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  GameShell,
  GameStage,
  GameStat,
  type GameHint,
  type GameHowTo,
  type GamePhase,
  type GameStageSize,
} from '@/features/arcade/components/shell/game-shell';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { playHaptic } from '@/features/arcade/lib/game-haptics';
import { useFeelReducedMotion, useGameFeedback, usePitchLadder } from '@/features/arcade/lib/use-game-feedback';
import { markArcadeGameReady } from '@/features/arcade/lib/arcade-performance';
import {
  applyMidwayTier,
  createMidwayDeferredTextures,
  createMidwayLightRig,
  createMidwayQualityController,
  createMidwayRenderer,
  disposeSceneDeep,
  markMidwayFirstFrame,
  MIDWAY_PALETTE,
  type MidwayDeferredTextures,
  type MidwayLightRig,
  type MidwayQualityController,
  type MidwayRendererHandle,
} from '@/features/arcade/lib/midway-three';
import { MidwayStill } from '@/features/arcade/components/midway-still';
import { ArcadeRematchButton, ArcadeRunResult } from '@/features/arcade/components/results/arcade-run-result';
import { useAccountSummary } from '@/features/arcade/components/shell/use-account-summary';
import { ArcadeGameplayCallouts } from '@/features/arcade/components/gameplay/arcade-game-hud';
import { useGameplayCallouts, useNewBestMoment } from '@/features/arcade/lib/use-gameplay-callouts';
import { isNewBest } from '@/features/arcade/lib/new-best';
import { SignInDialog } from '@/features/arcade/components/shell/sign-in-prompt';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { OnlineRound, type OnlineStatus, type SocketLike, type TicketInfo } from '@/features/arcade/lib/bumper-cars/online';
import type { WireReward, WireRoom, WireStanding } from '@/features/arcade/lib/bumper-cars/protocol';
import { CAR_COLORS, MAX_CARS, ROUND_TICKS, TICK_HZ } from '@/features/arcade/lib/bumper-cars/constants';
import { PracticeRound, type BumperView, type FeelEvent, type Pose, type SeatInfo } from '@/features/arcade/lib/bumper-cars/runtime';
import { placesFor } from '@/features/arcade/lib/bumper-cars/sim';
import { createBumperScene, RIG_CAMERA, RIG_RADIUS, RIG_TARGET, type BumperScene } from './_bumper-cars-scene';
import { createDriveInput, DRIVE_STICK_RADIUS, type DriveInput } from './_bumper-cars-input';
import { FriendsSheet, InviteSheet, LobbyPanel, type InviteFriend } from './_bumper-cars-lobby';
import { buildBumperTheme, DEFAULT_BUMPER_THEME, type BumperTheme, type InventoryCosmeticResponse } from './_bumper-cars-theme';

import './_bumper-cars.css';

const HINT: GameHint = {
  touch: 'Tap to drive a practice round.',
  pointer: 'Click to drive a practice round.',
};
const HOW_TO: GameHowTo = {
  lines: [
    'Drag or use the arrow keys to steer your car.',
    'A bump scores 1, a full-speed hit 2, and the most in 90 seconds wins.',
    'A round with people pays up to 75 tickets, and practice pays none.',
  ],
};

const POPUPS = 4;
const ORDINALS = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

type Mode = 'menu' | 'lobby' | 'round' | 'result';

type EndInfo = { reward: WireReward; settled: boolean };

type Standing = { seat: number; name: string; color: string; points: number; bumps: number; place: number; kind: SeatInfo['kind'] };

class RoomRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Ask the room route for a room and a socket ticket. */
async function roomRequest(body: Record<string, unknown>): Promise<TicketInfo> {
  const res = await fetch('/api/games/bumper-cars/room', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as
    | { error?: string; room?: WireRoom; seat?: number; ticket?: string; ws?: string }
    | null;
  if (!res.ok || !data?.room || !data.ticket) {
    throw new RoomRequestError(data?.error ?? 'The rink is busy. Try again.', res.status);
  }
  return { room: data.room, seat: data.seat ?? 0, ticket: data.ticket, ws: data.ws ?? '/ws/bumper-cars' };
}

function socketUrl(path: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}${path}`;
}

function formatClock(ticks: number): string {
  const s = Math.max(0, Math.ceil(ticks / TICK_HZ));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function BumperCarsClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const tagRefs = useRef<(HTMLDivElement | null)[]>([]);
  const popRefs = useRef<(HTMLDivElement | null)[]>([]);
  const stickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const countRef = useRef<HTMLDivElement>(null);

  const { account } = useAccountSummary();
  const myName = account?.username ?? 'You';

  const [mode, setMode] = useState<Mode>('menu');
  const [webglError, setWebglError] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);
  const [clock, setClock] = useState<string | null>(null);
  const [board, setBoard] = useState<Standing[]>([]);
  const [myPoints, setMyPoints] = useState(0);
  const [lastTen, setLastTen] = useState(false);
  const [standings, setStandings] = useState<Standing[] | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [practice, setPractice] = useState(true);
  const [room, setRoom] = useState<WireRoom | null>(null);
  const [mySeat, setMySeat] = useState(0);
  const [netStatus, setNetStatus] = useState<OnlineStatus | null>(null);
  const [endInfo, setEndInfo] = useState<EndInfo | null>(null);
  const [friends, setFriends] = useState<InviteFriend[]>([]);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rematchSent, setRematchSent] = useState(false);
  const [theme, setTheme] = useState<BumperTheme>(DEFAULT_BUMPER_THEME);
  const themeRef = useRef<BumperTheme>(DEFAULT_BUMPER_THEME);
  const [tagNames, setTagNames] = useState<Array<{ name: string; you: boolean }>>([]);
  const tagKeyRef = useRef('');

  const [best, setBest] = useState<number | null>(null);
  const bestRef = useRef<number | null>(null);
  const bestAtStartRef = useRef<number | null>(null);
  const { items: callouts, push: pushCallout, clear: clearCallouts } = useGameplayCallouts();
  const { check: newBestCheck, reset: resetNewBest } = useNewBestMoment(pushCallout, { unit: 'points', y: 22 });
  const newBestRef = useRef(newBestCheck);
  newBestRef.current = newBestCheck;
  const reducedMotion = useFeelReducedMotion();
  const { trigger } = useGameFeedback();
  const ladder = usePitchLadder();

  const modeRef = useRef<Mode>('menu');
  const onlineRef = useRef<OnlineRound | null>(null);
  const mySeatRef = useRef(0);
  const viewRef = useRef<BumperView | null>(null);
  const reducedRef = useRef(false);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const bumperRef = useRef<BumperScene | null>(null);
  const qualityRef = useRef<MidwayQualityController | null>(null);
  const rigRef = useRef<MidwayLightRig | null>(null);
  const handleRef = useRef<MidwayRendererHandle | null>(null);
  const deferredRef = useRef<MidwayDeferredTextures | null>(null);
  const deferredStartedRef = useRef(false);
  const builtSizeRef = useRef({ w: 0, h: 0 });
  const inputRef = useRef<DriveInput | null>(null);
  const rafRef = useRef(0);
  const lastFrameRef = useRef(0);
  const lastSecondRef = useRef<number | null>(null);
  const lastScoreAtRef = useRef(0);
  const popIndexRef = useRef(0);
  const humRef = useRef<{ set: (l: number) => void; stop: (ms?: number) => void } | null>(null);
  const boardKeyRef = useRef('');
  const perfStartRef = useRef<number | undefined>(typeof window === 'undefined' ? undefined : performance.now());
  const perfReadyRef = useRef(false);
  const idlePoseView = useRef<BumperView | null>(null);
  const poseRef = useRef<Pose>({ x: 0, z: 0, fx: 0, fz: 1, speed: 0, w: 0, ax: 0, az: 0 });
  const projRef = useRef({ x: 0, y: 0, behind: false });
  const shakeRef = useRef(trigger);
  shakeRef.current = trigger;

  useEffect(() => {
    reducedRef.current = reducedMotion;
  }, [reducedMotion]);

  // ── Feel: what each event sounds, shakes and buzzes like ──
  const popup = useCallback((seat: number, text: string, big: boolean) => {
    const el = popRefs.current[popIndexRef.current % POPUPS];
    popIndexRef.current += 1;
    const bumper = bumperRef.current;
    const view = viewRef.current;
    if (!el || !bumper || !view) return;
    view.pose(seat, poseRef.current);
    bumper.project(poseRef.current.x, 2.2, poseRef.current.z, projRef.current);
    const label = el.firstElementChild;
    if (label) label.textContent = text;
    el.style.left = `${projRef.current.x}px`;
    el.style.top = `${projRef.current.y}px`;
    el.dataset.tone = big ? 'combo' : 'score';
    el.dataset.run = 'false';
    void el.offsetWidth;
    el.dataset.run = 'true';
  }, []);

  const feel = useCallback(
    (events: FeelEvent[], view: BumperView, now: number) => {
      const bumper = bumperRef.current;
      const me = view.mySeat();
      for (const e of events) {
        if (e.kind === 'bump' || e.kind === 'touch') {
          const force = Math.min(1, e.speed / 6);
          const big = e.kind === 'bump' && (e.pa > 1 || e.pb > 1);
          bumper?.bump(e.a, e.b, e.x, e.z, e.nx, e.nz, e.kind === 'touch' ? force * 0.4 : force, now, big);
          const mine = e.a === me || e.b === me;
          const pitch = 1.15 - force * 0.35;
          if (e.kind === 'touch') {
            if (mine) SoundManager.play('bumperThud', { volume: 0.25, pitch: 1.2 });
            continue;
          }
          if (mine) {
            const delivered = (e.a === me ? e.pa : e.pb) > 0;
            SoundManager.play(big ? 'bumperBig' : 'bumperThud', { volume: 0.55 + 0.45 * force, pitch });
            playHaptic(big && delivered ? 'medium' : delivered ? 'tick' : 'light');
            shakeRef.current('impact', { sound: false, motion: false, shake: 0.3 + force * 0.7 });
            if (big && delivered) {
              view.hitStop(now);
              bumperRef.current?.shake(4);
            } else {
              bumperRef.current?.shake(1.5 + force * 2);
            }
          } else {
            SoundManager.play(big ? 'bumperBig' : 'bumperThud', { volume: 0.14 + 0.2 * force, pitch });
          }
        } else if (e.kind === 'wall') {
          bumper?.wall(e.car, e.x, e.z, Math.min(1, e.speed / 5), now);
          if (e.car === me) {
            SoundManager.play('bumperRail', { volume: 0.4 + 0.4 * Math.min(1, e.speed / 5) });
            bumperRef.current?.shake(1 + Math.min(1, e.speed / 5));
          }
        } else if (e.kind === 'score') {
          if (e.seat === me) {
            if (now - lastScoreAtRef.current > 3000) ladder.reset();
            lastScoreAtRef.current = now;
            trigger('collect', { pitch: ladder.next(), volume: 0.6 });
            popup(me, `+${e.points}`, e.big);
          }
        } else if (e.kind === 'phase') {
          if (e.phase === 'live') {
            SoundManager.play('bumperHorn');
            bumper?.setPowered(true);
            humRef.current?.stop(30);
            humRef.current = SoundManager.startHoldTone({ volume: 0.35 });
          } else if (e.phase === 'over') {
            SoundManager.play('bumperHorn', { pitch: 0.84 });
            bumper?.setPowered(false);
            humRef.current?.stop(400);
            humRef.current = null;
          }
        }
      }
    },
    [ladder, popup, trigger],
  );

  // ── The scoreboard, the clock and the end ──
  const readBoard = useCallback((view: BumperView): Standing[] => {
    const seats = view.seats();
    const points = view.points();
    const bumps = view.bumps();
    const present = seats.map((s, i) => ({ s, i })).filter(({ s }) => s.kind !== 'empty').map(({ i }) => i);
    const places = placesFor(points, present);
    return present
      .map((seat) => ({
        seat,
        name: seats[seat]!.name,
        color: seats[seat]!.color,
        points: points[seat]!,
        bumps: bumps[seat]!,
        place: places.get(seat) ?? present.length,
        kind: seats[seat]!.kind,
      }))
      .sort((a, b) => a.place - b.place || a.seat - b.seat);
  }, []);

  const finishRound = useCallback(
    (view: BumperView) => {
      const final = readBoard(view);
      setStandings(final);
      const mine = final.find((s) => s.seat === view.mySeat());
      setAnnouncement(mine ? `Round over. You came ${ORDINALS[mine.place]} with ${mine.points} points.` : 'Round over.');
      if (mine?.place === 1) {
        SoundManager.play('arcadeWin');
        playHaptic('win');
      } else {
        SoundManager.play('arcadeCashout');
      }
      inputRef.current?.reset();
      modeRef.current = 'result';
      setMode('result');
    },
    [readBoard],
  );

  // ── Frame ──
  const frame = useCallback(
    (now: number) => {
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const bumper = bumperRef.current;
      if (!renderer || !scene || !bumper) return;
      const dtMs = lastFrameRef.current ? Math.min(100, now - lastFrameRef.current) : 16;
      lastFrameRef.current = now;
      const view = viewRef.current ?? idlePoseView.current;
      if (!view) return;
      const playing = modeRef.current === 'round';
      const seated = playing || modeRef.current === 'lobby';

      if (playing && viewRef.current) {
        const me = view.mySeat();
        view.pose(me, poseRef.current);
        const input = inputRef.current?.read(poseRef.current.fx, poseRef.current.fz) ?? { steer: 0, throttle: 0 };
        view.setInput(input.steer, input.throttle);
      }
      view.update(now);
      const events = view.drainEvents();
      if (events.length > 0) feel(events, view, now);

      const phase = view.phase();
      const rt = view.roundTick();
      if (playing) {
        // Clock and count in.
        const left = phase === 'countdown' ? ROUND_TICKS : ROUND_TICKS - rt;
        const seconds = Math.ceil(Math.max(0, left) / TICK_HZ);
        if (seconds !== lastSecondRef.current) {
          lastSecondRef.current = seconds;
          setClock(formatClock(Math.max(0, left)));
          setLastTen(phase === 'live' && seconds <= 10);
          if (phase === 'live' && seconds <= 10 && seconds >= 1) SoundManager.play('bumperCount', { volume: 0.5, pitch: 1.2 });
        }
        const count = countRef.current;
        if (count) {
          const c = phase === 'countdown' ? Math.ceil(-rt / TICK_HZ) : 0;
          const text = c > 0 && c <= 3 ? String(c) : '';
          if (count.textContent !== text) {
            count.textContent = text;
            if (text) {
              SoundManager.play('bumperCount', { volume: 0.7 });
              count.dataset.run = 'false';
              void count.offsetWidth;
              count.dataset.run = 'true';
            }
          }
        }
        // Scoreboard, only when it changes.
        const points = view.points();
        const key = points.join(',');
        if (key !== boardKeyRef.current) {
          boardKeyRef.current = key;
          setBoard(readBoard(view));
          setMyPoints(points[view.mySeat()] ?? 0);
          if (view.mode === 'online') newBestRef.current(points[view.mySeat()] ?? 0, bestAtStartRef.current);
        }
        // Motor hum follows your speed.
        humRef.current?.set(Math.min(1, poseRef.current.speed / 4.6) * 0.75);
        if (view instanceof PracticeRound && view.finished()) finishRound(view);
      }

      qualityRef.current?.hold(playing && phase === 'live');
      qualityRef.current?.frame(now, dtMs);
      bumper.update(view, now, dtMs, reducedRef.current);
      renderer.render(scene, bumper.camera);

      // Name tags over the cars.
      const seats = view.seats();
      const tagKey = seats.map((x) => `${x.kind}:${x.name}`).join('|');
      if (tagKey !== tagKeyRef.current) {
        tagKeyRef.current = tagKey;
        setTagNames(seats.map((x) => ({ name: x.name, you: x.kind === 'you' })));
      }
      for (let i = 0; i < MAX_CARS; i += 1) {
        const tag = tagRefs.current[i];
        if (!tag) continue;
        const seat = seats[i];
        if (!seat || seat.kind === 'empty' || !viewRef.current || !seated) {
          tag.style.visibility = 'hidden';
          continue;
        }
        view.pose(i, poseRef.current);
        bumper.project(poseRef.current.x, 2.85, poseRef.current.z, projRef.current);
        tag.style.visibility = 'visible';
        tag.style.transform = `translate3d(${projRef.current.x.toFixed(1)}px, ${projRef.current.y.toFixed(1)}px, 0) translate(-50%, -100%)`;
      }
      // The stick.
      const stick = inputRef.current?.stick() ?? null;
      const base = stickRef.current;
      const knob = knobRef.current;
      if (base && knob) {
        if (stick && playing) {
          const len = Math.hypot(stick.dx, stick.dy);
          const k = len > DRIVE_STICK_RADIUS ? DRIVE_STICK_RADIUS / len : 1;
          base.dataset.on = 'true';
          base.style.transform = `translate3d(${stick.ox}px, ${stick.oy}px, 0)`;
          knob.style.transform = `translate3d(${stick.dx * k}px, ${stick.dy * k}px, 0)`;
        } else {
          base.dataset.on = 'false';
        }
      }
    },
    [feel, finishRound, readBoard],
  );
  const frameRef = useRef(frame);
  frameRef.current = frame;

  const loop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const tick = (now: number) => {
      frameRef.current(now);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  // ── Starting ──
  const startPractice = useCallback(() => {
    if (!rendererRef.current || !bumperRef.current) return;
    onlineRef.current?.dispose();
    onlineRef.current = null;
    setRoom(null);
    setNetStatus(null);
    setEndInfo(null);
    SoundManager.unlock();
    trigger('press', { haptic: true });
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const seedParam = Number(params?.get('bumperSeed'));
    const seed = Number.isFinite(seedParam) && seedParam > 0 ? seedParam >>> 0 : (Math.random() * 0x7fffffff) >>> 0;
    viewRef.current?.dispose();
    const view = new PracticeRound({
      seed,
      myName,
      autopilot: params?.get('bumperAutopilot') === '1',
      reducedMotion: () => reducedRef.current,
    });
    viewRef.current = view;
    bumperRef.current.setMine(view.mySeat());
    bumperRef.current.setSeatColors(view.seats().map((s) => s.color));
    boardKeyRef.current = '';
    lastSecondRef.current = null;
    ladder.reset();
    setStandings(null);
    setPractice(true);
    setLastTen(false);
    setAnnouncement('');
    modeRef.current = 'round';
    setMode('round');
    lastFrameRef.current = 0;
    loop();
  }, [ladder, loop, myName, trigger]);

  // ── Online: a real round on the server ──
  const toStandings = useCallback((list: WireStanding[], me: number): Standing[] => {
    return list.map((st) => ({
      seat: st.seat,
      name: st.name,
      color: CAR_COLORS[st.seat]!,
      points: st.points,
      bumps: st.bumps,
      place: st.place,
      kind: st.seat === me ? 'you' : st.result === 'bot' ? 'bot' : 'player',
    }));
  }, []);

  const backToMenu = useCallback((message: string | null) => {
    onlineRef.current?.dispose();
    onlineRef.current = null;
    viewRef.current = null;
    humRef.current?.stop(200);
    humRef.current = null;
    bumperRef.current?.setPowered(false);
    setRoom(null);
    setNetStatus(null);
    setNotice(message);
    modeRef.current = 'menu';
    setMode('menu');
  }, []);

  const goOnline = useCallback(
    (info: TicketInfo) => {
      if (!bumperRef.current) return;
      SoundManager.unlock();
      viewRef.current?.dispose();
      onlineRef.current?.dispose();
      const params = new URLSearchParams(window.location.search);
      const online = new OnlineRound({
        connect: (path) => new WebSocket(socketUrl(path)) as unknown as SocketLike,
        first: info,
        ticket: () => roomRequest({ action: 'ticket', roomId: info.room.id }),
        reducedMotion: () => reducedRef.current,
        interpolateOthers: params.get('bumperNet') === 'interp',
        onRoom: (next, seat) => {
          setRoom(next);
          setMySeat(seat);
          mySeatRef.current = seat;
          bumperRef.current?.setMine(seat);
          if (next.ph === 'lobby' && modeRef.current !== 'lobby') {
            setRematchSent(false);
            setStandings(null);
            setEndInfo(null);
            boardKeyRef.current = '';
            modeRef.current = 'lobby';
            setMode('lobby');
          } else if (next.ph === 'running' && modeRef.current !== 'round') {
            resetNewBest();
            clearCallouts();
            setStandings(null);
            setEndInfo(null);
            boardKeyRef.current = '';
            lastSecondRef.current = null;
            ladder.reset();
            modeRef.current = 'round';
            setMode('round');
          } else if (next.ph === 'closed') {
            backToMenu(null);
          }
        },
        onEnd: (end) => {
          const me = mySeatRef.current;
          const final = toStandings(end.standings, me);
          setEndInfo({ reward: end.reward, settled: end.settled });
          const mineEnd = end.standings.find((x) => x.seat === me);
          if (mineEnd && mineEnd.result !== 'forfeit' && (bestRef.current == null || mineEnd.points > bestRef.current)) {
            bestRef.current = mineEnd.points;
            setBest(mineEnd.points);
          }
          if (modeRef.current !== 'result') {
            setStandings(final);
            const mine = final.find((x) => x.seat === me);
            setAnnouncement(mine ? `Round over. You came ${ORDINALS[mine.place]} with ${mine.points} points.` : 'Round over.');
            if (mine?.place === 1) {
              SoundManager.play('arcadeWin');
              playHaptic('win');
            } else {
              SoundManager.play('arcadeCashout');
            }
            inputRef.current?.reset();
            modeRef.current = 'result';
            setMode('result');
          } else {
            setStandings(final);
          }
        },
        onStatus: (status, detail) => {
          setNetStatus(status);
          if (status === 'closed' && detail && modeRef.current !== 'result') backToMenu(detail);
        },
      });
      onlineRef.current = online;
      viewRef.current = online;
      setRoom(info.room);
      setMySeat(info.seat);
      mySeatRef.current = info.seat;
      bumperRef.current.setMine(info.seat);
      bestAtStartRef.current = bestRef.current;
      resetNewBest();
      setPractice(false);
      setNotice(null);
      setLastTen(false);
      setRematchSent(false);
      boardKeyRef.current = '';
      lastSecondRef.current = null;
      const next: Mode = info.room.ph === 'running' ? 'round' : info.room.ph === 'over' ? 'result' : 'lobby';
      modeRef.current = next;
      setMode(next);
      lastFrameRef.current = 0;
      loop();
    },
    [backToMenu, clearCallouts, ladder, loop, resetNewBest, toStandings],
  );

  const requestRoom = useCallback(
    async (body: Record<string, unknown>) => {
      if (!account) {
        setSignInOpen(true);
        return;
      }
      trigger('press', { haptic: true });
      setJoinBusy(true);
      setJoinError(null);
      try {
        const info = await roomRequest(body);
        setFriendsOpen(false);
        goOnline(info);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The rink is busy. Try again.';
        if (error instanceof RoomRequestError && error.status === 401) setSignInOpen(true);
        else if (friendsOpen) setJoinError(message);
        else setNotice(message);
      } finally {
        setJoinBusy(false);
      }
    },
    [account, friendsOpen, goOnline, trigger],
  );

  const inviteFriend = useCallback(
    async (friendId: string) => {
      const res = await fetch('/api/games/bumper-cars/room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'invite', roomId: room?.id, friendId }),
      });
      if (!res.ok) throw new Error('invite failed');
    },
    [room?.id],
  );

  const openInvite = useCallback(() => {
    setInviteOpen(true);
    void fetch('/api/games/bumper-cars/room', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { friends?: InviteFriend[] } | null) => setFriends(d?.friends ?? []))
      .catch(() => undefined);
  }, []);

  // Back to a round you're in after a reload, or to an invite link.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (!sceneReady || resumedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const join = params.get('join');
    const code = params.get('code');
    if (!account) {
      if (join || code) setSignInOpen(true);
      return;
    }
    resumedRef.current = true;
    void (async () => {
      try {
        if (join || code) {
          goOnline(await roomRequest({ action: 'join', roomId: join ?? undefined, code: code ?? undefined }));
          return;
        }
        const res = await fetch('/api/games/bumper-cars/room', { cache: 'no-store' });
        const data = (await res.json().catch(() => null)) as { room?: WireRoom | null; best?: number | null } | null;
        if (typeof data?.best === 'number') {
          bestRef.current = data.best;
          setBest(data.best);
        }
        if (data?.room) goOnline(await roomRequest({ action: 'ticket', roomId: data.room.id }));
      } catch (error) {
        setNotice(error instanceof Error ? error.message : null);
      }
    })();
  }, [account, goOnline, sceneReady]);

  // ── The scene ──
  const buildScene = useCallback(
    (width: number, height: number) => {
      const canvas = canvasRef.current;
      if (!canvas || rendererRef.current) return;
      const quality = qualityRef.current ?? createMidwayQualityController({ game: 'bumper-cars' });
      qualityRef.current = quality;
      const tier = quality.tier();
      const fallBack = () => {
        cancelAnimationFrame(rafRef.current);
        deferredRef.current?.dispose();
        deferredRef.current = null;
        rigRef.current?.dispose();
        rigRef.current = null;
        bumperRef.current?.dispose();
        bumperRef.current = null;
        if (sceneRef.current) disposeSceneDeep(sceneRef.current);
        sceneRef.current = null;
        rendererRef.current = null;
        handleRef.current?.dispose();
        handleRef.current = null;
        setWebglError(true);
      };
      const handle = createMidwayRenderer({
        canvas,
        tier,
        width,
        height,
        onPause: () => cancelAnimationFrame(rafRef.current),
        onRestore: () => {
          rigRef.current?.refreshEnvironment();
          loop();
        },
        onFallback: fallBack,
      });
      if (!handle) {
        setWebglError(true);
        return;
      }
      handleRef.current = handle;
      rendererRef.current = handle.renderer;
      builtSizeRef.current = { w: width, h: height };
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(MIDWAY_PALETTE.nightBottom);
      sceneRef.current = scene;
      const bumper = createBumperScene(scene, tier);
      bumper.setSize(width, height);
      bumper.setTheme(themeRef.current);
      bumperRef.current = bumper;
      const rig = createMidwayLightRig(handle.renderer, scene, {
        tier,
        target: RIG_TARGET,
        radius: RIG_RADIUS,
        camera: RIG_CAMERA,
      });
      rigRef.current = rig;
      rig.addPractical([0, 6, 0], { intensity: 2.2, distance: 26 });
      quality.onChange((next) => {
        applyMidwayTier(handle.renderer, rig, next, { scene, camera: bumper.camera });
      });
      const deferred = createMidwayDeferredTextures('bumper-cars', { quality });
      deferredRef.current = deferred;
      for (const job of bumper.paintDeferred()) deferred.add(job.paint, job.apply);
      deferred.add(
        () => {
          bumper.warm(handle.renderer, scene);
          return null;
        },
        () => undefined,
      );
      // The first frame: the cars parked round the rink, power off.
      idlePoseView.current = new PracticeRound({ seed: 1, myName: '' });
      idlePoseView.current.update(performance.now());
      bumper.update(idlePoseView.current, performance.now(), 16, true);
      handle.renderer.render(scene, bumper.camera);
      markMidwayFirstFrame('bumper-cars', tier);
      setSceneReady(true);
      loop();
    },
    [loop],
  );

  const fitCanvas = useCallback(({ width, height }: GameStageSize) => {
    setCanvasSize((prev) =>
      prev && prev.width === Math.floor(width) && prev.height === Math.floor(height)
        ? prev
        : { width: Math.floor(width), height: Math.floor(height) },
    );
  }, []);

  useEffect(() => {
    if (!canvasSize) return;
    buildScene(canvasSize.width, canvasSize.height);
    const renderer = rendererRef.current;
    const bumper = bumperRef.current;
    if (renderer && bumper) {
      if (builtSizeRef.current.w !== canvasSize.width || builtSizeRef.current.h !== canvasSize.height) {
        renderer.setSize(canvasSize.width, canvasSize.height, false);
        builtSizeRef.current = { w: canvasSize.width, h: canvasSize.height };
      }
      bumper.setSize(canvasSize.width, canvasSize.height);
    }
    if (rendererRef.current && !deferredStartedRef.current) {
      deferredStartedRef.current = true;
      deferredRef.current?.start();
    }
    if (perfReadyRef.current || !rendererRef.current) return;
    const raf = requestAnimationFrame(() => {
      if (perfReadyRef.current || !rendererRef.current) return;
      perfReadyRef.current = true;
      markArcadeGameReady('bumper-cars', perfStartRef.current, { renderer: 'webgl' });
    });
    return () => cancelAnimationFrame(raf);
  }, [buildScene, canvasSize]);

  // The equipped skin set: the rink, the cars' bodywork and the sound tint.
  const loadSkin = useCallback(async () => {
    try {
      const res = await fetch('/api/store/inventory?gameType=bumper-cars', { cache: 'no-store' });
      if (!res.ok) return;
      const next = buildBumperTheme((await res.json()) as InventoryCosmeticResponse);
      themeRef.current = next;
      setTheme(next);
      bumperRef.current?.setTheme(next);
    } catch {
      /* the house look stays */
    }
  }, []);
  // QA only, with ?arcadePerf=1: ?bumperSkin=<slug> draws a catalog skin
  // without owning it, for the screenshots SKINS.md asks for.
  useEffect(() => {
    if (!sceneReady) return;
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('bumperSkin');
    if (!slug || params.get('arcadePerf') !== '1') return;
    void Promise.all([import('@/features/arcade/lib/skins/counter-catalog'), import('@/features/arcade/lib/skins/skin-set'), import('./_bumper-cars-theme')]).then(
      ([catalog, sets, themes]) => {
        const item = catalog.COUNTER_SKINS.find((x) => x.id === `counter-bumper-cars-${slug}`);
        const skin = item ? sets.readSkinSet(item.assetRef, 'bumper-cars') : null;
        if (!skin) return;
        const next = themes.applyBumperSkinSet({ ...DEFAULT_BUMPER_THEME }, skin);
        themeRef.current = next;
        setTheme(next);
        bumperRef.current?.setTheme(next);
      },
    );
  }, [sceneReady]);

  useEffect(() => {
    if (!account) return;
    void loadSkin();
    const handle = () => void loadSkin();
    window.addEventListener('store-inventory-updated', handle);
    return () => window.removeEventListener('store-inventory-updated', handle);
  }, [account, loadSkin]);
  useEffect(() => {
    SoundManager.setTint(theme.sound);
    return () => SoundManager.setTint('house');
  }, [theme.sound]);

  // Input lives on the field for the page's life.
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const input = createDriveInput(
      field,
      () => bumperRef.current?.screenAxes() ?? { right: [1, 0], up: [0, -1] },
      () => modeRef.current === 'round',
    );
    inputRef.current = input;
    return () => {
      input.dispose();
      inputRef.current = null;
    };
  }, [webglError]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      humRef.current?.stop(30);
      viewRef.current?.dispose();
      deferredRef.current?.dispose();
      rigRef.current?.dispose();
      bumperRef.current?.dispose();
      qualityRef.current?.dispose();
      if (sceneRef.current) disposeSceneDeep(sceneRef.current);
      handleRef.current?.dispose();
    };
  }, []);

  // Test hooks, only with ?arcadePerf=1: the recorder and the sync test read them.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.search.includes('arcadePerf=1')) return;
    const w = window as unknown as { __bumperInfo?: () => unknown };
    w.__bumperInfo = () => {
      const view = viewRef.current;
      const info = rendererRef.current?.info;
      return {
        mode: modeRef.current,
        phase: view?.phase() ?? null,
        roundTick: view?.roundTick() ?? null,
        points: view ? [...view.points()] : null,
        calls: info?.render.calls ?? null,
        triangles: info?.render.triangles ?? null,
        tier: qualityRef.current?.tier() ?? null,
        seat: view?.mySeat() ?? null,
        net: onlineRef.current?.netStats() ?? null,
        status: onlineRef.current?.connectionStatus() ?? null,
        room: onlineRef.current?.currentRoom().id ?? null,
      };
    };
    return () => {
      delete w.__bumperInfo;
    };
  }, []);

  const phase: GamePhase = mode === 'menu' ? 'ready' : mode === 'result' ? 'over' : 'playing';
  const mine = standings?.find((s) => s.kind === 'you') ?? null;

  const end = useMemo(() => {
    if (mode !== 'result' || !standings) return null;
    const place = mine?.place ?? standings.length;
    const won = place === 1;
    const newBest = !practice && isNewBest(mine?.points ?? 0, bestAtStartRef.current ?? 0) && bestAtStartRef.current != null;
    const reward = !practice && endInfo?.reward
      ? {
          awardedTickets: endInfo.reward.tickets,
          awardedCredits: endInfo.reward.tickets,
          wantedTickets: endInfo.reward.wanted,
          wantedCredits: endInfo.reward.wanted,
          ...(endInfo.reward.balanceAfter !== null ? { balanceAfter: endInfo.reward.balanceAfter } : {}),
          ...(endInfo.reward.account ? { account: endInfo.reward.account as never } : {}),
        }
      : null;
    const online = onlineRef.current;
    return (
      <ArcadeRunResult
        title={won ? 'You won' : newBest ? 'New best' : `${ORDINALS[place]} of ${standings.length}`}
        tone={won ? 'win' : newBest ? 'best' : 'neutral'}
        stats={[
          { label: 'points', value: mine?.points ?? 0, highlight: won || newBest },
          { label: 'bumps', value: mine?.bumps ?? 0 },
          { label: 'place', value: ORDINALS[place] ?? String(place) },
        ]}
        reward={reward}
        achievements={!practice && Array.isArray(endInfo?.reward?.achievements) ? (endInfo!.reward!.achievements as never[]) : undefined}
        saving={!practice && !endInfo?.settled}
        guest={!account}
        back={{ label: 'lobby', onClick: () => backToMenu(null) }}
        actions={
          practice ? (
            <ArcadeRematchButton onClick={startPractice} />
          ) : (
            <>
              <ArcadeRematchButton
                disabled={rematchSent || !online}
                onClick={() => {
                  online?.rematch();
                  setRematchSent(true);
                }}
              >
                {rematchSent ? 'ready' : 'rematch'}
              </ArcadeRematchButton>
            </>
          )
        }
      >
        <ol className='bc-standings' data-testid='bumper-standings' data-round={room?.round ?? undefined}>
          {standings.map((s) => (
            <li key={s.seat} data-seat={s.seat} data-points={s.points} data-you={s.kind === 'you' || undefined}>
              <span className='bc-dot' style={{ background: s.color }} aria-hidden='true' />
              <span className='bc-standing-place'>{s.place}</span>
              <span className='bc-standing-name'>{s.name}</span>
              <span className='bc-standing-points'>{s.points}</span>
            </li>
          ))}
        </ol>
        {!practice && rematchSent ? <p className='bc-note'>Next round when everyone is ready, or in 20 seconds.</p> : null}
      </ArcadeRunResult>
    );
  }, [account, backToMenu, endInfo, mine, mode, practice, rematchSent, room?.round, standings, startPractice]);

  const menuControls =
    mode === 'menu' || (mode === 'result' && practice) ? (
      <div className='bc-controls' data-surface='ink'>
        <ArcadeButton tone='primary' disabled={joinBusy || !sceneReady} onClick={() => void requestRoom({ action: 'play' })}>
          play
        </ArcadeButton>
        <ArcadeButton disabled={joinBusy || !sceneReady} onClick={() => (account ? setFriendsOpen(true) : setSignInOpen(true))}>
          friends
        </ArcadeButton>
        <ArcadeButton disabled={!sceneReady} onClick={startPractice}>
          practice
        </ArcadeButton>
      </div>
    ) : null;

  return (
    <GameShell
      game='bumper-cars'
      stat={mode === 'round' ? <GameStat value={clock} label='left' /> : <GameStat value={best} label='best' />}
      howTo={HOW_TO}
    >
      <GameStage
        phase={phase}
        hint={HINT}
        busy={!sceneReady && !webglError ? 'Loading the rink.' : null}
        onStart={() => startPractice()}
        startKeys={['Space', 'Enter', 'ArrowUp', 'KeyW']}
        onSize={fitCanvas}
        end={end}
        controls={menuControls}
      >
        {webglError ? (
          <MidwayStill
            game='bumper-cars'
            alt='Bumper cars: eight cars on a steel floor inside a padded red and cream rail, under string lights.'
            style={canvasSize ? { width: canvasSize.width, height: canvasSize.height } : undefined}
          />
        ) : (
          <div
            ref={fieldRef}
            className='bc-field'
            data-mode={mode}
            style={{ width: canvasSize?.width ?? '100%', height: canvasSize?.height ?? '100%' }}
          >
            <canvas
              ref={canvasRef}
              aria-label='Bumper cars. Drag or use the arrow keys to drive.'
              style={{ width: canvasSize?.width ?? '100%', height: canvasSize?.height ?? '100%' }}
            />
            <div className='bc-tags' aria-hidden='true'>
              {Array.from({ length: MAX_CARS }, (_, i) => (
                <div
                  key={i}
                  ref={(el) => {
                    tagRefs.current[i] = el;
                  }}
                  className='bc-tag'
                  data-you={tagNames[i]?.you || undefined}
                >
                  {tagNames[i]?.name ?? ''}
                </div>
              ))}
            </div>
            {mode === 'round' ? (
              <div className='bc-board' aria-hidden='true'>
                {board.map((s) => (
                  <div key={s.seat} className='bc-chip' data-you={s.kind === 'you' || undefined}>
                    <span className='bc-dot' style={{ background: s.color }} />
                    <span className='bc-chip-points'>{s.points}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {mode === 'round' ? (
              <div className='bc-me' data-warn={lastTen || undefined} aria-hidden='true'>
                <span className='bc-me-points'>{myPoints}</span>
                <span className='bc-me-label'>points</span>
              </div>
            ) : null}
            {mode === 'round' ? <ArcadeGameplayCallouts items={callouts} /> : null}
            <div ref={countRef} className='bc-count' data-run='false' aria-hidden='true' />
            <div ref={stickRef} className='bc-stick' data-on='false' aria-hidden='true'>
              <div ref={knobRef} className='bc-knob' />
            </div>
            {Array.from({ length: POPUPS }, (_, i) => (
              <div
                key={i}
                ref={(el) => {
                  popRefs.current[i] = el;
                }}
                className='arc-floater bc-pop'
                data-tone='score'
                data-numeric
                data-run='false'
                aria-hidden='true'
              >
                <span className='arc-floater-label' />
              </div>
            ))}
            {mode === 'lobby' && room ? (
              <LobbyPanel
                room={room}
                seat={mySeat}
                onStart={() => onlineRef.current?.start()}
                onLeave={() => {
                  onlineRef.current?.leave();
                  backToMenu(null);
                }}
                onInvite={openInvite}
              />
            ) : null}
            {netStatus === 'reconnecting' && mode !== 'menu' ? (
              <p className='bc-status' role='status'>
                Reconnecting. Your seat is held.
              </p>
            ) : null}
            {notice && mode === 'menu' ? (
              <p className='bc-status' role='status'>
                {notice}
              </p>
            ) : null}
            <p className='sr-only' aria-live='polite' aria-atomic='true'>
              {announcement}
            </p>
          </div>
        )}
      </GameStage>
      <FriendsSheet
        open={friendsOpen}
        onClose={() => setFriendsOpen(false)}
        busy={joinBusy}
        error={joinError}
        onCreate={() => void requestRoom({ action: 'create' })}
        onJoinCode={(code) => void requestRoom({ action: 'join', code })}
      />
      <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} room={room} friends={friends} onInviteFriend={inviteFriend} />
      <SignInDialog
        open={signInOpen}
        onClose={() => setSignInOpen(false)}
        reason='Sign in to play bumper cars with people. Your rounds and tickets are saved to your account.'
      />
    </GameShell>
  );
}


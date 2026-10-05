'use client';

/* The game shell. Every game page is one ink cabinet: a strip on top
   (back, the game's name, your best or the clock, tickets, ?, sound) and
   the stage under it, sized to the screen. No page header, no wallet card,
   no paragraph, no start card. The stage shows the game's real first frame
   with one line under it, and the first input starts the run.

     <GameShell game='stack' stat={<GameStat value={best} label='best' />} howTo={HOW_TO}>
       <GameStage phase={phase} hint={HINT} onStart={start} aspect={W / H} onSize={fit} end={result}>
         <canvas … />
       </GameStage>
     </GameShell>

   Lobbies pass no stage and put the lobby in `below`. Ticket machines put
   their machine frame where GameStage goes. The rules and a step-by-step
   for each kind of page are in docs/design/tixy-rebrand/SHELL.md. */

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { getArcadeGameBySlug } from '@/features/arcade/components/arcade-game-registry';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { ArcadeStub } from '@/features/arcade/components/ui/arcade-ui';
import { SHELL_MOMENT_ATTR } from '@/features/arcade/components/gameplay/arcade-game-hud';
import { ArcadeLoadingDots } from '@/features/arcade/components/ui/arcade-states';
import { punchTicketBalance, TICKET_BALANCE_ATTR } from '@/features/arcade/components/feedback/ticket-gain';
import { ArcadeDialog } from '@/features/arcade/components/ui/arcade-sheet';
import { Num } from '@/features/arcade/components/ui/num';
import { getGameDisplayName } from '@/features/arcade/lib/game-renames';
import { useIsTouchDevice, usePreventGameGestures } from '@/features/arcade/lib/game-mobile-utils';
import {
  FIRST_INPUT_KEYS,
  useFirstInput,
  useGameKeyGuard,
  type GameInput,
} from '@/features/arcade/lib/use-first-input';
import { useRollingNumber } from '@/features/arcade/lib/use-rolling-number';

import { GameStill } from '../game-previews/game-still';
import { hasGameStill } from '../game-previews/still-slugs';
import { useMarkGameShell } from './game-shell-presence';
import { GamesWalletProvider, useOptionalGamesWallet } from './games-wallet-provider';
import { useAccountSummary } from './use-account-summary';

import './game-shell.css';

export type { GameInput } from '@/features/arcade/lib/use-first-input';

// ── Types ───────────────────────────────────────────────────────────────

/** `ready`: the first frame, waiting for the first input. `playing`: a run
 *  is on (including a death or settle animation). `over`: the result is up. */
export type GamePhase = 'ready' | 'playing' | 'over';

/** One short sentence, sentence case, full stop: "Tap to drop." Pass both
 *  forms when touch and desktop differ. */
export type GameHint = string | { touch: string; pointer: string };

/** How to play, behind the ? button. Three lines at most, each one sentence.
 *  `picture` is a small SVG; without it the sheet shows the game's screen (the
 *  same SVG as its floor tile), or its poster if it has none. */
export type GameHowTo = {
  lines: readonly [string] | readonly [string, string] | readonly [string, string, string];
  picture?: ReactNode;
};

/** A machine's paytable for the ? sheet (MachineGlass sets it). The sheet
 *  reads it when it opens, so it never re-renders the shell. */
export function useShellHowToExtra(render: (() => ReactNode) | null) {
  const shell = useContext(ShellContext);
  const latest = useRef(render);
  useEffect(() => {
    latest.current = render;
  });
  const has = render != null;
  useEffect(() => {
    if (!shell || !has) return;
    const read = () => latest.current?.() ?? null;
    shell.howToExtra.current = read;
    return () => {
      if (shell.howToExtra.current === read) shell.howToExtra.current = null;
    };
  }, [shell, has]);
}

export type GameStageSize = { width: number; height: number };

/* What the strip needs from the stage: the phase, for the ? button, and the
   game's pause, if it has one. */
type StageState = { phase: GamePhase; onPause?: () => void };
type ShellContextValue = {
  name: string;
  setStage: (state: StageState | null) => void;
  /** More for the ? sheet, read when it opens: a machine's paytable. */
  howToExtra: { current: (() => ReactNode) | null };
};
const ShellContext = createContext<ShellContextValue | null>(null);

// ── GameShell ───────────────────────────────────────────────────────────

export type GameShellProps = {
  /** The registry slug. Sets the name, the poster and the default back link. */
  game: string;
  /** Your best or the clock: a <GameStat>. One number, nothing else. */
  stat?: ReactNode;
  /** A game with more than one mode puts its <GameModes> here, beside the
   *  name (stacker: cabinet and endless). On phones the name gives it room
   *  and stays for screen readers. */
  modes?: ReactNode;
  howTo?: GameHowTo;
  /** The ticket balance the game already tracks. Leave it out and the shell
   *  loads it. Shown to signed-in players only. */
  tickets?: number;
  /** Where back goes. Defaults to the floor. */
  backHref?: string;
  /** Inside the cabinet, under the strip: a <GameStage>, or a machine frame.
   *  Leave it out for a lobby. */
  children?: ReactNode;
  /** Under the cabinet, on the page: the lobby, a leaderboard button row. */
  below?: ReactNode;
  /** A class for the page root, for a game's own scoped CSS. */
  className?: string;
};

export function GameShell(props: GameShellProps) {
  const wallet = useOptionalGamesWallet();
  if (props.tickets === undefined && !wallet) {
    return (
      <GamesWalletProvider>
        <GameShellFrame {...props} />
      </GamesWalletProvider>
    );
  }
  return <GameShellFrame {...props} />;
}

function GameShellFrame({
  game,
  stat,
  modes,
  howTo,
  tickets,
  backHref = '/',
  children,
  below,
  className,
}: GameShellProps) {
  const entry = getArcadeGameBySlug(game);
  const name = getGameDisplayName(game, entry?.title ?? game).toLowerCase();
  const cabinetRef = useRef<HTMLDivElement>(null);
  const hasStage = children != null && children !== false;
  const top = useDocumentTop(cabinetRef, hasStage);
  const [stage, setStage] = useState<StageState | null>(null);
  const howToExtra = useRef<(() => ReactNode) | null>(null);
  useMarkGameShell();

  return (
    <ShellContext.Provider value={{ name, setStage, howToExtra }}>
      <div className={['arc-shell', className].filter(Boolean).join(' ')} data-game={game}>
        <div
          ref={cabinetRef}
          className='arc-shell-cabinet'
          data-stage={hasStage || undefined}
          style={top == null ? undefined : ({ '--shell-top': `${top}px` } as CSSProperties)}
        >
          <header className='arc-shell-strip' data-surface='ink'>
            <Link
              href={backHref}
              className='arc-shell-icon'
              aria-label={backHref === '/' ? 'back to the floor' : 'back'}
            >
              <ChevronLeft size={22} strokeWidth={2} strokeLinecap='square' aria-hidden />
            </Link>
            <h1 className='arc-shell-name' data-modes={modes ? '' : undefined}>
              {name}
            </h1>
            {modes}
            {/* A new best lands here, above the stage (ArcadeGameplayCallouts). */}
            <div className='arc-shell-moment' {...{ [SHELL_MOMENT_ATTR]: '' }} />
            <div className='arc-shell-right'>
              {stat}
              <StripTickets tickets={tickets} />
              {howTo ? (
                <HowToButton game={game} name={name} howTo={howTo} stage={stage} extra={howToExtra} />
              ) : null}
              <MuteButton />
            </div>
          </header>
          {children}
        </div>
        {below ? <div className='arc-shell-below'>{below}</div> : null}
      </div>
    </ShellContext.Provider>
  );
}

/* The cabinet's distance from the top of the document, so CSS can size it
   to the rest of the viewport. Re-measured when anything above it changes
   height (a challenge banner, an ad). */
function useDocumentTop(ref: React.RefObject<HTMLElement | null>, enabled: boolean) {
  const [top, setTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const next = Math.round(el.getBoundingClientRect().top + window.scrollY);
      setTop((prev) => (prev === next ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [enabled, ref]);
  return top;
}

// ── Strip pieces ────────────────────────────────────────────────────────

/** The strip's number: your best, the clock, your rating. `value` is a
 *  number or a preformatted string ("0:42"); `label` is one lowercase word.
 *  Pass null until the real value has loaded: the strip never shows a
 *  placeholder. */
export function GameStat({ value, label }: { value: number | string | null | undefined; label: string }) {
  if (value == null) return null;
  return (
    <span className='arc-shell-stat'>
      <Num value={value} label={`${typeof value === 'number' ? value.toLocaleString('en-US') : value} ${label}`} />
      <small aria-hidden>{label}</small>
    </span>
  );
}

/** A game's modes, in the strip beside its name: one lit at a time.
 *  `locked` while a run is on, so a run can't be switched away from. */
export function GameModes<T extends string>({
  label,
  options,
  value,
  onChange,
  locked,
}: {
  /** Lowercase, for screen readers: `mode`. */
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  locked?: boolean;
}) {
  return (
    <div role='group' aria-label={label} className='arc-shell-modes'>
      {options.map((option) => (
        <button
          key={option.value}
          type='button'
          aria-pressed={option.value === value}
          aria-disabled={(locked && option.value !== value) || undefined}
          onClick={() => {
            if (!locked && option.value !== value) onChange(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function StripTickets({ tickets }: { tickets?: number }) {
  const { account, loaded } = useAccountSummary();
  const wallet = useOptionalGamesWallet();
  const value =
    tickets !== undefined ? tickets : wallet?.loaded ? wallet.wallet.credits : null;
  // The first change after mount is the balance loading: it jumps. Later
  // changes (a payout) roll.
  const [seen, setSeen] = useState<number | null>(null);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (value == null) return;
    if (seen == null) setSeen(value);
    else if (value !== seen && !changed) setChanged(true);
  }, [value, seen, changed]);
  const rollable = changed || (tickets === undefined && seen != null);
  const shown = useRollingNumber(Math.max(0, Math.floor(value ?? 0)), {
    duration: rollable ? undefined : 0,
  });
  // Tickets arriving punch the balance as it counts up (flights land here
  // too: data-ticket-balance).
  const stubRef = useRef<HTMLSpanElement>(null);
  const lastRef = useRef<number | null>(null);
  useEffect(() => {
    if (value == null) return;
    const last = lastRef.current;
    lastRef.current = value;
    if (rollable && last != null && value > last) punchTicketBalance(stubRef.current);
  }, [value, rollable]);

  if (!loaded || !account || value == null) return null;
  return (
    <span ref={stubRef} className='arc-shell-tickets' {...{ [TICKET_BALANCE_ATTR]: '' }}>
      <ArcadeStub size='sm'>
        <Num value={shown} label={`${Math.floor(value).toLocaleString('en-US')} tickets`} />
      </ArcadeStub>
    </span>
  );
}

/* While a run is on, ? pauses the game first if it can, and does nothing
   if it can't: the sheet never opens over a live run. */
function HowToButton({
  game,
  name,
  howTo,
  stage,
  extra,
}: {
  game: string;
  name: string;
  howTo: GameHowTo;
  stage: StageState | null;
  extra: { current: (() => ReactNode) | null };
}) {
  const [open, setOpen] = useState(false);
  // A machine's paytable, read as the sheet opens.
  const [extraNode, setExtraNode] = useState<ReactNode>(null);
  const live = stage?.phase === 'playing';
  const blocked = live && !stage?.onPause;
  return (
    <>
      <button
        type='button'
        className='arc-shell-icon arc-shell-q'
        aria-label='how to play'
        aria-haspopup='dialog'
        disabled={blocked}
        onClick={() => {
          if (live) stage?.onPause?.();
          setExtraNode(extra.current?.() ?? null);
          setOpen(true);
        }}
      >
        <span className='arc-shell-q-dot' aria-hidden>
          ?
        </span>
      </button>
      <ArcadeDialog open={open} onClose={() => setOpen(false)} title={`how to play ${name}`}>
        <div className='arc-howto'>
          <div className='arc-howto-picture'>
            {howTo.picture ??
              (hasGameStill(game) ? (
                <GameStill slug={game} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/games/${game}/poster.webp`} alt='' width={320} height={200} />
              ))}
          </div>
          {howTo.lines.slice(0, 3).map((line) => (
            <p key={line}>{line}</p>
          ))}
          {extraNode}
        </div>
      </ArcadeDialog>
    </>
  );
}

/** What `end` shows when a run can't start or was cut off: a title in
 *  sentence case that says what happened ("Connection lost"), one sentence
 *  that says what to do, and one button (retry). */
export function GameStageNotice({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className='arc-shell-notice' role='alert'>
      <h2>{title}</h2>
      {children}
      {action ? <div className='arc-shell-notice-action'>{action}</div> : null}
    </section>
  );
}

// ── GameStage ───────────────────────────────────────────────────────────

export type GameStageProps = {
  phase: GamePhase;
  /** The line under the first frame. Shown only while `phase` is `ready`. */
  hint?: GameHint;
  /** Something is loading before a run can start: the session, the 3D
   *  scene. The hint row shows this sentence instead of the hint, and
   *  presses on the stage are swallowed without starting. */
  busy?: string | null;
  /** Your existing start function. While `phase` is `ready`, the first press
   *  on the screen, or one of `startKeys`, calls it once with what was
   *  pressed; your own handlers never see that press. Leave it out when the
   *  game starts from its own button. */
  onStart?: (input: GameInput) => void;
  /** KeyboardEvent.code values that start the run. Default Space, Enter,
   *  ArrowUp. A game whose first input is its first move lists its move
   *  keys (snake: the arrows and WASD). */
  startKeys?: readonly string[];
  /** Pause the run. While `playing`, the strip's ? calls it before opening
   *  the sheet; without it, ? is disabled during a run. */
  onPause?: () => void;
  /** The shared result (ArcadeRunResult, rematch first) or an error with a
   *  retry button. Drawn over the stage whenever it is not null. */
  end?: ReactNode;
  /** On-screen controls that sit under the screen, inside the cabinet: word
   *  grid's keyboard, a d-pad. The screen shrinks to make room. */
  controls?: ReactNode;
  /** Width over height of the game's drawing. The screen keeps this shape at
   *  the largest size that fits; leave it out to fill the stage. */
  aspect?: number;
  /** Called with the screen's inner size on mount and on every resize. Size
   *  your canvas from it; don't read window.innerWidth. */
  onSize?: (size: GameStageSize) => void;
  children: ReactNode;
};

const BEZEL = 5;

export function GameStage({
  phase,
  hint,
  busy,
  onStart,
  startKeys = FIRST_INPUT_KEYS,
  onPause,
  end,
  controls,
  aspect,
  onSize,
  children,
}: GameStageProps) {
  const shell = useContext(ShellContext);
  const areaRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const [size, setSize] = useState<GameStageSize | null>(null);
  const touch = useIsTouchDevice();
  const hasEnd = end != null && end !== false;

  usePreventGameGestures(phase === 'playing');
  useGameKeyGuard(startKeys, phase);
  const start = useCallback((input: GameInput) => onStart?.(input), [onStart]);
  useFirstInput({
    enabled: phase === 'ready' && onStart != null && !hasEnd,
    busy: Boolean(busy),
    onInput: start,
    target: screenRef,
    keys: startKeys,
  });

  // Tell the strip's ? what it may do.
  const setStage = shell?.setStage;
  useEffect(() => {
    setStage?.({ phase, onPause });
  }, [setStage, phase, onPause]);
  useEffect(() => () => setStage?.(null), [setStage]);

  // A run starting with focus on a strip or result button moves focus to
  // the screen, so the game's keys don't land on that button.
  useEffect(() => {
    if (phase !== 'playing') return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('.arc-shell-strip, .arc-shell-end')) {
      screenRef.current?.focus({ preventScroll: true });
    }
  }, [phase]);

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const measure = () => {
      const style = getComputedStyle(area);
      const availW =
        area.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - BEZEL * 2;
      const availH =
        area.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - BEZEL * 2;
      if (availW <= 0 || availH <= 0) return;
      let width = availW;
      let height = availH;
      if (aspect && aspect > 0) {
        width = Math.min(availW, availH * aspect);
        height = width / aspect;
      }
      const next = { width: Math.floor(width), height: Math.floor(height) };
      setSize((prev) =>
        prev && prev.width === next.width && prev.height === next.height ? prev : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, [aspect]);

  const onSizeRef = useRef(onSize);
  onSizeRef.current = onSize;
  useEffect(() => {
    if (size) onSizeRef.current?.(size);
  }, [size]);

  const hintText = hint == null ? null : typeof hint === 'string' ? hint : touch ? hint.touch : hint.pointer;
  const line = busy ? busy : phase === 'ready' && !hasEnd ? hintText : null;
  const name = shell?.name ?? 'game';
  const hasHintRow = Boolean(hintText) || Boolean(busy);

  return (
    <div className='arc-shell-stage' data-phase={phase} data-hintless={hasHintRow ? undefined : ''}>
      <div ref={areaRef} className='arc-shell-area'>
        {/* The screen takes focus, so a keyboard player can Tab back to the
            game from the strip and press Space. */}
        <div
          ref={screenRef}
          className='arc-shell-screen border-tixy-bezel'
          data-surface='ink'
          tabIndex={0}
          role='application'
          aria-roledescription='game'
          aria-label={line ? `${name}. ${line}` : name}
          aria-describedby={line ? hintId : undefined}
          style={
            aspect && size
              ? { width: size.width + BEZEL * 2, height: size.height + BEZEL * 2 }
              : undefined
          }
        >
          {children}
        </div>
        {hasEnd ? <div className='arc-shell-end'>{end}</div> : null}
      </div>
      {controls ? <div className='arc-shell-controls'>{controls}</div> : null}
      {/* A game with no hint (or none any more) gets no hint row. A game
          with one keeps the row through the run, so the stage holds still. */}
      {hasHintRow ? (
        <p id={hintId} className='arc-shell-hint' data-surface='ink' data-busy={busy ? '' : undefined}>
          {busy ? (
            <span className='arc-shell-busy'>
              <ArcadeLoadingDots />
              {line}
            </span>
          ) : (
            line
          )}
        </p>
      ) : null}
    </div>
  );
}

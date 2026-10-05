'use client';

// ===========================================================================
// MultiplayerLobby: the shared pre-game screen for every versus game.
//
// Laid out in the season page's language (multiplayer-lobby.css): panels
// told apart by tone, play now in ink and big, challenge and practice under
// it, the record as a few big numbers, the lists as cards on a panel.
//
// The three actions, always in this order:
//   (a) play now   joins the game's quick-match queue (POST
//                  /api/games/<slug>/match/queue -> { status, matchId }).
//                  While queued, a card shows the time waited and cancel,
//                  driven by the game's `<slug>Lobby` SSE topic with a 5 s
//                  poll behind it; after 45 s it says no one else is queued.
//   (b) challenge  the game's invite flow. mode 'friends' (a friend
//                  challenge, pass <MultiplayerSetupPanel/> as `panel`) or
//                  mode 'code-only' (an invite code or link).
//   (c) practice   `bot` (levels and onStart), or `practiceSolo` for a game
//                  with no bot (typing duel links to the solo test).
//
// Slots (the game supplies its own pieces; the lobby places them):
//   optionsSlot     choices above play now (LobbyChoice rows)
//   bannersSlot     banners on top (an incoming challenge)
//   headerActions   leaderboard and inventory, at the foot of the actions
//   statsSlot       the record beside the actions (LobbyRecord)
//   openMatchesSlot your games and open games under them (LobbySection)
//   extrasSlot      tournaments, full width at the bottom
//   rules           a short rules note behind a "rules" button
//
// A game that draws its own lobby (8-ball) passes `layout`: the lobby keeps
// the queue, the sign-in dialog and the challenge and practice dialogs, and
// hands the game the pieces (LobbyLayoutParts). `bot.oneTap` starts practice
// at defaultDifficulty with no pop-up; `bot.guests` lets guests practice.
//
// Guests see the whole lobby. Pressing an action asks them to sign in, in a
// dialog. The record becomes one "Sign in to ..." line and the lists go. The
// lobby reads the session itself; a page that already knows (its matches
// request came back 401) passes `guest`. A 401 is never an error.
//
// The `queue` adapter: start() posts the queue request; poll(matchId)
// answers 'waiting', 'active' or 'gone'; cancel(matchId) posts the cancel;
// lobbyTopic is the realtime topic. Navigation is `onOpenMatch(matchId)`.
// ===========================================================================

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';

import { ArcadeButton, Num, type ArcadeEnamel } from '@/features/arcade/components/ui/arcade-ui';
import { ArcadeDialog } from '@/features/arcade/components/ui/arcade-sheet';
import { SignInDialog, SignInLine } from '@/features/arcade/components/shell/sign-in-prompt';
import { useAccountSummary } from '@/features/arcade/components/shell/use-account-summary';
import { useSearchParams } from 'next/navigation';
import { subscribeLive } from '@/lib/liveEvents';
import type { MultiplayerGameType } from '@/server/arcade/multiplayer';
import type { MultiplayerInviteResult } from '@/features/arcade/components/multiplayer-setup-panel';
import { ArcadeLoadingDots } from '@/features/arcade/components/ui/arcade-states';

import './multiplayer-lobby.css';

// ---------------------------------------------------------------------------
// Public prop types (exported for rollout agents / per-game wiring)
// ---------------------------------------------------------------------------

/** Wires the PLAY button to a game's shared quick-match endpoint. */
export type LobbyQueueAdapter = {
  /** POST the quick-match request. `matched` = paired + active now; `queued` =
   *  waiting for someone to join. */
  start: () => Promise<{ status: 'matched' | 'queued'; matchId: string }>;
  /** Poll a queued match's live status so the card can detect the transition to
   *  `active` (matched) or `gone` (row disappeared). */
  poll: (matchId: string) => Promise<'waiting' | 'active' | 'gone'>;
  /** Cancel a queued (still-waiting) match. */
  cancel: (matchId: string) => Promise<void>;
  /** Realtime topic that fires on lobby changes (e.g. `chessLobby`). */
  lobbyTopic: string;
};

/** Practice-vs-bot configuration (games with a bot backend). */
export type LobbyBotConfig = {
  difficulties: ReadonlyArray<{ id: string; label: string; sublabel?: ReactNode }>;
  defaultDifficulty: string;
  /** Start a practice match at the chosen difficulty (navigates on success). */
  onStart: (difficulty: string) => Promise<void>;
  /** Optional note shown in the bot modal (e.g. "No timer, play at your pace."). */
  note?: ReactNode;
  /** Start at `defaultDifficulty` in one tap, with no difficulty pop-up. The
   *  game offers the difficulty somewhere else. Default false. */
  oneTap?: boolean;
  /** Guests may practice: the tap calls `onStart` instead of asking them to
   *  sign in. Throw `LobbySignInRequired` from `onStart` to ask after all.
   *  Default false. */
  guests?: boolean;
};

/** Thrown by `bot.onStart` when the server wants an account after all. */
export class LobbySignInRequired extends Error {
  constructor() {
    super('Sign in to play.');
    this.name = 'LobbySignInRequired';
  }
}

/** What a game that draws its own lobby gets (`layout`). */
export type LobbyLayoutParts = {
  guest: boolean;
  play: {
    onPress: () => void;
    busy: boolean;
    queued: boolean;
    /** The queue's status card while queued, ready to place. */
    queueCard: ReactNode;
  };
  challenge: { onPress: () => void };
  practice: { onPress: () => void; busy: boolean } | null;
  /** Ask a guest to sign in, with the lobby's usual reason. */
  askSignIn: () => void;
  error: string | null;
  dismissError: () => void;
  /** The challenge, sign-in and practice dialogs. Render once. */
  dialogs: ReactNode;
};

/** Challenge-a-player configuration. */
export type LobbyChallengeConfig =
  | {
      mode: 'friends';
      /** Rendered inside the challenge modal, typically a <MultiplayerSetupPanel/>. */
      panel: ReactNode;
    }
  | {
      mode: 'code-only';
      gameType: MultiplayerGameType;
      /** Create an invite code/link; returned invite is shown for copy/share. */
      onCreateCodeInvite: () => Promise<MultiplayerInviteResult | void>;
      /** Join a match/table by the resolved target id + code. */
      onJoinByCode: (targetId: string, inviteCode?: string) => Promise<void> | void;
    };

export type MultiplayerLobbyProps = {
  gameType: MultiplayerGameType;
  gameName: string;
  /** Kept for callers; the lobby draws play now in ink. */
  accent?: ArcadeEnamel;
  queue: LobbyQueueAdapter;
  /** Navigate into a match once matched/joined. */
  onOpenMatch: (matchId: string) => void;
  challenge: LobbyChallengeConfig;
  /** Practice-vs-bot config. Omit for games with no bot (use practiceSolo). */
  bot?: LobbyBotConfig;
  /** Solo-practice link fallback (typing-duel: "Practice solo" → /typing-test). */
  practiceSolo?: { href: string; label?: string; note?: ReactNode };

  // Slots
  optionsSlot?: ReactNode;
  bannersSlot?: ReactNode;
  headerActions?: ReactNode;
  statsSlot?: ReactNode;
  openMatchesSlot?: ReactNode;
  extrasSlot?: ReactNode;
  rules?: ReactNode;

  /** Externally-surfaced error (component also raises its own). */
  error?: string | null;
  onDismissError?: () => void;
  /** Signed out. Defaults to what the session says. */
  guest?: boolean;
  /** Draw the lobby yourself from its parts. See LobbyLayoutParts. */
  layout?: (parts: LobbyLayoutParts) => ReactNode;
};

// 45s of waiting → gently suggest the other two actions (never auto-cancel).
const QUEUE_FALLBACK_HINT_MS = 45_000;
// Safety-net poll cadence; the SSE topic is the primary matched signal.
const QUEUE_POLL_MS = 5_000;

type QueueState =
  | { phase: 'idle' }
  | { phase: 'queued'; matchId: string; startedAt: number };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MultiplayerLobby({
  // `gameType` is part of the public prop contract (rollout agents pass it and
  // future shell logic may branch on it), but the shell doesn't read it today.
  gameType: _gameType,
  gameName,
  // The primary is ink under tixy; the accent is part of the contract only.
  accent: _accent = 'primary',
  queue,
  onOpenMatch,
  challenge,
  bot,
  practiceSolo,
  optionsSlot,
  bannersSlot,
  headerActions,
  statsSlot,
  openMatchesSlot,
  extrasSlot,
  rules,
  error,
  onDismissError,
  guest: guestProp,
  layout,
}: MultiplayerLobbyProps) {
  const { account, loaded: accountLoaded } = useAccountSummary();
  const guest = guestProp ?? (accountLoaded && !account);
  const [showSignIn, setShowSignIn] = useState(false);
  // A guest who followed an invite link (?code= or ?join=) is asked to sign
  // in at once; the link stays in the sign-in page's next=, so they land
  // back on it signed in. The page skips its auto-join for guests.
  const searchParams = useSearchParams();
  const inviteLink = Boolean(searchParams.get('code') || searchParams.get('join'));
  const [inviteAsked, setInviteAsked] = useState(false);
  useEffect(() => {
    if (guest && inviteLink && !inviteAsked) {
      setInviteAsked(true);
      setShowSignIn(true);
    }
  }, [guest, inviteLink, inviteAsked]);
  const [queueState, setQueueState] = useState<QueueState>({ phase: 'idle' });
  const [queueBusy, setQueueBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [localError, setLocalError] = useState<string | null>(null);
  const [showChallenge, setShowChallenge] = useState(false);
  const [showBot, setShowBot] = useState(false);
  const [showRules, setShowRules] = useState(false);

  // Keep a ref so the SSE handler always sees the latest matchId without
  // re-subscribing on every render.
  const openMatchRef = useRef(onOpenMatch);
  openMatchRef.current = onOpenMatch;

  const resetQueue = useCallback(() => setQueueState({ phase: 'idle' }), []);

  const handleMatched = useCallback((matchId: string) => {
    setQueueState({ phase: 'idle' });
    openMatchRef.current(matchId);
  }, []);

  const onPlay = useCallback(async () => {
    if (guest) {
      setShowSignIn(true);
      return;
    }
    if (queueBusy || queueState.phase !== 'idle') return;
    setQueueBusy(true);
    setLocalError(null);
    try {
      const result = await queue.start();
      if (result.status === 'matched') {
        handleMatched(result.matchId);
      } else {
        setQueueState({ phase: 'queued', matchId: result.matchId, startedAt: Date.now() });
        setNowTs(Date.now());
      }
    } catch (err) {
      setLocalError((err as Error).message);
    } finally {
      setQueueBusy(false);
    }
  }, [guest, queue, queueBusy, queueState.phase, handleMatched]);

  const onCancel = useCallback(async () => {
    if (queueState.phase !== 'queued' || cancelling) return;
    const { matchId } = queueState;
    setCancelling(true);
    // Drop out of the queued phase up front so the matched-transition watcher
    // unsubscribes immediately, otherwise the `match_cancelled` broadcast (or
    // an in-flight poll) would hit the row we're about to delete and log a 404.
    resetQueue();
    try {
      await queue.cancel(matchId);
    } catch (err) {
      // The opponent may have joined in the same instant the cancel fired -
      // the match is no longer cancellable. Re-check and open it if so.
      try {
        const status = await queue.poll(matchId);
        if (status === 'active') {
          handleMatched(matchId);
          return;
        }
      } catch { /* fall through to error */ }
      setLocalError((err as Error).message);
    } finally {
      setCancelling(false);
    }
  }, [queue, queueState, cancelling, resetQueue, handleMatched]);

  // Elapsed-time ticker while queued.
  useEffect(() => {
    if (queueState.phase !== 'queued') return;
    const interval = setInterval(() => setNowTs(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [queueState.phase]);

  // Matched-transition watcher: SSE-primary + poll fallback.
  useEffect(() => {
    if (queueState.phase !== 'queued') return;
    const { matchId } = queueState;
    let active = true;

    const check = async () => {
      if (!active) return;
      try {
        const status = await queue.poll(matchId);
        if (!active) return;
        if (status === 'active') {
          active = false;
          handleMatched(matchId);
        } else if (status === 'gone') {
          active = false;
          resetQueue();
        }
      } catch { /* transient, retry on next tick */ }
    };

    const unsub = subscribeLive([queue.lobbyTopic], () => { void check(); });
    const poll = setInterval(() => { void check(); }, QUEUE_POLL_MS);
    // Immediate re-check in case the join landed between start() and mount.
    const kickoff = setTimeout(() => { void check(); }, 800);

    return () => {
      active = false;
      unsub();
      clearInterval(poll);
      clearTimeout(kickoff);
    };
  }, [queueState, queue, handleMatched, resetQueue]);

  const queued = queueState.phase === 'queued';
  const elapsedMs = queued ? Math.max(0, nowTs - queueState.startedAt) : 0;
  const showFallbackHint = queued && elapsedMs >= QUEUE_FALLBACK_HINT_MS;

  const shownError = error ?? localError;

  const openChallenge = useCallback(
    () => (guest ? setShowSignIn(true) : setShowChallenge(true)),
    [guest],
  );
  const [practiceBusy, setPracticeBusy] = useState(false);
  const startPracticeNow = useCallback(async () => {
    if (!bot || practiceBusy) return;
    setPracticeBusy(true);
    setLocalError(null);
    try {
      await bot.onStart(bot.defaultDifficulty);
      // Navigation is owned by onStart; stay busy until the page changes.
    } catch (err) {
      setPracticeBusy(false);
      if (err instanceof LobbySignInRequired) {
        setShowSignIn(true);
        return;
      }
      setLocalError((err as Error).message);
    }
  }, [bot, practiceBusy]);
  const openBot = useCallback(() => {
    if (guest && !bot?.guests) {
      setShowSignIn(true);
      return;
    }
    if (bot?.oneTap) {
      void startPracticeNow();
      return;
    }
    setShowBot(true);
  }, [guest, bot, startPracticeNow]);

  const dialogs = (
    <>
      <LobbyModal
        open={showChallenge}
        title='challenge'
        onClose={() => setShowChallenge(false)}
        wide
      >
        {challenge.mode === 'friends' ? (
          challenge.panel
        ) : (
          <CodeOnlyChallenge
            gameType={challenge.gameType}
            onCreateCodeInvite={challenge.onCreateCodeInvite}
            onJoinByCode={challenge.onJoinByCode}
          />
        )}
      </LobbyModal>
      <SignInDialog
        open={showSignIn}
        onClose={() => setShowSignIn(false)}
        reason={
          inviteLink
            ? `Sign in to join this ${gameName.toLowerCase()} game. The invite opens again once you are in.`
            : `Sign in to play ${gameName.toLowerCase()}. Your games and rating are saved to your account.`
        }
      />
      {bot && !bot.oneTap ? (
        <BotMatchModal open={showBot} config={bot} onClose={() => setShowBot(false)} />
      ) : null}
    </>
  );

  if (layout) {
    return (
      <>
        {layout({
          guest,
          play: {
            onPress: () => void onPlay(),
            busy: queueBusy,
            queued,
            queueCard: queued ? (
              <QueueStatusCard
                elapsedMs={elapsedMs}
                cancelling={cancelling}
                onCancel={onCancel}
                showFallbackHint={showFallbackHint}
                onOpenChallenge={openChallenge}
                onOpenPractice={bot ? openBot : undefined}
              />
            ) : null,
          },
          challenge: { onPress: openChallenge },
          practice: bot ? { onPress: openBot, busy: practiceBusy } : null,
          askSignIn: () => setShowSignIn(true),
          error: shownError ?? null,
          dismissError: () => {
            setLocalError(null);
            onDismissError?.();
          },
          dialogs,
        })}
      </>
    );
  }

  return (
    <div className='ml'>
      {bannersSlot}

      {shownError ? (
        <div className='ml-banner' data-tone='error' role='alert'>
          <p>{shownError}</p>
          <span className='ml-banner-actions'>
            <ArcadeButton
              onClick={() => {
                setLocalError(null);
                onDismissError?.();
              }}
            >
              ok
            </ArcadeButton>
          </span>
        </div>
      ) : null}

      <div className='ml-grid'>
        {/* The three actions: play now dominates; challenge and practice
            sit under it; leaderboard, inventory and the rules at the foot. */}
        <section className='ml-panel' aria-label={`play ${gameName.toLowerCase()}`}>
          {optionsSlot ? <div className='ml-options'>{optionsSlot}</div> : null}

          {queued ? (
            <QueueStatusCard
              elapsedMs={elapsedMs}
              cancelling={cancelling}
              onCancel={onCancel}
              showFallbackHint={showFallbackHint}
            />
          ) : (
            <button type='button' onClick={onPlay} disabled={queueBusy} className='ml-go'>
              {queueBusy ? <ArcadeLoadingDots /> : null}
              play now
            </button>
          )}

          <div className='ml-more'>
            <ArcadeButton onClick={openChallenge}>challenge</ArcadeButton>
            {bot ? (
              <ArcadeButton onClick={openBot} disabled={practiceBusy}>
                {practiceBusy ? <ArcadeLoadingDots /> : null}
                practice
              </ArcadeButton>
            ) : practiceSolo ? (
              <a href={practiceSolo.href} data-tone='key' data-size='md' className='arc-key'>
                {practiceSolo.label ?? 'practice solo'}
              </a>
            ) : null}
          </div>

          {headerActions || rules ? (
            <div className='ml-links'>
              {headerActions}
              {rules ? (
                <ArcadeButton
                  tone='ghost'
                  size='sm'
                  onClick={() => setShowRules((v) => !v)}
                  aria-expanded={showRules}
                >
                  rules
                </ArcadeButton>
              ) : null}
            </div>
          ) : null}
          {rules && showRules ? <div className='ml-rules'>{rules}</div> : null}
        </section>

        {/* Your record beside the actions. A guest gets one line. */}
        {statsSlot ? (
          guest ? (
            <aside className='ml-panel'>
              <SignInLine action='keep your games and rating' />
            </aside>
          ) : (
            <aside className='min-w-0'>{statsSlot}</aside>
          )
        ) : null}

        {/* Your games and the open ones, under the actions. Nothing for a
            guest: the line above already asks. */}
        {openMatchesSlot && !guest ? <div className='ml-wide min-w-0'>{openMatchesSlot}</div> : null}

        {extrasSlot ? <div className='ml-wide min-w-0 space-y-3'>{extrasSlot}</div> : null}
      </div>

      {/* Challenge modal (kept mounted so exit motion can play), the
          sign-in dialog for a guest who pressed an action, and the
          practice-vs-bot modal. */}
      {dialogs}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces a lobby page builds its slots from (chess, connect four)
// ---------------------------------------------------------------------------

export type LobbyChoiceOption<T extends string> = {
  id: T;
  label: string;
  /** A number beside the word: a clock, a bot's rating. */
  num?: ReactNode;
  /** What a screen reader hears for this option, if more than the word. */
  ariaLabel?: string;
};

/** One option row: the word, then its choices as segments. */
export function LobbyChoice<T extends string>({
  label,
  value,
  options,
  onChange,
  note,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<LobbyChoiceOption<NoInfer<T>>>;
  onChange: (value: NoInfer<T>) => void;
  note?: ReactNode;
}) {
  const groupId = useId();
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = options.findIndex((o) => o.id === value);
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else return;
    event.preventDefault();
    const option = options[next];
    if (!option) return;
    onChange(option.id);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };
  return (
    <div className='ml-choice'>
      <span id={groupId} className='ml-choice-label'>
        {label}
      </span>
      <div className='ml-seg' role='radiogroup' aria-labelledby={groupId} onKeyDown={onKeyDown}>
        {options.map((o) => {
          const on = o.id === value;
          return (
            <button
              key={o.id}
              type='button'
              role='radio'
              aria-checked={on}
              aria-label={o.ariaLabel}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(o.id)}
            >
              {o.label}
              {o.num != null ? <span className='ml-seg-num'>{o.num}</span> : null}
            </button>
          );
        })}
      </div>
      {note ? <p className='ml-choice-note'>{note}</p> : null}
    </div>
  );
}

/** Your record in a rated game: the rating big, then wins, losses and draws
 *  once there are any. A new player gets a sentence, not a row of zeros. */
export function LobbyRecord({
  rating,
  peak,
  wins,
  losses,
  draws,
  facts,
  children,
}: {
  rating: number;
  peak?: number | null;
  wins: number;
  losses: number;
  draws?: number | null;
  /** One sentence of numbers under the record: "52% won. Best streak 4." */
  facts?: ReactNode;
  /** A chart, under the numbers. */
  children?: ReactNode;
}) {
  const played = wins + losses + (draws ?? 0);
  return (
    <section className='ml-panel' aria-label='your record'>
      <h2>your record</h2>
      <p className='ml-rating'>
        <span className='ml-rating-num'>
          <Num value={rating} label={`rating ${rating}`} />
        </span>
        <span className='ml-rating-word'>
          rating
          {peak != null && peak > rating ? (
            <>
              , best <Num value={peak} />
            </>
          ) : null}
        </span>
      </p>
      {played === 0 ? (
        <p className='ml-sub'>
          No rated games yet. Everyone starts at <Num value={rating} />.
        </p>
      ) : (
        <>
          <ul className='ml-nums'>
            <li>
              <span className='ml-num'>
                <Num value={wins} />
              </span>
              <small>{wins === 1 ? 'win' : 'wins'}</small>
            </li>
            <li>
              <span className='ml-num'>
                <Num value={losses} />
              </span>
              <small>{losses === 1 ? 'loss' : 'losses'}</small>
            </li>
            {draws != null ? (
              <li>
                <span className='ml-num'>
                  <Num value={draws} />
                </span>
                <small>{draws === 1 ? 'draw' : 'draws'}</small>
              </li>
            ) : null}
          </ul>
          {facts ? <p className='ml-sub'>{facts}</p> : null}
        </>
      )}
      {children}
    </section>
  );
}

/** A titled list inside the games panel. Renders nothing when empty. */
export function LobbySection({
  title,
  count,
  action,
  collapsible = false,
  scroll = false,
  children,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  /** Closed until the title is pressed. */
  collapsible?: boolean;
  scroll?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const shown = !collapsible || open;
  return (
    <section className='ml-section'>
      <h3>
        {collapsible ? (
          <button type='button' onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {title}
            {count != null ? <Num value={count} /> : null}
            <ChevronDown size={18} strokeWidth={2} strokeLinecap='square' aria-hidden />
          </button>
        ) : (
          <span>
            {title}
            {count != null ? (
              <>
                {' '}
                <Num value={count} />
              </>
            ) : null}
          </span>
        )}
        {shown ? action : null}
      </h3>
      {shown ? (
        <ul className='ml-list' data-scroll={scroll || undefined}>
          {children}
        </ul>
      ) : null}
    </section>
  );
}

export type LobbyRowState = { text: string; tone?: 'turn' | 'won' | 'lost' };

/** One game in a list: who, where it stands, one button. */
export function LobbyRow({
  name,
  state,
  meta,
  href,
  action,
}: {
  name: ReactNode;
  state?: LobbyRowState | null;
  meta?: ReactNode;
  /** The row opens the game. */
  href?: string;
  action?: ReactNode;
}) {
  const body = (
    <>
      <strong>{name}</strong>
      {state || meta ? (
        <small>
          {state ? (
            <span className='ml-row-state' data-tone={state.tone}>
              {state.text}
            </span>
          ) : null}
          {state && meta ? ', ' : null}
          {meta}
        </small>
      ) : null}
    </>
  );
  return (
    <li>
      {href ? (
        <Link href={href} className='ml-row-main'>
          {body}
        </Link>
      ) : (
        <span className='ml-row-main'>{body}</span>
      )}
      {action}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Queue-status card
// ---------------------------------------------------------------------------

function QueueStatusCard({
  elapsedMs,
  cancelling,
  onCancel,
  showFallbackHint,
  onOpenChallenge,
  onOpenPractice,
}: {
  elapsedMs: number;
  cancelling: boolean;
  onCancel: () => void;
  showFallbackHint: boolean;
  /** A lobby that hides its other actions while queued (8-ball's rail)
   *  passes them here, for the line after 45 seconds. */
  onOpenChallenge?: () => void;
  onOpenPractice?: () => void;
}) {
  return (
    <div className='ml-queue'>
      <div className='ml-queue-row'>
        <span className='ml-queue-clock' role='timer' aria-label={`${formatElapsed(elapsedMs)} in the queue`}>
          <Num value={formatElapsed(elapsedMs)} />
        </span>
        <p className='ml-queue-words'>In the queue.</p>
        <ArcadeButton onClick={onCancel} disabled={cancelling}>
          {cancelling ? <ArcadeLoadingDots /> : null}
          cancel
        </ArcadeButton>
      </div>
      {showFallbackHint ? (
        <div className='ml-queue-row'>
          <p className='ml-queue-note' aria-live='polite'>
            No one else is in the queue yet.
          </p>
          {onOpenChallenge ? (
            <ArcadeButton size='sm' onClick={onOpenChallenge}>
              challenge
            </ArcadeButton>
          ) : null}
          {onOpenPractice ? (
            <ArcadeButton size='sm' onClick={onOpenPractice}>
              practice
            </ArcadeButton>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bot match modal
// ---------------------------------------------------------------------------

function BotMatchModal({
  open,
  config,
  onClose,
}: {
  open: boolean;
  config: LobbyBotConfig;
  onClose: () => void;
}) {
  const [difficulty, setDifficulty] = useState(config.defaultDifficulty);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await config.onStart(difficulty);
      // Navigation is owned by onStart; leave the modal up until it unmounts.
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <LobbyModal open={open} title='practice' onClose={onClose}>
      <div className='ml-dialog'>
        <LobbyChoice
          label='level'
          value={difficulty}
          onChange={setDifficulty}
          options={config.difficulties.map((d) => ({
            id: d.id,
            label: d.label,
            ariaLabel: typeof d.sublabel === 'string' ? `${d.label}, ${d.sublabel}` : undefined,
          }))}
        />
        <p>
          Practice is not rated.
          {config.note ? <> {config.note}</> : null}
        </p>
        {error ? <p className='ml-error'>{error}</p> : null}
        <ArcadeButton tone='primary' size='lg' onClick={() => void start()} disabled={submitting}>
          {submitting ? <ArcadeLoadingDots /> : null}
          start
        </ArcadeButton>
      </div>
    </LobbyModal>
  );
}

// ---------------------------------------------------------------------------
// Code-only challenge (Tier B games without a targeted-challenge backend)
// ---------------------------------------------------------------------------

function CodeOnlyChallenge({
  gameType,
  onCreateCodeInvite,
  onJoinByCode,
}: {
  gameType: MultiplayerGameType;
  onCreateCodeInvite: () => Promise<MultiplayerInviteResult | void>;
  onJoinByCode: (targetId: string, inviteCode?: string) => Promise<void> | void;
}) {
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<MultiplayerInviteResult | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const result = await onCreateCodeInvite();
      if (result && 'invite' in result && result.invite) setCreated(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const join = async () => {
    const code = joinCode.trim();
    if (!code) return;
    setJoining(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/games/multiplayer/code?gameType=${encodeURIComponent(gameType)}&code=${encodeURIComponent(code)}`,
        { cache: 'no-store' },
      );
      const payload = (await res.json()) as {
        invite?: { code: string; matchId?: string; targetId?: string; tableId?: string };
        error?: string;
      };
      if (!res.ok || !payload.invite) throw new Error(payload.error || 'No game has that code.');
      const targetId = payload.invite.targetId ?? payload.invite.tableId ?? payload.invite.matchId;
      if (!targetId) throw new Error('That game is over.');
      await onJoinByCode(targetId, payload.invite.code);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setJoining(false);
    }
  };

  const invite = created?.invite ?? null;
  const shareValue = invite?.url ?? invite?.href ?? '';

  return (
    <div className='ml-dialog'>
      <section className='ml-card'>
        <h3>invite link</h3>
        <p>Anyone with the link joins your game.</p>
        <ArcadeButton tone='primary' onClick={() => void create()} disabled={creating}>
          {creating ? <ArcadeLoadingDots /> : null}
          create link
        </ArcadeButton>

        {invite ? (
          <div className='ml-code'>
            <div className='ml-code-row'>
              <span className='ml-code-value' aria-label={`code ${invite.code.split('').join(' ')}`}>
                {invite.code}
              </span>
              <ArcadeButton
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(shareValue || invite.code);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1400);
                  } catch {
                    setError('Copying is blocked here. Select the link and copy it.');
                  }
                }}
              >
                {copied ? 'copied' : 'copy link'}
              </ArcadeButton>
            </div>
            {shareValue ? (
              <input readOnly value={shareValue} aria-label='invite link' className='arcade-input min-w-0 w-full px-3' />
            ) : null}
          </div>
        ) : null}
      </section>

      <section className='ml-card'>
        <h3>join with a code</h3>
        <div className='ml-field'>
          <input
            type='text'
            value={joinCode}
            aria-label='game code'
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void join();
              }
            }}
            placeholder='code'
            className='arcade-input arcade-num px-3 font-semibold uppercase tracking-[0.12em] placeholder:normal-case'
          />
          <ArcadeButton onClick={() => void join()} disabled={joining || !joinCode.trim()}>
            {joining ? <ArcadeLoadingDots /> : null}
            join
          </ArcadeButton>
        </div>
      </section>

      {error ? <p className='ml-error' role='alert'>{error}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal shell
// ---------------------------------------------------------------------------

function LobbyModal({
  open = true,
  title,
  onClose,
  children,
  wide = false,
}: {
  open?: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  // Mobile: bottom sheet. Desktop: cabinet modal with exit motion.
  return (
    <ArcadeDialog open={open} onClose={onClose} title={title} maxWidth={wide ? 512 : 384}>
      {children}
    </ArcadeDialog>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

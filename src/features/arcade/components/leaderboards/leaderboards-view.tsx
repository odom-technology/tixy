'use client';

/* The leaderboards page. A picker with the floor games in their groups, drawn
   with the same stills as the home tiles, and a search; on phones it is a
   strip you swipe. Beside it, the board for the picked game (the shared
   board from the game's own modal), or, with nothing picked, this week's
   paid boards and where you stand on each floor board.

   The picked game and its tab live in the URL (?game=snake&mode=easy), so a
   board can be shared and survives a refresh. Picking writes the URL with
   history.pushState: no request, and back goes to the last board. A link to
   a game that isn't on the floor opens the overview. */

import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, Trophy } from 'lucide-react';
import {
  Suspense,
  use,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { ArcadeButton, ArcadeLinkButton } from '@/features/arcade/components/ui/arcade-ui';
import { Num } from '@/features/arcade/components/ui/num';
import { getGameDisplayRoute } from '@/features/arcade/lib/game-renames';
import { subscribeLive } from '@/lib/liveEvents';
import type { Standing } from '@/server/arcade/leaderboard-overview';
import type { WeeklyBoardsView } from '@/server/arcade/rewards/weekly-boards';

import { MachineWinsBoard } from './machine-wins-board';
import { getPickerGroups, pickableGame, pickableMode, type PickerGame } from './page-boards';
import { WeeklyBoardNote, WeeklyBoards } from './weekly-boards';
import './leaderboards-page.css';

const GROUPS = getPickerGroups();
const GAMES = GROUPS.flatMap(({ games }) => games);
const BY_SLUG = new Map(GAMES.map((game) => [game.slug, game]));

/* The boards the admin clear endpoint knows. */
const CLEARABLE = new Set(['snake', '2048', '8-ball', 'chess']);

function boardUrl(slug: string | null, mode?: string | null) {
  const params = new URLSearchParams();
  if (slug) params.set('game', slug);
  if (slug && mode) params.set('mode', mode);
  const query = params.toString();
  return query ? `?${query}` : '?';
}

/* A plain click picks in place; a modified click opens the link as usual. */
function inPlace(event: MouseEvent) {
  return !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0);
}

/* The game's screen in an ink bezel: its still, or its poster. */
function Screen({ slug, still, size }: { slug: string; still: ReactNode; size: 'sm' | 'lg' }) {
  const [missing, setMissing] = useState(false);
  return (
    <span className='lb-screen' data-size={size} aria-hidden='true'>
      {still ??
        (missing ? null : (
          <Image
            src={`/games/${slug}/poster.webp`}
            alt=''
            width={240}
            height={150}
            quality={70}
            sizes={size === 'lg' ? '160px' : '96px'}
            onError={() => setMissing(true)}
          />
        ))}
    </span>
  );
}

export type LeaderboardsViewProps = {
  stills: Record<string, ReactNode>;
  /** null when nobody is signed in. */
  standings: Promise<Standing[]> | null;
  /** This week's paid boards, last week's winners; null if they didn't load. */
  weekly: Promise<WeeklyBoardsView | null>;
  canAdminClear: boolean;
};

export function LeaderboardsView({ stills, standings, weekly, canAdminClear }: LeaderboardsViewProps) {
  const router = useRouter();
  const params = useSearchParams();
  const asked = params.get('game');
  const picked = pickableGame(asked);
  const game = picked ? (BY_SLUG.get(picked) ?? null) : null;
  const mode = game ? pickableMode(game.board, params.get('mode')) : null;
  const paneRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // Weekly standings are streamed server snapshots rather than polled boards.
    // Refresh their props after an identity edit, keeping the picked game in the URL.
    const refreshIfVisible = () => {
      if (!document.hidden) router.refresh();
    };
    const unsubscribe = subscribeLive(['gameLeaderboards'], (payload) => {
      if (payload.reason === 'profile-updated') refreshIfVisible();
    });
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [router]);

  const go = useCallback((slug: string | null, nextMode: string | null = null, replace = false) => {
    const url = `${window.location.pathname}${boardUrl(slug, nextMode)}`.replace(/\?$/, '');
    if (replace) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
  }, []);

  // A link to a game off the floor (or with no board) opens the overview.
  useEffect(() => {
    if (asked && !picked) go(null, null, true);
  }, [asked, go, picked]);

  const pick = useCallback(
    (slug: string | null) => {
      if (slug === picked) return;
      go(slug);
      // Keep the page where it is unless the pane's top is out of sight.
      const top = paneRef.current?.getBoundingClientRect().top ?? 0;
      if (top < 0) paneRef.current?.scrollIntoView({ block: 'start' });
    },
    [go, picked],
  );

  return (
    <div className='lb'>
      <h1 className='lb-title'>leaderboards</h1>
      <div className='lb-layout'>
        <Picker picked={picked} stills={stills} onPick={pick} />
        <section ref={paneRef} className='lb-pane' aria-live='polite'>
          {game ? (
            <BoardPane
              key={game.slug}
              game={game}
              mode={mode}
              still={stills[game.slug] ?? null}
              canAdminClear={canAdminClear}
              weekly={weekly}
              signedIn={standings != null}
              onMode={(next) => go(game.slug, next, true)}
            />
          ) : (
            <Overview stills={stills} standings={standings} weekly={weekly} onPick={pick} />
          )}
        </section>
      </div>
    </div>
  );
}

// ── The picker ───────────────────────────────────────────────────────────────

function Picker({
  picked,
  stills,
  onPick,
}: {
  picked: string | null;
  stills: Record<string, ReactNode>;
  onPick: (slug: string | null) => void;
}) {
  const [text, setText] = useState('');
  const stripRef = useRef<HTMLDivElement>(null);
  const searchId = useId();
  const needle = text.trim().toLowerCase();
  const groups = useMemo(
    () =>
      needle
        ? GROUPS.map(({ group, games }) => ({
            group,
            games: games.filter(
              (game) => game.name.includes(needle) || game.slug.includes(needle) || group.label.includes(needle),
            ),
          })).filter(({ games }) => games.length > 0)
        : GROUPS,
    [needle],
  );
  const matches = groups.flatMap(({ games }) => games);

  // On a phone the picker is a strip: bring the picked game into view in it,
  // without moving the page.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || strip.scrollWidth <= strip.clientWidth) return;
    const item = strip.querySelector<HTMLElement>('[aria-current="page"]');
    if (!item) return;
    const left = item.offsetLeft - strip.offsetLeft - (strip.clientWidth - item.offsetWidth) / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: 'auto' });
  }, [picked]);

  return (
    <nav className='lb-picker' aria-label='games with a board'>
      <label className='lb-search' htmlFor={searchId}>
        <Search size={18} strokeWidth={2} strokeLinecap='square' aria-hidden />
        <span className='sr-only'>find a game</span>
        <input
          id={searchId}
          type='search'
          value={text}
          placeholder='find a game'
          autoComplete='off'
          enterKeyHint='go'
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && matches[0]) {
              event.preventDefault();
              onPick(matches[0].slug);
            }
            if (event.key === 'Escape') setText('');
          }}
        />
      </label>

      <div ref={stripRef} className='lb-strip'>
        <div className='lb-group'>
          <span className='lb-group-name' aria-hidden='true'>
            &nbsp;
          </span>
          <ul>
            <li>
              <a
                href='?'
                className='lb-pick'
                aria-current={picked == null ? 'page' : undefined}
                onClick={(event) => {
                  if (!inPlace(event)) return;
                  event.preventDefault();
                  onPick(null);
                }}
              >
                <span className='lb-screen lb-screen-overview' data-size='sm' aria-hidden='true'>
                  <Trophy size={22} strokeWidth={2} strokeLinecap='square' />
                </span>
                <span className='lb-pick-name'>overview</span>
              </a>
            </li>
          </ul>
        </div>
        {groups.map(({ group, games }) => (
          <div key={group.id} className='lb-group' role='group' aria-label={group.label}>
            <span className='lb-group-name'>
              {group.label} <Num className='lb-num' value={games.length} />
            </span>
            <ul>
              {games.map((game) => (
                <li key={game.slug}>
                  <a
                    href={boardUrl(game.slug)}
                    className='lb-pick'
                    aria-current={picked === game.slug ? 'page' : undefined}
                    onClick={(event) => {
                      if (!inPlace(event)) return;
                      event.preventDefault();
                      onPick(game.slug);
                    }}
                  >
                    <Screen slug={game.slug} still={stills[game.slug] ?? null} size='sm' />
                    <span className='lb-pick-name'>{game.name}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {needle && matches.length === 0 ? (
          <p className='lb-none'>No floor game is called &ldquo;{text.trim()}&rdquo;.</p>
        ) : null}
      </div>
    </nav>
  );
}

// ── One game's board ─────────────────────────────────────────────────────────

function BoardPane({
  game,
  mode,
  still,
  canAdminClear,
  weekly,
  signedIn,
  onMode,
}: {
  game: PickerGame;
  mode: string | null;
  still: ReactNode;
  canAdminClear: boolean;
  weekly: Promise<WeeklyBoardsView | null>;
  signedIn: boolean;
  onMode: (mode: string) => void;
}) {
  const { board } = game;
  const [refreshKey, setRefreshKey] = useState(0);
  const [clearNote, setClearNote] = useState<string | null>(null);
  const modeValue =
    board.kind !== 'wins' && mode != null
      ? board.modes?.find((m) => String(m.value) === mode)?.value
      : undefined;

  const clear = async () => {
    const token = window.prompt(`Clear the ${game.name} board? Type CLEAR to confirm.`, '');
    if (token !== 'CLEAR') return;
    const query = new URLSearchParams({ game: game.slug });
    if ((game.slug === 'chess' || game.slug === '8-ball') && modeValue != null) query.set('mode', String(modeValue));
    try {
      const response = await fetch(`/api/admin/db/user?${query.toString()}`, { method: 'DELETE' });
      const body = (await response.json().catch(() => ({}))) as { deleted?: number; error?: string };
      if (!response.ok) throw new Error(body.error || 'The board was not cleared.');
      setClearNote(`Cleared ${Number(body.deleted ?? 0)} rows.`);
      setRefreshKey((key) => key + 1);
    } catch (error) {
      setClearNote((error as Error).message);
    }
  };

  return (
    <>
      <header className='lb-head'>
        <Screen slug={game.slug} still={still} size='lg' />
        <h2 className='lb-head-name'>{game.name}</h2>
        <div className='lb-head-actions'>
          {canAdminClear && CLEARABLE.has(game.slug) ? (
            <ArcadeButton tone='danger' size='sm' onClick={() => void clear()}>
              clear
            </ArcadeButton>
          ) : null}
          <ArcadeLinkButton tone='primary' href={getGameDisplayRoute(game.slug, game.href)}>
            play
          </ArcadeLinkButton>
        </div>
      </header>
      {clearNote ? <p className='lb-board-note'>{clearNote}</p> : null}
      <Suspense fallback={null}>
        <WeeklyBoardNote weekly={weekly} slug={game.slug} signedIn={signedIn} />
      </Suspense>
      <div className='lb-board'>
        {board.kind === 'wins' ? (
          <MachineWinsBoard slug={game.slug} label={`${game.name} board`} />
        ) : (
          <GameLeaderboard
            gameType={board.gameType}
            modes={board.modes}
            mode={modeValue}
            onModeChange={board.modes ? (next) => onMode(String(next)) : undefined}
            refreshKey={refreshKey}
            label={`${game.name} board`}
          />
        )}
      </div>
    </>
  );
}

// ── The overview ─────────────────────────────────────────────────────────────

const ON_LABEL: Record<Standing['on'], string> = {
  'all time': 'all time',
  rating: 'rating',
  today: 'today',
  'this week': 'this week',
};

function StandingRank({ standings, slug }: { standings: Promise<Standing[]>; slug: string }) {
  const mine = use(standings).find((standing) => standing.slug === slug);
  if (!mine) return <span className='lb-stand-none'>no score yet</span>;
  return (
    <span className='lb-stand-rank'>
      <Num className='lb-num' value={mine.rank} label={`rank ${mine.rank}`} />
      <small>{ON_LABEL[mine.on]}</small>
    </span>
  );
}

function Overview({
  stills,
  standings,
  weekly,
  onPick,
}: {
  stills: Record<string, ReactNode>;
  standings: Promise<Standing[]> | null;
  weekly: Promise<WeeklyBoardsView | null>;
  onPick: (slug: string) => void;
}) {
  return (
    <div className='lb-overview'>
      <Suspense
        fallback={
          <section className='lb-week'>
            <h2 className='lb-h2'>boards that pay this week</h2>
          </section>
        }
      >
        <WeeklyBoards weekly={weekly} stills={stills} signedIn={standings != null} onPick={onPick} />
      </Suspense>

      <section aria-labelledby='lb-stand-title'>
        <h2 id='lb-stand-title' className='lb-h2'>
          where you stand
        </h2>
        {standings ? null : (
          <p className='lb-board-note'>
            <Link href='/signin?next=/leaderboard'>Sign in</Link> to see your rank on each board.
          </p>
        )}
        <ul className='lb-stand'>
          {GAMES.map((game) => (
            <li key={game.slug}>
              <a
                href={boardUrl(game.slug)}
                className='lb-stand-tile'
                onClick={(event) => {
                  if (!inPlace(event)) return;
                  event.preventDefault();
                  onPick(game.slug);
                }}
              >
                <Screen slug={game.slug} still={stills[game.slug] ?? null} size='sm' />
                <span className='lb-stand-name'>{game.name}</span>
                {standings ? (
                  <Suspense fallback={<span className='lb-stand-rank' aria-hidden='true' />}>
                    <StandingRank standings={standings} slug={game.slug} />
                  </Suspense>
                ) : (
                  <span className='lb-stand-rank' aria-hidden='true' />
                )}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

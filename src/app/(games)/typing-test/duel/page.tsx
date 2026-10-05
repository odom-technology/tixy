'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CircleDot, Keyboard, UsersRound } from 'lucide-react';

import { GamesShell } from '@/features/arcade/components/shell/games-shell';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import {
  MultiplayerLobby,
  type LobbyQueueAdapter,
} from '@/features/arcade/components/multiplayer-lobby';
import type { MultiplayerInviteResult } from '@/features/arcade/components/multiplayer-setup-panel';
import { ArcadeLoadingDots } from '@/features/arcade/components/ui/arcade-states';

type SessionStatus = 'waiting' | 'active' | 'completed' | 'cancelled';

type MultiplayerSession = {
  id: string;
  status: SessionStatus;
  ownerUserId?: string;
  currentPlayerCount: number;
  maxPlayers: number;
  minPlayers: number;
  metadata: Record<string, unknown>;
  createdAt: number;
};

type MultiplayerPlayer = {
  userId: string;
  userName: string;
  seatIndex: number;
  status: string;
};

type MultiplayerSnapshot = {
  session: MultiplayerSession;
  players: MultiplayerPlayer[];
};

const MODES = [15, 30, 60] as const;
type ModeSec = (typeof MODES)[number];

function getModeSec(session: MultiplayerSession): ModeSec {
  const value = Number(session.metadata?.modeSec);
  return value === 15 || value === 30 || value === 60 ? value : 30;
}

async function readJson(response: Response) {
  return response.json().catch(() => null);
}

function isMultiplayerSnapshot(value: unknown): value is MultiplayerSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { session?: Partial<MultiplayerSession>; players?: unknown };
  const status = candidate.session?.status;
  return Boolean(
    candidate.session
      && typeof candidate.session.id === 'string'
      && (status === 'waiting' || status === 'active' || status === 'completed' || status === 'cancelled')
      && typeof candidate.session.currentPlayerCount === 'number'
      && typeof candidate.session.maxPlayers === 'number'
      && typeof candidate.session.metadata === 'object'
      && candidate.session.metadata !== null
      && Array.isArray(candidate.players),
  );
}

function readSessionSnapshots(payload: unknown): MultiplayerSnapshot[] {
  const sessions = (payload as { sessions?: unknown } | null)?.sessions;
  return Array.isArray(sessions) ? sessions.filter(isMultiplayerSnapshot) : [];
}

export default function TypingDuelLobbyPage() {
  const router = useRouter();
  const [modeSec, setModeSec] = useState<ModeSec>(30);
  const [sessions, setSessions] = useState<MultiplayerSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const deepLinkHandledRef = useRef(false);

  const waitingSessions = useMemo(
    () => sessions.filter((snapshot) => snapshot.session.status === 'waiting'),
    [sessions],
  );
  const activeSessions = useMemo(
    () => sessions.filter((snapshot) => snapshot.session.status === 'active'),
    [sessions],
  );

  const loadSessions = useCallback(async () => {
    try {
      const response = await fetch('/api/games/multiplayer/session?gameType=typing-test', {
        cache: 'no-store',
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(payload?.error ?? 'Failed to load typing duels.');
      setSessions(readSessionSnapshots(payload));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
    let timer: number | null = null;
    const stop = () => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };
    const start = () => {
      if (timer !== null || document.hidden) return;
      timer = window.setInterval(() => void loadSessions(), 5000);
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        void loadSessions();
        start();
      }
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadSessions]);

  const openRoom = useCallback(
    (sessionId: string) => router.push(`/typing-test/duel/${sessionId}`),
    [router],
  );

  const joinAndOpen = useCallback(
    async (sessionId: string, inviteCode?: string) => {
      if (!sessionId) return;
      setBusyId(sessionId);
      setError(null);
      try {
        const response = await fetch(`/api/games/multiplayer/session/${sessionId}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(inviteCode ? { inviteCode } : {}),
        });
        const payload = await readJson(response);
        if (!response.ok) throw new Error(payload?.error ?? 'Failed to join typing duel.');
        openRoom(sessionId);
      } catch (err) {
        setError((err as Error).message);
        setBusyId(null);
      }
    },
    [openRoom],
  );

  const joinByCode = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim().toUpperCase();
      if (!code) return;
      setError(null);
      try {
        const response = await fetch(
          `/api/games/multiplayer/code?gameType=typing-test&code=${encodeURIComponent(code)}`,
          { cache: 'no-store' },
        );
        const payload = await readJson(response);
        if (!response.ok) throw new Error(payload?.error ?? 'Game code not found.');
        const sessionId = payload?.invite?.matchId ?? payload?.invite?.targetId;
        if (!sessionId) throw new Error('Typing duel code is missing a match.');
        await joinAndOpen(sessionId, code);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [joinAndOpen],
  );

  // Deep links: ?code=<gameCode> (join by code) and ?join=<sessionId>.
  useEffect(() => {
    if (deepLinkHandledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const sessionId = params.get('join');
    if (code) {
      deepLinkHandledRef.current = true;
      void joinByCode(code);
    } else if (sessionId) {
      deepLinkHandledRef.current = true;
      void joinAndOpen(sessionId);
    }
  }, [joinByCode, joinAndOpen]);

  // PLAY — transactional quick-join over the session tables.
  const queueAdapter: LobbyQueueAdapter = useMemo(
    () => ({
      start: async () => {
        const res = await fetch('/api/games/multiplayer/session/quick-join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameType: 'typing-test', metadata: { modeSec } }),
        });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || 'Failed to find a duel.');
        void loadSessions();
        return { status: payload.status, matchId: payload.sessionId ?? payload.matchId };
      },
      poll: async (sessionId) => {
        const res = await fetch(`/api/games/multiplayer/session/${sessionId}`, {
          cache: 'no-store',
        });
        if (res.status === 404) return 'gone';
        if (!res.ok) return 'waiting';
        const payload = await res.json().catch(() => null);
        const session = payload?.session as MultiplayerSession | undefined;
        if (!session || session.status === 'cancelled') return 'gone';
        // An opponent has arrived (or the run already started/finished) → head
        // into the room where the existing ready-up flow takes over.
        if (
          session.status === 'active'
          || session.status === 'completed'
          || Number(session.currentPlayerCount) >= 2
        ) {
          return 'active';
        }
        return 'waiting';
      },
      cancel: async (sessionId) => {
        const res = await fetch('/api/games/multiplayer/session/quick-join', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.error || 'Failed to cancel.');
        }
        void loadSessions();
      },
      lobbyTopic: 'typingLobby',
    }),
    [modeSec, loadSessions],
  );

  // CHALLENGE (code-only) — create a shareable public session + join by code.
  const createCodeInvite = useCallback(async (): Promise<MultiplayerInviteResult> => {
    const res = await fetch('/api/games/multiplayer/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameType: 'typing-test',
        visibility: 'public',
        metadata: { modeSec },
        createInvite: true,
      }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || 'Failed to create typing duel.');
    void loadSessions();
    return { matchId: payload.session.id, invite: payload.invite };
  }, [modeSec, loadSessions]);

  // ── Slots ──────────────────────────────────────────────────────────────
  const optionsSlot = (
    <div>
      <div className='arcade-kicker mb-1.5 text-xs text-faint'>Match length</div>
      <div className='flex gap-2'>
        {MODES.map((mode) => (
          <button
            key={mode}
            type='button'
            onClick={() => setModeSec(mode)}
            data-active={modeSec === mode}
            className='tt-mode flex-1'
          >
            {mode}s
          </button>
        ))}
      </div>
    </div>
  );

  const statsSlot = (
    <section className='rounded-cabinet border-2 border-ink bg-panel p-4 shadow-cabinet'>
      <h2 className='mb-3 text-base font-semibold text-strong'>Live now</h2>
      <div className='grid grid-cols-2 gap-2'>
        <div className='arcade-card-inset flex items-center gap-3 px-3 py-3'>
          <UsersRound size={18} className='text-primary' />
          <div>
            <p className='arcade-num text-2xl font-bold text-strong'>
              {loading ? '—' : waitingSessions.length}
            </p>
            <p className='arcade-kicker text-[10px] text-faint'>Open</p>
          </div>
        </div>
        <div className='arcade-card-inset flex items-center gap-3 px-3 py-3'>
          <CircleDot size={18} className='text-info-text' />
          <div>
            <p className='arcade-num text-2xl font-bold text-strong'>
              {loading ? '—' : activeSessions.length}
            </p>
            <p className='arcade-kicker text-[10px] text-faint'>In play</p>
          </div>
        </div>
      </div>
    </section>
  );

  const openMatchesSlot = (
    <div className='rounded-cabinet border-2 border-ink bg-panel p-4 shadow-cabinet'>
      <p className='arcade-kicker mb-2 flex items-center gap-2'>
        <Keyboard size={14} className='text-faint' />
        Open duels
        <span className='ml-0.5 normal-case text-[11px] font-normal tracking-normal text-faint'>
          ({waitingSessions.length})
        </span>
      </p>
      {waitingSessions.length === 0 ? (
        <div className='py-3 text-center text-xs text-faint'>
          No open duels right now — hit Play to open one.
        </div>
      ) : (
        <div className='space-y-1.5'>
          {waitingSessions.map((snapshot) => (
            <div
              key={snapshot.session.id}
              className='flex items-center justify-between gap-2 border-b border-soft px-3 py-2 last:border-b-0'
            >
              <div className='min-w-0'>
                <div className='flex items-center gap-1.5 truncate text-sm'>
                  <span className='font-medium'>
                    {snapshot.players[0]?.userName ?? 'Open seat'}
                  </span>
                  <span className='rounded-full border border-ink bg-tickets px-1.5 py-0.5 text-[10px] font-semibold text-tickets-on'>
                    {getModeSec(snapshot.session)}s
                  </span>
                </div>
                <p className='mt-0.5 text-[11px] text-faint'>
                  {snapshot.session.currentPlayerCount}/{snapshot.session.maxPlayers} seated
                </p>
              </div>
              <ArcadeButton
                tone='success'
                size='sm'
                onClick={() => joinAndOpen(snapshot.session.id)}
                disabled={busyId === snapshot.session.id}
              >
                {busyId === snapshot.session.id ? (
                  <ArcadeLoadingDots />
                ) : null}
                Join
              </ArcadeButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const rules = (
    <div className='space-y-1.5'>
      <p>
        Two players race the <span className='font-semibold text-strong'>same words</span> from a
        shared seed. Both ready up, a 3-2-1 countdown fires, then type as fast and accurately as you
        can before the clock runs out.
      </p>
      <p>
        Highest <span className='font-semibold text-strong'>WPM</span> when the timer ends wins —
        every keystroke is validated server-side. Space commits a word; Backspace on an empty word
        steps back.
      </p>
    </div>
  );

  return (
    <GamesShell
      shellClassName='page-shell space-y-6'
      headerProps={{
        eyebrow: 'Multiplayer',
        title: 'Typing Duel',
        icon: <Keyboard className='h-6 w-6' aria-hidden />,
        subtitle: 'Two players, one seed, server-validated keystrokes.',
      }}
    >
      <MultiplayerLobby
        gameType='typing-test'
        gameName='Typing Duel'
        accent='primary'
        queue={queueAdapter}
        onOpenMatch={openRoom}
        challenge={{
          mode: 'code-only',
          gameType: 'typing-test',
          onCreateCodeInvite: createCodeInvite,
          onJoinByCode: (targetId, code) => joinAndOpen(targetId, code),
        }}
        practiceSolo={{
          href: '/typing-test',
          label: 'Practice solo',
          note: 'Sharpen up on the solo test — no opponent, no clock pressure.',
        }}
        optionsSlot={optionsSlot}
        statsSlot={statsSlot}
        openMatchesSlot={openMatchesSlot}
        rules={rules}
        error={error}
        onDismissError={() => setError(null)}
      />
    </GamesShell>
  );
}

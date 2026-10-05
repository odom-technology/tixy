'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { useParams } from 'next/navigation';
import {
  Check,
  Clock,
  Keyboard,
  Swords,
  Trophy,
  UsersRound,
} from 'lucide-react';

import { GamesShell } from '@/features/arcade/components/shell/games-shell';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { useInGamePresence } from '@/features/social/presence/presence-client';
import {
  ArcadeButton,
  ArcadeChip,
  ArcadeLinkButton,
  ArcadeMarquee,
  ArcadeNotice,
  ArcadePanel,
  ArcadeStat,
  cx,
} from '@/features/arcade/components/ui/arcade-ui';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import { connectGameWs, type GameWsHandle } from '@/features/arcade/lib/game-ws';
import { generateSeededWords } from '@/features/arcade/lib/typing-words';
import { usePreventGameGestures } from '@/features/arcade/lib/game-mobile-utils';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { Caret } from '../../_caret';
import { useTypingLineScroll } from '../../_use-typing-line-scroll';
import { ArcadeCountdown } from '@/features/arcade/components/gameplay/arcade-game-hud';
import { ArcadeLoadingDots } from '@/features/arcade/components/ui/arcade-states';

type SessionStatus = 'waiting' | 'active' | 'completed' | 'cancelled';

type MultiplayerSession = {
  id: string;
  gameType: 'typing-test';
  mode: 'versus';
  status: SessionStatus;
  ownerUserId: string;
  minPlayers: number;
  maxPlayers: number;
  currentPlayerCount: number;
  visibility: 'public' | 'private' | 'invite';
  metadata: Record<string, unknown>;
  startedAt: number | null;
  completedAt: number | null;
};

type MultiplayerPlayer = {
  userId: string;
  userName: string;
  seatIndex: number;
  status: 'seated' | 'ready' | 'playing' | 'left';
};

type TypingDuelResult = {
  userId: string;
  userName: string;
  modeSec: number;
  wpm: number;
  rawWpm: number;
  accuracy: number;
  correctChars: number;
  incorrectChars: number;
  totalChars: number;
  wordsCompleted: number;
  createdAt: number;
};

type TypingDuelOutcome = {
  complete: boolean;
  draw: boolean;
  winnerUserId: string | null;
  reason: 'all-results' | 'timeout' | 'draw' | null;
};

type TypingDuelSnapshot = {
  session: MultiplayerSession;
  players: MultiplayerPlayer[];
  results: TypingDuelResult[];
  outcome: TypingDuelOutcome;
  viewer: {
    userId: string;
    isPlayer: boolean;
    seatIndex: number | null;
    hasResult: boolean;
  };
};

type RunState =
  | 'idle'
  | 'starting'
  | 'countdown'
  | 'playing'
  | 'submitting'
  | 'submitted'
  | 'error';

type FinalStats = {
  wpm: number;
  rawWpm: number;
  accuracy: number;
};

const MAX_EXTRA_CHARS = 20;

async function readJson(response: Response) {
  return response.json().catch(() => null);
}

function getModeSec(session?: MultiplayerSession | null) {
  const value = Number(session?.metadata?.modeSec);
  return value === 15 || value === 30 || value === 60 ? value : 30;
}

function statusTone(status: SessionStatus) {
  if (status === 'active') return 'prize' as const;
  if (status === 'completed') return 'info' as const;
  if (status === 'cancelled') return 'danger' as const;
  return 'primary' as const;
}

export default function TypingDuelMatchPage() {
  const params = useParams<{ id: string | string[] }>();
  const duelId = Array.isArray(params.id) ? params.id[0] : params.id;
  useInGamePresence('typing-duel');

  const [snapshot, setSnapshot] = useState<TypingDuelSnapshot | null>(null);
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const [runState, setRunState] = useState<RunState>('idle');
  const [modeSec, setModeSec] = useState(30);
  const [countdown, setCountdown] = useState(3);
  const [timeLeft, setTimeLeft] = useState(30);
  const [words, setWords] = useState<string[]>([]);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [currentInput, setCurrentInput] = useState('');
  const [wordInputHistory, setWordInputHistory] = useState<string[]>([]);
  const [correctChars, setCorrectChars] = useState(0);
  const [incorrectChars, setIncorrectChars] = useState(0);
  const [finalStats, setFinalStats] = useState<FinalStats | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const wsRef = useRef<GameWsHandle | null>(null);
  const envMonitorRef = useRef(new EnvMonitor());
  const sessionTokenRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef(0);
  const lastInputLengthRef = useRef(0);
  const correctCharsRef = useRef(0);
  const incorrectCharsRef = useRef(0);
  const wordsCompletedRef = useRef(0);
  const isSubmittingRef = useRef(false);
  const endRunRef = useRef<(() => void) | null>(null);
  const outcomeHandledRef = useRef(false);

  const {
    containerRef: wordsContainerRef,
    isScrolled: isWordsScrolled,
    style: wordsScrollStyle,
  } = useTypingLineScroll({
    currentWordIndex,
    layoutKey: currentInput.length,
    enabled: runState === 'idle' || runState === 'playing',
  });

  usePreventGameGestures(runState === 'playing');

  const ownResult = useMemo(
    () =>
      snapshot?.results?.find(
        (result) => result.userId === snapshot.viewer?.userId,
      ) ?? null,
    [snapshot],
  );
  const opponent = useMemo(
    () =>
      snapshot?.players?.find((player) => player.userId !== snapshot.viewer?.userId) ??
      null,
    [snapshot],
  );
  const activeModeSec = getModeSec(snapshot?.session);
  const canReady =
    snapshot?.viewer.isPlayer &&
    snapshot.session.status === 'waiting' &&
    snapshot.players.length >= snapshot.session.minPlayers &&
    snapshot.players.some(
      (player) =>
        player.userId === snapshot.viewer.userId && player.status !== 'ready',
    );
  const canStartRun =
    snapshot?.viewer.isPlayer &&
    snapshot.session.status === 'active' &&
    !snapshot.viewer.hasResult &&
    !ownResult &&
    (runState === 'idle' || runState === 'error' || runState === 'starting');

  const loadSnapshot = useCallback(async () => {
    if (!duelId) return;
    try {
      const response = await fetch(`/api/games/typing-test/duel/${duelId}`, {
        cache: 'no-store',
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to load typing duel.');
      }
      setSnapshot(payload);
      setModeSec(getModeSec(payload.session));
      setLoadError(null);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, [duelId]);

  useEffect(() => {
    setShareCode(new URLSearchParams(window.location.search).get('code'));
  }, []);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    if (!snapshot) return;
    const delay = snapshot.session.status === 'completed' ? 5000 : 2000;
    let timer: number | null = null;
    const stop = () => {
      if (timer === null) return;
      window.clearTimeout(timer);
      timer = null;
    };
    const start = () => {
      if (timer !== null || document.hidden) return;
      timer = window.setTimeout(() => {
        timer = null;
        void loadSnapshot();
      }, delay);
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        void loadSnapshot();
        start();
      }
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [snapshot, loadSnapshot]);

  // Win/lose ceremony — fire the outcome cue once when the duel resolves.
  useEffect(() => {
    if (!snapshot?.outcome.complete) return;
    if (outcomeHandledRef.current) return;
    outcomeHandledRef.current = true;
    if (snapshot.outcome.draw) {
      SoundManager.play('coinCorrect');
    } else if (snapshot.outcome.winnerUserId === snapshot.viewer.userId) {
      SoundManager.play('win');
    } else {
      SoundManager.play('lose');
    }
  }, [
    snapshot?.outcome.complete,
    snapshot?.outcome.draw,
    snapshot?.outcome.winnerUserId,
    snapshot?.viewer.userId,
  ]);

  useEffect(() => {
    if (runState !== 'countdown') return;
    if (countdown <= 0) {
      SoundManager.play('score'); // "GO"
      setRunState('idle');
      window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 30);
      return;
    }
    SoundManager.play('arcadeBet', { volume: 0.6 }); // countdown tick
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown, runState]);

  useEffect(() => {
    const envMonitor = envMonitorRef.current;
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      wsRef.current?.close();
      envMonitor.stop();
    };
  }, []);

  const resetRunState = useCallback((newModeSec: number, seed: number) => {
    const generatedWords = generateSeededWords(seed, 240);
    setWords(generatedWords);
    setWordInputHistory(generatedWords.map(() => ''));
    setCurrentWordIndex(0);
    setCurrentInput('');
    setCorrectChars(0);
    setIncorrectChars(0);
    setFinalStats(null);
    correctCharsRef.current = 0;
    incorrectCharsRef.current = 0;
    wordsCompletedRef.current = 0;
    lastInputLengthRef.current = 0;
    setModeSec(newModeSec);
    setTimeLeft(newModeSec);
  }, []);

  const joinDuel = async () => {
    if (!duelId) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/games/multiplayer/session/${duelId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shareCode ? { inviteCode: shareCode } : {}),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to join typing duel.');
      }
      await loadSnapshot();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setActionBusy(false);
    }
  };

  const markReady = async () => {
    if (!duelId) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/games/multiplayer/session/${duelId}/ready`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ready: true }),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to mark ready.');
      }
      // NOTE: the shared /session/ready route returns a bare session snapshot
      // (session + players only) — it has no `results`/`viewer`/`outcome`. Do
      // NOT push it into `snapshot`, or the duel-shaped selectors below would
      // read `.results`/`.viewer` off undefined. Re-fetch the full duel view.
      await loadSnapshot();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setActionBusy(false);
    }
  };

  const startRun = async () => {
    if (!duelId || !canStartRun || runState === 'starting') return;
    setRunState('starting');
    setActionError(null);
    try {
      const response = await fetch(`/api/games/typing-test/duel/${duelId}/session`, {
        method: 'POST',
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to start typing duel run.');
      }
      const nextModeSec = Number(payload.modeSec);
      const typingSeed = Number(payload.typingSeed);
      if (
        !payload.token ||
        !Number.isInteger(typingSeed) ||
        !(nextModeSec === 15 || nextModeSec === 30 || nextModeSec === 60)
      ) {
        throw new Error('Typing duel session is missing run data.');
      }
      resetRunState(nextModeSec, typingSeed);
      sessionTokenRef.current = payload.token;
      envMonitorRef.current.start();
      wsRef.current?.close();
      wsRef.current = await connectGameWs(payload.token);
      wsRef.current.onDisconnect((reason) => {
        console.error('Typing Duel socket disconnected:', reason);
        setRunState('error');
        setActionError('Connection to the game server was lost.');
      });
      setCountdown(3);
      setRunState('countdown');
    } catch (err) {
      wsRef.current?.close();
      wsRef.current = null;
      envMonitorRef.current.stop();
      setRunState('error');
      setActionError((err as Error).message);
    }
  };

  const endRun = useCallback(async () => {
    if (!duelId || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    envMonitorRef.current.stop();
    setRunState('submitting');

    const correct = correctCharsRef.current;
    const incorrect = incorrectCharsRef.current;
    const totalChars = correct + incorrect;
    const accuracy = totalChars > 0 ? (correct / totalChars) * 100 : 0;
    const wpm = Math.round(correct / 5 / (modeSec / 60));
    const rawWpm = Math.round(totalChars / 5 / (modeSec / 60));
    const completed = wordsCompletedRef.current;
    setFinalStats({ wpm, rawWpm, accuracy });

    try {
      const response = await fetch('/api/games/typing-test/score', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wpm,
          rawWpm,
          accuracy,
          mode: modeSec,
          correctChars: correct,
          incorrectChars: incorrect,
          totalChars,
          wordsCompleted: completed,
          sessionToken: sessionTokenRef.current,
          multiplayerSessionId: duelId,
          env: envMonitorRef.current.getFingerprint(),
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to submit duel result.');
      }
      wsRef.current?.close();
      wsRef.current = null;
      setRunState('submitted');
      await loadSnapshot();
    } catch (err) {
      setRunState('error');
      setActionError((err as Error).message);
    } finally {
      isSubmittingRef.current = false;
    }
  }, [duelId, loadSnapshot, modeSec]);

  useEffect(() => {
    endRunRef.current = endRun;
  }, [endRun]);

  const startTypingTimer = useCallback(() => {
    if (runState !== 'idle') return;
    setRunState('playing');
    startTimeRef.current = Date.now();
    timerRef.current = window.setInterval(() => {
      const elapsedMs = Date.now() - startTimeRef.current;
      const remaining = Math.max(0, modeSec - Math.floor(elapsedMs / 1000));
      setTimeLeft(remaining);
      if (elapsedMs >= modeSec * 1000) {
        endRunRef.current?.();
      }
    }, 100);
  }, [modeSec, runState]);

  const playTypingSound = useCallback((key: string, release = false) => {
    if (key !== 'Backspace' && key.length !== 1) return;
    const pitch =
      key === ' '
        ? 0.82
        : key === 'Backspace'
          ? 1.14
          : 0.94 + ((key.codePointAt(0) ?? 0) % 9) * 0.015;
    SoundManager.play(release ? 'typingThockRelease' : 'typingThock', {
      volume: release ? 0.38 : key === ' ' ? 0.7 : 0.58,
      pitch,
    });
  }, []);

  const handleInputValue = useCallback(
    (value: string) => {
      if (runState === 'idle' && value.length > 0) {
        startTypingTimer();
      }
      if (runState !== 'playing' && runState !== 'idle') return;
      if (runState === 'idle' && value.length === 0) return;

      const currentWord = words[currentWordIndex];
      if (!currentWord) return;
      const prevLen = lastInputLengthRef.current;
      if (value.length > prevLen) {
        for (let index = prevLen; index < value.length; index += 1) {
          const newChar = value[index];
          if (newChar) wsRef.current?.sendTypingKey(newChar);
        }
      } else if (value.length < prevLen) {
        for (let index = 0; index < prevLen - value.length; index += 1) {
          wsRef.current?.sendTypingKey('\b');
        }
      }

      if (value.endsWith(' ')) {
        const typedWord = value.slice(0, -1);
        let wordCorrect = 0;
        let wordIncorrect = 0;
        for (let index = 0; index < Math.max(typedWord.length, currentWord.length); index += 1) {
          if (index < typedWord.length && index < currentWord.length) {
            if (typedWord[index] === currentWord[index]) wordCorrect += 1;
            else wordIncorrect += 1;
          } else {
            wordIncorrect += 1;
          }
        }
        if (typedWord === currentWord) wordCorrect += 1;
        else wordIncorrect += 1;

        setWordInputHistory((history) => {
          const next = [...history];
          next[currentWordIndex] = typedWord;
          return next;
        });
        setCorrectChars((value) => {
          const next = value + wordCorrect;
          correctCharsRef.current = next;
          return next;
        });
        setIncorrectChars((value) => {
          const next = value + wordIncorrect;
          incorrectCharsRef.current = next;
          return next;
        });
        wordsCompletedRef.current += 1;
        setCurrentWordIndex((value) => value + 1);
        setCurrentInput('');
        lastInputLengthRef.current = 0;
        return;
      }

      const cappedValue = value.slice(0, currentWord.length + MAX_EXTRA_CHARS);
      lastInputLengthRef.current = cappedValue.length;
      setCurrentInput(cappedValue);
    },
    [currentWordIndex, runState, startTypingTimer, words],
  );

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleInputValue(event.target.value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (
      (runState === 'playing' || runState === 'idle') &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      playTypingSound(event.key);
    }
    if (event.key === ' ') {
      event.preventDefault();
      handleInputValue(`${currentInput} `);
      return;
    }
    if (event.key === 'Backspace' && currentInput === '' && currentWordIndex > 0) {
      event.preventDefault();
      wsRef.current?.sendEvent('typing_prev_word');
      const previousWord = wordInputHistory[currentWordIndex - 1] ?? '';
      setCurrentWordIndex((value) => value - 1);
      setCurrentInput(previousWord);
      lastInputLengthRef.current = previousWord.length;
    }
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLInputElement>) => {
    if (
      (runState === 'playing' || runState === 'idle') &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      playTypingSound(event.key, true);
    }
  };

  const currentWpm =
    runState === 'playing'
      ? Math.round(
          correctChars /
            5 /
            (Math.max(0.1, (Date.now() - startTimeRef.current) / 1000) / 60),
        )
      : finalStats?.wpm ?? ownResult?.wpm ?? 0;
  const currentAccuracy = (() => {
    const total = correctChars + incorrectChars;
    if (runState !== 'playing' || total === 0) {
      return finalStats?.accuracy ?? ownResult?.accuracy ?? 100;
    }
    return (correctChars / total) * 100;
  })();

  if (!duelId) {
    return (
      <GamesShell headerProps={{ title: 'Typing Duel', eyebrow: 'Multiplayer' }}>
        <ArcadeNotice tone='danger'>Typing duel id is missing.</ArcadeNotice>
      </GamesShell>
    );
  }

  return (
    <GamesShell
      shellClassName='page-shell space-y-6'
      headerProps={{
        eyebrow: 'Multiplayer',
        title: 'Typing Duel',
        icon: <Keyboard className='h-6 w-6' aria-hidden />,
        subtitle: snapshot
          ? `${activeModeSec}s match / ${snapshot.session.status}`
          : 'Loading match...',
        actions: (
          <ArcadeLinkButton href='/typing-test/duel' tone='ghost' size='sm'>
            Lobby
          </ArcadeLinkButton>
        ),
      }}
    >
      {loadError ? <ArcadeNotice tone='danger'>{loadError}</ArcadeNotice> : null}
      {actionError ? <ArcadeNotice tone='danger'>{actionError}</ArcadeNotice> : null}

      <section className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]'>
        <ArcadePanel variant='cabinet' className='overflow-hidden'>
          <ArcadeMarquee
            tone={snapshot ? statusTone(snapshot.session.status) : 'primary'}
            size='md'
            trailing={shareCode ? `Code ${shareCode}` : undefined}
          >
            Match Room
          </ArcadeMarquee>
          <div className='space-y-4 p-4'>
            <div className='grid gap-3 sm:grid-cols-3'>
              <ArcadeStat
                label='Time'
                value={runState === 'playing' ? timeLeft : activeModeSec}
                sub='seconds'
                tone='primary'
                icon={Clock}
              />
              <ArcadeStat
                label='WPM'
                value={currentWpm}
                sub='live'
                tone='prize'
                icon={Keyboard}
              />
              <ArcadeStat
                label='Accuracy'
                value={`${currentAccuracy.toFixed(1)}%`}
                sub='live'
                tone='info'
                icon={Trophy}
              />
            </div>

            <div className='grid gap-3 sm:grid-cols-2'>
              {snapshot?.players.map((player) => {
                const result = snapshot.results.find(
                  (entry) => entry.userId === player.userId,
                );
                const isWinner = snapshot.outcome.winnerUserId === player.userId;
                return (
                  <div
                    key={player.userId}
                    className='rounded-panel border-2 border-ink bg-panel-soft p-3'
                  >
                    <div className='flex items-center justify-between gap-3'>
                      <div className='min-w-0'>
                        <p className='truncate font-semibold text-strong'>
                          {player.userName}
                        </p>
                        <p className='text-xs text-faint'>Seat {player.seatIndex + 1}</p>
                      </div>
                      <ArcadeChip tone={result ? 'prize' : player.status === 'ready' ? 'primary' : 'info'}>
                        {result ? 'Done' : player.status}
                      </ArcadeChip>
                    </div>
                    {result ? (
                      <div className='mt-3 flex flex-wrap items-end gap-3 text-sm'>
                        <b className='text-2xl text-strong'>{result.wpm}</b>
                        <span className='text-faint'>WPM</span>
                        <span className='text-body'>{result.accuracy.toFixed(1)}%</span>
                        {isWinner ? (
                          <ArcadeChip tone='tickets'>
                            <Trophy className='h-3 w-3' aria-hidden />
                            Winner
                          </ArcadeChip>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {snapshot && snapshot.players.length < snapshot.session.maxPlayers ? (
                <div className='rounded-panel border-2 border-dashed border-ink bg-panel-soft p-3 text-sm text-body'>
                  Open seat
                </div>
              ) : null}
            </div>

            {snapshot && !snapshot.viewer.isPlayer ? (
              <ArcadeButton
                type='button'
                tone='primary'
                size='lg'
                onClick={joinDuel}
                disabled={actionBusy}
                className='justify-center'
              >
                <UsersRound className='h-5 w-5' aria-hidden />
                Join Match
              </ArcadeButton>
            ) : null}

            {canReady ? (
              <ArcadeButton
                type='button'
                tone='primary'
                size='lg'
                onClick={markReady}
                disabled={actionBusy}
                className='justify-center'
              >
                <Check className='h-5 w-5' aria-hidden />
                Ready
              </ArcadeButton>
            ) : null}

            {snapshot?.viewer.isPlayer && snapshot.session.status === 'waiting' ? (
              <ArcadeNotice tone='info'>
                {opponent ? 'Waiting for ready checks.' : 'Waiting for another player.'}
              </ArcadeNotice>
            ) : null}

            {canStartRun ? (
              <ArcadeButton
                type='button'
                tone='primary'
                size='lg'
                onClick={startRun}
                disabled={runState === 'starting'}
                className='justify-center'
              >
                {runState === 'starting' ? (
                  <ArcadeLoadingDots />
                ) : (
                  <Swords className='h-5 w-5' aria-hidden />
                )}
                Start Run
              </ArcadeButton>
            ) : null}

            {snapshot?.outcome.complete ? (
              <OutcomeNotice snapshot={snapshot} />
            ) : null}
          </div>
        </ArcadePanel>

        <ArcadePanel variant='raised' className='overflow-hidden'>
          <ArcadeMarquee tone='info'>Results</ArcadeMarquee>
          <div className='space-y-3 p-4'>
            {snapshot?.results.length ? (
              snapshot.results.map((result) => (
                <div
                  key={result.userId}
                  className='rounded-panel border-2 border-ink bg-panel-soft p-3'
                >
                  <div className='flex items-center justify-between gap-3'>
                    <p className='truncate font-semibold text-strong'>
                      {result.userName}
                    </p>
                    <b className='tabular-nums text-strong'>{result.wpm} WPM</b>
                  </div>
                  <div className='mt-2 grid grid-cols-3 gap-2 text-xs text-faint'>
                    <span>{result.rawWpm} raw</span>
                    <span>{result.accuracy.toFixed(1)}%</span>
                    <span>{result.wordsCompleted} words</span>
                  </div>
                </div>
              ))
            ) : (
              <p className='text-sm text-body'>No submitted runs yet.</p>
            )}
          </div>
        </ArcadePanel>
      </section>

      {snapshot && snapshot.players.length > 0 ? (
        <DuelRace
          snapshot={snapshot}
          words={words}
          currentWordIndex={currentWordIndex}
          runState={runState}
        />
      ) : null}

      <ArcadePanel
        variant='well'
        className={cx(
          'tt-well-screen relative min-h-[280px] cursor-text overflow-hidden p-4',
          runState === 'playing' && 'ring-2 ring-primary',
        )}
        onClick={() => inputRef.current?.focus({ preventScroll: true })}
      >
        <div className='absolute top-3 right-3 z-20' data-no-typing-focus>
          <MuteButton />
        </div>
        <input
          ref={inputRef}
          value={currentInput}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          disabled={runState !== 'idle' && runState !== 'playing'}
          autoCapitalize='off'
          autoCorrect='off'
          spellCheck={false}
          aria-label='Typing duel input'
          className='absolute left-0 top-0 h-px w-px opacity-0'
        />
        {runState === 'countdown' ? (
          <div className='relative flex min-h-[240px] items-center justify-center'>
            <ArcadeCountdown value={countdown > 0 ? countdown : 'go'} />
          </div>
        ) : words.length ? (
          <div
            className='tt-words-viewport relative h-[240px] overflow-hidden text-[26px] leading-[1.6] text-faint sm:text-[32px]'
            data-scrolled={isWordsScrolled}
          >
            <div
              ref={wordsContainerRef}
              className='tt-words-track relative flex flex-wrap content-start gap-x-3 gap-y-3 pr-12'
              style={wordsScrollStyle}
            >
              <Caret
                wordsContainerRef={wordsContainerRef}
                currentWordIndex={currentWordIndex}
                currentInputLength={currentInput.length}
                caretColor='var(--enamel-tickets)'
                caretType='bar'
                caretThickness={3}
                caretGlowStrength={0}
                caretPulseMode='none'
                caretTrailEnabled={false}
              />
              {words.slice(0, 120).map((word, index) => (
                <WordSpan
                  key={`${word}-${index}`}
                  index={index}
                  word={word}
                  typed={
                    index === currentWordIndex
                      ? currentInput
                      : wordInputHistory[index] ?? ''
                  }
                  active={index === currentWordIndex}
                  completed={index < currentWordIndex}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className='flex min-h-[240px] items-center justify-center text-sm text-body'>
            {snapshot?.viewer.hasResult || ownResult
              ? 'Run submitted.'
              : 'Start the run when the match is active.'}
          </div>
        )}
      </ArcadePanel>
    </GamesShell>
  );
}

function DuelRace({
  snapshot,
  words,
  currentWordIndex,
  runState,
}: {
  snapshot: TypingDuelSnapshot;
  words: string[];
  currentWordIndex: number;
  runState: RunState;
}) {
  const totalWords = Math.max(1, words.length || 1);
  const viewerId = snapshot.viewer.userId;

  const progressFor = (player: MultiplayerPlayer) => {
    const isYou = player.userId === viewerId;
    const result = snapshot.results.find((r) => r.userId === player.userId);
    // Finished runs read from the submitted result; the live viewer reads from
    // local word progress (opponent live keystrokes are server-side only).
    if (result) {
      return Math.min(100, (result.wordsCompleted / totalWords) * 100);
    }
    if (isYou && (runState === 'playing' || runState === 'submitting')) {
      return Math.min(100, (currentWordIndex / totalWords) * 100);
    }
    return 0;
  };

  return (
    <ArcadePanel variant='panel' className='overflow-hidden'>
      <ArcadeMarquee tone='primary' size='sm'>
        Race
      </ArcadeMarquee>
      <div className='space-y-3 p-4'>
        {snapshot.players.map((player) => {
          const isYou = player.userId === viewerId;
          const pct = progressFor(player);
          const result = snapshot.results.find((r) => r.userId === player.userId);
          // Opponents' live keystrokes are server-side only, so until they
          // submit we can't show a true bar — surface a "typing…" pulse while
          // the race is live instead of a dead 0%.
          const pending =
            !result && !isYou && snapshot.session.status === 'active';
          return (
            <div key={player.userId}>
              <div className='mb-1 flex items-center justify-between gap-2 text-xs'>
                <span className='truncate font-semibold text-strong'>
                  {player.userName}
                  {isYou ? <span className='ml-1 text-faint'>(you)</span> : null}
                </span>
                <span className='arcade-num shrink-0 text-faint'>
                  {result ? `${result.wpm} WPM` : pending ? 'typing…' : `${Math.round(pct)}%`}
                </span>
              </div>
              <div className='tt-race-track' data-pending={pending ? '' : undefined}>
                {pending ? (
                  <div className='tt-race-pulse' data-opp='' />
                ) : (
                  <div
                    className='tt-race-fill'
                    data-you={isYou ? '' : undefined}
                    data-opp={isYou ? undefined : ''}
                    style={{ width: `${pct}%` }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </ArcadePanel>
  );
}

function WordSpan({
  index,
  word,
  typed,
  active,
  completed,
}: {
  index: number;
  word: string;
  typed: string;
  active: boolean;
  completed: boolean;
}) {
  const extra = typed.length > word.length ? typed.slice(word.length) : '';
  return (
    <span
      data-word-index={index}
      className={cx(
        'tt-word relative inline-block rounded',
        active && 'tt-word-active bg-panel text-strong shadow-[0_0_0_3px_var(--surface-panel)]',
        completed && typed === word && 'tt-word-complete text-strong opacity-60',
      )}
    >
      {word.split('').map((char, index) => {
        const typedChar = typed[index];
        const hasTyped = typedChar !== undefined;
        return (
          <span
            key={`${char}-${index}`}
            data-char-index={index}
            className={cx(
              'tt-char',
              hasTyped && typedChar === char && 'text-prize-text',
              hasTyped && typedChar !== char && 'text-danger-text',
              active && index === typed.length - 1 && typedChar === char && 'tt-char-impact',
              active && index === typed.length - 1 && typedChar !== char && 'tt-char-impact-error',
            )}
          >
            {char}
          </span>
        );
      })}
      {extra ? (
        <span className='text-danger-text'>
          {extra.split('').map((char, extraIndex) => (
            <span
              key={`${char}-${extraIndex}`}
              data-extra-index={extraIndex}
              className={
                active && word.length + extraIndex === typed.length - 1
                  ? 'tt-char-impact-error'
                  : undefined
              }
            >
              {char}
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function OutcomeNotice({ snapshot }: { snapshot: TypingDuelSnapshot }) {
  const { outcome, viewer } = snapshot;
  const isPlayer = viewer.isPlayer;
  const youWon = !outcome.draw && outcome.winnerUserId === viewer.userId;
  const youLost = isPlayer && !outcome.draw && !youWon;
  const winner = snapshot.players.find((player) => player.userId === outcome.winnerUserId);
  const byTimeout = outcome.reason === 'timeout';

  const tone: 'win' | 'lose' | 'draw' = outcome.draw ? 'draw' : youLost ? 'lose' : 'win';
  const title = outcome.draw
    ? 'Dead heat!'
    : youWon
      ? 'You win!'
      : youLost
        ? `${winner?.userName ?? 'Opponent'} wins`
        : `${winner?.userName ?? 'Winner'} wins`;
  const sub = outcome.draw
    ? 'Both racers finished level.'
    : `${winner?.userName ?? 'Winner'} took it${byTimeout ? ' on the clock' : ''}.`;

  return (
    <div className='tt-ceremony' data-outcome={tone} role='status' aria-live='polite'>
      <Trophy className='tt-ceremony-ico h-6 w-6' aria-hidden />
      <div className='min-w-0'>
        <p className='text-base font-bold leading-tight text-strong'>{title}</p>
        <p className='truncate text-xs text-faint'>{sub}</p>
      </div>
    </div>
  );
}

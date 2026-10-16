'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Circle, Square, Star, Triangle } from 'lucide-react';

import { GameShell, GameStage, GameStat } from '@/features/arcade/components/shell/game-shell';
import { ArcadeButton, ArcadeLinkButton } from '@/features/arcade/components/ui/arcade-ui';
import { createPattern, ROUNDS, RULES_VERSION, SYMBOLS } from '@/features/arcade/lib/starter-match/engine';

import './_starter-match.css';

type Phase = 'ready' | 'starting' | 'playing' | 'saving' | 'save-error' | 'result';
type Session = { sessionToken: string; seed: number; rulesVersion: typeof RULES_VERSION };
type Leader = { userId: string; userName: string; score: number };
type SavedRun = { score: number; leaderboard: Leader[]; ticketsAwarded: 0 };
type RequestError = { message: string; signIn: boolean };

const SHAPES = [Circle, Square, Triangle, Star];
const HOW_TO = {
  lines: [
    'Choose the button with the same shape as the target.',
    'Complete eight rounds for up to 800 points.',
    'This contributor example saves scores and awards no tickets or XP.',
  ] as const,
  picture: <Star size={80} aria-hidden />,
};

class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(path: string, signal: AbortSignal, body?: object): Promise<T> {
  const response = await fetch(`/api/games/starter-match/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    signal,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new ApiError(
      typeof data.error === 'string' ? data.error : 'The request could not be completed.',
      response.status,
    );
  }
  return data as T;
}

function requestError(error: unknown): RequestError {
  return {
    message: error instanceof Error ? error.message : 'Connection failed. Please try again.',
    signIn: error instanceof ApiError && error.status === 401,
  };
}

export default function StarterMatchClient() {
  const [phase, setPhase] = useState<Phase>('ready');
  const [pattern, setPattern] = useState<number[]>([]);
  const [round, setRound] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<RequestError | null>(null);
  const [savedRun, setSavedRun] = useState<SavedRun | null>(null);
  const [leaderboard, setLeaderboard] = useState<Leader[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);

  // Refs synchronously lock input and requests, even before React renders.
  const phaseRef = useRef<Phase>('ready');
  const selectedRef = useRef<number | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const choicesRef = useRef<number[]>([]);
  const runRequest = useRef<AbortController | null>(null);
  const boardRequest = useRef<AbortController | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);

  const changePhase = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  const loadLeaderboard = useCallback(async () => {
    boardRequest.current?.abort();
    const controller = new AbortController();
    boardRequest.current = controller;
    setLeaderboardLoading(true);
    setLeaderboardError(null);
    try {
      const data = await request<{ leaderboard: Leader[] }>('leaderboard', controller.signal);
      if (!controller.signal.aborted) setLeaderboard(data.leaderboard);
    } catch (caught) {
      if (!controller.signal.aborted) setLeaderboardError(requestError(caught).message);
    } finally {
      if (!controller.signal.aborted) setLeaderboardLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLeaderboard();
    return () => {
      runRequest.current?.abort();
      boardRequest.current?.abort();
    };
  }, [loadLeaderboard]);

  useEffect(() => {
    if (phase === 'result' || phase === 'save-error') resultHeading.current?.focus();
  }, [phase]);

  async function start() {
    if (phaseRef.current === 'starting' || phaseRef.current === 'saving') return;
    runRequest.current?.abort();
    const controller = new AbortController();
    runRequest.current = controller;
    sessionRef.current = null;
    choicesRef.current = [];
    selectedRef.current = null;
    setSelected(null);
    setRound(0);
    setPattern([]);
    setSavedRun(null);
    setError(null);
    changePhase('starting');
    try {
      const session = await request<Session>('session', controller.signal, {});
      if (controller.signal.aborted) return;
      if (session.rulesVersion !== RULES_VERSION) {
        throw new Error('The game rules have changed. Reload this page to play.');
      }
      const nextPattern = createPattern(session.seed);
      sessionRef.current = session;
      setPattern(nextPattern);
      changePhase('playing');
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(requestError(caught));
        changePhase('ready');
      }
    }
  }

  async function save() {
    const session = sessionRef.current;
    if (!session || phaseRef.current === 'saving') return;
    changePhase('saving');
    setError(null);
    runRequest.current?.abort();
    const controller = new AbortController();
    runRequest.current = controller;
    try {
      // Only the transcript is submitted. The server computes the score.
      const result = await request<SavedRun>('score', controller.signal, {
        sessionToken: session.sessionToken,
        rulesVersion: session.rulesVersion,
        choices: [...choicesRef.current],
      });
      if (controller.signal.aborted) return;
      // A slower initial board load must not overwrite the saved run's board.
      boardRequest.current?.abort();
      setLeaderboardLoading(false);
      setLeaderboardError(null);
      setLeaderboard(result.leaderboard);
      setSavedRun(result);
      changePhase('result');
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(requestError(caught));
        changePhase('save-error');
      }
    }
  }

  function choose(choice: number) {
    if (phaseRef.current !== 'playing' || selectedRef.current !== null) return;
    selectedRef.current = choice;
    setSelected(choice);
    choicesRef.current.push(choice);
    if (choicesRef.current.length === ROUNDS) void save();
  }

  function nextRound() {
    if (phaseRef.current !== 'playing' || selectedRef.current === null) return;
    selectedRef.current = null;
    setSelected(null);
    setRound(choicesRef.current.length);
  }

  const activeRound = phase === 'playing';
  const target = pattern[round];
  const TargetShape = SHAPES[target] ?? Circle;
  const roundMessage = activeRound
    ? selected === null
      ? `Round ${round + 1} of ${ROUNDS}. Match ${SYMBOLS[target]}.`
      : `${selected === target ? 'Correct.' : `The target was ${SYMBOLS[target]}.`} Choose Next round to continue.`
    : phase === 'starting'
      ? 'Starting your run…'
      : phase === 'saving'
        ? 'All eight rounds complete. Saving your score…'
        : phase === 'result'
          ? `Score saved: ${savedRun?.score} points.`
          : '';

  return (
    <GameShell
      game='starter-match'
      className='starter-match'
      stat={<GameStat value={savedRun?.score} label='score' />}
      howTo={HOW_TO}
      below={
        <section className='starter-match-board' aria-labelledby='starter-match-board-title'>
          <h2 id='starter-match-board-title'>Pattern Match leaderboard</h2>
          <p>A small contributor example. Scores only; no tickets or XP.</p>
          {leaderboardLoading ? <p role='status'>Loading scores…</p> : null}
          {leaderboardError ? (
            <div>
              <p role='alert'>Scores could not load: {leaderboardError}</p>
              <ArcadeButton onClick={() => void loadLeaderboard()}>Retry leaderboard</ArcadeButton>
            </div>
          ) : !leaderboardLoading ? (
            leaderboard.length ? (
              <ol className='starter-match-scores'>
                {leaderboard.map((entry) => (
                  <li key={entry.userId}><span>{entry.userName}</span><strong>{entry.score} points</strong></li>
                ))}
              </ol>
            ) : <p>No scores yet. Complete a run to be first.</p>
          ) : null}
        </section>
      }
    >
      <GameStage phase={phase === 'ready' || phase === 'starting' ? 'ready' : phase === 'result' || phase === 'save-error' ? 'over' : 'playing'} startKeys={[]}>
        <div className='starter-match-play'>
          <p className='starter-match-eyebrow'>Contributor starter · Pattern Match</p>
          <p className='starter-match-announcement' role='status' aria-live='polite' aria-atomic='true'>{roundMessage}</p>

          {phase === 'ready' || phase === 'starting' ? (
            <div className='starter-match-intro'>
              <Star size={72} aria-hidden />
              <h2>Match the shape</h2>
              <p>Choose the matching shape across eight rounds. Each correct match earns 100 points. Take your time.</p>
              <p>Sign in to save a score. This starter awards no tickets or XP.</p>
              <ArcadeButton tone='primary' disabled={phase === 'starting'} onClick={() => void start()}>
                {phase === 'starting' ? 'Starting…' : error ? 'Try starting again' : 'Start matching'}
              </ArcadeButton>
            </div>
          ) : null}

          {activeRound ? (
            <div className='starter-match-round'>
              <p>Round {round + 1} / {ROUNDS}</p>
              <div className='starter-match-target'>
                <TargetShape size={80} strokeWidth={2} aria-hidden />
                <h2>Match {SYMBOLS[target]}</h2>
              </div>
              <div className='starter-match-choices' role='group' aria-label='Choose the matching shape'>
                {SYMBOLS.map((symbol, index) => {
                  const Shape = SHAPES[index];
                  return (
                    <ArcadeButton key={symbol} disabled={selected !== null} onClick={() => choose(index)}>
                      <Shape size={24} aria-hidden />{symbol}
                    </ArcadeButton>
                  );
                })}
              </div>
              {selected !== null ? <ArcadeButton tone='primary' onClick={nextRound}>Next round</ArcadeButton> : null}
              <ArcadeButton size='sm' tone='ghost' onClick={() => void start()}>Restart run</ArcadeButton>
            </div>
          ) : null}

          {phase === 'saving' ? <p>Please wait while the server verifies your choices.</p> : null}
          {phase === 'result' || phase === 'save-error' ? (
            <div className='starter-match-result'>
              <h2 ref={resultHeading} tabIndex={-1}>{phase === 'result' ? `${savedRun?.score} points` : 'Score not saved'}</h2>
              <p>{phase === 'result' ? 'Your server-verified score is saved. No tickets or XP were awarded.' : 'Your choices are kept on this page. Retry saving, or start a new run.'}</p>
              {phase === 'save-error' ? <ArcadeButton tone='primary' onClick={() => void save()}>Retry saving score</ArcadeButton> : null}
              <ArcadeButton onClick={() => void start()}>Play again</ArcadeButton>
            </div>
          ) : null}

          {error ? (
            <div className='starter-match-error'>
              <p role='alert'>{error.message}</p>
              {error.signIn ? <ArcadeLinkButton href='/signin?next=%2Fstarter-match'>Sign in to play</ArcadeLinkButton> : null}
            </div>
          ) : null}
        </div>
      </GameStage>
    </GameShell>
  );
}

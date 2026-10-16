'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Lightbulb, LightbulbOff } from 'lucide-react';
import { GameShell, GameStage, GameStat } from '@/features/arcade/components/shell/game-shell';
import { ArcadeButton, ArcadeLinkButton } from '@/features/arcade/components/ui/arcade-ui';
import { createBoard, toggleCell, MAX_MOVES, RULES_VERSION, SIZE } from '@/features/arcade/lib/lights-out/engine';
import './_lights-out.css';

type Phase = 'ready' | 'starting' | 'playing' | 'saving' | 'save-error' | 'result';
type Session = { sessionToken: string; seed: number; rulesVersion: number };
type Leader = { userId: string; userName: string; score: number };
type SavedRun = { score: number; solved: boolean; moves: number; ticketsAwarded: 0; leaderboard: Leader[] };
type RequestError = { message: string; signIn: boolean };

const HOW_TO = {
  lines: [
    'Press a light to toggle it and its up, down, left, and right neighbors.',
    'Switch all nine lights off within 24 moves; fewer moves score more points.',
    'Scores are saved to this game’s board; no tickets or XP are awarded.',
  ] as const,
  picture: <Lightbulb size={80} aria-hidden />,
};

class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(path: string, signal: AbortSignal, body?: object): Promise<T> {
  const response = await fetch(`/api/games/lights-out/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    signal,
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(typeof data.error === 'string' ? data.error : 'The request could not be completed.', response.status);
  return data as T;
}

function requestError(error: unknown): RequestError {
  return {
    message: error instanceof Error ? error.message : 'Connection failed. Please try again.',
    signIn: error instanceof ApiError && error.status === 401,
  };
}

export default function LightsOutClient() {
  const [phase, setPhase] = useState<Phase>('ready');
  const [board, setBoard] = useState<boolean[]>([]);
  const [moves, setMoves] = useState(0);
  const [error, setError] = useState<RequestError | null>(null);
  const [savedRun, setSavedRun] = useState<SavedRun | null>(null);
  const [leaderboard, setLeaderboard] = useState<Leader[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const phaseRef = useRef<Phase>('ready');
  const sessionRef = useRef<Session | null>(null);
  const movesRef = useRef<number[]>([]);
  const boardRef = useRef<boolean[]>([]);
  const runRequest = useRef<AbortController | null>(null);
  const boardRequest = useRef<AbortController | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);

  function changePhase(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }

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
    return () => { runRequest.current?.abort(); boardRequest.current?.abort(); };
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
    movesRef.current = [];
    boardRef.current = [];
    setBoard([]);
    setMoves(0);
    setSavedRun(null);
    setError(null);
    changePhase('starting');
    try {
      const session = await request<Session>('session', controller.signal, {});
      if (controller.signal.aborted) return;
      if (session.rulesVersion !== RULES_VERSION) throw new Error('The game rules have changed. Reload this page to play.');
      const initialBoard = createBoard(session.seed);
      sessionRef.current = session;
      boardRef.current = initialBoard;
      setBoard(initialBoard);
      changePhase('playing');
    } catch (caught) {
      if (!controller.signal.aborted) { setError(requestError(caught)); changePhase('ready'); }
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
      const result = await request<SavedRun>('score', controller.signal, {
        sessionToken: session.sessionToken,
        rulesVersion: session.rulesVersion,
        moves: [...movesRef.current],
      });
      if (controller.signal.aborted) return;
      boardRequest.current?.abort();
      setLeaderboardLoading(false);
      setLeaderboardError(null);
      setLeaderboard(result.leaderboard);
      setSavedRun(result);
      changePhase('result');
    } catch (caught) {
      if (!controller.signal.aborted) { setError(requestError(caught)); changePhase('save-error'); }
    }
  }

  function press(index: number) {
    if (phaseRef.current !== 'playing') return;
    const next = toggleCell(boardRef.current, index);
    boardRef.current = next;
    movesRef.current.push(index);
    setBoard(next);
    setMoves(movesRef.current.length);
    if (next.every((light) => !light) || movesRef.current.length === MAX_MOVES) void save();
  }

  const active = phase === 'playing';
  const lit = board.filter(Boolean).length;
  const announcement = active
    ? `${lit} ${lit === 1 ? 'light' : 'lights'} on. ${MAX_MOVES - moves} moves left.`
    : phase === 'starting' ? 'Starting your puzzle…'
      : phase === 'saving' ? 'Verifying your moves and saving the result…'
        : phase === 'result' ? `Score saved: ${savedRun?.score} points.` : '';

  return (
    <GameShell game='lights-out' className='lights-out' stat={<GameStat value={savedRun?.score} label='score' />} howTo={HOW_TO}
      below={
        <section className='lights-out-board' aria-labelledby='lights-out-board-title'>
          <h2 id='lights-out-board-title'>Lights Out leaderboard</h2>
          <p>Best score per player. Scores only; no tickets or XP.</p>
          {leaderboardLoading ? <p role='status'>Loading scores…</p> : null}
          {leaderboardError ? (
            <div><p role='alert'>Scores could not load: {leaderboardError}</p><ArcadeButton onClick={() => void loadLeaderboard()}>Retry leaderboard</ArcadeButton></div>
          ) : !leaderboardLoading ? (
            leaderboard.length ? <ol className='lights-out-scores'>{leaderboard.map((entry) => (
              <li key={entry.userId}><span>{entry.userName}</span><strong>{entry.score} points</strong></li>
            ))}</ol> : <p>No scores yet. Solve a puzzle to start the board.</p>
          ) : null}
        </section>
      }>
      <GameStage phase={phase === 'ready' || phase === 'starting' ? 'ready' : phase === 'result' || phase === 'save-error' ? 'over' : 'playing'} startKeys={[]}>
        <div className='lights-out-play'>
          <p className='lights-out-eyebrow'>Lights Out</p>
          <p className='lights-out-announcement' role='status' aria-live='polite' aria-atomic='true'>{announcement}</p>
          {phase === 'ready' || phase === 'starting' ? (
            <div className='lights-out-intro'>
              <Lightbulb size={64} aria-hidden />
              <h2>Switch every light off</h2>
              <p>Press any light to toggle it and its up, down, left, and right neighbors. Solve the grid within {MAX_MOVES} moves.</p>
              <p>Fewer moves score more: 1,000 points for one move, then 25 fewer per extra move. Reach the limit with lights on and score zero.</p>
              <p>Sign in to save your score. No tickets or XP are awarded.</p>
              <ArcadeButton tone='primary' disabled={phase === 'starting'} onClick={() => void start()}>
                {phase === 'starting' ? 'Starting…' : error ? 'Try starting again' : 'Start puzzle'}
              </ArcadeButton>
            </div>
          ) : null}
          {active ? (
            <div className='lights-out-round'>
              <h2>Switch every light off</h2>
              <p>Moves {moves} / {MAX_MOVES}</p>
              <div className='lights-out-grid' role='group' aria-label='Lights Out board'>
                {board.map((on, index) => {
                  const Icon = on ? Lightbulb : LightbulbOff;
                  return <ArcadeButton key={index} className='lights-out-cell' aria-pressed={on}
                    aria-label={`Row ${Math.floor(index / SIZE) + 1} column ${index % SIZE + 1}: ${on ? 'on' : 'off'}`} onClick={() => press(index)}>
                    <Icon size={26} aria-hidden /><span>{on ? 'On' : 'Off'}</span>
                  </ArcadeButton>;
                })}
              </div>
              <p className='lights-out-hint'>Each press flips a cross. Use Tab and Enter/Space, or tap a light.</p>
              <ArcadeButton size='sm' tone='ghost' onClick={() => void start()}>Restart puzzle</ArcadeButton>
            </div>
          ) : null}
          {phase === 'saving' ? <p>Please wait while the server replays your puzzle.</p> : null}
          {phase === 'result' || phase === 'save-error' ? (
            <div className='lights-out-result'>
              <h2 ref={resultHeading} tabIndex={-1}>{phase === 'result' ? `${savedRun?.score} points` : 'Score not saved'}</h2>
              <p>{phase === 'result' ? savedRun?.solved ? `Solved in ${savedRun.moves} moves.` : 'Move limit reached with lights still on. Try a different approach.' : 'Your moves are kept on this page. Retry saving, or start a new puzzle.'}</p>
              {phase === 'result' ? <p>Your server-verified result is saved. No tickets or XP were awarded.</p> : null}
              {phase === 'save-error' ? <ArcadeButton tone='primary' onClick={() => void save()}>Retry saving score</ArcadeButton> : null}
              <ArcadeButton onClick={() => void start()}>Play again</ArcadeButton>
            </div>
          ) : null}
          {error ? <div className='lights-out-error'><p role='alert'>{error.message}</p>
            {error.signIn ? <ArcadeLinkButton href='/signin?next=%2Flights-out'>Sign in to play</ArcadeLinkButton> : null}
          </div> : null}
        </div>
      </GameStage>
    </GameShell>
  );
}

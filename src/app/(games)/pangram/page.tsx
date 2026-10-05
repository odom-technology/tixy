'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Trophy,
  Share2,
  Shuffle,
  Delete,
  CornerDownLeft,
  Hexagon,
  Sparkles,
} from 'lucide-react';
import { ArcadeButton, ArcadeNotice } from '@/features/arcade/components/ui/arcade-ui';
import { DAILY_BOARD_MODES, GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { PageHeader, GamesWalletCard } from '@/features/arcade/components/shell/page-header';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import { GameInventoryModal } from '@/features/arcade/components/game-inventory-modal';
import { GameInventoryButton } from '@/features/arcade/components/game-inventory-button';
import { GamesRouteSwitcher } from '@/features/arcade/components/games-route-switcher';
import { ArcadeRunRewards } from '@/features/arcade/components/results/arcade-run-result';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { MuteButton } from '@/features/arcade/components/mute-button';
import {
  type PangramCosmeticTheme,
  DEFAULT_PANGRAM_THEME,
  buildPangramTheme,
  pangramThemeToCssVars,
} from './_pangram-theme';
import './_pangram-midway.css';
import { ArcadeLoading } from '@/features/arcade/components/ui/arcade-states';

// ─── Types ──────────────────────────────────────────────────────────────────
type PangramPuzzle = {
  dateKey: string;
  dayNumber: number;
  letters: string[];
  center: string;
  totalWords: number;
  totalPangrams: number;
  maxScore: number;
};

type GuessReason = 'too-short' | 'missing-center' | 'bad-letter' | 'not-a-word';

type GuessResponse = {
  accepted: boolean;
  isPangram: boolean;
  points: number;
  reason?: GuessReason;
  error?: string;
};

type ScoreResponse = {
  error?: string;
  missedWords?: string[];
  reward?: {
    awardedCredits?: number;
    wantedCredits?: number;
    capRemaining?: number;
    earnedTodayTotal?: number;
    balanceAfter?: number;
  };
};

// ─── Rank tiers (must match server PANGRAM_RANK_TIERS) ───────────────────────
const RANK_TIERS = [
  { name: 'Beginner', pct: 0 },
  { name: 'Good Start', pct: 0.02 },
  { name: 'Moving Up', pct: 0.05 },
  { name: 'Good', pct: 0.08 },
  { name: 'Great', pct: 0.15 },
  { name: 'Amazing', pct: 0.25 },
  { name: 'Genius', pct: 0.7 },
  { name: 'Queen Bee', pct: 1 },
] as const;

const tierIndexForScore = (score: number, maxScore: number) => {
  if (maxScore <= 0) return 0;
  const ratio = score / maxScore;
  let idx = 0;
  for (let i = 0; i < RANK_TIERS.length; i++) {
    if (ratio >= RANK_TIERS[i]!.pct) idx = i;
  }
  return idx;
};

// ─── Scoring (client mirror — server is authoritative) ───────────────────────
const _scoreWord = (word: string) => {
  const len = word.length;
  let pts = len === 4 ? 1 : len;
  if (new Set(word).size === 7) pts += 7;
  return pts;
};
const isPangramWord = (word: string) => new Set(word).size === 7;

// ─── Date helpers (UTC — must match the server) ──────────────────────────────
const pad2 = (n: number) => n.toString().padStart(2, '0');
const getDateKey = (d: Date = new Date()) =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

const formatDateDisplay = (d: Date = new Date()) => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};

// ─── LocalStorage ────────────────────────────────────────────────────────────
type SavedState = {
  dateKey: string;
  foundWords: string[];
  score: number;
  submitted: boolean;
  missedWords?: string[] | null;
  elapsedMs?: number;
};

const LS_KEY_PREFIX = 'pangram_';

const loadSavedState = (dateKey: string): SavedState | null => {
  try {
    const raw = localStorage.getItem(`${LS_KEY_PREFIX}${dateKey}`);
    return raw ? (JSON.parse(raw) as SavedState) : null;
  } catch {
    return null;
  }
};

const saveSavedState = (state: SavedState) => {
  try {
    localStorage.setItem(`${LS_KEY_PREFIX}${state.dateKey}`, JSON.stringify(state));
  } catch {
    // Ignore quota errors
  }
};

// ─── Honeycomb geometry — a TIGHT pointy-top flower: a centre hex with six
// neighbours sharing its edges (E/W + the four diagonals). Offsets are in units
// of one hex width (`--pg-hex-w`); the comb is 3 hex-widths across so the flower
// packs with no gaps. SQRT3_2 = √3/2 is the diagonal row's vertical offset. ────
const SQRT3_2 = 0.8660254;
/** dx/dy offset of each outer hex centre from the comb centre, in hex-widths. */
const OUTER_SLOTS: { dx: number; dy: number }[] = [
  { dx: -0.5, dy: -SQRT3_2 }, // 0 NW
  { dx: 0.5, dy: -SQRT3_2 }, //  1 NE
  { dx: 1, dy: 0 }, //          2 E
  { dx: 0.5, dy: SQRT3_2 }, //  3 SE
  { dx: -0.5, dy: SQRT3_2 }, // 4 SW
  { dx: -1, dy: 0 }, //         5 W
];

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

// ─── Main component ─────────────────────────────────────────────────────────
export default function PangramPage() {
  const [dateKey, setDateKey] = useState(() => getDateKey());

  // Detect UTC date rollover (midnight) and reload for the new puzzle.
  useEffect(() => {
    const check = setInterval(() => {
      const currentKey = getDateKey();
      if (currentKey !== dateKey) {
        setDateKey(currentKey);
        window.location.reload();
      }
    }, 60_000);
    return () => clearInterval(check);
  }, [dateKey]);

  // ─── Puzzle state ───────────────────────────────────────────────────────
  const [puzzle, setPuzzle] = useState<PangramPuzzle | null>(null);
  const [puzzleLoading, setPuzzleLoading] = useState(true);
  const [puzzleError, setPuzzleError] = useState<string | null>(null);

  // ─── Game state ─────────────────────────────────────────────────────────
  const [input, setInput] = useState('');
  const [foundWords, setFoundWords] = useState<string[]>([]);
  const [score, setScore] = useState(0);
  const [outerLetters, setOuterLetters] = useState<string[]>([]);
  const [hasSubmittedScore, setHasSubmittedScore] = useState(false);
  const [missedWords, setMissedWords] = useState<string[] | null>(null);
  const [pressedLetter, setPressedLetter] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const startTimeRef = useRef(Date.now());
  const elapsedAtStartRef = useRef(0);

  // Floating feedback toast above the comb.
  const [toast, setToast] = useState<{ message: string; tone: 'good' | 'bad' | 'pangram'; nonce: number } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isGuessingRef = useRef(false);

  // ─── Wallet + reward + leaderboard UI ───────────────────────────────────
  const [shareMessage, setShareMessage] = useState('');
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);
  const [leaderboardMode, setLeaderboardMode] = useState<'daily' | 'alltime'>('daily');
  const [walletBalances, setWalletBalances] = useState({ credits: 0 });
  const [dailyCreditsProgress, setDailyCreditsProgress] = useState({ earned: 0, cap: 300 });
  const {
    reward: runReward,
    achievements: runAchievements,
    capture: captureRunResult,
    reset: resetRunResult,
  } = useArcadeRunResult();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmittingScore, setIsSubmittingScore] = useState(false);
  const [theme, setTheme] = useState<PangramCosmeticTheme>(
    DEFAULT_PANGRAM_THEME,
  );

  // ─── Fetch puzzle ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const fetchPuzzle = async () => {
      try {
        const res = await fetch('/api/games/pangram/puzzle', { cache: 'no-store' });
        if (!res.ok) {
          if (!cancelled) setPuzzleError('Failed to load puzzle');
          return;
        }
        const data = (await res.json()) as PangramPuzzle;
        if (cancelled) return;
        resetRunResult();
        setPuzzle(data);
        // Restore saved progress for this exact date.
        const saved = loadSavedState(data.dateKey);
        if (saved && saved.dateKey === data.dateKey) {
          setFoundWords(saved.foundWords);
          setScore(saved.score);
          setHasSubmittedScore(saved.submitted);
          setMissedWords(Array.isArray(saved.missedWords) ? saved.missedWords : null);
          elapsedAtStartRef.current = Math.max(0, Number(saved.elapsedMs) || 0);
          startTimeRef.current = Date.now();
        }
        // Initial outer-letter order = the six non-center letters.
        setOuterLetters(data.letters.filter((l) => l !== data.center));
      } catch {
        if (!cancelled) setPuzzleError('Failed to load puzzle');
      } finally {
        if (!cancelled) setPuzzleLoading(false);
      }
    };
    void fetchPuzzle();
    return () => {
      cancelled = true;
    };
  }, [resetRunResult]);

  // ─── Load wallet ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const loadWallet = async () => {
      try {
        const res = await fetch('/api/store/inventory?gameType=pangram', {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const payload = (await res.json()) as {
          wallet?: { credits?: number };
          dailyGameCredits?: { earned?: number; cap?: number };
          equipped?: Array<{
            slot?: string;
            item?: { assetRef?: Record<string, unknown> | null } | null;
          }>;
        };
        if (cancelled) return;
        setWalletBalances({ credits: payload.wallet?.credits ?? 0 });
        setDailyCreditsProgress({
          earned: payload.dailyGameCredits?.earned ?? 0,
          cap: payload.dailyGameCredits?.cap ?? 300,
        });
        setTheme(buildPangramTheme(payload));
      } catch {
        /* silently fail */
      }
    };
    void loadWallet();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Persist on change ──────────────────────────────────────────────────
  useEffect(() => {
    if (!puzzle) return;
    saveSavedState({
      dateKey: puzzle.dateKey,
      foundWords,
      score,
      submitted: hasSubmittedScore,
      missedWords,
      elapsedMs: elapsedAtStartRef.current + (Date.now() - startTimeRef.current),
    });
  }, [puzzle, foundWords, score, hasSubmittedScore, missedWords]);

  // Cleanup toast timer
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const showToast = useCallback((message: string, tone: 'good' | 'bad' | 'pangram') => {
    setToast({ message, tone, nonce: Date.now() });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 1400);
  }, []);

  // ─── Letter entry ────────────────────────────────────────────────────────
  const appendLetter = useCallback(
    (letter: string) => {
      if (!puzzle || hasSubmittedScore) return;
      setInput((prev) => (prev.length >= 20 ? prev : prev + letter));
      setPressedLetter(letter);
      window.setTimeout(() => setPressedLetter(null), 120);
      SoundManager.play('arcadeBet', { volume: 0.5 });
    },
    [puzzle, hasSubmittedScore],
  );

  const deleteLetter = useCallback(() => {
    if (hasSubmittedScore) return;
    setInput((prev) => prev.slice(0, -1));
  }, [hasSubmittedScore]);

  const shuffleOuter = useCallback(() => {
    if (hasSubmittedScore) return;
    setOuterLetters((prev) => {
      const out = [...prev];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    });
    SoundManager.play('arcadeReelTick', { volume: 0.5 });
  }, [hasSubmittedScore]);

  const flashShake = useCallback(() => {
    setShaking(true);
    window.setTimeout(() => setShaking(false), 500);
  }, []);

  // ─── Submit a guess (server-authoritative grading) ───────────────────────
  const submitGuess = useCallback(async (override?: string) => {
    if (!puzzle || hasSubmittedScore || isGuessingRef.current) return;
    const word = (override ?? input).trim().toLowerCase();
    setInput('');
    if (word.length === 0) return;

    // Local fast-path rejections (server still authoritative for acceptance).
    if (word.length < 4) {
      showToast('Too short', 'bad');
      flashShake();
      SoundManager.play('arcadeLose', { volume: 0.4 });
      return;
    }
    if (!word.includes(puzzle.center)) {
      showToast('Missing center letter', 'bad');
      flashShake();
      SoundManager.play('arcadeLose', { volume: 0.4 });
      return;
    }
    const letterSet = new Set(puzzle.letters);
    if ([...word].some((c) => !letterSet.has(c))) {
      showToast('Bad letter', 'bad');
      flashShake();
      SoundManager.play('arcadeLose', { volume: 0.4 });
      return;
    }
    if (foundWords.includes(word)) {
      showToast('Already found', 'bad');
      flashShake();
      return;
    }

    isGuessingRef.current = true;
    try {
      const res = await fetch('/api/games/pangram/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateKey: getDateKey(), word }),
      });
      const data = (await res.json().catch(() => null)) as GuessResponse | null;
      if (!res.ok || !data) {
        showToast(
          typeof data?.error === 'string' && data.error.trim()
            ? data.error
            : 'Try again',
          'bad',
        );
        flashShake();
        return;
      }
      if (!data.accepted) {
        const msg =
          data.reason === 'not-a-word'
            ? 'Not in word list'
            : data.reason === 'missing-center'
              ? 'Missing center letter'
              : data.reason === 'too-short'
                ? 'Too short'
                : 'Bad letter';
        showToast(msg, 'bad');
        flashShake();
        SoundManager.play('arcadeLose', { volume: 0.4 });
        return;
      }
      // Accepted!
      setFoundWords((prev) => (prev.includes(word) ? prev : [word, ...prev]));
      setScore((prev) => prev + data.points);
      if (data.isPangram) {
        showToast(`PANGRAM! +${data.points}`, 'pangram');
        SoundManager.play('arcadeBigWin', { volume: 0.6 });
        if (!reduceMotion()) {
          setCelebrate(true);
          window.setTimeout(() => setCelebrate(false), 1200);
        }
      } else {
        showToast(`+${data.points}`, 'good');
        SoundManager.play('arcadeWin', { volume: 0.45 });
      }
    } catch {
      showToast('Network error', 'bad');
      flashShake();
    } finally {
      isGuessingRef.current = false;
    }
  }, [puzzle, hasSubmittedScore, input, foundWords, showToast, flashShake]);

  // ─── Keyboard support ───────────────────────────────────────────────────
  useEffect(() => {
    if (!puzzle) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't hijack typing inside other inputs/modals.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (showLeaderboard || showInventory || hasSubmittedScore) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        void submitGuess();
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        deleteLetter();
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        shuffleOuter();
        return;
      }
      const ch = e.key.toLowerCase();
      if (ch.length === 1 && ch >= 'a' && ch <= 'z' && puzzle.letters.includes(ch)) {
        e.preventDefault();
        appendLetter(ch);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [puzzle, submitGuess, deleteLetter, shuffleOuter, appendLetter, showLeaderboard, showInventory, hasSubmittedScore]);

  // ─── Submit score to leaderboard ─────────────────────────────────────────
  const submitScore = useCallback(async (revealOnly = false) => {
    if (!puzzle || isSubmittingScore) return;
    if (hasSubmittedScore && (!revealOnly || missedWords !== null)) return;
    if (foundWords.length === 0) {
      setSubmitError('Find at least one word before submitting.');
      return;
    }
    const firstSubmission = !hasSubmittedScore;
    try {
      setIsSubmittingScore(true);
      setSubmitError(null);
      const res = await fetch('/api/games/pangram/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          puzzleDate: getDateKey(),
          words: foundWords,
          timeSeconds: Math.round(
            (elapsedAtStartRef.current + (Date.now() - startTimeRef.current)) / 100,
          ) / 10,
        }),
      });
      const data = (await res.json().catch(() => null)) as ScoreResponse | null;
      if (res.ok) {
        setHasSubmittedScore(true);
        if (firstSubmission) captureRunResult(data);
        if (Array.isArray(data?.missedWords)) {
          setMissedWords(data.missedWords.filter((word) => typeof word === 'string' && word.length > 0));
        }
        const reward = data?.reward;
        if (reward) {
          const awarded = Number(reward.awardedCredits ?? 0);
          const balanceAfter = Number(reward.balanceAfter);

          setWalletBalances((prev) => ({
            ...prev,
            credits: Number.isFinite(balanceAfter)
              ? Math.max(0, Math.floor(balanceAfter))
              : Math.max(0, prev.credits + (Number.isFinite(awarded) ? Math.max(0, awarded) : 0)),
          }));

          if (
            Number.isFinite(Number(reward.earnedTodayTotal)) &&
            Number.isFinite(Number(reward.capRemaining))
          ) {
            setDailyCreditsProgress({
              earned: Math.max(0, Number(reward.earnedTodayTotal)),
              cap: Math.max(0, Number(reward.earnedTodayTotal)) + Math.max(0, Number(reward.capRemaining)),
            });
          }
        }
        setLeaderboardRefreshKey((k) => k + 1);
      } else {
        setSubmitError(
          typeof data?.error === 'string' && data.error.trim().length > 0
            ? data.error
            : 'Could not submit score. Please try again.',
        );
      }
    } catch {
      setSubmitError('Network error while submitting score. Please try again.');
    } finally {
      setIsSubmittingScore(false);
    }
  }, [captureRunResult, puzzle, hasSubmittedScore, missedWords, isSubmittingScore, foundWords]);

  // ─── Share ───────────────────────────────────────────────────────────────
  const handleShare = useCallback(() => {
    if (!puzzle) return;
    const tierIdx = tierIndexForScore(score, puzzle.maxScore);
    const tier = RANK_TIERS[tierIdx]!.name;
    const totalTiers = RANK_TIERS.length;
    const filled = tierIdx + 1;
    const bar = '▰'.repeat(filled) + '▱'.repeat(totalTiers - filled);
    const pangramCount = foundWords.filter(isPangramWord).length;
    const text =
      `Pangram #${puzzle.dayNumber} — ${tier}\n` +
      `${bar}\n` +
      `${score} pts · ${foundWords.length}/${puzzle.totalWords} words` +
      (pangramCount > 0 ? ` · ${pangramCount} pangram${pangramCount !== 1 ? 's' : ''}` : '') +
      ` 🐝`;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setShareMessage('Copied to clipboard!');
        setTimeout(() => setShareMessage(''), 2000);
      })
      .catch(() => setShareMessage(text));
  }, [puzzle, score, foundWords]);

  // ─── Derived display ─────────────────────────────────────────────────────
  const walletCard = {
    credits: walletBalances.credits,
    progress: {
      label: 'Daily Tickets',
      current: dailyCreditsProgress.earned,
      max: dailyCreditsProgress.cap,
    },
  };

  const tierIdx = puzzle ? tierIndexForScore(score, puzzle.maxScore) : 0;
  const currentTier = RANK_TIERS[tierIdx]!;
  const nextTier = RANK_TIERS[tierIdx + 1];
  const nextThreshold = puzzle && nextTier ? Math.ceil(nextTier.pct * puzzle.maxScore) : null;
  const pangramsFound = foundWords.filter(isPangramWord).length;

  // Progress spans the full possible score; Genius sits at 70%, Queen Bee at 100%.
  const progressRatio = puzzle && puzzle.maxScore > 0
    ? Math.min(1, score / puzzle.maxScore)
    : 0;

  // ─── Loading state ───────────────────────────────────────────────────────
  if (puzzleLoading) {
    return (
      <section className='mx-auto w-full max-w-4xl space-y-4 px-3 pt-3 pb-[calc(8rem+env(safe-area-inset-bottom))] sm:space-y-8 sm:px-4 sm:pt-6 sm:pb-12'>
        <div className='hidden sm:block'>
          <PageHeader eyebrow='tixy' icon={<Hexagon size={22} />} title='Pangram' subtitle='Loading today&apos;s letters...' wallet={walletCard} />
        </div>
        <div className='sm:hidden'><GamesWalletCard wallet={walletCard} compact /></div>
        <GamesRouteSwitcher />
        <div className='flex items-center justify-center py-20'>
          <ArcadeLoading label='Loading today&apos;s letters.' />
        </div>
      </section>
    );
  }

  // ─── Error state ─────────────────────────────────────────────────────────
  if (!puzzle || puzzleError) {
    return (
      <section className='mx-auto w-full max-w-4xl space-y-4 px-3 pt-3 pb-[calc(8rem+env(safe-area-inset-bottom))] sm:space-y-8 sm:px-4 sm:pt-6 sm:pb-12'>
        <div className='hidden sm:block'>
          <PageHeader eyebrow='tixy' icon={<Hexagon size={22} />} title='Pangram' wallet={walletCard} />
        </div>
        <div className='sm:hidden'><GamesWalletCard wallet={walletCard} compact /></div>
        <GamesRouteSwitcher />
        <div className='arcade-card px-4 py-12 text-center'>
          <Hexagon size={48} className='mx-auto text-faint/40 mb-4' />
          <h2 className='text-xl font-bold text-strong'>Pangram</h2>
          <p className='mt-2 text-sm text-faint'>
            {puzzleError ? 'Could not load today&apos;s puzzle. Please try again later.' : 'No puzzle available.'}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className='pangram-root mx-auto w-full max-w-4xl space-y-4 px-3 pt-3 pb-[calc(8rem+env(safe-area-inset-bottom))] sm:space-y-8 sm:px-4 sm:pt-6 sm:pb-12'
      style={pangramThemeToCssVars(theme)}
    >
      <div className='hidden sm:block'>
        <PageHeader
          eyebrow='tixy'
          icon={<Hexagon size={22} />}
          title='Pangram'
          subtitle={`Today’s Letters — ${formatDateDisplay()}`}
          wallet={walletCard}
        />
      </div>
      <div className='sm:hidden'>
        <GamesWalletCard wallet={walletCard} compact />
      </div>
      <GamesRouteSwitcher />

      <div className='flex justify-end gap-2'>
        <GameLeaderboardButton
          onClick={() => setShowLeaderboard(true)}
          className='bg-background font-semibold hover:bg-raised max-sm:px-3 max-sm:py-1.5 max-sm:text-xs'
        />
        <GameInventoryButton
          onClick={() => setShowInventory(true)}
          className='bg-background font-semibold hover:bg-raised max-sm:px-3 max-sm:py-1.5 max-sm:text-xs'
        />
        <MuteButton />
      </div>

      {/* ── Rank-tier progress ── */}
      <div className='pg-rank'>
        <div className='pg-rank-head'>
          <span className='pg-rank-tier'>{currentTier.name}</span>
          <span className='pg-rank-score'>
            {score} <span className='pg-rank-score-sub'>pts</span>
          </span>
        </div>
        <div className='pg-rank-track' role='progressbar' aria-valuenow={score} aria-valuemin={0} aria-valuemax={puzzle.maxScore}>
          <div className='pg-rank-fill' style={{ width: `${progressRatio * 100}%` }} />
          {RANK_TIERS.map((t, i) => (
            <span
              key={t.name}
              className='pg-rank-pip'
              data-reached={tierIdx >= i ? 'true' : undefined}
              data-current={tierIdx === i ? 'true' : undefined}
              style={{ left: `${Math.min(97.5, Math.max(2.5, t.pct * 100))}%` }}
              title={t.name}
            />
          ))}
        </div>
        <div className='pg-rank-foot'>
          <span>
            {foundWords.length}/{puzzle.totalWords} words
            {pangramsFound > 0 ? ` · ${pangramsFound}/${puzzle.totalPangrams} pangrams` : ''}
          </span>
          {nextThreshold != null ? (
            <span>{Math.max(0, nextThreshold - score)} to {nextTier!.name}</span>
          ) : (
            <span className='pg-rank-genius'>Genius reached!</span>
          )}
        </div>
      </div>

      {/* ── Main stage ── */}
      <div className='arcade-game-surface px-4 py-5 sm:px-8 sm:py-8'>
        {/* Found words list */}
        <div className='pg-found' aria-label='Words found'>
          {foundWords.length === 0 ? (
            <p className='pg-found-empty'>Found words appear here. Make a word of 4+ letters using the center.</p>
          ) : (
            <ul className='pg-found-list'>
              {[...foundWords].sort().map((w) => (
                <li key={w} className='pg-found-word' data-pangram={isPangramWord(w) ? 'true' : undefined}>
                  {w}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Input line */}
        <div className='pg-input-area'>
          {toast && (
            <div
              key={toast.nonce}
              className='pg-toast-wrap'
              role='status'
              aria-live='polite'
            >
              <span className='pg-toast' data-tone={toast.tone}>
                {toast.tone === 'pangram' ? <Sparkles size={14} className='shrink-0' /> : null}
                {toast.message}
              </span>
            </div>
          )}
          <div className={`pg-input${shaking ? ' pg-input-shake' : ''}`} aria-live='polite'>
            {input.length === 0 ? (
              <span className='pg-input-placeholder'>
                {hasSubmittedScore ? 'Today’s run is complete' : 'Type or tap letters'}
              </span>
            ) : (
              [...input].map((ch, i) => (
                <span
                  key={i}
                  className='pg-input-char'
                  data-center={ch === puzzle.center ? 'true' : undefined}
                  data-bad={!puzzle.letters.includes(ch) ? 'true' : undefined}
                >
                  {ch}
                </span>
              ))
            )}
            <span className='pg-input-caret' aria-hidden />
          </div>
        </div>

        {/* Honeycomb — Spelling Bee-style taps; letters may be reused freely. */}
        <div
          className={`pg-comb${celebrate ? ' pg-comb-celebrate' : ''}`}
          role='group'
          aria-label='Letter hive — tap or type to build words'
        >
          {/* Centre hex (amber) */}
          <button
            type='button'
            className='pg-hex pg-hex-center'
            data-pressed={pressedLetter === puzzle.center ? 'true' : undefined}
            onClick={() => appendLetter(puzzle.center)}
            disabled={hasSubmittedScore}
            aria-label={`Center letter ${puzzle.center}`}
          >
            <span className='pg-hex-face'>{puzzle.center}</span>
          </button>

          {/* Six outer hexes, placed with valid percentage coordinates. */}
          {outerLetters.map((letter, i) => {
            const slot = OUTER_SLOTS[i]!;
            return (
              <button
                key={`${letter}-${i}`}
                type='button'
                className='pg-hex pg-hex-outer'
                data-pressed={pressedLetter === letter ? 'true' : undefined}
                style={{
                  left: `${50 + (slot.dx / 3) * 100}%`,
                  top: `${50 + (slot.dy / 2.887) * 100}%`,
                }}
                onClick={() => appendLetter(letter)}
                disabled={hasSubmittedScore}
                aria-label={`Letter ${letter}`}
              >
                <span className='pg-hex-face'>{letter}</span>
              </button>
            );
          })}
        </div>

        {/* Controls */}
        <div className='pg-controls'>
          <ArcadeButton tone='ghost' size='sm' onClick={deleteLetter} disabled={hasSubmittedScore || input.length === 0} aria-label='Delete'>
            <Delete size={16} />
            Delete
          </ArcadeButton>
          <ArcadeButton tone='ghost' size='sm' onClick={shuffleOuter} disabled={hasSubmittedScore} aria-label='Shuffle letters'>
            <Shuffle size={16} />
            Shuffle
          </ArcadeButton>
          <ArcadeButton tone='primary' size='sm' onClick={() => void submitGuess()} disabled={hasSubmittedScore || input.length === 0} aria-label='Enter word'>
            <CornerDownLeft size={16} />
            Enter
          </ArcadeButton>
        </div>

        {/* Submit-to-leaderboard / results */}
        <div className='pg-finish'>
          {hasSubmittedScore ? (
            <ArcadeRunRewards
              reward={runReward}
              achievements={runAchievements}
              className='w-full max-w-sm'
            />
          ) : null}
          {submitError && <ArcadeNotice tone='danger'>{submitError}</ArcadeNotice>}

          <div className='text-xs text-faint'>
            Daily Tickets: {dailyCreditsProgress.earned}/{dailyCreditsProgress.cap}
          </div>

          <div className='flex flex-wrap items-center justify-center gap-3'>
            {!hasSubmittedScore ? (
              <ArcadeButton
                tone='primary'
                size='sm'
                onClick={() => void submitScore()}
                disabled={isSubmittingScore || foundWords.length === 0}
              >
                <Trophy size={14} />
                {isSubmittingScore ? 'Submitting...' : 'Finish & Submit'}
              </ArcadeButton>
            ) : (
              <span className='pg-locked'>
                <Trophy size={14} />
                Submitted for today
              </span>
            )}
            <ArcadeButton tone='ghost' size='sm' onClick={handleShare} disabled={foundWords.length === 0}>
              <Share2 size={14} />
              Share
            </ArcadeButton>
            <ArcadeButton tone='ghost' size='sm' onClick={() => setShowLeaderboard(true)}>
              <Trophy size={14} />
              Leaderboard
            </ArcadeButton>
          </div>

          {!hasSubmittedScore && foundWords.length > 0 ? (
            <p className='text-xs text-faint'>
              Keep playing until you’re ready—submitting ends today’s run.
            </p>
          ) : null}

          {shareMessage && (
            <p className='pg-share-msg text-xs font-medium animate-in fade-in duration-300'>{shareMessage}</p>
          )}

          {hasSubmittedScore && (
            <div className='pg-missed' aria-label='Missed words'>
              <div className='pg-missed-head'>
                <span>Missed words</span>
                {missedWords !== null ? (
                  <span>{missedWords.length === 0 ? 'Complete' : `${missedWords.length} missed`}</span>
                ) : null}
              </div>
              {missedWords === null ? (
                <ArcadeButton
                  tone='ghost'
                  size='sm'
                  onClick={() => void submitScore(true)}
                  disabled={isSubmittingScore || foundWords.length === 0}
                >
                  {isSubmittingScore ? 'Loading...' : 'Show missed words'}
                </ArcadeButton>
              ) : missedWords.length === 0 ? (
                <p className='pg-missed-empty'>You found every word.</p>
              ) : (
                <ul className='pg-missed-list'>
                  {missedWords.map((w) => (
                    <li key={w} className='pg-missed-word' data-pangram={isPangramWord(w) ? 'true' : undefined}>
                      {w}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      <GameLeaderboardModal
        open={showLeaderboard}
        onOpenChange={setShowLeaderboard}
        title='Pangram Leaderboard'
        description={leaderboardMode === 'daily' ? "Today's hive" : 'All-time standings'}
      >
        <GameLeaderboard
          gameType='pangram'
          mode={leaderboardMode}
          modes={DAILY_BOARD_MODES}
          onModeChange={(next) => setLeaderboardMode(next as 'daily' | 'alltime')}
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>

      <GameInventoryModal
        open={showInventory}
        onOpenChange={setShowInventory}
        title='Pangram Inventory'
        description='No equip slots are active for this game yet.'
      />

      {/* ── Midway-skinned Pangram graphics (scoped, no globals.css edits) ──
          The hive is six cream/wood "key" hexes around an amber-enamel center.
          The input line is a recessed well; found words are enamel chips; the
          rank bar is an inset track filled with amber paint. Nothing glows.
          Letter-press + shuffle + celebrate all degrade under reduced-motion. */}
    </section>
  );
}

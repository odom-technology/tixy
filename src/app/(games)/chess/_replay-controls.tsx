'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
} from 'lucide-react';

type Props = {
  /** Total plies played. */
  totalPly: number;
  /** Current review ply (0 = initial position, totalPly = live/final). */
  currentPly: number;
  /** Jump to a specific ply. */
  onSeek: (ply: number) => void;
};

const SPEED_OPTIONS = [
  { ms: 1800, label: '0.5×' },
  { ms: 900,  label: '1×' },
  { ms: 450,  label: '2×' },
  { ms: 225,  label: '4×' },
] as const;

export function ReplayControls({ totalPly, currentPly, onSeek }: Props) {
  const [speedMs, setSpeedMs] = useState(900);
  const [playing, setPlaying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const atEnd = currentPly >= totalPly;
  const atStart = currentPly <= 0;

  // Autoplay tick
  useEffect(() => {
    if (!playing) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      return;
    }
    intervalRef.current = setInterval(() => {
      onSeek(Math.min(totalPly, currentPly + 1));
    }, speedMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [playing, speedMs, currentPly, totalPly, onSeek]);

  // Stop at the end
  useEffect(() => {
    if (atEnd && playing) setPlaying(false);
  }, [atEnd, playing]);

  // Keyboard shortcuts — ignore when the user is typing in an input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
      switch (e.key) {
        case 'ArrowLeft':  e.preventDefault(); onSeek(Math.max(0, currentPly - 1)); break;
        case 'ArrowRight': e.preventDefault(); onSeek(Math.min(totalPly, currentPly + 1)); break;
        case 'Home':       e.preventDefault(); onSeek(0); break;
        case 'End':        e.preventDefault(); onSeek(totalPly); break;
        case ' ':
          e.preventDefault();
          setPlaying((p) => !p);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentPly, totalPly, onSeek]);

  return (
    <div className='rounded-panel border-2 border-ink bg-panel p-2 shadow-chip'>
      <div className='flex items-center justify-between gap-2'>
        <div className='flex items-center gap-0.5'>
          <ControlButton disabled={atStart} onClick={() => onSeek(0)} title='Start (Home)'>
            <ChevronFirst size={16} />
          </ControlButton>
          <ControlButton disabled={atStart} onClick={() => onSeek(Math.max(0, currentPly - 1))} title='Previous (←)'>
            <ChevronLeft size={16} />
          </ControlButton>
          <ControlButton
            onClick={() => {
              if (atEnd) onSeek(0);
              setPlaying((p) => !p);
            }}
            title={playing ? 'Pause (space)' : 'Play (space)'}
            primary
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </ControlButton>
          <ControlButton disabled={atEnd} onClick={() => onSeek(Math.min(totalPly, currentPly + 1))} title='Next (→)'>
            <ChevronRight size={16} />
          </ControlButton>
          <ControlButton disabled={atEnd} onClick={() => onSeek(totalPly)} title='Latest (End)'>
            <ChevronLast size={16} />
          </ControlButton>
        </div>

        <div className='flex items-center gap-2 text-[11px] text-faint'>
          <span className='arcade-num'>
            {currentPly} / {totalPly}
          </span>
          <select
            value={speedMs}
            onChange={(e) => setSpeedMs(Number(e.target.value))}
            className='rounded-tag border border-ink bg-well px-1.5 py-0.5 text-[11px] text-strong'
            aria-label='Playback speed'
          >
            {SPEED_OPTIONS.map((s) => (
              <option key={s.ms} value={s.ms}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Scrubber */}
      <input
        type='range'
        min={0}
        max={Math.max(1, totalPly)}
        value={currentPly}
        onChange={(e) => onSeek(Number(e.target.value))}
        className='mt-1.5 w-full accent-[var(--enamel-tickets)]'
        aria-label='Position in game'
      />
    </div>
  );
}

function ControlButton({
  children,
  disabled,
  onClick,
  title,
  primary,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  primary?: boolean;
}) {
  return (
    <button
      type='button'
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-key transition disabled:opacity-40 ${
        primary
          ? 'border-2 border-ink bg-key-face text-key-face-on shadow-chip hover:brightness-107'
          : 'hover:bg-raised'
      }`}
    >
      {children}
    </button>
  );
}

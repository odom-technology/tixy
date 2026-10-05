'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';

type MoveQuality = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | null;

type Props = {
  /** SAN strings ordered by ply. */
  sans: string[];
  /** Per-ply annotation aligned with `sans` (same length or undefined). */
  annotations?: MoveQuality[];
  /** Metadata for PGN export header (optional). */
  pgnMeta?: {
    whiteName?: string | null;
    blackName?: string | null;
    result?: '1-0' | '0-1' | '1/2-1/2' | null;
    timeControl?: string | null;
    date?: string | null;
  };
  /** Current ply (1-indexed) to highlight as the active review position. */
  currentPly?: number | null;
  /** If provided, move items become clickable; the callback receives the ply number. */
  onJumpToPly?: (ply: number) => void;
};

export function MoveList({ sans, annotations, pgnMeta, currentPly, onJumpToPly }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const activeMoveRef = useRef<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);

  // Auto-scroll the list. While live (no currentPly or pointing past the
  // last move) snap to the bottom as new moves arrive. When reviewing a
  // specific ply — forward or backward — ensure that cell is visible so
  // scrubbing doesn't leave the highlighted move off-screen.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const isLive = currentPly == null || currentPly >= sans.length;
    if (isLive) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    const target = activeMoveRef.current;
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'nearest' });
    }
  }, [sans.length, currentPly]);

  const pairs: Array<{ n: number; white: string | null; black: string | null }> = [];
  for (let i = 0; i < sans.length; i += 2) {
    pairs.push({
      n: i / 2 + 1,
      white: sans[i] ?? null,
      black: sans[i + 1] ?? null,
    });
  }

  const copyPgn = async () => {
    const pgn = buildPgn(sans, pgnMeta);
    try {
      await navigator.clipboard.writeText(pgn);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };

  return (
    <div>
      {sans.length > 0 && (
        <div className='mb-1 flex justify-end'>
          <ArcadeButton
            tone='ghost'
            size='xs'
            onClick={copyPgn}
          >
            <Copy size={11} />
            {copied ? 'copied' : 'copy pgn'}
          </ArcadeButton>
        </div>
      )}
      <div
        ref={ref}
        className='arcade-card-inset max-h-[360px] overflow-y-auto p-2 text-sm'
      >
        <ol className='space-y-0.5'>
          {pairs.map((p) => {
            const whitePly = (p.n - 1) * 2 + 1;
            const blackPly = whitePly + 1;
            const whiteQuality = annotations?.[whitePly - 1] ?? null;
            const blackQuality = annotations?.[blackPly - 1] ?? null;
            return (
              <li key={p.n} className='grid grid-cols-[2rem_1fr_1fr] items-center gap-2'>
                <span className='text-right text-xs text-faint'>{p.n}.</span>
                <MoveCell
                  san={p.white}
                  ply={whitePly}
                  isCurrent={currentPly === whitePly}
                  onJump={onJumpToPly}
                  quality={whiteQuality}
                  activeRef={currentPly === whitePly ? activeMoveRef : undefined}
                />
                <MoveCell
                  san={p.black}
                  ply={blackPly}
                  isCurrent={currentPly === blackPly}
                  onJump={onJumpToPly}
                  quality={blackQuality}
                  activeRef={currentPly === blackPly ? activeMoveRef : undefined}
                />
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

const QUALITY_STYLE: Record<Exclude<MoveQuality, null>, { icon: string; colorClass: string; label: string }> = {
  best:       { icon: '!',  colorClass: 'text-prize-text', label: 'Best move' },
  good:       { icon: '',   colorClass: '', label: 'Good move' },
  inaccuracy: { icon: '?!', colorClass: 'text-faint', label: 'Inaccuracy' },
  mistake:    { icon: '?',  colorClass: 'text-tickets-text', label: 'Mistake' },
  blunder:    { icon: '??', colorClass: 'text-danger-text', label: 'Blunder' },
};

function MoveCell({
  san,
  ply,
  isCurrent,
  onJump,
  quality,
  activeRef,
}: {
  san: string | null;
  ply: number;
  isCurrent: boolean;
  onJump?: (ply: number) => void;
  quality: MoveQuality;
  activeRef?: React.RefObject<HTMLElement | null>;
}) {
  if (!san) return <span />;
  const clickable = Boolean(onJump);
  const classes = `flex items-center gap-1 rounded px-1 py-0.5 text-left transition-colors ${
    isCurrent ? 'border border-ink bg-tickets text-tickets-on' : 'text-strong'
  } ${clickable ? 'cursor-pointer hover:bg-raised' : ''}`;
  const qualityStyle = quality ? QUALITY_STYLE[quality] : null;
  const showIcon = Boolean(qualityStyle && qualityStyle.icon);

  const inner = (
    <>
      <span>{san}</span>
      {showIcon && qualityStyle && (
        <span
          className={`font-sans text-[10px] font-bold ${qualityStyle.colorClass}`}
          title={qualityStyle.label}
        >
          {qualityStyle.icon}
        </span>
      )}
    </>
  );
  if (!clickable) {
    return (
      <span
        ref={activeRef as React.RefObject<HTMLSpanElement | null> | undefined}
        className={classes}
        aria-current={isCurrent ? 'true' : undefined}
      >
        {inner}
      </span>
    );
  }
  return (
    <button
      ref={activeRef as React.RefObject<HTMLButtonElement | null> | undefined}
      type='button'
      aria-current={isCurrent ? 'true' : undefined}
      onClick={() => onJump?.(ply)}
      className={classes}
    >
      {inner}
    </button>
  );
}

function buildPgn(sans: string[], meta?: Props['pgnMeta']): string {
  const today = (meta?.date ?? new Date().toISOString().slice(0, 10)).replace(/-/g, '.');
  const white = meta?.whiteName ?? '?';
  const black = meta?.blackName ?? '?';
  const result = meta?.result ?? '*';
  const timeControl = meta?.timeControl ?? '';

  const headers = [
    `[Event "Arcade Chess"]`,
    `[Site "Arcade"]`,
    `[Date "${today}"]`,
    `[White "${white}"]`,
    `[Black "${black}"]`,
    `[Result "${result}"]`,
    ...(timeControl ? [`[TimeControl "${timeControl}"]`] : []),
  ].join('\n');

  const parts: string[] = [];
  for (let i = 0; i < sans.length; i++) {
    if (i % 2 === 0) parts.push(`${Math.floor(i / 2) + 1}.`);
    parts.push(sans[i]!);
  }
  const body = parts.join(' ') + (result !== '*' ? ` ${result}` : '');

  return `${headers}\n\n${body}\n`;
}

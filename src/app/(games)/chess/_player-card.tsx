'use client';

import { FramedAvatar } from '@/features/users/components/framed-avatar';
import { Username } from '@/features/users/components/username';
import { namecardBackground } from '@/features/users/components/namecard';
import type { ProfileFlair } from '@/server/arcade/rewards/profile-flair';
import {
  BOT_PLAYERCARD_THEMES,
  getPlayercardAnimationStyle,
  getPlayercardAnimationStylesheet,
  type PlayercardTheme,
} from '@/features/arcade/lib/pool-playercard-theme';
import type { ChessColor } from '@/features/arcade/lib/chess/types';
import type { PieceCode } from '@/features/arcade/lib/chess';
import type { ChessPiecesTheme } from '@/features/arcade/lib/chess/theme';
import { ChessPieceSvg, type ChessPieceShape } from './_piece-svg';

export type { PlayercardTheme } from '@/features/arcade/lib/pool-playercard-theme';
export { DEFAULT_PLAYERCARD_THEME } from '@/features/arcade/lib/pool-playercard-theme';

/** Re-export for chess call sites; the underlying table lives in the shared lib. */
export const CHESS_BOT_PLAYERCARD_THEMES = BOT_PLAYERCARD_THEMES;

type Props = {
  name: string;
  avatarUrl?: string | null;
  color: ChessColor;
  eloRating?: number | null;
  eloTier?: string | null;
  eloTierColor?: string | null;
  /** Whether it is this player's turn. */
  isActive: boolean;
  /** Whether this row is the viewer's own seat. */
  isMe?: boolean;
  /** Piece colours for the captured row. Defaults to the paper and ink look. */
  piecesTheme?: ChessPiecesTheme;
  pieceStrokeWhite?: string;
  /** A skin set's piece shape, so captured pieces match the board. */
  pieceShape?: ChessPieceShape;
  pieceStrokeBlack?: string;
  /** Captured piece values summed (e.g. material advantage for this side). */
  materialAdvantage?: number;
  /** Array of enemy pieces captured by this player, as piece letters ('p','n','b','r','q'). */
  capturedPieces?: Array<'p' | 'n' | 'b' | 'r' | 'q'>;
  theme?: PlayercardTheme;
  /** Equipped profile cosmetics (background/frame/badge/name color/title). */
  flair?: ProfileFlair | null;
  side: 'left' | 'right';
  /** Bot difficulty tier — renders a difficulty chip next to the name. */
  botTier?: 'easy' | 'medium' | 'hard' | null;
};

/** Chess player row: avatar, name and rating, then the pieces this side has
 *  captured in one row. The clock sits beside it. The row is plain on the ink
 *  screen; an equipped player card (or a bot's) still paints its own ground. */
export function ChessPlayerCard({
  name,
  avatarUrl,
  color,
  eloRating,
  eloTier,
  eloTierColor,
  isActive,
  isMe = false,
  materialAdvantage,
  capturedPieces,
  piecesTheme,
  pieceStrokeWhite = '#1f1a16',
  pieceShape,
  pieceStrokeBlack = '#f4ebdc',
  theme,
  flair,
  side,
  botTier,
}: Props) {
  const animName = theme && theme.cardAnimation !== 'none' ? theme.cardAnimation : null;
  const flairBg = namecardBackground(flair);
  const frameColor = flair?.frameColor ?? null;
  // The pieces this side took are the other colour's.
  const capturedCode = (p: 'p' | 'n' | 'b' | 'r' | 'q') =>
    ((color === 'white' ? 'b' : 'w') + p) as PieceCode;
  const capturedWhite = color === 'black';

  return (
    <>
      {animName && theme && (
        <style dangerouslySetInnerHTML={{ __html: getPlayercardAnimationStylesheet('pc') }} />
      )}
      <div
        className={`relative flex min-w-0 items-center gap-2.5 overflow-hidden rounded-panel px-2 py-1.5 ${
          side === 'right' ? 'flex-row-reverse text-right' : ''
        }`}
        data-active={isActive || undefined}
        style={{
          ...(theme ? { background: theme.cardBg, ...getPlayercardAnimationStyle(theme, { prefix: 'pc' }) } : {}),
          ...(frameColor ? { boxShadow: `inset 0 0 0 2px ${frameColor}` } : {}),
        }}
      >
        {/* Equipped profile background, behind a dark scrim for legibility. */}
        {flairBg && (
          <>
            <div aria-hidden className='absolute inset-0 z-0' style={{ background: flairBg }} />
            <div
              aria-hidden
              className='absolute inset-0 z-0'
              style={{
                background:
                  'linear-gradient(90deg, rgba(31,26,22,0.82) 0%, rgba(31,26,22,0.55) 55%, rgba(31,26,22,0.4) 100%)',
              }}
            />
          </>
        )}

        <div className='relative z-[1] shrink-0'>
          <span
            className='block rounded-full'
            style={frameColor ? { boxShadow: `0 0 0 2px ${frameColor}` } : undefined}
          >
            <FramedAvatar name={name} imageUrl={avatarUrl} frame={flair?.frameArt ?? null} size='md' />
          </span>
          <span
            className='absolute -bottom-1 -right-1 inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-bold'
            style={{
              background: color === 'white' ? '#f4ebdc' : '#1f1a16',
              color: color === 'white' ? '#1f1a16' : '#f4ebdc',
              borderColor: color === 'white' ? '#1f1a16' : '#f4ebdc',
            }}
            aria-label={color}
          >
            {color === 'white' ? '♔' : '♚'}
          </span>
        </div>

        <div className='relative z-[1] min-w-0 flex-1'>
          <div className={`flex items-center gap-1.5 ${side === 'right' ? 'justify-end' : ''}`}>
            {/* Your turn is red; the other seat's turn is a quiet paper dot. */}
            {isActive && (
              <span
                role='img'
                aria-label={isMe ? 'your turn' : 'their turn'}
                className='h-2.5 w-2.5 shrink-0 rounded-full'
                style={{ background: isMe ? 'var(--tixy-on-ink-red, #dd9484)' : 'var(--tixy-on-ink-2, #c9c1b4)' }}
              />
            )}
            <span
              className='truncate text-sm font-bold'
              style={{ color: flair?.nameColor ?? theme?.nameColor ?? 'var(--tixy-paper, #f4ebdc)' }}
            >
              <Username name={name} flair={flair} />
            </span>
            {botTier && <BotTierBadge tier={botTier} />}
            {eloRating != null && (
              <span
                className='arcade-num shrink-0 text-base font-bold leading-none'
                style={{ color: eloTierColor && theme ? eloTierColor : 'var(--tixy-on-ink-2, #c9c1b4)' }}
                title={eloTier ?? undefined}
              >
                {eloRating}
              </span>
            )}
          </div>
          {/* Captured pieces: one row, overlapping, never wrapping. */}
          <div className={`mt-0.5 flex h-5 items-center ${side === 'right' ? 'justify-end' : ''}`}>
            {capturedPieces && capturedPieces.length > 0 ? (
              <div
                className='flex min-w-0 flex-nowrap items-center overflow-hidden'
                aria-label={`captured ${capturedPieces.length} pieces`}
              >
                {capturedPieces.map((p, i) => (
                  <span
                    key={i}
                    className={`inline-block h-5 w-5 shrink-0 ${i > 0 ? '-ml-1.5' : ''}`}
                    aria-hidden
                  >
                    <ChessPieceSvg
                      piece={capturedCode(p)}
                      fill={
                        capturedWhite
                          ? (piecesTheme?.whiteColor ?? '#fbf6ec')
                          : (piecesTheme?.blackColor ?? '#1f1a16')
                      }
                      stroke={capturedWhite ? pieceStrokeWhite : pieceStrokeBlack}
                      shape={pieceShape}
                    />
                  </span>
                ))}
              </div>
            ) : null}
            {materialAdvantage != null && materialAdvantage > 0 && (
              <span className='arcade-num ml-1.5 shrink-0 text-sm font-bold leading-none text-[var(--tixy-on-ink-2,#c9c1b4)]'>
                +{materialAdvantage}
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/** Compute captured pieces for each side from a FEN by diffing against the starting rack. */
export function computeCapturedPieces(fen: string): {
  whiteCaptured: Array<'p' | 'n' | 'b' | 'r' | 'q'>;
  blackCaptured: Array<'p' | 'n' | 'b' | 'r' | 'q'>;
  whiteMaterialAdvantage: number;
  blackMaterialAdvantage: number;
} {
  const pieces = fen.split(' ')[0] ?? '';
  const counts = { P: 0, N: 0, B: 0, R: 0, Q: 0, p: 0, n: 0, b: 0, r: 0, q: 0 };
  for (const ch of pieces) {
    if (ch in counts) counts[ch as keyof typeof counts]++;
  }
  // Promotions consume a pawn and produce an extra non-king piece. Any surplus
  // past the starting rack on N/B/R/Q is evidence of promotion, so pawns that
  // vanished from the board due to promotion must NOT be counted as captures.
  const whitePromotions =
    Math.max(0, counts.N - 2) + Math.max(0, counts.B - 2) +
    Math.max(0, counts.R - 2) + Math.max(0, counts.Q - 1);
  const blackPromotions =
    Math.max(0, counts.n - 2) + Math.max(0, counts.b - 2) +
    Math.max(0, counts.r - 2) + Math.max(0, counts.q - 1);

  const whiteCaptured: Array<'p' | 'n' | 'b' | 'r' | 'q'> = [];
  const blackCaptured: Array<'p' | 'n' | 'b' | 'r' | 'q'> = [];

  // Pawn captures: pawns gone minus pawns that were promoted.
  const whitePawnsLost = Math.max(0, 8 - counts.P - whitePromotions);
  const blackPawnsLost = Math.max(0, 8 - counts.p - blackPromotions);
  for (let i = 0; i < blackPawnsLost; i++) whiteCaptured.push('p');
  for (let i = 0; i < whitePawnsLost; i++) blackCaptured.push('p');

  const startCount = { n: 2, b: 2, r: 2, q: 1 } as const;
  for (const key of ['n', 'b', 'r', 'q'] as const) {
    const whiteHasCaptured = Math.max(0, startCount[key] - counts[key]);
    const blackHasCaptured = Math.max(0, startCount[key] - counts[key.toUpperCase() as 'N' | 'B' | 'R' | 'Q']);
    for (let i = 0; i < whiteHasCaptured; i++) whiteCaptured.push(key);
    for (let i = 0; i < blackHasCaptured; i++) blackCaptured.push(key);
  }

  // Material advantage: compute directly from what's on the board so promoted
  // queens/rooks contribute to the side that promoted them.
  const whiteMaterial = counts.P + counts.N * 3 + counts.B * 3 + counts.R * 5 + counts.Q * 9;
  const blackMaterial = counts.p + counts.n * 3 + counts.b * 3 + counts.r * 5 + counts.q * 9;
  const diff = whiteMaterial - blackMaterial;
  const whiteMaterialAdvantage = Math.max(0, diff);
  const blackMaterialAdvantage = Math.max(0, -diff);

  return { whiteCaptured, blackCaptured, whiteMaterialAdvantage, blackMaterialAdvantage };
}

function BotTierBadge({ tier }: { tier: 'easy' | 'medium' | 'hard' }) {
  return (
    <span className='shrink-0 text-[0.9375rem] text-[var(--tixy-on-ink-2,#c9c1b4)]'>
      {tier} bot
    </span>
  );
}

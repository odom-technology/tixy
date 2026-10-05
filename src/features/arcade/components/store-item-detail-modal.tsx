'use client';

import { getGameTitle } from '@/features/arcade/lib/game-renames';
import { useEffect } from 'react';

import type { RewardGameType } from '@/features/arcade/lib/rewards';
import { getCurrencyDisplayName } from '@/features/arcade/lib/rewards';
import {
  StoreItemPreview,
  type TypingPreviewContext,
} from '@/features/arcade/components/store-item-preview';
import {
  ArcadeButton,
  ArcadeChip,
  ArcadeNotice,
  type ArcadeEnamel,
} from '@/features/arcade/components/ui/arcade-ui';
import { ArcadeModal } from '@/features/arcade/components/ui/arcade-interactive';

/* One inspection counter for the whole arcade: the same item modal opens
   from the store wall and from the inventory shelf, and the right-hand
   key is always the next step — Buy, then Equip, then Unequip. */

export type StoreDetailItem = {
  id: string;
  name: string;
  gameType: RewardGameType;
  rarity: string;
  currencyType: 'credits';
  price: number;
  slots: string[];
  assetRef: Record<string, unknown> | null;
  setLabels?: string[];
};

const RAW_GAME_LABELS: Record<RewardGameType, string> = {
  snake: 'Snake',
  'flappy-bird': 'Flappy Bird',
  'typing-test': 'Typing Test',
  'reaction-time': 'Reaction Time',
  'coin-flip': 'Coin Flip',
  '8-ball': '8-Ball',
  tetris: 'Tetris',
  connections: 'Connections',
  '2048': '2048',
  chess: 'Chess',
  'word-grid': 'Word Grid',
  pangram: 'Pangram',
  stack: 'Stack',
  sequence: 'Sequence Memory',
  breakout: 'Breakout',
  tumbler: 'Tumbler',
  'high-striker': 'High Striker',
  'skee-ball': 'Skee-Ball',
  gunrush: 'Gunrush',
  gopher: 'Gopher Pop',
  ricochet: 'Ricochet',
  swerve: 'Swerve',
  sudoku: 'Sudoku',
  math: 'Math Sprint',
  'connect-four': 'Connect Four',
  checkers: 'Checkers',
  reversi: 'Reversi',
  battleship: 'Battleship',
  'bubble-shooter': 'Gumball Drop',
  'gem-swap': 'Gem Swap',
  'sky-climber': 'Sky Climber',
  minesweeper: 'Minesweeper',
  keno: 'Keno',
  'prize-wheel': 'Prize Wheel',
  baccarat: 'Baccarat',
  'fortune-teller': 'Fortune Teller',
  'gem-roll': 'Gem Roll',
  'lucky-cage': 'Lucky Cage',
  'ring-toss': 'Ring Toss',
  'mini-golf': 'Mini Golf',
  'bumper-cars': 'Bumper Cars',
  derby: 'Derby',
  'log-splitter': 'Log Splitter',
  'knife-booth': 'Knife Booth',
  'melon-chop': 'Melon Chop',
  'tin-duck': 'Tin Duck Gallery',
  'boardwalk-hop': 'Boardwalk Hop',
  'punch-card': 'Punch Card',
  freecell: 'FreeCell Sprint',
  profile: 'Profile',
};

export const GAME_LABELS = Object.fromEntries(
  Object.entries(RAW_GAME_LABELS).map(([game, label]) => [game, getGameTitle(game, label)]),
) as Record<RewardGameType, string>;

/* Rarity is always a solid enamel chip — never a tint. Common stays on
   the neutral raised chip. */
export const rarityChipTone: Record<string, ArcadeEnamel | undefined> = {
  common: undefined,
  rare: 'info',
  epic: 'prize',
  legendary: 'tickets',
  mythic: 'primary',
};

/* The item modal marquee borrows the rarity enamel; common gets cream. */
export const rarityMarqueeTone: Record<string, ArcadeEnamel | 'cream'> = {
  common: 'cream',
  rare: 'info',
  epic: 'prize',
  legendary: 'tickets',
  mythic: 'primary',
};

export const formatSlotLabel = (slot: string) =>
  slot
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());

export const formatSlotSummary = (slots: string[]) => {
  if (slots.length === 0) return 'Cosmetic';
  if (slots.length === 1) return formatSlotLabel(slots[0]);
  if (slots.length === 2) {
    return `${formatSlotLabel(slots[0])} + ${formatSlotLabel(slots[1])}`;
  }
  return `${slots.length} slots`;
};

const formatNaturalList = (values: string[]) => {
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
};

/* Falls back to the raw slug: on the shared dev DB (and briefly during
   deploys) the rotation can hold items for game types this build doesn't
   know yet — they must render as their slug, never as "undefined"/a crash. */
export const getGameLabel = (gameType: string) =>
  GAME_LABELS[gameType as RewardGameType] ?? gameType;

export const getItemSecondaryLine = (item: StoreDetailItem) =>
  `${getGameLabel(item.gameType)} · ${formatSlotSummary(item.slots)}`;

const getSlotEffectCopy = (gameType: RewardGameType, slot: string) => {
  switch (gameType) {
    case 'snake':
      if (slot === 'board') return 'Changes the board art during runs.';
      if (slot === 'food') return 'Changes how food pickups look during runs.';
      break;
    case 'flappy-bird':
      if (slot === 'bird') return 'Changes your bird skin during runs.';
      if (slot === 'pipe') return 'Changes the pipe art during runs.';
      if (slot === 'background')
        return 'Changes the background scene during runs.';
      break;
    case 'typing-test':
      if (slot === 'theme' || slot === 'hud') {
        return 'Updates the typing layout colors and panel styling.';
      }
      if (slot === 'caret') return 'Changes the typing cursor while you type.';
      if (slot === 'feedback') return 'Changes hit and error feedback styling.';
      if (slot === 'text-style')
        return 'Changes the text styling shown during tests.';
      break;
    case 'reaction-time':
      if (slot === 'target')
        return 'Changes the target look during reaction rounds.';
      if (slot === 'background')
        return 'Changes the background during reaction rounds.';
      break;
    case 'coin-flip':
      if (slot === 'coin') return 'Changes the coin look during flips.';
      if (slot === 'background') return 'Changes the backdrop during flips.';
      break;
    case '8-ball':
      if (slot === 'table') return 'Changes the table look during matches.';
      if (slot === 'cue') return 'Changes the cue appearance during matches.';
      if (slot === 'playercard')
        return 'Changes the player card shown in matches.';
      break;
    case 'tetris':
      if (slot === 'board') return 'Changes the board look during games.';
      if (slot === 'blocks') return 'Changes how pieces look during games.';
      break;
    case 'connections':
      if (slot === 'tile')
        return 'Changes the tile styling on the puzzle board.';
      if (slot === 'background') return 'Changes the board background.';
      break;
  }

  return `Changes the ${formatSlotLabel(slot).toLowerCase()} for ${getGameLabel(gameType)}.`;
};

export const getItemValueLine = (item: StoreDetailItem) => {
  if (item.slots.length === 0) {
    return `Adds a cosmetic variant for ${getGameLabel(item.gameType)}.`;
  }
  if (item.slots.length === 1) {
    return getSlotEffectCopy(item.gameType, item.slots[0]);
  }
  return `Updates the ${formatNaturalList(
    item.slots.map((slot) => formatSlotLabel(slot).toLowerCase()),
  )} for ${getGameLabel(item.gameType)}.`;
};

export function RarityChip({ rarity }: { rarity: string }) {
  return (
    <ArcadeChip tone={rarityChipTone[rarity]} className='uppercase'>
      {rarity}
    </ArcadeChip>
  );
}

/* Price is always the tickets number: tabular mono in amber. */
export function TicketPrice({
  amount,
  currencyType,
  size = 'md',
}: {
  amount: number;
  currencyType: StoreDetailItem['currencyType'];
  size?: 'sm' | 'md' | 'lg';
}) {
  const numClass =
    size === 'lg' ? 'text-xl' : size === 'sm' ? 'text-sm' : 'text-base';
  return (
    <span className='inline-flex items-baseline gap-1.5 whitespace-nowrap'>
      <span
        className={`arcade-num font-semibold text-tickets-text ${numClass}`}
      >
        {amount.toLocaleString()}
      </span>
      <span className='arcade-kicker text-[10px]'>
        {getCurrencyDisplayName(currencyType)}
      </span>
    </span>
  );
}

export function StoreItemDetailModal({
  item,
  owned,
  equipped,
  busy = false,
  justPurchased = false,
  walletCredits = null,
  contextChip = null,
  setProgressLabel = null,
  replacementMessage = null,
  currentEquipped = [],
  typingPreviewContext,
  snakeBoardAssetRef = null,
  accountRequired = false,
  onClose,
  onPurchase,
  onEquip,
  onUnequip,
}: {
  item: StoreDetailItem;
  owned: boolean;
  equipped: boolean;
  busy?: boolean;
  justPurchased?: boolean;
  /** null hides the wallet line (e.g. surfaces without store state). */
  walletCredits?: number | null;
  /** Extra neutral chip, e.g. 'Daily rotation' on the store. */
  contextChip?: string | null;
  setProgressLabel?: string | null;
  replacementMessage?: string | null;
  currentEquipped?: StoreDetailItem[];
  typingPreviewContext?: TypingPreviewContext;
  snakeBoardAssetRef?: Record<string, unknown> | null;
  accountRequired?: boolean;
  onClose: () => void;
  onPurchase?: () => void;
  onEquip?: () => void;
  onUnequip?: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const shortBy = walletCredits != null ? walletCredits - item.price : 0;

  const action = accountRequired
    ? (
        <ArcadeButton type='button' disabled tone='ghost'>
          Account required
        </ArcadeButton>
      )
    : !owned
    ? onPurchase && (
        <ArcadeButton
          type='button'
          onClick={onPurchase}
          disabled={busy}
          tone='primary'
        >
          {busy ? 'Buying...' : 'Buy'}
        </ArcadeButton>
      )
    : equipped
      ? onUnequip && (
          <ArcadeButton type='button' onClick={onUnequip} disabled={busy}>
            {busy ? 'Working...' : 'Unequip'}
          </ArcadeButton>
        )
      : onEquip && (
          <ArcadeButton
            type='button'
            onClick={onEquip}
            disabled={busy}
            tone='success'
            className={justPurchased ? 'store-reveal' : undefined}
          >
            {busy ? 'Equipping...' : 'Equip'}
          </ArcadeButton>
        );

  return (
    <ArcadeModal
      title={item.name}
      tone={rarityMarqueeTone[item.rarity] ?? 'cream'}
      onClose={onClose}
      maxWidth='46rem'
      actions={
        <>
          <ArcadeButton type='button' tone='ghost' onClick={onClose}>
            Close
          </ArcadeButton>
          {action}
        </>
      }
    >
      <div className='grid gap-4 sm:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]'>
        {/* The stage: an inset well holding the prize. */}
        <div className='self-start rounded-well border-2 border-ink bg-well p-3 inset-shadow-well'>
          <StoreItemPreview
            item={item}
            forceSquare
            snakeBoardAssetRef={snakeBoardAssetRef}
            typingPreviewContext={
              item.gameType === 'typing-test' ? typingPreviewContext : undefined
            }
          />
        </div>

        <div className='flex min-w-0 flex-col gap-3'>
          <div className='flex flex-wrap items-center gap-1.5'>
            <RarityChip rarity={item.rarity} />
            {contextChip ? <ArcadeChip>{contextChip}</ArcadeChip> : null}
            {equipped ? (
              <ArcadeChip tone='prize'>Equipped</ArcadeChip>
            ) : owned ? (
              <ArcadeChip
                tone='prize'
                className={justPurchased ? 'store-reveal' : undefined}
              >
                Owned
              </ArcadeChip>
            ) : null}
          </div>

          <div>
            <p className='arcade-kicker'>Game</p>
            <p className='mt-1 text-sm text-body'>
              {getItemSecondaryLine(item)}
            </p>
          </div>

          <div>
            <p className='arcade-kicker'>What it does</p>
            <p className='mt-1 text-sm text-body'>{getItemValueLine(item)}</p>
          </div>

          {setProgressLabel ? (
            <div>
              <p className='arcade-kicker'>Set</p>
              <p className='arcade-num mt-1 text-sm text-info-text'>
                {setProgressLabel}
              </p>
            </div>
          ) : null}

          {replacementMessage && !equipped ? (
            <div>
              <p className='arcade-kicker'>Loadout</p>
              <p className='mt-1 text-sm text-tickets-text'>
                {replacementMessage}
              </p>
            </div>
          ) : null}

          {accountRequired ? (
            <ArcadeNotice tone='info'>
              Create an account to buy, own, and equip cosmetics.
            </ArcadeNotice>
          ) : null}

          {/* Ticket-stub price block. */}
          <div className='mt-auto rounded-well border-2 border-ink bg-well px-4 py-3 inset-shadow-well'>
            <div className='flex items-center justify-between gap-3'>
              <span className='arcade-kicker'>Price</span>
              <TicketPrice
                amount={item.price}
                currencyType={item.currencyType}
                size='lg'
              />
            </div>
            {walletCredits != null ? (
              <div className='mt-2 flex items-center justify-between gap-3 border-t border-dashed border-soft pt-2'>
                <span className='arcade-kicker'>Your tickets</span>
                <span className='arcade-num text-sm font-semibold text-tickets-text'>
                  {walletCredits.toLocaleString()}
                </span>
              </div>
            ) : null}
            {!owned && walletCredits != null && shortBy < 0 ? (
              <p className='mt-2 text-xs text-danger-text'>
                Short{' '}
                <span className='arcade-num'>
                  {Math.abs(shortBy).toLocaleString()}
                </span>{' '}
                tickets.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {currentEquipped.length > 0 && !equipped ? (
        <div className='mt-4'>
          <p className='arcade-kicker'>Replaces in your loadout</p>
          <div className='mt-2 grid gap-2 sm:grid-cols-2'>
            {currentEquipped.map((equippedItem) => (
              <div
                key={equippedItem.id}
                className='flex items-center gap-3 rounded-well border-2 border-ink bg-well p-2.5 inset-shadow-well'
              >
                <div className='w-16 shrink-0'>
                  <StoreItemPreview
                    item={equippedItem}
                    compact
                    forceSquare
                    snakeBoardAssetRef={snakeBoardAssetRef}
                    typingPreviewContext={
                      equippedItem.gameType === 'typing-test'
                        ? typingPreviewContext
                        : undefined
                    }
                  />
                </div>
                <div className='min-w-0'>
                  <p className='truncate text-sm font-semibold text-strong'>
                    {equippedItem.name}
                  </p>
                  <p className='mt-0.5 truncate text-xs text-faint'>
                    {getItemSecondaryLine(equippedItem)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {justPurchased ? (
        <ArcadeNotice tone='success' className='store-reveal mt-4'>
          It&apos;s yours — equip it right here, or keep browsing.
        </ArcadeNotice>
      ) : equipped ? (
        <ArcadeNotice tone='success' className='mt-4'>
          Equipped — this is live in your game.
        </ArcadeNotice>
      ) : owned ? (
        <ArcadeNotice className='mt-4'>
          You own this one. Equip it to make it live.
        </ArcadeNotice>
      ) : (
        <ArcadeNotice className='mt-4'>
          Purchases are permanent and land in your inventory right away.
        </ArcadeNotice>
      )}
    </ArcadeModal>
  );
}

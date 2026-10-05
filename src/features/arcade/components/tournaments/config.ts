import {
  CHESS_TOURNAMENT_DEFAULT_MAX_BET,
  CHESS_TOURNAMENT_DEFAULT_MIN_BET,
  CHESS_WAGER_INCREMENT,
} from '@/server/arcade/chess-wager-constants';
import {
  POOL_TOURNAMENT_DEFAULT_MAX_BET,
  POOL_TOURNAMENT_DEFAULT_MIN_BET,
  POOL_WAGER_INCREMENT,
} from '@/server/arcade/pool-wager-constants';

/**
 * Per-game tournament-UI configuration: API base path, arcade URL prefix,
 * and visual accent. Keeps the call sites down to a single `gameType` prop
 * while all the per-game differences live in one table.
 */

export type TournamentGameKey = 'chess' | '8-ball';

type TournamentGameConfig = {
  /** API base for tournament operations (wager POST builds onto this). */
  apiBasePath: string;
  /** URL prefix for a live match. Append `/${matchId}` to link in. */
  arcadeMatchPath: string;
  /** Wager step size (credits). */
  wagerIncrement: number;
  /** Default min/max bet when toggling on betting in the create modal. */
  defaultMinBet: number;
  defaultMaxBet: number;
  /** Label used in the create-modal title ("Create <label>"). */
  createLabel: string;
  /** Placeholder text for the tournament-name field. */
  namePlaceholder: string;
  /** Visual accents for the bracket, match card, and create modal. */
  accent: {
    /** Border color for the in-progress match card. */
    borderActive: string;
    /** Fill behind the in-progress match card. */
    bgActive: string;
    /** Primary action background (Watch/Play link, Create button). */
    ctaBg: string;
    /** Primary action text color. */
    ctaText: string;
    /** Primary action hover background. */
    ctaHover: string;
    /** Border + fill for the selected segmented option (BO1/BO3 picker). */
    selectedBorder: string;
    selectedBg: string;
    selectedText: string;
  };
};

export const TOURNAMENT_GAME_CONFIG: Record<TournamentGameKey, TournamentGameConfig> = {
  chess: {
    apiBasePath: '/api/games/chess/tournament',
    arcadeMatchPath: '/chess',
    wagerIncrement: CHESS_WAGER_INCREMENT,
    defaultMinBet: CHESS_TOURNAMENT_DEFAULT_MIN_BET,
    defaultMaxBet: CHESS_TOURNAMENT_DEFAULT_MAX_BET,
    createLabel: 'chess tournament',
    namePlaceholder: 'e.g. Blitz invitational',
    accent: {
      borderActive: 'border-ink',
      bgActive: 'bg-raised',
      ctaBg: 'bg-primary',
      ctaText: 'text-primary-on',
      ctaHover: 'hover:brightness-107',
      selectedBorder: 'border-ink',
      selectedBg: 'bg-primary',
      selectedText: 'text-primary-on',
    },
  },
  '8-ball': {
    apiBasePath: '/api/games/8-ball/tournament',
    arcadeMatchPath: '/8-ball',
    wagerIncrement: POOL_WAGER_INCREMENT,
    defaultMinBet: POOL_TOURNAMENT_DEFAULT_MIN_BET,
    defaultMaxBet: POOL_TOURNAMENT_DEFAULT_MAX_BET,
    createLabel: 'tournament',
    namePlaceholder: 'e.g. Spring championship',
    accent: {
      borderActive: 'border-ink',
      bgActive: 'bg-raised',
      ctaBg: 'bg-primary',
      ctaText: 'text-primary-on',
      ctaHover: 'hover:brightness-107',
      selectedBorder: 'border-ink',
      selectedBg: 'bg-primary',
      selectedText: 'text-primary-on',
    },
  },
};

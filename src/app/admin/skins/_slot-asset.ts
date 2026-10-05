import type {
  ItemDraft,
  SnakeBodyDraft,
  SnakeBoardDraft,
  SnakeFoodDraft,
  TypingCaretDraft,
  TypingFeedbackDraft,
  TypingThemeDraft,
  TypingTextStyleDraft,
  FlappyBirdDraft,
  FlappyPipeDraft,
  FlappyBackgroundDraft,
  FlappyTrailDraft,
  CoinFlipCoinDraft,
  CoinFlipTrailDraft,
  CoinFlipBackgroundDraft,
  EightBallCueDraft,
  EightBallTableDraft,
  EightBallBallsDraft,
  EightBallPlayercardDraft,
  TetrisBlocksDraft,
  TetrisBoardDraft,
  TetrisEffectsDraft,
  TetrisGhostDraft,
  Game2048TilesDraft,
  Game2048GridDraft,
  Game2048BackgroundDraft,
  ChessBoardDraft,
  ChessPiecesDraft,
  ChessClockDraft,
} from './_types';
import {
  composeSnakeBodyAssetRef,
  composeSnakeBoardAssetRef,
  composeSnakeFoodAssetRef,
  composeTypingCaretAssetRef,
  composeTypingFeedbackAssetRef,
  composeTypingThemeAssetRef,
  composeTypingTextStyleAssetRef,
  composeFlappyBirdAssetRef,
  composeFlappyPipeAssetRef,
  composeFlappyBackgroundAssetRef,
  composeFlappyTrailAssetRef,
  composeCoinFlipCoinAssetRef,
  composeCoinFlipTrailAssetRef,
  composeCoinFlipBackgroundAssetRef,
  composeEightBallCueAssetRef,
  composeEightBallTableAssetRef,
  composeEightBallBallsAssetRef,
  composeEightBallPlayercardAssetRef,
  composeTetrisBlocksAssetRef,
  composeTetrisBoardAssetRef,
  composeTetrisEffectsAssetRef,
  composeTetrisGhostAssetRef,
  composeGame2048TilesAssetRef,
  composeGame2048GridAssetRef,
  composeGame2048BackgroundAssetRef,
  composeChessBoardAssetRef,
  composeChessPiecesAssetRef,
  composeChessClockAssetRef,
} from './_types';

type EditorKind =
  | 'snake-body'
  | 'snake-board'
  | 'snake-food'
  | 'typing-theme'
  | 'typing-caret'
  | 'typing-feedback'
  | 'typing-text-style'
  | 'flappy-bird'
  | 'flappy-pipe'
  | 'flappy-background'
  | 'flappy-trail'
  | '8ball-cue'
  | '8ball-table'
  | '8ball-balls'
  | '8ball-playercard'
  | 'tetris-blocks'
  | 'tetris-board'
  | 'tetris-effects'
  | 'tetris-ghost'
  | 'coinflip-coin'
  | 'coinflip-trail'
  | 'coinflip-background'
  | '2048-tiles'
  | '2048-grid'
  | '2048-background'
  | 'chess-board'
  | 'chess-pieces'
  | 'chess-clock'
  | 'generic';

export type SlotAssetDrafts = {
  snakeBodyDraft: SnakeBodyDraft;
  snakeBoardDraft: SnakeBoardDraft;
  snakeFoodDraft: SnakeFoodDraft;
  typingThemeDraft: TypingThemeDraft;
  typingCaretDraft: TypingCaretDraft;
  typingFeedbackDraft: TypingFeedbackDraft;
  typingTextStyleDraft: TypingTextStyleDraft;
  flappyBirdDraft: FlappyBirdDraft;
  flappyPipeDraft: FlappyPipeDraft;
  flappyBackgroundDraft: FlappyBackgroundDraft;
  flappyTrailDraft: FlappyTrailDraft;
  eightBallCueDraft: EightBallCueDraft;
  eightBallTableDraft: EightBallTableDraft;
  eightBallBallsDraft: EightBallBallsDraft;
  eightBallPlayercardDraft: EightBallPlayercardDraft;
  tetrisBlocksDraft: TetrisBlocksDraft;
  tetrisBoardDraft: TetrisBoardDraft;
  tetrisEffectsDraft: TetrisEffectsDraft;
  tetrisGhostDraft: TetrisGhostDraft;
  coinFlipCoinDraft: CoinFlipCoinDraft;
  coinFlipTrailDraft: CoinFlipTrailDraft;
  coinFlipBackgroundDraft: CoinFlipBackgroundDraft;
  game2048TilesDraft: Game2048TilesDraft;
  game2048GridDraft: Game2048GridDraft;
  game2048BackgroundDraft: Game2048BackgroundDraft;
  chessBoardDraft: ChessBoardDraft;
  chessPiecesDraft: ChessPiecesDraft;
  chessClockDraft: ChessClockDraft;
};

export const resolveEditorKind = (itemDraft: ItemDraft): EditorKind => {
  if (itemDraft.gameType === 'snake' && itemDraft.slots.includes('body')) {
    return 'snake-body';
  }
  if (itemDraft.gameType === 'snake' && itemDraft.slots.includes('board')) {
    return 'snake-board';
  }
  if (itemDraft.gameType === 'snake' && itemDraft.slots.includes('food')) {
    return 'snake-food';
  }
  if (itemDraft.gameType === 'typing-test' && itemDraft.slots.includes('theme')) {
    return 'typing-theme';
  }
  if (itemDraft.gameType === 'typing-test' && itemDraft.slots.includes('caret')) {
    return 'typing-caret';
  }
  if (itemDraft.gameType === 'typing-test' && itemDraft.slots.includes('feedback')) {
    return 'typing-feedback';
  }
  if (itemDraft.gameType === 'typing-test' && itemDraft.slots.includes('text-style')) {
    return 'typing-text-style';
  }
  if (itemDraft.gameType === 'flappy-bird' && itemDraft.slots.includes('bird')) {
    return 'flappy-bird';
  }
  if (itemDraft.gameType === 'flappy-bird' && itemDraft.slots.includes('pipe')) {
    return 'flappy-pipe';
  }
  if (itemDraft.gameType === 'flappy-bird' && itemDraft.slots.includes('background')) {
    return 'flappy-background';
  }
  if (itemDraft.gameType === 'flappy-bird' && itemDraft.slots.includes('trail')) {
    return 'flappy-trail';
  }
  if (itemDraft.gameType === '8-ball' && itemDraft.slots.includes('cue')) {
    return '8ball-cue';
  }
  if (itemDraft.gameType === '8-ball' && itemDraft.slots.includes('table')) {
    return '8ball-table';
  }
  if (itemDraft.gameType === '8-ball' && itemDraft.slots.includes('balls')) {
    return '8ball-balls';
  }
  if (itemDraft.gameType === '8-ball' && itemDraft.slots.includes('playercard')) {
    return '8ball-playercard';
  }
  if (itemDraft.gameType === 'tetris' && itemDraft.slots.includes('blocks')) {
    return 'tetris-blocks';
  }
  if (itemDraft.gameType === 'tetris' && itemDraft.slots.includes('board')) {
    return 'tetris-board';
  }
  if (itemDraft.gameType === 'tetris' && itemDraft.slots.includes('effects')) {
    return 'tetris-effects';
  }
  if (itemDraft.gameType === 'tetris' && itemDraft.slots.includes('ghost')) {
    return 'tetris-ghost';
  }
  if (itemDraft.gameType === 'coin-flip' && itemDraft.slots.includes('coin')) {
    return 'coinflip-coin';
  }
  if (itemDraft.gameType === 'coin-flip' && itemDraft.slots.includes('trail')) {
    return 'coinflip-trail';
  }
  if (itemDraft.gameType === 'coin-flip' && itemDraft.slots.includes('background')) {
    return 'coinflip-background';
  }
  if (itemDraft.gameType === '2048' && itemDraft.slots.includes('tiles')) {
    return '2048-tiles';
  }
  if (itemDraft.gameType === '2048' && itemDraft.slots.includes('grid')) {
    return '2048-grid';
  }
  if (itemDraft.gameType === '2048' && itemDraft.slots.includes('background')) {
    return '2048-background';
  }
  if (itemDraft.gameType === 'chess' && itemDraft.slots.includes('board')) {
    return 'chess-board';
  }
  if (itemDraft.gameType === 'chess' && itemDraft.slots.includes('pieces')) {
    return 'chess-pieces';
  }
  if (itemDraft.gameType === 'chess' && itemDraft.slots.includes('clock')) {
    return 'chess-clock';
  }
  return 'generic';
};

export const composeAssetRefForEditorKind = (
  editorKind: EditorKind,
  drafts: SlotAssetDrafts,
  composeFallbackAssetRef: () => Record<string, unknown>,
): Record<string, unknown> => {
  switch (editorKind) {
    case 'snake-body':
      return composeSnakeBodyAssetRef(drafts.snakeBodyDraft);
    case 'snake-board':
      return composeSnakeBoardAssetRef(drafts.snakeBoardDraft);
    case 'snake-food':
      return composeSnakeFoodAssetRef(drafts.snakeFoodDraft);
    case 'typing-theme':
      return composeTypingThemeAssetRef(drafts.typingThemeDraft);
    case 'typing-caret':
      return composeTypingCaretAssetRef(drafts.typingCaretDraft);
    case 'typing-feedback':
      return composeTypingFeedbackAssetRef(drafts.typingFeedbackDraft);
    case 'typing-text-style':
      return composeTypingTextStyleAssetRef(drafts.typingTextStyleDraft);
    case 'flappy-bird':
      return composeFlappyBirdAssetRef(drafts.flappyBirdDraft);
    case 'flappy-pipe':
      return composeFlappyPipeAssetRef(drafts.flappyPipeDraft);
    case 'flappy-background':
      return composeFlappyBackgroundAssetRef(drafts.flappyBackgroundDraft);
    case 'flappy-trail':
      return composeFlappyTrailAssetRef(drafts.flappyTrailDraft);
    case '8ball-cue':
      return composeEightBallCueAssetRef(drafts.eightBallCueDraft);
    case '8ball-table':
      return composeEightBallTableAssetRef(drafts.eightBallTableDraft);
    case '8ball-balls':
      return composeEightBallBallsAssetRef(drafts.eightBallBallsDraft);
    case '8ball-playercard':
      return composeEightBallPlayercardAssetRef(drafts.eightBallPlayercardDraft);
    case 'tetris-blocks':
      return composeTetrisBlocksAssetRef(drafts.tetrisBlocksDraft);
    case 'tetris-board':
      return composeTetrisBoardAssetRef(drafts.tetrisBoardDraft);
    case 'tetris-effects':
      return composeTetrisEffectsAssetRef(drafts.tetrisEffectsDraft);
    case 'tetris-ghost':
      return composeTetrisGhostAssetRef(drafts.tetrisGhostDraft);
    case 'coinflip-coin':
      return composeCoinFlipCoinAssetRef(drafts.coinFlipCoinDraft);
    case 'coinflip-trail':
      return composeCoinFlipTrailAssetRef(drafts.coinFlipTrailDraft);
    case 'coinflip-background':
      return composeCoinFlipBackgroundAssetRef(drafts.coinFlipBackgroundDraft);
    case '2048-tiles':
      return composeGame2048TilesAssetRef(drafts.game2048TilesDraft);
    case '2048-grid':
      return composeGame2048GridAssetRef(drafts.game2048GridDraft);
    case '2048-background':
      return composeGame2048BackgroundAssetRef(drafts.game2048BackgroundDraft);
    case 'chess-board':
      return composeChessBoardAssetRef(drafts.chessBoardDraft);
    case 'chess-pieces':
      return composeChessPiecesAssetRef(drafts.chessPiecesDraft);
    case 'chess-clock':
      return composeChessClockAssetRef(drafts.chessClockDraft);
    default:
      return composeFallbackAssetRef();
  }
};

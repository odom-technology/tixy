// ---------------------------------------------------------------------------
// Tetris — Core Game Engine
// Pure logic, no rendering. Manages board state, piece movement, SRS rotation,
// line clearing, scoring, 7-bag randomizer, hold, ghost piece, T-spin detection.
// ---------------------------------------------------------------------------

import {
  COLS,
  TOTAL_ROWS,
  PIECE_TYPES,
  PIECE_SHAPES,
  WALL_KICKS,
  I_WALL_KICKS,
  ROTATION_NAMES,
  SCORE_TABLE,
  BACK_TO_BACK_MULTIPLIER,
  LINES_PER_LEVEL,
  LINE_CLEAR_ANIMATION_MS,
  NEXT_PREVIEW_COUNT,
  getDropInterval,
  type PieceType,
  type RotationState,
} from './_tetris-config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Cell = PieceType | null;

type Piece = {
  type: PieceType;
  x: number;
  y: number;
  rotation: RotationState;
};

type TetrisStats = {
  score: number;
  level: number;
  lines: number;
  singles: number;
  doubles: number;
  triples: number;
  tetrises: number;
  tSpins: number;
  maxCombo: number;
  piecesPlaced: number;
  totalInputs: number;
};

export type LineClearEvent = {
  linesCleared: number;
  isTSpin: boolean;
  isTSpinMini: boolean;
  isBackToBack: boolean;
  combo: number;
  points: number;
  clearedRows: number[];
};

export type GameOverData = {
  score: number;
  level: number;
  lines: number;
  stats: TetrisStats;
  durationMs: number;
};

// ---------------------------------------------------------------------------
// 7-Bag Randomizer
// ---------------------------------------------------------------------------

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class BagRandomizer {
  private bag: PieceType[] = [];
  private cachedPeek: PieceType[] = [];
  private cacheValid = false;

  next(): PieceType {
    if (this.bag.length === 0) {
      this.bag = shuffleArray(PIECE_TYPES);
    }
    this.cacheValid = false;
    return this.bag.pop()!;
  }

  peek(count: number): PieceType[] {
    if (this.cacheValid && this.cachedPeek.length === count) return this.cachedPeek;
    while (this.bag.length < count) {
      this.bag = [...shuffleArray(PIECE_TYPES), ...this.bag];
    }
    this.cachedPeek = this.bag.slice(-count).reverse();
    this.cacheValid = true;
    return this.cachedPeek;
  }
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class TetrisEngine {
  board: Cell[][] = [];
  current: Piece | null = null;
  queue: BagRandomizer;
  holdPiece: PieceType | null = null;
  holdUsed = false;
  stats: TetrisStats;
  combo = -1;
  backToBack = false;
  lastActionWasRotation = false;
  isGameOver = false;
  isPaused = false;

  // Drop timing
  dropTimer = 0;

  // Game time
  activePlayTime = 0;
  hasFirstAction = false; // true after first input or first gravity drop

  // Line clear animation
  clearingRows: number[] = [];
  clearAnimTimer = 0;

  // Game over animation
  gameOverAnimTimer = 0;
  gameOverAnimRow = TOTAL_ROWS;

  // Dirty flag for UI sync (avoids 60fps React state updates)
  dirty = true;

  // Callbacks
  onLineClear?: (event: LineClearEvent) => void;
  onGameOver?: (data: GameOverData) => void;
  onLevelUp?: (level: number) => void;
  onPieceLock?: () => void;
  onTSpin?: () => void;
  onBackToBack?: () => void;
  onHardDrop?: (distance: number) => void;

  constructor() {
    this.queue = new BagRandomizer();
    this.stats = this.emptyStats();
    this.initBoard();
  }

  private emptyStats(): TetrisStats {
    return {
      score: 0, level: 1, lines: 0,
      singles: 0, doubles: 0, triples: 0, tetrises: 0,
      tSpins: 0, maxCombo: 0, piecesPlaced: 0, totalInputs: 0,
    };
  }

  private initBoard() {
    this.board = Array.from({ length: TOTAL_ROWS }, () =>
      Array.from({ length: COLS }, () => null),
    );
  }

  // fallow-ignore-next-line unused-class-member
  start() {
    this.initBoard();
    this.stats = this.emptyStats();
    this.combo = -1;
    this.backToBack = false;
    this.holdPiece = null;
    this.holdUsed = false;
    this.isGameOver = false;
    this.isPaused = false;
    this.clearingRows = [];
    this.clearAnimTimer = 0;
    this.gameOverAnimTimer = 0;
    this.gameOverAnimRow = TOTAL_ROWS;
    this.queue = new BagRandomizer();
    this.activePlayTime = 0;
    this.dropTimer = 0;
    this.hasFirstAction = false;
    this.dirty = true;
    this.spawnPiece();
  }

  private spawnPiece(): boolean {
    const type = this.queue.next();
    return this.spawnSpecificPiece(type);
  }

  private spawnSpecificPiece(type: PieceType): boolean {
    const shape = PIECE_SHAPES[type][0];
    const x = Math.floor((COLS - shape[0].length) / 2);

    this.current = { type, x, y: 0, rotation: 0 };
    this.lastActionWasRotation = false;
    this.dropTimer = 0;
    this.dirty = true;

    if (!this.isValidPosition(this.current)) {
      this.current.y = -1;
      if (!this.isValidPosition(this.current)) {
        this.current = null;
        return false;
      }
    }
    return true;
  }

  // fallow-ignore-next-line unused-class-member
  getNextPieces(): PieceType[] {
    return this.queue.peek(NEXT_PREVIEW_COUNT);
  }

  // ---------------------------------------------------------------------------
  // Collision detection
  // ---------------------------------------------------------------------------

  private getShape(piece: Piece): number[][] {
    return PIECE_SHAPES[piece.type][piece.rotation];
  }

  isValidPosition(piece: Piece): boolean {
    const shape = this.getShape(piece);
    for (let row = 0; row < shape.length; row++) {
      for (let col = 0; col < shape[row].length; col++) {
        if (!shape[row][col]) continue;
        const boardX = piece.x + col;
        const boardY = piece.y + row;
        if (boardX < 0 || boardX >= COLS) return false;
        if (boardY >= TOTAL_ROWS) return false;
        if (boardY < 0) continue;
        if (this.board[boardY][boardX] !== null) return false;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Movement
  // ---------------------------------------------------------------------------

  // fallow-ignore-next-line unused-class-member
  moveLeft(): boolean {
    if (!this.current || this.isGameOver || this.isPaused || this.clearingRows.length > 0) return false;
    if (!this.hasFirstAction) this.hasFirstAction = true;
    this.stats.totalInputs++;
    const test = { ...this.current, x: this.current.x - 1 };
    if (this.isValidPosition(test)) {
      this.current.x = test.x;
      this.lastActionWasRotation = false;
      return true;
    }
    return false;
  }

  // fallow-ignore-next-line unused-class-member
  moveRight(): boolean {
    if (!this.current || this.isGameOver || this.isPaused || this.clearingRows.length > 0) return false;
    if (!this.hasFirstAction) this.hasFirstAction = true;
    this.stats.totalInputs++;
    const test = { ...this.current, x: this.current.x + 1 };
    if (this.isValidPosition(test)) {
      this.current.x = test.x;
      this.lastActionWasRotation = false;
      return true;
    }
    return false;
  }

  // fallow-ignore-next-line unused-class-member
  softDrop(): boolean {
    if (!this.current || this.isGameOver || this.isPaused || this.clearingRows.length > 0) return false;
    if (!this.hasFirstAction) this.hasFirstAction = true;
    const test = { ...this.current, y: this.current.y + 1 };
    if (this.isValidPosition(test)) {
      this.current.y = test.y;
      this.stats.score += SCORE_TABLE.softDrop;
      this.lastActionWasRotation = false;
      this.dropTimer = 0;
      this.dirty = true;
      return true;
    }
    return false;
  }

  // fallow-ignore-next-line unused-class-member
  hardDrop(): boolean {
    if (!this.current || this.isGameOver || this.isPaused || this.clearingRows.length > 0) return false;
    if (!this.hasFirstAction) this.hasFirstAction = true;
    this.stats.totalInputs++;
    let distance = 0;
    while (this.isValidPosition({ ...this.current, y: this.current.y + 1 })) {
      this.current.y++;
      distance++;
    }
    this.stats.score += distance * SCORE_TABLE.hardDrop;
    this.onHardDrop?.(distance);
    this.lockPiece();
    return true;
  }

  // ---------------------------------------------------------------------------
  // SRS Rotation
  // ---------------------------------------------------------------------------

  // fallow-ignore-next-line unused-class-member
  rotateCW(): boolean { return this.rotate(1); }
  // fallow-ignore-next-line unused-class-member
  rotateCCW(): boolean { return this.rotate(-1); }

  private rotate(direction: 1 | -1): boolean {
    if (!this.current || this.isGameOver || this.isPaused || this.clearingRows.length > 0) return false;
    if (this.current.type === 'O') return false;
    if (!this.hasFirstAction) this.hasFirstAction = true;
    this.stats.totalInputs++;

    const oldRotation = this.current.rotation;
    const newRotation = ((oldRotation + direction + 4) % 4) as RotationState;
    const kickKey = `${ROTATION_NAMES[oldRotation]}>${ROTATION_NAMES[newRotation]}`;
    const kicks = this.current.type === 'I' ? I_WALL_KICKS[kickKey] : WALL_KICKS[kickKey];
    if (!kicks) return false;

    for (const [dx, dy] of kicks) {
      const test: Piece = {
        ...this.current,
        x: this.current.x + dx,
        y: this.current.y - dy,
        rotation: newRotation,
      };
      if (this.isValidPosition(test)) {
        this.current.x = test.x;
        this.current.y = test.y;
        this.current.rotation = newRotation;
        this.lastActionWasRotation = true;
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Hold
  // ---------------------------------------------------------------------------

  // fallow-ignore-next-line unused-class-member
  hold(): boolean {
    if (!this.current || this.holdUsed || this.isGameOver || this.isPaused || this.clearingRows.length > 0) return false;
    if (!this.hasFirstAction) this.hasFirstAction = true;
    this.stats.totalInputs++;
    const currentType = this.current.type;
    if (this.holdPiece !== null) {
      const swapType = this.holdPiece;
      this.holdPiece = currentType;
      this.spawnSpecificPiece(swapType);
    } else {
      this.holdPiece = currentType;
      this.spawnPiece();
    }
    this.holdUsed = true;
    this.dirty = true;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Ghost piece
  // ---------------------------------------------------------------------------

  getGhostY(): number {
    if (!this.current || this.clearingRows.length > 0) return 0;
    let ghostY = this.current.y;
    for (let i = 0; i < TOTAL_ROWS; i++) {
      if (!this.isValidPosition({ ...this.current, y: ghostY + 1 })) break;
      ghostY++;
    }
    return ghostY;
  }

  // ---------------------------------------------------------------------------
  // Lock delay & piece locking
  // ---------------------------------------------------------------------------

  private lockPiece() {
    if (!this.current) return;
    const shape = this.getShape(this.current);
    const isTSpin = this.detectTSpin();
    const isTSpinMini = isTSpin && this.detectTSpinMini();

    for (let row = 0; row < shape.length; row++) {
      for (let col = 0; col < shape[row].length; col++) {
        if (!shape[row][col]) continue;
        const boardY = this.current.y + row;
        const boardX = this.current.x + col;
        if (boardY >= 0 && boardY < TOTAL_ROWS && boardX >= 0 && boardX < COLS) {
          this.board[boardY][boardX] = this.current.type;
        }
      }
    }

    this.stats.piecesPlaced++;
    this.holdUsed = false;
    this.onPieceLock?.();

    const clearedRows = this.findFullRows();
    if (clearedRows.length > 0) {
      // Set current to null BEFORE animation — it's been placed on the board
      this.current = null;
      this.handleLineClear(clearedRows, isTSpin, isTSpinMini);
    } else {
      if (isTSpin) {
        const points = (isTSpinMini ? SCORE_TABLE.tSpinMini : SCORE_TABLE.tSpin) * this.stats.level;
        this.stats.score += points;
        this.stats.tSpins++;
        this.onTSpin?.();
      }
      this.combo = -1;
      this.current = null;
      if (!this.spawnPiece()) {
        this.triggerGameOver();
      }
    }
    this.dirty = true;
  }

  // ---------------------------------------------------------------------------
  // T-Spin detection
  // ---------------------------------------------------------------------------

  private detectTSpin(): boolean {
    if (!this.current || this.current.type !== 'T') return false;
    if (!this.lastActionWasRotation) return false;

    const corners = [
      [this.current.y, this.current.x],
      [this.current.y, this.current.x + 2],
      [this.current.y + 2, this.current.x],
      [this.current.y + 2, this.current.x + 2],
    ];

    let filledCorners = 0;
    for (const [cy, cx] of corners) {
      if (cy < 0 || cy >= TOTAL_ROWS || cx < 0 || cx >= COLS) {
        filledCorners++;
      } else if (this.board[cy][cx] !== null) {
        filledCorners++;
      }
    }
    return filledCorners >= 3;
  }

  private detectTSpinMini(): boolean {
    if (!this.current || this.current.type !== 'T') return false;

    const frontCorners: [number, number][] = [];
    switch (this.current.rotation) {
      case 0: frontCorners.push([0, 0], [0, 2]); break;
      case 1: frontCorners.push([0, 2], [2, 2]); break;
      case 2: frontCorners.push([2, 0], [2, 2]); break;
      case 3: frontCorners.push([0, 0], [2, 0]); break;
    }

    let frontFilled = 0;
    for (const [dr, dc] of frontCorners) {
      const cy = this.current.y + dr;
      const cx = this.current.x + dc;
      if (cy < 0 || cy >= TOTAL_ROWS || cx < 0 || cx >= COLS) {
        frontFilled++;
      } else if (this.board[cy][cx] !== null) {
        frontFilled++;
      }
    }
    return frontFilled < 2;
  }

  // ---------------------------------------------------------------------------
  // Line clearing
  // ---------------------------------------------------------------------------

  private findFullRows(): number[] {
    const full: number[] = [];
    for (let row = 0; row < TOTAL_ROWS; row++) {
      if (this.board[row].every((cell) => cell !== null)) {
        full.push(row);
      }
    }
    return full;
  }

  private handleLineClear(clearedRows: number[], isTSpin: boolean, isTSpinMini: boolean) {
    const count = clearedRows.length;
    const isDifficult = count === 4 || isTSpin;
    const isB2B = this.backToBack && isDifficult;

    let points: number;
    if (isTSpin) {
      if (isTSpinMini && count === 0) points = SCORE_TABLE.tSpinMini;
      else if (count === 0) points = SCORE_TABLE.tSpin;
      else if (count === 1) points = SCORE_TABLE.tSpinSingle;
      else if (count === 2) points = SCORE_TABLE.tSpinDouble;
      else points = SCORE_TABLE.tSpinTriple;
      this.stats.tSpins++;
    } else {
      switch (count) {
        case 1: points = SCORE_TABLE.single; break;
        case 2: points = SCORE_TABLE.double; break;
        case 3: points = SCORE_TABLE.triple; break;
        case 4: points = SCORE_TABLE.tetris; break;
        default: points = 0;
      }
    }

    points *= this.stats.level;
    if (isB2B) points = Math.floor(points * BACK_TO_BACK_MULTIPLIER);

    this.combo++;
    if (this.combo > 0) {
      points += SCORE_TABLE.comboBonus * this.combo * this.stats.level;
    }

    this.stats.score += points;

    switch (count) {
      case 1: this.stats.singles++; break;
      case 2: this.stats.doubles++; break;
      case 3: this.stats.triples++; break;
      case 4: this.stats.tetrises++; break;
    }
    if (this.combo > this.stats.maxCombo) this.stats.maxCombo = this.combo;

    this.backToBack = isDifficult;

    const oldLevel = this.stats.level;
    this.stats.lines += count;
    this.stats.level = Math.floor(this.stats.lines / LINES_PER_LEVEL) + 1;

    this.clearingRows = clearedRows;
    this.clearAnimTimer = 0;

    this.onLineClear?.({
      linesCleared: count, isTSpin, isTSpinMini, isBackToBack: isB2B,
      combo: this.combo, points, clearedRows,
    });

    if (isTSpin) this.onTSpin?.();
    if (isB2B) this.onBackToBack?.();
    if (this.stats.level > oldLevel) this.onLevelUp?.(this.stats.level);
  }

  private clearRows(rows: number[]) {
    // Sort descending so we remove from bottom up — no index shift issues
    const sorted = [...rows].sort((a, b) => b - a);
    for (const row of sorted) {
      this.board.splice(row, 1);
    }
    // Add empty rows at top to restore board height
    for (let i = 0; i < sorted.length; i++) {
      this.board.unshift(Array.from({ length: COLS }, () => null));
    }
  }

  // ---------------------------------------------------------------------------
  // Game Over
  // ---------------------------------------------------------------------------

  private triggerGameOver() {
    this.isGameOver = true;
    this.gameOverAnimTimer = 0;
    this.gameOverAnimRow = TOTAL_ROWS;
    this.dirty = true;
    this.onGameOver?.({
      score: this.stats.score,
      level: this.stats.level,
      lines: this.stats.lines,
      stats: { ...this.stats },
      durationMs: this.activePlayTime,
    });
  }

  // ---------------------------------------------------------------------------
  // Game Loop Update
  // ---------------------------------------------------------------------------

  // fallow-ignore-next-line unused-class-member
  update(dt: number) {
    if (this.isGameOver || this.isPaused) return;

    // Handle clear animation (current is already null during this)
    if (this.clearingRows.length > 0) {
      this.clearAnimTimer += dt;
      this.activePlayTime += dt;
      if (this.clearAnimTimer >= LINE_CLEAR_ANIMATION_MS) {
        this.clearRows(this.clearingRows);
        this.clearingRows = [];
        this.clearAnimTimer = 0;
        if (!this.spawnPiece()) {
          this.triggerGameOver();
        }
      }
      return;
    }

    if (!this.current) return;

    // Track active play time only after first action
    if (this.hasFirstAction) {
      this.activePlayTime += dt;
    }

    // Gravity — fixed-step: consume accumulated time fully so dropped frames catch up
    const dropInterval = getDropInterval(this.stats.level) * 1000;
    this.dropTimer += dt;
    let gravitySteps = 0;
    // Allow enough catch-up steps so high gravity remains accurate under lag.
    while (this.dropTimer >= dropInterval && gravitySteps < TOTAL_ROWS) {
      this.dropTimer -= dropInterval;
      gravitySteps++;
      if (!this.hasFirstAction) this.hasFirstAction = true;
      const test = { ...this.current, y: this.current.y + 1 };
      if (this.isValidPosition(test)) {
        this.current.y = test.y;
      } else {
        // NES-style lock behavior: no independent lock timer; the piece
        // locks when a gravity step attempts to move down and fails.
        this.dropTimer = 0;
        this.lockPiece();
        return;
      }
    }
  }

  // fallow-ignore-next-line unused-class-member
  updateGameOverAnimation(dt: number): boolean {
    if (!this.isGameOver) return false;
    this.gameOverAnimTimer += dt;
    const rowInterval = 600 / TOTAL_ROWS;
    const rowsToGray = Math.floor(this.gameOverAnimTimer / rowInterval);
    this.gameOverAnimRow = TOTAL_ROWS - rowsToGray;
    return this.gameOverAnimRow > 0;
  }

  // fallow-ignore-next-line unused-class-member
  togglePause(): boolean {
    if (this.isGameOver) return false;
    this.isPaused = !this.isPaused;
    this.dirty = true;
    return this.isPaused;
  }
}

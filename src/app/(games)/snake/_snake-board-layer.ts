import {
  BASE_HEIGHT,
  BASE_WIDTH,
  CELL_SIZE,
  GRID_SIZE,
} from './_snake-helpers';
import type { SnakeCosmeticTheme } from './_snake-types';

type RefLike<T> = {
  current: T;
};

export type SnakeBoardImageLoadState = 'loading' | 'ready' | 'error';

export type SnakeBoardThemeSnapshot = Pick<
  SnakeCosmeticTheme,
  | 'boardColorA'
  | 'boardColorB'
  | 'boardTileColorA2'
  | 'boardTileColorB2'
  | 'boardTileGradientEnabled'
  | 'boardTileGradientDirection'
  | 'boardGlobalGradientEnabled'
  | 'boardGlobalGradientStart'
  | 'boardGlobalGradientEnd'
  | 'boardGlobalGradientDirection'
  | 'boardGlobalGradientStrength'
  | 'boardGridLineColor'
  | 'boardGridLineWidth'
  | 'boardBorderColor'
  | 'boardBorderWidth'
  | 'boardVignette'
  | 'boardImageUrl'
  | 'boardImageZoom'
  | 'boardImageOffsetX'
  | 'boardImageOffsetY'
  | 'skin'
>;

const createBoardThemeSnapshot = (
  snakeTheme: SnakeCosmeticTheme,
): SnakeBoardThemeSnapshot => ({
  boardColorA: snakeTheme.boardColorA,
  boardColorB: snakeTheme.boardColorB,
  boardTileColorA2: snakeTheme.boardTileColorA2,
  boardTileColorB2: snakeTheme.boardTileColorB2,
  boardTileGradientEnabled: snakeTheme.boardTileGradientEnabled,
  boardTileGradientDirection: snakeTheme.boardTileGradientDirection,
  boardGlobalGradientEnabled: snakeTheme.boardGlobalGradientEnabled,
  boardGlobalGradientStart: snakeTheme.boardGlobalGradientStart,
  boardGlobalGradientEnd: snakeTheme.boardGlobalGradientEnd,
  boardGlobalGradientDirection: snakeTheme.boardGlobalGradientDirection,
  boardGlobalGradientStrength: snakeTheme.boardGlobalGradientStrength,
  boardGridLineColor: snakeTheme.boardGridLineColor,
  boardGridLineWidth: snakeTheme.boardGridLineWidth,
  boardBorderColor: snakeTheme.boardBorderColor,
  boardBorderWidth: snakeTheme.boardBorderWidth,
  boardVignette: snakeTheme.boardVignette,
  boardImageUrl: snakeTheme.boardImageUrl,
  boardImageZoom: snakeTheme.boardImageZoom,
  boardImageOffsetX: snakeTheme.boardImageOffsetX,
  boardImageOffsetY: snakeTheme.boardImageOffsetY,
  skin: snakeTheme.skin,
});

const boardThemeChanged = (
  previous: SnakeBoardThemeSnapshot | null,
  next: SnakeBoardThemeSnapshot,
) =>
  !previous ||
  previous.boardColorA !== next.boardColorA ||
  previous.boardColorB !== next.boardColorB ||
  previous.boardTileColorA2 !== next.boardTileColorA2 ||
  previous.boardTileColorB2 !== next.boardTileColorB2 ||
  previous.boardTileGradientEnabled !== next.boardTileGradientEnabled ||
  previous.boardTileGradientDirection !== next.boardTileGradientDirection ||
  previous.boardGlobalGradientEnabled !== next.boardGlobalGradientEnabled ||
  previous.boardGlobalGradientStart !== next.boardGlobalGradientStart ||
  previous.boardGlobalGradientEnd !== next.boardGlobalGradientEnd ||
  previous.boardGlobalGradientDirection !== next.boardGlobalGradientDirection ||
  previous.boardGlobalGradientStrength !== next.boardGlobalGradientStrength ||
  previous.boardGridLineColor !== next.boardGridLineColor ||
  previous.boardGridLineWidth !== next.boardGridLineWidth ||
  previous.boardBorderColor !== next.boardBorderColor ||
  previous.boardBorderWidth !== next.boardBorderWidth ||
  previous.boardVignette !== next.boardVignette ||
  previous.boardImageUrl !== next.boardImageUrl ||
  previous.boardImageZoom !== next.boardImageZoom ||
  previous.boardImageOffsetX !== next.boardImageOffsetX ||
  previous.boardImageOffsetY !== next.boardImageOffsetY ||
  previous.skin?.material !== next.skin?.material ||
  previous.skin?.line !== next.skin?.line;

export function ensureSnakeBoardLayer({
  scale,
  snakeTheme,
  boardLayerRef,
  boardLayerThemeRef,
  boardImageCacheRef,
  boardImageLoadStateRef,
  onAsyncTextureReady,
}: {
  /** Layer pixels per board unit: the canvas's pixel width over BASE_WIDTH,
   *  rounded up to a quarter, so the layer matches the canvas it is drawn
   *  on and is rebuilt when the canvas is resized. */
  scale: number;
  snakeTheme: SnakeCosmeticTheme;
  boardLayerRef: RefLike<HTMLCanvasElement | null>;
  boardLayerThemeRef: RefLike<SnakeBoardThemeSnapshot | null>;
  boardImageCacheRef: RefLike<Map<string, HTMLImageElement>>;
  boardImageLoadStateRef: RefLike<Map<string, SnakeBoardImageLoadState>>;
  onAsyncTextureReady: () => void;
}) {
  const nextTheme = createBoardThemeSnapshot(snakeTheme);
  const shouldRebuild =
    !boardLayerRef.current ||
    boardLayerRef.current.dataset.scale !== String(scale) ||
    boardThemeChanged(boardLayerThemeRef.current, nextTheme);
  if (!shouldRebuild) {
    return;
  }

  const boardLayer = document.createElement('canvas');
  boardLayer.width = Math.ceil(BASE_WIDTH * scale);
  boardLayer.height = Math.ceil(BASE_HEIGHT * scale);
  boardLayer.dataset.scale = String(scale);
  const boardCtx = boardLayer.getContext('2d');
  if (boardCtx) {
    boardCtx.scale(scale, scale);
    const makeGradient = (
      x: number,
      y: number,
      width: number,
      height: number,
      start: string,
      end: string,
      direction: string,
    ) => {
      if (direction === 'horizontal') {
        const gradient = boardCtx.createLinearGradient(x, y, x + width, y);
        gradient.addColorStop(0, start);
        gradient.addColorStop(1, end);
        return gradient;
      }
      if (direction === 'vertical') {
        const gradient = boardCtx.createLinearGradient(x, y, x, y + height);
        gradient.addColorStop(0, start);
        gradient.addColorStop(1, end);
        return gradient;
      }
      if (direction === 'radial') {
        const gradient = boardCtx.createRadialGradient(
          x + width * 0.5,
          y + height * 0.5,
          Math.min(width, height) * 0.12,
          x + width * 0.5,
          y + height * 0.5,
          Math.max(width, height) * 0.75,
        );
        gradient.addColorStop(0, start);
        gradient.addColorStop(1, end);
        return gradient;
      }
      const gradient = boardCtx.createLinearGradient(x, y, x + width, y + height);
      gradient.addColorStop(0, start);
      gradient.addColorStop(1, end);
      return gradient;
    };

    const drawProceduralBoard = () => {
      for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
          const isA = (x + y) % 2 === 0;
          if (snakeTheme.boardTileGradientEnabled) {
            boardCtx.fillStyle = makeGradient(
              x * CELL_SIZE,
              y * CELL_SIZE,
              CELL_SIZE,
              CELL_SIZE,
              isA ? snakeTheme.boardColorA : snakeTheme.boardColorB,
              isA ? snakeTheme.boardTileColorA2 : snakeTheme.boardTileColorB2,
              snakeTheme.boardTileGradientDirection,
            );
          } else {
            boardCtx.fillStyle = isA ? snakeTheme.boardColorA : snakeTheme.boardColorB;
          }
          boardCtx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
      }
    };

    const drawImageCover = (
      image: HTMLImageElement,
      zoomPercent: number,
      offsetXPercent: number,
      offsetYPercent: number,
    ) => {
      const imageWidth = image.naturalWidth || image.width;
      const imageHeight = image.naturalHeight || image.height;
      if (imageWidth <= 0 || imageHeight <= 0) return false;
      const zoom = Math.max(0.6, Math.min(2.2, zoomPercent / 100));
      const scale =
        Math.max(BASE_WIDTH / imageWidth, BASE_HEIGHT / imageHeight) * zoom;
      const drawWidth = imageWidth * scale;
      const drawHeight = imageHeight * scale;
      const overflowX = Math.max(0, drawWidth - BASE_WIDTH);
      const overflowY = Math.max(0, drawHeight - BASE_HEIGHT);
      const normalizedX = Math.max(-100, Math.min(100, offsetXPercent)) / 100;
      const normalizedY = Math.max(-100, Math.min(100, offsetYPercent)) / 100;
      const dx = (BASE_WIDTH - drawWidth) / 2 + (overflowX / 2) * normalizedX;
      const dy = (BASE_HEIGHT - drawHeight) / 2 + (overflowY / 2) * normalizedY;
      boardCtx.drawImage(image, dx, dy, drawWidth, drawHeight);
      return true;
    };

    drawProceduralBoard();

    // A skin set's material, drawn flat over the board, cell-aligned so it
    // never reads as part of the grid's rules.
    const material = snakeTheme.skin?.material;
    if (material === 'planks') {
      boardCtx.save();
      for (let row = 0; row < GRID_SIZE; row++) {
        boardCtx.fillStyle = row % 2 ? snakeTheme.boardTileColorB2 : snakeTheme.boardColorA;
        boardCtx.fillRect(0, row * CELL_SIZE, BASE_WIDTH, CELL_SIZE);
      }
      boardCtx.strokeStyle = snakeTheme.skin!.line;
      boardCtx.lineWidth = 1.5;
      for (let row = 0; row < GRID_SIZE; row++) {
        const y = row * CELL_SIZE + 0.75;
        boardCtx.beginPath();
        boardCtx.moveTo(0, y);
        boardCtx.lineTo(BASE_WIDTH, y);
        boardCtx.stroke();
        // Board ends, staggered like a boardwalk.
        for (let joint = ((row * 3) % 5) + 2; joint < GRID_SIZE; joint += 6) {
          boardCtx.beginPath();
          boardCtx.moveTo(joint * CELL_SIZE, row * CELL_SIZE);
          boardCtx.lineTo(joint * CELL_SIZE, (row + 1) * CELL_SIZE);
          boardCtx.stroke();
        }
      }
      boardCtx.restore();
    } else if (material === 'paper') {
      boardCtx.save();
      boardCtx.strokeStyle = snakeTheme.skin!.line;
      boardCtx.lineWidth = 1.5;
      for (let row = 1; row < GRID_SIZE; row++) {
        const y = row * CELL_SIZE;
        boardCtx.beginPath();
        boardCtx.moveTo(0, y);
        boardCtx.lineTo(BASE_WIDTH, y);
        boardCtx.stroke();
      }
      boardCtx.restore();
    } else if (material === 'slate') {
      // A few chalk smudges, the same on every board.
      boardCtx.save();
      boardCtx.strokeStyle = snakeTheme.skin!.line;
      boardCtx.globalAlpha = 0.35;
      boardCtx.lineWidth = 3;
      boardCtx.lineCap = 'round';
      for (let i = 0; i < 9; i++) {
        const x = ((i * 137) % GRID_SIZE) * CELL_SIZE + CELL_SIZE * 0.3;
        const y = ((i * 71 + 5) % GRID_SIZE) * CELL_SIZE + CELL_SIZE * 0.5;
        boardCtx.beginPath();
        boardCtx.moveTo(x, y);
        boardCtx.lineTo(x + CELL_SIZE * 1.6, y - CELL_SIZE * 0.35);
        boardCtx.stroke();
      }
      boardCtx.restore();
    }

    const boardImageUrl = snakeTheme.boardImageUrl.trim();
    const boardImageZoom = snakeTheme.boardImageZoom;
    const boardImageOffsetX = snakeTheme.boardImageOffsetX;
    const boardImageOffsetY = snakeTheme.boardImageOffsetY;
    if (boardImageUrl.length > 0) {
      const state = boardImageLoadStateRef.current.get(boardImageUrl);
      const cachedImage = boardImageCacheRef.current.get(boardImageUrl);
      if (
        state === 'ready' &&
        cachedImage &&
        drawImageCover(
          cachedImage,
          boardImageZoom,
          boardImageOffsetX,
          boardImageOffsetY,
        )
      ) {
        // image texture drawn over base board
      } else if (!state) {
        const image = new Image();
        boardImageLoadStateRef.current.set(boardImageUrl, 'loading');
        boardImageCacheRef.current.set(boardImageUrl, image);
        image.onload = () => {
          boardImageLoadStateRef.current.set(boardImageUrl, 'ready');
          boardLayerThemeRef.current = null;
          requestAnimationFrame(onAsyncTextureReady);
        };
        image.onerror = () => {
          boardImageLoadStateRef.current.set(boardImageUrl, 'error');
          boardLayerThemeRef.current = null;
          requestAnimationFrame(onAsyncTextureReady);
        };
        image.src = boardImageUrl;
      }
    }

    if (
      snakeTheme.boardGlobalGradientEnabled &&
      snakeTheme.boardGlobalGradientStrength > 0
    ) {
      boardCtx.save();
      boardCtx.globalAlpha = Math.min(1, snakeTheme.boardGlobalGradientStrength / 100);
      boardCtx.fillStyle = makeGradient(
        0,
        0,
        BASE_WIDTH,
        BASE_HEIGHT,
        snakeTheme.boardGlobalGradientStart,
        snakeTheme.boardGlobalGradientEnd,
        snakeTheme.boardGlobalGradientDirection,
      );
      boardCtx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
      boardCtx.restore();
    }

    if (snakeTheme.boardGridLineWidth > 0) {
      boardCtx.save();
      boardCtx.strokeStyle = snakeTheme.boardGridLineColor;
      boardCtx.lineWidth = snakeTheme.boardGridLineWidth;
      boardCtx.globalAlpha = 0.75;
      for (let i = 1; i < GRID_SIZE; i++) {
        const line = i * CELL_SIZE;
        boardCtx.beginPath();
        boardCtx.moveTo(line, 0);
        boardCtx.lineTo(line, BASE_HEIGHT);
        boardCtx.stroke();
        boardCtx.beginPath();
        boardCtx.moveTo(0, line);
        boardCtx.lineTo(BASE_WIDTH, line);
        boardCtx.stroke();
      }
      boardCtx.restore();
    }

    if (snakeTheme.boardBorderWidth > 0) {
      const borderWidth = Math.max(
        1,
        Math.min(
          snakeTheme.boardBorderWidth,
          Math.floor(Math.min(BASE_WIDTH, BASE_HEIGHT) / 4),
        ),
      );
      boardCtx.fillStyle = snakeTheme.boardBorderColor;
      boardCtx.fillRect(0, 0, BASE_WIDTH, borderWidth);
      boardCtx.fillRect(0, BASE_HEIGHT - borderWidth, BASE_WIDTH, borderWidth);
      boardCtx.fillRect(0, 0, borderWidth, BASE_HEIGHT);
      boardCtx.fillRect(BASE_WIDTH - borderWidth, 0, borderWidth, BASE_HEIGHT);
    }

    if (snakeTheme.boardVignette > 0) {
      const vignette = boardCtx.createRadialGradient(
        BASE_WIDTH / 2,
        BASE_HEIGHT / 2,
        Math.min(BASE_WIDTH, BASE_HEIGHT) * 0.2,
        BASE_WIDTH / 2,
        BASE_HEIGHT / 2,
        Math.max(BASE_WIDTH, BASE_HEIGHT) * 0.75,
      );
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(
        1,
        `rgba(0,0,0,${Math.min(0.95, (snakeTheme.boardVignette / 200) * 0.9)})`,
      );
      boardCtx.fillStyle = vignette;
      boardCtx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
    }
  }

  boardLayerRef.current = boardLayer;
  boardLayerThemeRef.current = nextTheme;
}

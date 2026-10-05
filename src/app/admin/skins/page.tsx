'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArcadeButton,
  ArcadeNotice,
} from '@/features/arcade/components/ui/arcade-ui';
import {
  type ApiResponse,
  type AssetField,
  type ItemDraft,
  type Metadata,
  type SkinGroup,
  type SkinStudioExportAsset,
  type SkinStudioExportFile,
  type SnakeBoardDraft,
  type SnakeBodyDraft,
  type SnakeFoodDraft,
  type TypingCaretDraft,
  type TypingFeedbackDraft,
  type TypingThemeDraft,
  type TypingTextStyleDraft,
  type FlappyBirdDraft,
  type FlappyPipeDraft,
  type FlappyBackgroundDraft,
  type FlappyTrailDraft,
  type EightBallCueDraft,
  type EightBallTableDraft,
  type EightBallBallsDraft,
  type EightBallPlayercardDraft,
  type TetrisBlocksDraft,
  type TetrisBoardDraft,
  type TetrisEffectsDraft,
  type TetrisGhostDraft,
  type StoreItem,
  type StoreRarity,
  type CurrencyType,
  DEFAULT_SNAKE_BODY_DRAFT,
  DEFAULT_SNAKE_BOARD_DRAFT,
  DEFAULT_METADATA,
  DEFAULT_SNAKE_FOOD_DRAFT,
  DEFAULT_TYPING_CARET_DRAFT,
  DEFAULT_TYPING_FEEDBACK_DRAFT,
  DEFAULT_TYPING_THEME_DRAFT,
  DEFAULT_TYPING_TEXT_STYLE_DRAFT,
  DEFAULT_FLAPPY_BIRD_DRAFT,
  DEFAULT_FLAPPY_PIPE_DRAFT,
  DEFAULT_FLAPPY_BACKGROUND_DRAFT,
  DEFAULT_FLAPPY_TRAIL_DRAFT,
  DEFAULT_EIGHT_BALL_CUE_DRAFT,
  DEFAULT_EIGHT_BALL_TABLE_DRAFT,
  DEFAULT_EIGHT_BALL_BALLS_DRAFT,
  DEFAULT_EIGHT_BALL_PLAYERCARD_DRAFT,
  DEFAULT_TETRIS_BLOCKS_DRAFT,
  DEFAULT_TETRIS_BOARD_DRAFT,
  DEFAULT_TETRIS_EFFECTS_DRAFT,
  DEFAULT_TETRIS_GHOST_DRAFT,
  SKIN_STUDIO_DRAFT_STORAGE_KEY,
  INITIAL_ITEM_DRAFT,
  parseAssetFieldsFromAssetRef,
  parseSnakeBodyDraftFromAssetRef,
  parseSnakeBoardDraftFromAssetRef,
  parseSnakeFoodDraftFromAssetRef,
  parseTypingCaretDraftFromAssetRef,
  parseTypingFeedbackDraftFromAssetRef,
  parseTypingThemeDraftFromAssetRef,
  parseTypingTextStyleDraftFromAssetRef,
  parseFlappyBirdDraftFromAssetRef,
  parseFlappyPipeDraftFromAssetRef,
  parseFlappyBackgroundDraftFromAssetRef,
  parseFlappyTrailDraftFromAssetRef,
  parseEightBallCueDraftFromAssetRef,
  parseEightBallTableDraftFromAssetRef,
  parseEightBallBallsDraftFromAssetRef,
  parseEightBallPlayercardDraftFromAssetRef,
  parseTetrisBlocksDraftFromAssetRef,
  parseTetrisBoardDraftFromAssetRef,
  parseTetrisEffectsDraftFromAssetRef,
  parseTetrisGhostDraftFromAssetRef,
  parseCoinFlipCoinDraftFromAssetRef,
  parseCoinFlipTrailDraftFromAssetRef,
  parseCoinFlipBackgroundDraftFromAssetRef,
  type CoinFlipCoinDraft,
  type CoinFlipTrailDraft,
  type CoinFlipBackgroundDraft,
  DEFAULT_COIN_FLIP_COIN_DRAFT,
  DEFAULT_COIN_FLIP_TRAIL_DRAFT,
  DEFAULT_COIN_FLIP_BACKGROUND_DRAFT,
  parseGame2048TilesDraftFromAssetRef,
  parseGame2048GridDraftFromAssetRef,
  parseGame2048BackgroundDraftFromAssetRef,
  type Game2048TilesDraft,
  type Game2048GridDraft,
  type Game2048BackgroundDraft,
  DEFAULT_GAME_2048_TILES_DRAFT,
  DEFAULT_GAME_2048_GRID_DRAFT,
  DEFAULT_GAME_2048_BACKGROUND_DRAFT,
  type ChessBoardDraft,
  type ChessPiecesDraft,
  type ChessClockDraft,
  DEFAULT_CHESS_BOARD_DRAFT,
  DEFAULT_CHESS_PIECES_DRAFT,
  DEFAULT_CHESS_CLOCK_DRAFT,
  parseChessBoardDraftFromAssetRef,
  parseChessPiecesDraftFromAssetRef,
  parseChessClockDraftFromAssetRef,
} from './_types';
import { SnakeBodyEditor } from './_snake-body-editor';
import { SnakeBoardEditor } from './_snake-board-editor';
import { SnakeFoodEditor } from './_snake-food-editor';
import { TypingCaretEditor } from './_typing-caret-editor';
import { TypingFeedbackEditor } from './_typing-feedback-editor';
import { TypingThemeEditor } from './_typing-theme-editor';
import { TypingTextStyleEditor } from './_typing-text-style-editor';
import { FlappyBirdEditor } from './_flappy-bird-editor';
import { FlappyPipeEditor } from './_flappy-pipe-editor';
import { FlappyBackgroundEditor } from './_flappy-background-editor';
import { FlappyTrailEditor } from './_flappy-trail-editor';
import { EightBallCueEditor } from './_8ball-cue-editor';
import { EightBallTableEditor } from './_8ball-table-editor';
import { EightBallBallsEditor } from './_8ball-balls-editor';
import { EightBallPlayercardEditor } from './_8ball-playercard-editor';
import { TetrisBlocksEditor } from './_tetris-blocks-editor';
import { TetrisBoardEditor } from './_tetris-board-editor';
import { TetrisEffectsEditor } from './_tetris-effects-editor';
import { TetrisGhostEditor } from './_tetris-ghost-editor';
import {
  CoinFlipCoinEditor,
  CoinFlipTrailEditor,
  CoinFlipBackgroundEditor,
} from './_coinflip-editors';
import {
  Game2048TilesEditor,
  Game2048GridEditor,
  Game2048BackgroundEditor,
} from './_2048-editors';
import {
  ChessBoardEditor,
  ChessPiecesEditor,
  ChessClockEditor,
} from './_chess-editors';
import { AssetFieldsEditor } from './_asset-fields-editor';
import { AdminCatalogPanel } from '@/features/admin/components/admin-catalog-panel';
import {
  AdminConsoleFrame,
  ConsoleMetric,
  ConsolePanel,
  ConsoleTabs,
} from '@/features/admin/components/admin-console';
import {
  ItemCoreForm,
  ItemGroupingForm,
  ItemSlotSelector,
} from './_item-form-sections';
import { computeCreditsItemPriceForSkinStudio } from '@/features/arcade/lib/skin-studio-pricing';
import { toGameScopedGroupSlug, type ItemGroupMode } from './_utils';
import {
  composeAssetRefForEditorKind,
  resolveEditorKind,
  type SlotAssetDrafts,
} from './_slot-asset';

const STORAGE_IMAGE_PATH_PREFIX = '/api/storage/image/';
const MAX_STORAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
const PROXY_SAFE_UPLOAD_BYTES = 900 * 1024;

const normalizeStorageImagePath = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const stripHashAndQuery = (path: string) =>
    path.split('#')[0]?.split('?')[0] ?? '';

  if (trimmed.startsWith(STORAGE_IMAGE_PATH_PREFIX)) {
    const normalized = stripHashAndQuery(trimmed);
    return normalized.startsWith(STORAGE_IMAGE_PATH_PREFIX) ? normalized : null;
  }

  try {
    const parsed = new URL(trimmed, window.location.origin);
    const normalized = stripHashAndQuery(parsed.pathname);
    return normalized.startsWith(STORAGE_IMAGE_PATH_PREFIX) ? normalized : null;
  } catch {
    return null;
  }
};

const collectStorageImagePaths = (
  value: unknown,
  output: Set<string>,
): void => {
  if (typeof value === 'string') {
    const path = normalizeStorageImagePath(value);
    if (path) output.add(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectStorageImagePaths(entry, output));
    return;
  }
  if (!value || typeof value !== 'object') return;
  Object.values(value as Record<string, unknown>).forEach((entry) =>
    collectStorageImagePaths(entry, output),
  );
};

const toBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Failed to convert asset to base64.'));
        return;
      }
      const base64 = result.split(',')[1];
      if (!base64) {
        reject(new Error('Failed to parse asset base64.'));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () =>
      reject(new Error('Failed to read asset for export.'));
    reader.readAsDataURL(blob);
  });

const fromBase64 = (base64Data: string, mimeType: string): Blob => {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
};

const fileNameFromPath = (path: string, mimeType: string): string => {
  const tail = path.split('/').pop();
  if (tail && tail.trim()) return tail.trim();
  const extension =
    mimeType === 'image/png'
      ? 'png'
      : mimeType === 'image/jpeg'
        ? 'jpg'
        : mimeType === 'image/gif'
          ? 'gif'
          : mimeType === 'image/webp'
            ? 'webp'
            : 'bin';
  return `skin-asset.${extension}`;
};

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
};

const replaceExtension = (name: string, nextExt: string): string => {
  const base = name.replace(/\.[^/.]+$/, '');
  return `${base}${nextExt}`;
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Failed to read blob for compression.'));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () =>
      reject(new Error('Failed to read blob for compression.'));
    reader.readAsDataURL(blob);
  });

const loadImageElement = (dataUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error('Failed to decode image for compression.'));
    image.src = dataUrl;
  });

const canvasToBlob = (
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to encode compressed image.'));
          return;
        }
        resolve(blob);
      },
      type,
      quality,
    );
  });

const compressImageBlobForProxy = async (
  blob: Blob,
  maxBytes: number,
): Promise<Blob> => {
  if (!blob.type.startsWith('image/')) return blob;
  if (blob.size <= maxBytes) return blob;

  const dataUrl = await blobToDataUrl(blob);
  const image = await loadImageElement(dataUrl);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return blob;

  let best = blob;
  let scale = 1;
  let quality = 0.9;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const candidate = await canvasToBlob(canvas, 'image/webp', quality);
    if (candidate.size < best.size) {
      best = candidate;
    }
    if (candidate.size <= maxBytes) {
      return candidate;
    }

    if (quality > 0.55) {
      quality = Math.max(0.5, quality - 0.12);
    } else {
      scale *= 0.85;
      quality = 0.82;
    }
  }

  return best;
};

const parseEmbeddedExportAssets = (raw: unknown): SkinStudioExportAsset[] => {
  if (!Array.isArray(raw)) return [];
  const assets: SkinStudioExportAsset[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const value = entry as Record<string, unknown>;
    const candidatePath =
      typeof value.path === 'string'
        ? value.path
        : typeof value.sourceUrl === 'string'
          ? value.sourceUrl
          : '';
    const path = normalizeStorageImagePath(candidatePath);
    const base64Data =
      typeof value.base64Data === 'string'
        ? value.base64Data
        : typeof value.dataBase64 === 'string'
          ? value.dataBase64
          : '';
    if (!path || !base64Data.trim()) continue;
    const mimeType =
      typeof value.mimeType === 'string' && value.mimeType.trim()
        ? value.mimeType.trim()
        : 'application/octet-stream';
    const fileName =
      typeof value.fileName === 'string' && value.fileName.trim()
        ? value.fileName.trim()
        : fileNameFromPath(path, mimeType);
    assets.push({
      path,
      mimeType,
      fileName,
      base64Data,
    });
  }
  return assets;
};

const rewriteAssetRefImagePaths = (
  value: unknown,
  replacementByPath: Map<string, string>,
): unknown => {
  if (typeof value === 'string') {
    const path = normalizeStorageImagePath(value);
    if (path && replacementByPath.has(path)) {
      return replacementByPath.get(path) ?? value;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      rewriteAssetRefImagePaths(entry, replacementByPath),
    );
  }
  if (!value || typeof value !== 'object') return value;
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    next[key] = rewriteAssetRefImagePaths(entry, replacementByPath);
  }
  return next;
};

export default function AdminSkinsPage() {
  return (
    <Suspense fallback={<p role='status' className='p-6 text-sm text-faint'>Loading Skin Studio…</p>}>
      <AdminSkinsContent />
    </Suspense>
  );
}

function AdminSkinsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get('tab') === 'editor' ? 'editor' : 'catalog';
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [items, setItems] = useState<StoreItem[]>([]);
  const [groups, setGroups] = useState<SkinGroup[]>([]);
  const [metadata, setMetadata] = useState<Metadata>(DEFAULT_METADATA);

  const [itemDraft, setItemDraft] = useState<ItemDraft>(INITIAL_ITEM_DRAFT);
  const [snakeBodyDraft, setSnakeBodyDraft] = useState<SnakeBodyDraft>({
    ...DEFAULT_SNAKE_BODY_DRAFT,
  });
  const [snakeBoardDraft, setSnakeBoardDraft] = useState<SnakeBoardDraft>({
    ...DEFAULT_SNAKE_BOARD_DRAFT,
  });
  const [snakeFoodDraft, setSnakeFoodDraft] = useState<SnakeFoodDraft>({
    ...DEFAULT_SNAKE_FOOD_DRAFT,
  });
  const [typingThemeDraft, setTypingThemeDraft] = useState<TypingThemeDraft>({
    ...DEFAULT_TYPING_THEME_DRAFT,
  });
  const [typingCaretDraft, setTypingCaretDraft] = useState<TypingCaretDraft>({
    ...DEFAULT_TYPING_CARET_DRAFT,
  });
  const [typingFeedbackDraft, setTypingFeedbackDraft] =
    useState<TypingFeedbackDraft>({
      ...DEFAULT_TYPING_FEEDBACK_DRAFT,
    });
  const [typingTextStyleDraft, setTypingTextStyleDraft] =
    useState<TypingTextStyleDraft>({
      ...DEFAULT_TYPING_TEXT_STYLE_DRAFT,
    });
  const [flappyBirdDraft, setFlappyBirdDraft] = useState<FlappyBirdDraft>({
    ...DEFAULT_FLAPPY_BIRD_DRAFT,
  });
  const [flappyPipeDraft, setFlappyPipeDraft] = useState<FlappyPipeDraft>({
    ...DEFAULT_FLAPPY_PIPE_DRAFT,
  });
  const [flappyBackgroundDraft, setFlappyBackgroundDraft] =
    useState<FlappyBackgroundDraft>({
      ...DEFAULT_FLAPPY_BACKGROUND_DRAFT,
    });
  const [flappyTrailDraft, setFlappyTrailDraft] = useState<FlappyTrailDraft>({
    ...DEFAULT_FLAPPY_TRAIL_DRAFT,
  });
  const [eightBallCueDraft, setEightBallCueDraft] = useState<EightBallCueDraft>(
    {
      ...DEFAULT_EIGHT_BALL_CUE_DRAFT,
    },
  );
  const [eightBallTableDraft, setEightBallTableDraft] =
    useState<EightBallTableDraft>({
      ...DEFAULT_EIGHT_BALL_TABLE_DRAFT,
    });
  const [eightBallBallsDraft, setEightBallBallsDraft] =
    useState<EightBallBallsDraft>({
      ...DEFAULT_EIGHT_BALL_BALLS_DRAFT,
    });
  const [eightBallPlayercardDraft, setEightBallPlayercardDraft] =
    useState<EightBallPlayercardDraft>({
      ...DEFAULT_EIGHT_BALL_PLAYERCARD_DRAFT,
    });
  const [tetrisBlocksDraft, setTetrisBlocksDraft] = useState<TetrisBlocksDraft>(
    {
      ...DEFAULT_TETRIS_BLOCKS_DRAFT,
    },
  );
  const [tetrisBoardDraft, setTetrisBoardDraft] = useState<TetrisBoardDraft>({
    ...DEFAULT_TETRIS_BOARD_DRAFT,
  });
  const [tetrisEffectsDraft, setTetrisEffectsDraft] =
    useState<TetrisEffectsDraft>({
      ...DEFAULT_TETRIS_EFFECTS_DRAFT,
    });
  const [tetrisGhostDraft, setTetrisGhostDraft] = useState<TetrisGhostDraft>({
    ...DEFAULT_TETRIS_GHOST_DRAFT,
  });
  const [coinFlipCoinDraft, setCoinFlipCoinDraft] = useState<CoinFlipCoinDraft>(
    {
      ...DEFAULT_COIN_FLIP_COIN_DRAFT,
    },
  );
  const [coinFlipTrailDraft, setCoinFlipTrailDraft] =
    useState<CoinFlipTrailDraft>({
      ...DEFAULT_COIN_FLIP_TRAIL_DRAFT,
    });
  const [coinFlipBackgroundDraft, setCoinFlipBackgroundDraft] =
    useState<CoinFlipBackgroundDraft>({
      ...DEFAULT_COIN_FLIP_BACKGROUND_DRAFT,
    });
  const [game2048TilesDraft, setGame2048TilesDraft] =
    useState<Game2048TilesDraft>({
      ...DEFAULT_GAME_2048_TILES_DRAFT,
    });
  const [game2048GridDraft, setGame2048GridDraft] =
    useState<Game2048GridDraft>({
      ...DEFAULT_GAME_2048_GRID_DRAFT,
    });
  const [game2048BackgroundDraft, setGame2048BackgroundDraft] =
    useState<Game2048BackgroundDraft>({
      ...DEFAULT_GAME_2048_BACKGROUND_DRAFT,
    });
  const [chessBoardDraft, setChessBoardDraft] = useState<ChessBoardDraft>({
    ...DEFAULT_CHESS_BOARD_DRAFT,
  });
  const [chessPiecesDraft, setChessPiecesDraft] = useState<ChessPiecesDraft>({
    ...DEFAULT_CHESS_PIECES_DRAFT,
  });
  const [chessClockDraft, setChessClockDraft] = useState<ChessClockDraft>({
    ...DEFAULT_CHESS_CLOCK_DRAFT,
  });

  const [assetFields, setAssetFields] = useState<AssetField[]>([]);
  const [itemGroupMode, setItemGroupMode] = useState<ItemGroupMode>('none');
  const [selectedExistingGroupId, setSelectedExistingGroupId] = useState('');
  const [removeFromSelectedGroup, setRemoveFromSelectedGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [groupSearchQuery, setGroupSearchQuery] = useState('');

  const [busy, setBusy] = useState(false);
  const [hasRestoredDraft, setHasRestoredDraft] = useState(false);
  const [isEditingExistingItem, setIsEditingExistingItem] = useState(false);
  const [editingSourceItemId, setEditingSourceItemId] = useState<string | null>(
    null,
  );
  const [editorInteracted, setEditorInteracted] = useState(false);
  const [restoredNamedDraft, setRestoredNamedDraft] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  // Compare against the last loaded or reset editor state, including every slot editor.
  // Generated IDs and prices are intentionally excluded from this comparison.
  const editorFingerprint = JSON.stringify({
    item: {
      name: itemDraft.name,
      gameType: itemDraft.gameType,
      rarity: itemDraft.rarity,
      slots: itemDraft.slots,
      active: itemDraft.active,
      assetRefText: itemDraft.assetRefText,
    },
    itemGroupMode,
    selectedExistingGroupId,
    removeFromSelectedGroup,
    newGroupName,
    assetFields,
    snakeBodyDraft,
    snakeBoardDraft,
    snakeFoodDraft,
    typingThemeDraft,
    typingCaretDraft,
    typingFeedbackDraft,
    typingTextStyleDraft,
    flappyBirdDraft,
    flappyPipeDraft,
    flappyBackgroundDraft,
    flappyTrailDraft,
    eightBallCueDraft,
    eightBallTableDraft,
    eightBallBallsDraft,
    eightBallPlayercardDraft,
    tetrisBlocksDraft,
    tetrisBoardDraft,
    tetrisEffectsDraft,
    tetrisGhostDraft,
    coinFlipCoinDraft,
    coinFlipTrailDraft,
    coinFlipBackgroundDraft,
    game2048TilesDraft,
    game2048GridDraft,
    game2048BackgroundDraft,
    chessBoardDraft,
    chessPiecesDraft,
    chessClockDraft,
  });
  const [editorBaseline, setEditorBaseline] = useState<string | null>(editorFingerprint);
  const hasEditorWork =
    editorBaseline !== null &&
    editorFingerprint !== editorBaseline &&
    (editorInteracted || restoredNamedDraft);
  useEffect(() => {
    if (editorBaseline === null) setEditorBaseline(editorFingerprint);
  }, [editorBaseline, editorFingerprint]);

  // --- Draft persistence ---
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SKIN_STUDIO_DRAFT_STORAGE_KEY);
      if (!raw) {
        setHasRestoredDraft(true);
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const draft = parsed?.itemDraft as Record<string, unknown> | undefined;
      if (draft) {
        setRestoredNamedDraft(
          typeof draft.name === 'string' && draft.name.trim().length > 0,
        );
        setItemDraft((prev) => ({
          ...prev,
          name: typeof draft.name === 'string' ? draft.name : prev.name,
          gameType:
            typeof draft.gameType === 'string' ? draft.gameType : prev.gameType,
          rarity:
            typeof draft.rarity === 'string'
              ? (draft.rarity as StoreRarity)
              : prev.rarity,
          currencyType:
            typeof draft.currencyType === 'string'
              ? (draft.currencyType as CurrencyType)
              : prev.currencyType,
          price:
            typeof draft.price === 'number' && Number.isFinite(draft.price)
              ? draft.price
              : prev.price,
          slots: Array.isArray(draft.slots)
            ? draft.slots.filter((v): v is string => typeof v === 'string')
            : prev.slots,
          active:
            typeof draft.active === 'boolean' ? draft.active : prev.active,
          assetRefText:
            typeof draft.assetRefText === 'string'
              ? draft.assetRefText
              : prev.assetRefText,
        }));
      }
      const body = parsed?.snakeBodyDraft as
        | Record<string, unknown>
        | undefined;
      if (body) {
        setSnakeBodyDraft(parseSnakeBodyDraftFromAssetRef(body));
      }
      const board = parsed?.snakeBoardDraft as
        | Record<string, unknown>
        | undefined;
      if (board) {
        setSnakeBoardDraft(parseSnakeBoardDraftFromAssetRef(board));
      }
      const food = parsed?.snakeFoodDraft as
        | Record<string, unknown>
        | undefined;
      if (food) {
        setSnakeFoodDraft(parseSnakeFoodDraftFromAssetRef(food));
      }
      const typingTheme = parsed?.typingThemeDraft as
        | Record<string, unknown>
        | undefined;
      if (typingTheme) {
        setTypingThemeDraft(parseTypingThemeDraftFromAssetRef(typingTheme));
      }
      const typingCaret = parsed?.typingCaretDraft as
        | Record<string, unknown>
        | undefined;
      if (typingCaret) {
        setTypingCaretDraft(parseTypingCaretDraftFromAssetRef(typingCaret));
      }
      const typingFeedback = parsed?.typingFeedbackDraft as
        | Record<string, unknown>
        | undefined;
      if (typingFeedback) {
        setTypingFeedbackDraft(
          parseTypingFeedbackDraftFromAssetRef(typingFeedback),
        );
      }
      const typingTextStyle = parsed?.typingTextStyleDraft as
        | Record<string, unknown>
        | undefined;
      if (typingTextStyle) {
        setTypingTextStyleDraft(
          parseTypingTextStyleDraftFromAssetRef(typingTextStyle),
        );
      }
      const tetrisBlocks = parsed?.tetrisBlocksDraft as
        | Record<string, unknown>
        | undefined;
      if (tetrisBlocks) {
        setTetrisBlocksDraft(parseTetrisBlocksDraftFromAssetRef(tetrisBlocks));
      }
      const tetrisBoard = parsed?.tetrisBoardDraft as
        | Record<string, unknown>
        | undefined;
      if (tetrisBoard) {
        setTetrisBoardDraft(parseTetrisBoardDraftFromAssetRef(tetrisBoard));
      }
      const tetrisEffects = parsed?.tetrisEffectsDraft as
        | Record<string, unknown>
        | undefined;
      if (tetrisEffects) {
        setTetrisEffectsDraft(
          parseTetrisEffectsDraftFromAssetRef(tetrisEffects),
        );
      }
      const tetrisGhost = parsed?.tetrisGhostDraft as
        | Record<string, unknown>
        | undefined;
      if (tetrisGhost) {
        setTetrisGhostDraft(parseTetrisGhostDraftFromAssetRef(tetrisGhost));
      }
      const cfCoin = parsed?.coinFlipCoinDraft as
        | Record<string, unknown>
        | undefined;
      if (cfCoin)
        setCoinFlipCoinDraft(parseCoinFlipCoinDraftFromAssetRef(cfCoin));
      const cfTrail = parsed?.coinFlipTrailDraft as
        | Record<string, unknown>
        | undefined;
      if (cfTrail)
        setCoinFlipTrailDraft(parseCoinFlipTrailDraftFromAssetRef(cfTrail));
      const cfBg = parsed?.coinFlipBackgroundDraft as
        | Record<string, unknown>
        | undefined;
      if (cfBg)
        setCoinFlipBackgroundDraft(
          parseCoinFlipBackgroundDraftFromAssetRef(cfBg),
        );
      const g2048Tiles = parsed?.game2048TilesDraft as Record<string, unknown> | undefined;
      if (g2048Tiles) setGame2048TilesDraft(parseGame2048TilesDraftFromAssetRef(g2048Tiles));
      const g2048Grid = parsed?.game2048GridDraft as Record<string, unknown> | undefined;
      if (g2048Grid) setGame2048GridDraft(parseGame2048GridDraftFromAssetRef(g2048Grid));
      const g2048Bg = parsed?.game2048BackgroundDraft as Record<string, unknown> | undefined;
      if (g2048Bg) setGame2048BackgroundDraft(parseGame2048BackgroundDraftFromAssetRef(g2048Bg));
      const chessBoard = parsed?.chessBoardDraft as Record<string, unknown> | undefined;
      if (chessBoard) setChessBoardDraft(parseChessBoardDraftFromAssetRef(chessBoard));
      const chessPieces = parsed?.chessPiecesDraft as Record<string, unknown> | undefined;
      if (chessPieces) setChessPiecesDraft(parseChessPiecesDraftFromAssetRef(chessPieces));
      const chessClock = parsed?.chessClockDraft as Record<string, unknown> | undefined;
      if (chessClock) setChessClockDraft(parseChessClockDraftFromAssetRef(chessClock));
      if (Array.isArray(parsed?.assetFields)) {
        setAssetFields(
          (parsed.assetFields as AssetField[])
            .filter((v): v is AssetField => !!v && typeof v === 'object')
            .slice(0, 80),
        );
      }
    } catch {
      // ignore malformed stored drafts
    } finally {
      setHasRestoredDraft(true);
    }
  }, []);

  useEffect(() => {
    if (!hasRestoredDraft) return;
    const payload = {
      itemDraft,
      snakeBodyDraft,
      snakeBoardDraft,
      snakeFoodDraft,
      typingThemeDraft,
      typingCaretDraft,
      typingFeedbackDraft,
      typingTextStyleDraft,
      eightBallCueDraft,
      eightBallTableDraft,
      eightBallBallsDraft,
      eightBallPlayercardDraft,
      tetrisBlocksDraft,
      tetrisBoardDraft,
      tetrisEffectsDraft,
      tetrisGhostDraft,
      coinFlipCoinDraft,
      coinFlipTrailDraft,
      coinFlipBackgroundDraft,
      game2048TilesDraft,
      game2048GridDraft,
      game2048BackgroundDraft,
      chessBoardDraft,
      chessPiecesDraft,
      chessClockDraft,
      assetFields,
      savedAt: Date.now(),
    };
    localStorage.setItem(
      SKIN_STUDIO_DRAFT_STORAGE_KEY,
      JSON.stringify(payload),
    );
  }, [
    assetFields,
    hasRestoredDraft,
    itemDraft,
    snakeBodyDraft,
    snakeBoardDraft,
    snakeFoodDraft,
    typingThemeDraft,
    typingCaretDraft,
    typingFeedbackDraft,
    typingTextStyleDraft,
    eightBallCueDraft,
    eightBallTableDraft,
    eightBallBallsDraft,
    eightBallPlayercardDraft,
    tetrisBlocksDraft,
    tetrisBoardDraft,
    tetrisEffectsDraft,
    tetrisGhostDraft,
    coinFlipCoinDraft,
    coinFlipTrailDraft,
    coinFlipBackgroundDraft,
    game2048TilesDraft,
    game2048GridDraft,
    game2048BackgroundDraft,
    chessBoardDraft,
    chessPiecesDraft,
    chessClockDraft,
  ]);

  // --- Data loading ---
  const loadState = async () => {
    setLoading(true);
    setError(null);
    setStatusMessage(null);
    try {
      const response = await fetch('/api/admin/skins', { cache: 'no-store' });
      const payload = (await response.json()) as ApiResponse;
      if (!response.ok)
        throw new Error(payload.error ?? 'Failed to load skin studio.');
      setItems(payload.items ?? []);
      setGroups(payload.groups ?? []);
      if (payload.metadata) setMetadata(payload.metadata);
      setLoadFailure(false);
    } catch (loadError) {
      setLoadFailure(true);
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadState();
  }, []);

  useEffect(() => {
    setItemDraft((prev) => {
      const slug = prev.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      const slotSlug = String(prev.slots[0] ?? 'item')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      const nextId = slug
        ? `${prev.gameType}-${slotSlug || 'item'}-${slug}`.slice(0, 64)
        : '';
      return prev.id === nextId ? prev : { ...prev, id: nextId };
    });
  }, [itemDraft.name, itemDraft.gameType, itemDraft.slots]);

  const editorKind = useMemo(() => resolveEditorKind(itemDraft), [itemDraft]);
  const isSnakeBodyItemDraft = editorKind === 'snake-body';
  const isSnakeBoardItemDraft = editorKind === 'snake-board';
  const isSnakeFoodItemDraft = editorKind === 'snake-food';
  const isTypingThemeItemDraft = editorKind === 'typing-theme';
  const isTypingCaretItemDraft = editorKind === 'typing-caret';
  const isTypingFeedbackItemDraft = editorKind === 'typing-feedback';
  const isTypingTextStyleItemDraft = editorKind === 'typing-text-style';
  const isFlappyBirdItemDraft = editorKind === 'flappy-bird';
  const isFlappyPipeItemDraft = editorKind === 'flappy-pipe';
  const isFlappyBackgroundItemDraft = editorKind === 'flappy-background';
  const isFlappyTrailItemDraft = editorKind === 'flappy-trail';
  const is8BallCueItemDraft = editorKind === '8ball-cue';
  const is8BallTableItemDraft = editorKind === '8ball-table';
  const is8BallBallsItemDraft = editorKind === '8ball-balls';
  const is8BallPlayercardItemDraft = editorKind === '8ball-playercard';
  const isTetrisBlocksItemDraft = editorKind === 'tetris-blocks';
  const isTetrisBoardItemDraft = editorKind === 'tetris-board';
  const isTetrisEffectsItemDraft = editorKind === 'tetris-effects';
  const isTetrisGhostItemDraft = editorKind === 'tetris-ghost';
  const isCoinFlipCoinItemDraft = editorKind === 'coinflip-coin';
  const isCoinFlipTrailItemDraft = editorKind === 'coinflip-trail';
  const isCoinFlipBackgroundItemDraft = editorKind === 'coinflip-background';
  const isGame2048TilesItemDraft = editorKind === '2048-tiles';
  const isGame2048GridItemDraft = editorKind === '2048-grid';
  const isGame2048BackgroundItemDraft = editorKind === '2048-background';
  const isChessBoardItemDraft = editorKind === 'chess-board';
  const isChessPiecesItemDraft = editorKind === 'chess-pieces';
  const isChessClockItemDraft = editorKind === 'chess-clock';
  const effectiveCurrencyType: CurrencyType = 'credits';

  const availableSlots = useMemo(
    () => metadata.slots[itemDraft.gameType] ?? [],
    [metadata.slots, itemDraft.gameType],
  );
  const linkedGroupsForDraft = useMemo(
    () =>
      itemDraft.id.trim()
        ? groups.filter((group) => group.itemIds.includes(itemDraft.id.trim()))
        : [],
    [groups, itemDraft.id],
  );
  const existingGroupOptions = useMemo(() => {
    const q = groupSearchQuery.trim().toLowerCase();
    return groups
      .filter(
        (group) =>
          !group.gameType ||
          group.gameType === itemDraft.gameType ||
          group.id === selectedExistingGroupId,
      )
      .filter((group) =>
        !q
          ? true
          : group.name.toLowerCase().includes(q) ||
            group.slug.toLowerCase().includes(q),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [groupSearchQuery, groups, itemDraft.gameType, selectedExistingGroupId]);
  const newGroupSlugPreview = useMemo(
    () =>
      toGameScopedGroupSlug(newGroupName, itemDraft.gameType) ||
      'auto-generated after name',
    [itemDraft.gameType, newGroupName],
  );

  useEffect(() => {
    if (availableSlots.length === 0) {
      setItemDraft((prev) =>
        prev.slots.length === 0 ? prev : { ...prev, slots: [] },
      );
      return;
    }
    const current = itemDraft.slots[0];
    if (!current || !availableSlots.includes(current)) {
      setItemDraft((prev) => ({ ...prev, slots: [availableSlots[0] ?? ''] }));
    }
  }, [availableSlots, itemDraft.slots]);

  useEffect(() => {
    if (itemGroupMode !== 'existing') return;
    if (existingGroupOptions.length === 0) {
      if (selectedExistingGroupId) setSelectedExistingGroupId('');
      return;
    }
    if (
      !existingGroupOptions.some(
        (group) => group.id === selectedExistingGroupId,
      )
    ) {
      setSelectedExistingGroupId(existingGroupOptions[0]?.id ?? '');
    }
  }, [existingGroupOptions, itemGroupMode, selectedExistingGroupId]);

  // --- Compose asset ref ---
  const composeAssetRefFromFields = useCallback(() => {
    const output: Record<string, unknown> = {};
    for (const field of assetFields) {
      const key = field.key.trim();
      if (!key) continue;
      if (field.type === 'boolean') output[key] = Boolean(field.value);
      else if (field.type === 'number') output[key] = Number(field.value || 0);
      else output[key] = String(field.value ?? '');
    }
    return output;
  }, [assetFields]);

  const slotAssetDrafts = useMemo<SlotAssetDrafts>(
    () => ({
      snakeBodyDraft,
      snakeBoardDraft,
      snakeFoodDraft,
      typingThemeDraft,
      typingCaretDraft,
      typingFeedbackDraft,
      typingTextStyleDraft,
      flappyBirdDraft,
      flappyPipeDraft,
      flappyBackgroundDraft,
      flappyTrailDraft,
      eightBallCueDraft,
      eightBallTableDraft,
      eightBallBallsDraft,
      eightBallPlayercardDraft,
      tetrisBlocksDraft,
      tetrisBoardDraft,
      tetrisEffectsDraft,
      tetrisGhostDraft,
      coinFlipCoinDraft,
      coinFlipTrailDraft,
      coinFlipBackgroundDraft,
      game2048TilesDraft,
      game2048GridDraft,
      game2048BackgroundDraft,
      chessBoardDraft,
      chessPiecesDraft,
      chessClockDraft,
    }),
    [
      snakeBodyDraft,
      snakeBoardDraft,
      snakeFoodDraft,
      typingThemeDraft,
      typingCaretDraft,
      typingFeedbackDraft,
      typingTextStyleDraft,
      flappyBirdDraft,
      flappyPipeDraft,
      flappyBackgroundDraft,
      flappyTrailDraft,
      eightBallCueDraft,
      eightBallTableDraft,
      eightBallBallsDraft,
      eightBallPlayercardDraft,
      tetrisBlocksDraft,
      tetrisBoardDraft,
      tetrisEffectsDraft,
      tetrisGhostDraft,
      coinFlipCoinDraft,
      coinFlipTrailDraft,
      coinFlipBackgroundDraft,
      game2048TilesDraft,
      game2048GridDraft,
      game2048BackgroundDraft,
      chessBoardDraft,
      chessPiecesDraft,
      chessClockDraft,
    ],
  );

  const editorPreviewAssetRef = useMemo(
    () =>
      composeAssetRefForEditorKind(
        editorKind,
        slotAssetDrafts,
        composeAssetRefFromFields,
      ),
    [editorKind, slotAssetDrafts, composeAssetRefFromFields],
  );

  const liveCreditsPricePreview = useMemo(
    () =>
      computeCreditsItemPriceForSkinStudio({
        rarity: itemDraft.rarity,
        slot: itemDraft.slots[0] ?? null,
        assetRef: editorPreviewAssetRef,
      }),
    [editorPreviewAssetRef, itemDraft.rarity, itemDraft.slots],
  );

  useEffect(() => {
    if (itemDraft.currencyType === effectiveCurrencyType) return;
    setItemDraft((prev) => ({ ...prev, currencyType: effectiveCurrencyType }));
  }, [effectiveCurrencyType, itemDraft.currencyType]);

  useEffect(() => {
    if (editorKind === 'generic') return;
    const nextAsset = composeAssetRefForEditorKind(
      editorKind,
      slotAssetDrafts,
      composeAssetRefFromFields,
    );
    const nextAssetText = JSON.stringify(nextAsset, null, 2);
    setItemDraft((prev) =>
      prev.assetRefText === nextAssetText
        ? prev
        : {
            ...prev,
            assetRefText: nextAssetText,
          },
    );
  }, [editorKind, slotAssetDrafts, composeAssetRefFromFields]);

  // --- Submit / Save ---
  const submitAction = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    setStatusMessage(null);
    try {
      const response = await fetch('/api/admin/skins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as ApiResponse;
      if (!response.ok) throw new Error(payload.error ?? 'Action failed.');
      setItems(payload.items ?? []);
      setGroups(payload.groups ?? []);
      if (payload.metadata) setMetadata(payload.metadata);
      if (payload.imported) {
        setStatusMessage(
          `Imported ${payload.imported.items} item(s) and ${payload.imported.groups} group(s).`,
        );
      }
      return true;
    } catch (submitError) {
      setError((submitError as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveItem = async () => {
    const savedItemId = itemDraft.id.trim();
    if (!savedItemId) {
      setError('Item ID is required. Add a name so the ID can be generated.');
      return;
    }
    const parsedAssetRef = composeAssetRefForEditorKind(
      editorKind,
      slotAssetDrafts,
      composeAssetRefFromFields,
    );
    const ok = await submitAction({
      action: 'upsert-item',
      id: itemDraft.id,
      previousId: isEditingExistingItem ? editingSourceItemId : undefined,
      name: itemDraft.name,
      gameType: itemDraft.gameType,
      rarity: itemDraft.rarity,
      currencyType: effectiveCurrencyType,
      price: liveCreditsPricePreview,
      slots: itemDraft.slots,
      active: itemDraft.active,
      assetRef: parsedAssetRef,
    });
    if (!ok) return;

    if (itemGroupMode === 'existing' && selectedExistingGroupId) {
      const targetGroup = groups.find(
        (group) => group.id === selectedExistingGroupId,
      );
      if (!targetGroup) {
        setError('Selected group was not found.');
        return;
      }
      const nextItemIds = removeFromSelectedGroup
        ? targetGroup.itemIds.filter((id) => id !== savedItemId)
        : Array.from(new Set([...targetGroup.itemIds, savedItemId]));
      const groupOk = await submitAction({
        action: 'upsert-group',
        id: targetGroup.id,
        name: targetGroup.name,
        slug: targetGroup.slug,
        description: targetGroup.description || null,
        gameType: targetGroup.gameType || null,
        active: targetGroup.active,
        itemIds: nextItemIds,
      });
      if (!groupOk) return;
      setStatusMessage(
        removeFromSelectedGroup
          ? `Saved item and removed it from "${targetGroup.name}".`
          : `Saved item and linked it to "${targetGroup.name}".`,
      );
    } else if (itemGroupMode === 'new' && newGroupName.trim()) {
      const trimmedName = newGroupName.trim();
      const computedSlug = toGameScopedGroupSlug(
        trimmedName,
        itemDraft.gameType,
      );
      if (!computedSlug) {
        setError('New group name is required.');
        return;
      }
      const groupOk = await submitAction({
        action: 'upsert-group',
        name: trimmedName,
        slug: computedSlug,
        description: null,
        gameType: itemDraft.gameType,
        active: true,
        itemIds: [savedItemId],
      });
      if (!groupOk) return;
      setStatusMessage(`Saved item and created group "${trimmedName}".`);
    } else {
      setStatusMessage(`Saved "${itemDraft.name}" to the catalog.`);
    }

    resetEditorDraft();
    router.push('/admin/skins');
  };

  const loadItemIntoEditor = (item: StoreItem) => {
    setEditorBaseline(null);
    setEditorInteracted(false);
    setRestoredNamedDraft(false);
    setIsEditingExistingItem(true);
    setEditingSourceItemId(item.id);
    setSnakeBodyDraft(parseSnakeBodyDraftFromAssetRef(item.assetRef));
    setSnakeBoardDraft(parseSnakeBoardDraftFromAssetRef(item.assetRef));
    setSnakeFoodDraft(parseSnakeFoodDraftFromAssetRef(item.assetRef));
    setTypingThemeDraft(parseTypingThemeDraftFromAssetRef(item.assetRef));
    setTypingCaretDraft(parseTypingCaretDraftFromAssetRef(item.assetRef));
    setTypingFeedbackDraft(parseTypingFeedbackDraftFromAssetRef(item.assetRef));
    setTypingTextStyleDraft(
      parseTypingTextStyleDraftFromAssetRef(item.assetRef),
    );
    setFlappyBirdDraft(parseFlappyBirdDraftFromAssetRef(item.assetRef));
    setFlappyPipeDraft(parseFlappyPipeDraftFromAssetRef(item.assetRef));
    setFlappyBackgroundDraft(
      parseFlappyBackgroundDraftFromAssetRef(item.assetRef),
    );
    setFlappyTrailDraft(parseFlappyTrailDraftFromAssetRef(item.assetRef));
    setEightBallCueDraft(parseEightBallCueDraftFromAssetRef(item.assetRef));
    setEightBallTableDraft(parseEightBallTableDraftFromAssetRef(item.assetRef));
    setEightBallBallsDraft(parseEightBallBallsDraftFromAssetRef(item.assetRef));
    setEightBallPlayercardDraft(
      parseEightBallPlayercardDraftFromAssetRef(item.assetRef),
    );
    setTetrisBlocksDraft(parseTetrisBlocksDraftFromAssetRef(item.assetRef));
    setTetrisBoardDraft(parseTetrisBoardDraftFromAssetRef(item.assetRef));
    setTetrisEffectsDraft(parseTetrisEffectsDraftFromAssetRef(item.assetRef));
    setTetrisGhostDraft(parseTetrisGhostDraftFromAssetRef(item.assetRef));
    setCoinFlipCoinDraft(parseCoinFlipCoinDraftFromAssetRef(item.assetRef));
    setCoinFlipTrailDraft(parseCoinFlipTrailDraftFromAssetRef(item.assetRef));
    setCoinFlipBackgroundDraft(
      parseCoinFlipBackgroundDraftFromAssetRef(item.assetRef),
    );
    setGame2048TilesDraft(parseGame2048TilesDraftFromAssetRef(item.assetRef));
    setGame2048GridDraft(parseGame2048GridDraftFromAssetRef(item.assetRef));
    setGame2048BackgroundDraft(parseGame2048BackgroundDraftFromAssetRef(item.assetRef));
    setChessBoardDraft(parseChessBoardDraftFromAssetRef(item.assetRef));
    setChessPiecesDraft(parseChessPiecesDraftFromAssetRef(item.assetRef));
    setChessClockDraft(parseChessClockDraftFromAssetRef(item.assetRef));
    setAssetFields(parseAssetFieldsFromAssetRef(item.assetRef));
    setItemDraft({
      id: item.id,
      name: item.name,
      gameType: item.gameType,
      rarity: item.rarity,
      currencyType: item.currencyType,
      price: item.price,
      slots: item.slots,
      active: item.active,
      assetRefText: JSON.stringify(item.assetRef ?? {}, null, 2),
    });
    const firstLinkedGroup = groups.find((group) =>
      group.itemIds.includes(item.id),
    );
    if (firstLinkedGroup) {
      setItemGroupMode('existing');
      setSelectedExistingGroupId(firstLinkedGroup.id);
      setRemoveFromSelectedGroup(false);
    } else {
      setItemGroupMode('none');
      setSelectedExistingGroupId('');
      setRemoveFromSelectedGroup(false);
    }
    setNewGroupName('');
    setGroupSearchQuery('');
    router.push('/admin/skins?tab=editor');
  };

  const resetEditorDraft = () => {
    setEditorBaseline(null);
    setEditorInteracted(false);
    setRestoredNamedDraft(false);
    const nextGameType =
      typeof itemDraft.gameType === 'string' && itemDraft.gameType.trim()
        ? itemDraft.gameType
        : INITIAL_ITEM_DRAFT.gameType;
    const gameSlots = metadata.slots[nextGameType] ?? [];
    const preferredSlot = itemDraft.slots[0] ?? '';
    const nextSlot =
      preferredSlot && gameSlots.includes(preferredSlot)
        ? preferredSlot
        : (gameSlots[0] ?? '');

    setIsEditingExistingItem(false);
    setEditingSourceItemId(null);
    setItemDraft({
      ...INITIAL_ITEM_DRAFT,
      gameType: nextGameType,
      slots: nextSlot ? [nextSlot] : [],
    });
    setSnakeBodyDraft({ ...DEFAULT_SNAKE_BODY_DRAFT });
    setSnakeBoardDraft({ ...DEFAULT_SNAKE_BOARD_DRAFT });
    setSnakeFoodDraft({ ...DEFAULT_SNAKE_FOOD_DRAFT });
    setTypingThemeDraft({ ...DEFAULT_TYPING_THEME_DRAFT });
    setTypingCaretDraft({ ...DEFAULT_TYPING_CARET_DRAFT });
    setTypingFeedbackDraft({ ...DEFAULT_TYPING_FEEDBACK_DRAFT });
    setTypingTextStyleDraft({ ...DEFAULT_TYPING_TEXT_STYLE_DRAFT });
    setFlappyBirdDraft({ ...DEFAULT_FLAPPY_BIRD_DRAFT });
    setFlappyPipeDraft({ ...DEFAULT_FLAPPY_PIPE_DRAFT });
    setFlappyBackgroundDraft({ ...DEFAULT_FLAPPY_BACKGROUND_DRAFT });
    setFlappyTrailDraft({ ...DEFAULT_FLAPPY_TRAIL_DRAFT });
    setEightBallCueDraft({ ...DEFAULT_EIGHT_BALL_CUE_DRAFT });
    setEightBallTableDraft({ ...DEFAULT_EIGHT_BALL_TABLE_DRAFT });
    setEightBallBallsDraft({ ...DEFAULT_EIGHT_BALL_BALLS_DRAFT });
    setEightBallPlayercardDraft({ ...DEFAULT_EIGHT_BALL_PLAYERCARD_DRAFT });
    setTetrisBlocksDraft({ ...DEFAULT_TETRIS_BLOCKS_DRAFT });
    setTetrisBoardDraft({ ...DEFAULT_TETRIS_BOARD_DRAFT });
    setTetrisEffectsDraft({ ...DEFAULT_TETRIS_EFFECTS_DRAFT });
    setTetrisGhostDraft({ ...DEFAULT_TETRIS_GHOST_DRAFT });
    setCoinFlipCoinDraft({ ...DEFAULT_COIN_FLIP_COIN_DRAFT });
    setCoinFlipTrailDraft({ ...DEFAULT_COIN_FLIP_TRAIL_DRAFT });
    setCoinFlipBackgroundDraft({ ...DEFAULT_COIN_FLIP_BACKGROUND_DRAFT });
    setGame2048TilesDraft({ ...DEFAULT_GAME_2048_TILES_DRAFT });
    setGame2048GridDraft({ ...DEFAULT_GAME_2048_GRID_DRAFT });
    setGame2048BackgroundDraft({ ...DEFAULT_GAME_2048_BACKGROUND_DRAFT });
    setChessBoardDraft({ ...DEFAULT_CHESS_BOARD_DRAFT });
    setChessPiecesDraft({ ...DEFAULT_CHESS_PIECES_DRAFT });
    setChessClockDraft({ ...DEFAULT_CHESS_CLOCK_DRAFT });
    setAssetFields([]);
    setItemGroupMode('none');
    setSelectedExistingGroupId('');
    setRemoveFromSelectedGroup(false);
    setNewGroupName('');
    setGroupSearchQuery('');
    localStorage.removeItem(SKIN_STUDIO_DRAFT_STORAGE_KEY);
  };

  const confirmDraftReplacement = (action: string) =>
    !hasEditorWork ||
    window.confirm(
      `Your current Skin Studio draft will be replaced if you ${action}. Continue?`,
    );

  const startNewItem = () => {
    if (!confirmDraftReplacement('start a new item')) return;
    resetEditorDraft();
    setError(null);
    setStatusMessage(null);
    router.push('/admin/skins?tab=editor');
  };

  const editItem = (item: StoreItem) => {
    if (isEditingExistingItem && editingSourceItemId === item.id) {
      router.push('/admin/skins?tab=editor');
      return;
    }
    if (!confirmDraftReplacement(`edit ${item.name}`)) return;
    loadItemIntoEditor(item);
    setError(null);
    setStatusMessage(null);
  };

  const resetEditor = () => {
    if (!confirmDraftReplacement('reset the editor')) return;
    resetEditorDraft();
    setError(null);
    setStatusMessage('Editor reset. Your saved catalog items were not changed.');
  };

  const downloadCatalogExport = async () => {
    setBusy(true);
    setError(null);
    setStatusMessage(null);
    try {
      const imagePaths = new Set<string>();
      for (const item of items) {
        collectStorageImagePaths(item.assetRef, imagePaths);
      }

      const assets: SkinStudioExportAsset[] = [];
      let failedAssets = 0;
      for (const path of imagePaths) {
        try {
          const response = await fetch(path, { cache: 'no-store' });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const blob = await response.blob();
          assets.push({
            path,
            mimeType: blob.type || 'application/octet-stream',
            fileName: fileNameFromPath(
              path,
              blob.type || 'application/octet-stream',
            ),
            base64Data: await toBase64(blob),
          });
        } catch {
          failedAssets += 1;
        }
      }

      const payload: SkinStudioExportFile = {
        format: 'skin-studio-export-v1',
        exportedAt: new Date().toISOString(),
        source: 'bespick-skin-studio',
        items,
        groups,
        assets: assets.length > 0 ? assets : undefined,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const dateStamp = new Date().toISOString().slice(0, 10);
      const link = document.createElement('a');
      link.href = url;
      link.download = `skin-studio-export-${dateStamp}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setStatusMessage(
        failedAssets > 0
          ? `Exported ${items.length} item(s), ${groups.length} group(s), ${assets.length} embedded image(s), and skipped ${failedAssets} image(s).`
          : `Exported ${items.length} item(s), ${groups.length} group(s), and ${assets.length} embedded image(s).`,
      );
    } catch (exportError) {
      setError(
        (exportError as Error).message || 'Failed to export catalog JSON.',
      );
    } finally {
      setBusy(false);
    }
  };

  const uploadCatalogImport = async (file: File) => {
    setError(null);
    setStatusMessage(null);
    try {
      const rawText = await file.text();
      const parsed = JSON.parse(rawText) as unknown;
      let importItems: unknown[] = [];
      let importGroups: unknown[] = [];
      let importAssets: SkinStudioExportAsset[] = [];

      if (Array.isArray(parsed)) {
        importItems = parsed;
      } else if (parsed && typeof parsed === 'object') {
        const value = parsed as Record<string, unknown>;
        if (
          value.format === 'skin-studio-export-v1' ||
          Array.isArray(value.items) ||
          Array.isArray(value.groups)
        ) {
          importItems = Array.isArray(value.items) ? value.items : [];
          importGroups = Array.isArray(value.groups) ? value.groups : [];
          importAssets = parseEmbeddedExportAssets(value.assets);
        } else if (
          typeof value.id === 'string' &&
          typeof value.name === 'string' &&
          typeof value.gameType === 'string'
        ) {
          importItems = [value];
        } else if (
          typeof value.name === 'string' &&
          typeof value.slug === 'string'
        ) {
          importGroups = [value];
        } else {
          throw new Error('Unsupported JSON format.');
        }
      } else {
        throw new Error('Unsupported JSON format.');
      }

      if (importItems.length === 0 && importGroups.length === 0) {
        throw new Error('Import file is empty.');
      }

      if (importAssets.length > 0) {
        const replacementByPath = new Map<string, string>();
        for (const asset of importAssets) {
          if (replacementByPath.has(asset.path)) continue;
          const originalBlob = fromBase64(asset.base64Data, asset.mimeType);
          if (originalBlob.size > MAX_STORAGE_UPLOAD_BYTES) {
            throw new Error(
              `Embedded image is too large: ${asset.path} (${formatBytes(originalBlob.size)}). Max upload size is ${formatBytes(MAX_STORAGE_UPLOAD_BYTES)}.`,
            );
          }

          let uploadBlob = await compressImageBlobForProxy(
            originalBlob,
            PROXY_SAFE_UPLOAD_BYTES,
          );
          let uploadType =
            uploadBlob.type || asset.mimeType || 'application/octet-stream';
          let uploadName =
            asset.fileName ||
            fileNameFromPath(asset.path, asset.mimeType) ||
            'skin-asset.bin';
          if (uploadBlob.type === 'image/webp') {
            uploadType = 'image/webp';
            uploadName = replaceExtension(uploadName, '.webp');
          }

          const uploadOnce = async (
            blob: Blob,
            type: string,
            fileName: string,
          ) => {
            const file = new File([blob], fileName, { type });
            const formData = new FormData();
            formData.append('file', file);
            const response = await fetch('/api/storage/upload', {
              method: 'POST',
              body: formData,
            });
            const payload = (await response.json().catch(() => null)) as {
              url?: string;
              error?: string;
            } | null;
            return { response, payload };
          };

          let uploadResult = await uploadOnce(
            uploadBlob,
            uploadType,
            uploadName,
          );

          if (
            uploadResult.response.status === 413 &&
            uploadBlob.size > 300 * 1024
          ) {
            // Retry once with a smaller target if the edge proxy limit is below ~1MB.
            uploadBlob = await compressImageBlobForProxy(
              uploadBlob,
              450 * 1024,
            );
            uploadType = uploadBlob.type || 'image/webp';
            if (uploadType === 'image/webp') {
              uploadName = replaceExtension(uploadName, '.webp');
            }
            uploadResult = await uploadOnce(uploadBlob, uploadType, uploadName);
          }

          if (!uploadResult.response.ok || !uploadResult.payload?.url) {
            if (uploadResult.response.status === 413) {
              throw new Error(
                `Upload rejected (413) for ${asset.path} after compression (${formatBytes(uploadBlob.size)}). Increase proxy upload limit (for nginx: client_max_body_size).`,
              );
            }
            throw new Error(
              uploadResult.payload?.error ??
                `Failed to restore embedded image asset: ${asset.path} (HTTP ${uploadResult.response.status || 'unknown'}).`,
            );
          }

          replacementByPath.set(asset.path, uploadResult.payload.url);
        }

        if (replacementByPath.size > 0 && importItems.length > 0) {
          importItems = importItems.map((itemRaw) => {
            if (
              !itemRaw ||
              typeof itemRaw !== 'object' ||
              Array.isArray(itemRaw)
            ) {
              return itemRaw;
            }
            const item = { ...(itemRaw as Record<string, unknown>) };
            const assetRef = item.assetRef;
            if (
              !assetRef ||
              typeof assetRef !== 'object' ||
              Array.isArray(assetRef)
            ) {
              return item;
            }
            item.assetRef = rewriteAssetRefImagePaths(
              assetRef,
              replacementByPath,
            ) as Record<string, unknown>;
            return item;
          });
        }
      }

      await submitAction({
        action: 'import-bundle',
        items: importItems,
        groups: importGroups,
      });
    } catch (importError) {
      setError(
        (importError as Error).message || 'Failed to import items from file.',
      );
    }
  };

  // --- Render ---
  return (
    <AdminConsoleFrame
      title='Skin Studio'
      subtitle='Manage the item catalog, then open a focused editor for each skin and its appearance.'
      actions={
        <>
          <ArcadeButton tone='primary' size='sm' disabled={busy || loading || loadFailure} onClick={startNewItem}>
            New item
          </ArcadeButton>
          <ArcadeButton tone='default' size='sm' disabled={busy || loading || loadFailure} onClick={() => uploadInputRef.current?.click()}>
            Import JSON
          </ArcadeButton>
          <ArcadeButton tone='default' size='sm' disabled={busy || loading || loadFailure} onClick={() => void downloadCatalogExport()}>
            Export JSON
          </ArcadeButton>
        </>
      }
      contentClassName='space-y-6'
    >
        {error ? (
          <div role='alert'><ArcadeNotice tone='danger'>Error: {error}</ArcadeNotice></div>
        ) : null}
        {loadFailure ? (
          <ArcadeButton tone='default' size='sm' disabled={loading || busy} onClick={() => void loadState()}>
            Retry loading catalog
          </ArcadeButton>
        ) : null}
        {statusMessage ? (
          <div role='status' aria-live='polite'><ArcadeNotice tone='success'>{statusMessage}</ArcadeNotice></div>
        ) : null}

        <div className='grid gap-3 sm:grid-cols-3'>
          <ConsoleMetric label='Catalog items' value={items.length} loading={loading} detail='All saved skins' />
          <ConsoleMetric label='In store pool' value={items.filter((item) => item.active).length} loading={loading} detail='Available to players' />
          <ConsoleMetric label='Groups' value={groups.length} loading={loading} detail='Item collections' />
        </div>
        <ConsoleTabs
          label='Skin Studio views'
          items={[
            { id: 'catalog', label: 'Catalog', href: '/admin/skins' },
            { id: 'editor', label: isEditingExistingItem ? 'Edit item' : 'Editor', href: '/admin/skins?tab=editor' },
          ]}
          active={activeTab}
        />

        <div
          className={activeTab === 'editor' ? 'space-y-5' : 'hidden'}
          inert={loading || busy || loadFailure}
          aria-busy={loading || busy}
          onChangeCapture={() => setEditorInteracted(true)}
          onClickCapture={() => setEditorInteracted(true)}
        >
        <ConsolePanel
          title='Basics & pricing'
          description={isEditingExistingItem
            ? `Editing ${itemDraft.name || 'item'} · Set its name, game, rarity, price, and store availability.`
            : 'Set the name, game, rarity, price, and store availability.'}
        >
          <div className='p-4 sm:p-5'>
          <ItemCoreForm
            itemDraft={itemDraft}
            setItemDraft={setItemDraft}
            metadata={metadata}
            liveCreditsPricePreview={liveCreditsPricePreview}
          />
          </div>
        </ConsolePanel>

        <ConsolePanel title='Grouping' description='Link this item to a collection or create a new one when you save.'>
          <div className='p-4 sm:p-5'>
          <ItemGroupingForm
            itemGroupMode={itemGroupMode}
            setItemGroupMode={setItemGroupMode}
            linkedGroupsForDraft={linkedGroupsForDraft}
            groupSearchQuery={groupSearchQuery}
            setGroupSearchQuery={setGroupSearchQuery}
            selectedExistingGroupId={selectedExistingGroupId}
            setSelectedExistingGroupId={setSelectedExistingGroupId}
            existingGroupOptions={existingGroupOptions}
            removeFromSelectedGroup={removeFromSelectedGroup}
            setRemoveFromSelectedGroup={setRemoveFromSelectedGroup}
            newGroupName={newGroupName}
            setNewGroupName={setNewGroupName}
            newGroupSlugPreview={newGroupSlugPreview}
          />
          </div>
        </ConsolePanel>

        <ConsolePanel title='Slot' description='Choose the part of the game this skin changes.'>
          <div className='p-4 sm:p-5'>
          <ItemSlotSelector
            itemDraft={itemDraft}
            setItemDraft={setItemDraft}
            availableSlots={availableSlots}
          />
          </div>
        </ConsolePanel>

        <ConsolePanel title='Appearance' description='Customize the selected slot and preview its visual options.'>
          <div className='space-y-4 p-4 sm:p-5'>
          {isSnakeBodyItemDraft ? (
            <SnakeBodyEditor
              itemDraft={itemDraft}
              snakeBodyDraft={snakeBodyDraft}
              setSnakeBodyDraft={setSnakeBodyDraft}
              editorPreviewAssetRef={editorPreviewAssetRef}
            />
          ) : null}

          {isSnakeBoardItemDraft ? (
            <SnakeBoardEditor
              itemDraft={itemDraft}
              snakeBoardDraft={snakeBoardDraft}
              setSnakeBoardDraft={setSnakeBoardDraft}
              editorPreviewAssetRef={editorPreviewAssetRef}
            />
          ) : null}

          {isSnakeFoodItemDraft ? (
            <SnakeFoodEditor
              itemDraft={itemDraft}
              snakeFoodDraft={snakeFoodDraft}
              setSnakeFoodDraft={setSnakeFoodDraft}
              editorPreviewAssetRef={editorPreviewAssetRef}
            />
          ) : null}

          {isTypingThemeItemDraft ? (
            <TypingThemeEditor
              itemDraft={itemDraft}
              typingThemeDraft={typingThemeDraft}
              setTypingThemeDraft={setTypingThemeDraft}
              editorPreviewAssetRef={editorPreviewAssetRef}
            />
          ) : null}

          {isTypingCaretItemDraft ? (
            <TypingCaretEditor
              itemDraft={itemDraft}
              typingCaretDraft={typingCaretDraft}
              setTypingCaretDraft={setTypingCaretDraft}
            />
          ) : null}

          {isTypingFeedbackItemDraft ? (
            <TypingFeedbackEditor
              itemDraft={itemDraft}
              typingFeedbackDraft={typingFeedbackDraft}
              setTypingFeedbackDraft={setTypingFeedbackDraft}
              editorPreviewAssetRef={editorPreviewAssetRef}
            />
          ) : null}

          {isTypingTextStyleItemDraft ? (
            <TypingTextStyleEditor
              itemDraft={itemDraft}
              typingTextStyleDraft={typingTextStyleDraft}
              setTypingTextStyleDraft={setTypingTextStyleDraft}
            />
          ) : null}

          {isFlappyBirdItemDraft ? (
            <FlappyBirdEditor
              itemDraft={itemDraft}
              flappyBirdDraft={flappyBirdDraft}
              setFlappyBirdDraft={setFlappyBirdDraft}
            />
          ) : null}

          {isFlappyPipeItemDraft ? (
            <FlappyPipeEditor
              itemDraft={itemDraft}
              flappyPipeDraft={flappyPipeDraft}
              setFlappyPipeDraft={setFlappyPipeDraft}
            />
          ) : null}

          {isFlappyBackgroundItemDraft ? (
            <FlappyBackgroundEditor
              itemDraft={itemDraft}
              flappyBackgroundDraft={flappyBackgroundDraft}
              setFlappyBackgroundDraft={setFlappyBackgroundDraft}
            />
          ) : null}

          {isFlappyTrailItemDraft ? (
            <FlappyTrailEditor
              itemDraft={itemDraft}
              flappyTrailDraft={flappyTrailDraft}
              setFlappyTrailDraft={setFlappyTrailDraft}
            />
          ) : null}

          {is8BallCueItemDraft ? (
            <EightBallCueEditor
              itemDraft={itemDraft}
              eightBallCueDraft={eightBallCueDraft}
              setEightBallCueDraft={setEightBallCueDraft}
            />
          ) : null}

          {is8BallTableItemDraft ? (
            <EightBallTableEditor
              itemDraft={itemDraft}
              eightBallTableDraft={eightBallTableDraft}
              setEightBallTableDraft={setEightBallTableDraft}
            />
          ) : null}

          {is8BallBallsItemDraft ? (
            <EightBallBallsEditor
              itemDraft={itemDraft}
              eightBallBallsDraft={eightBallBallsDraft}
              setEightBallBallsDraft={setEightBallBallsDraft}
            />
          ) : null}

          {is8BallPlayercardItemDraft ? (
            <EightBallPlayercardEditor
              itemDraft={itemDraft}
              eightBallPlayercardDraft={eightBallPlayercardDraft}
              setEightBallPlayercardDraft={setEightBallPlayercardDraft}
            />
          ) : null}

          {isTetrisBlocksItemDraft ? (
            <TetrisBlocksEditor
              itemDraft={itemDraft}
              tetrisBlocksDraft={tetrisBlocksDraft}
              setTetrisBlocksDraft={setTetrisBlocksDraft}
              editorPreviewAssetRef={editorPreviewAssetRef}
            />
          ) : null}

          {isTetrisBoardItemDraft ? (
            <TetrisBoardEditor
              itemDraft={itemDraft}
              tetrisBoardDraft={tetrisBoardDraft}
              setTetrisBoardDraft={setTetrisBoardDraft}
              editorPreviewAssetRef={editorPreviewAssetRef}
            />
          ) : null}

          {isTetrisEffectsItemDraft ? (
            <TetrisEffectsEditor
              itemDraft={itemDraft}
              tetrisEffectsDraft={tetrisEffectsDraft}
              setTetrisEffectsDraft={setTetrisEffectsDraft}
              editorPreviewAssetRef={editorPreviewAssetRef}
            />
          ) : null}

          {isTetrisGhostItemDraft ? (
            <TetrisGhostEditor
              itemDraft={itemDraft}
              tetrisGhostDraft={tetrisGhostDraft}
              setTetrisGhostDraft={setTetrisGhostDraft}
              editorPreviewAssetRef={editorPreviewAssetRef}
            />
          ) : null}

          {isCoinFlipCoinItemDraft ? (
            <CoinFlipCoinEditor
              itemDraft={itemDraft}
              coinFlipCoinDraft={coinFlipCoinDraft}
              setCoinFlipCoinDraft={setCoinFlipCoinDraft}
            />
          ) : null}

          {isCoinFlipTrailItemDraft ? (
            <CoinFlipTrailEditor
              itemDraft={itemDraft}
              coinFlipTrailDraft={coinFlipTrailDraft}
              setCoinFlipTrailDraft={setCoinFlipTrailDraft}
            />
          ) : null}

          {isCoinFlipBackgroundItemDraft ? (
            <CoinFlipBackgroundEditor
              itemDraft={itemDraft}
              coinFlipBackgroundDraft={coinFlipBackgroundDraft}
              setCoinFlipBackgroundDraft={setCoinFlipBackgroundDraft}
            />
          ) : null}

          {isGame2048TilesItemDraft ? (
            <Game2048TilesEditor
              itemDraft={itemDraft}
              game2048TilesDraft={game2048TilesDraft}
              setGame2048TilesDraft={setGame2048TilesDraft}
            />
          ) : null}

          {isGame2048GridItemDraft ? (
            <Game2048GridEditor
              itemDraft={itemDraft}
              game2048GridDraft={game2048GridDraft}
              setGame2048GridDraft={setGame2048GridDraft}
            />
          ) : null}

          {isGame2048BackgroundItemDraft ? (
            <Game2048BackgroundEditor
              itemDraft={itemDraft}
              game2048BackgroundDraft={game2048BackgroundDraft}
              setGame2048BackgroundDraft={setGame2048BackgroundDraft}
            />
          ) : null}

          {isChessBoardItemDraft ? (
            <ChessBoardEditor
              itemDraft={itemDraft}
              chessBoardDraft={chessBoardDraft}
              setChessBoardDraft={setChessBoardDraft}
            />
          ) : null}

          {isChessPiecesItemDraft ? (
            <ChessPiecesEditor
              itemDraft={itemDraft}
              chessPiecesDraft={chessPiecesDraft}
              setChessPiecesDraft={setChessPiecesDraft}
            />
          ) : null}

          {isChessClockItemDraft ? (
            <ChessClockEditor
              itemDraft={itemDraft}
              chessClockDraft={chessClockDraft}
              setChessClockDraft={setChessClockDraft}
            />
          ) : null}

          {!isSnakeBodyItemDraft &&
          !isSnakeBoardItemDraft &&
          !isSnakeFoodItemDraft &&
          !isTypingCaretItemDraft &&
          !isTypingFeedbackItemDraft &&
          !isTypingThemeItemDraft &&
          !isTypingTextStyleItemDraft &&
          !isFlappyBirdItemDraft &&
          !isFlappyPipeItemDraft &&
          !isFlappyBackgroundItemDraft &&
          !isFlappyTrailItemDraft &&
          !is8BallCueItemDraft &&
          !is8BallTableItemDraft &&
          !is8BallBallsItemDraft &&
          !is8BallPlayercardItemDraft &&
          !isTetrisBlocksItemDraft &&
          !isTetrisBoardItemDraft &&
          !isTetrisEffectsItemDraft &&
          !isTetrisGhostItemDraft &&
          !isCoinFlipCoinItemDraft &&
          !isCoinFlipTrailItemDraft &&
          !isCoinFlipBackgroundItemDraft &&
          !isGame2048TilesItemDraft &&
          !isGame2048GridItemDraft &&
          !isGame2048BackgroundItemDraft &&
          !isChessBoardItemDraft &&
          !isChessPiecesItemDraft &&
          !isChessClockItemDraft ? (
            <AssetFieldsEditor
              assetFields={assetFields}
              setAssetFields={setAssetFields}
            />
          ) : null}
          </div>
        </ConsolePanel>
        <div className='sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-soft bg-panel/95 p-4 shadow-lg backdrop-blur lg:bottom-0'>
          <p className='text-xs text-faint'>
            {isEditingExistingItem ? 'Save updates to this catalog item.' : 'Save to add this item to the catalog.'}
          </p>
          <div className='flex flex-wrap gap-2'>
          <ArcadeButton
            tone='primary'
            disabled={busy || loading || loadFailure}
            onClick={saveItem}
          >
            {busy ? 'Saving…' : 'Save item'}
          </ArcadeButton>
          <ArcadeButton
            tone='default'
            size='sm'
            disabled={busy || loading || loadFailure}
            onClick={resetEditor}
          >
            Reset editor
          </ArcadeButton>
          </div>
        </div>
        </div>
        <div className={activeTab === 'catalog' ? '' : 'hidden'}>

        <AdminCatalogPanel
          title='Item Catalog'
          loading={loading}
          items={items}
          groups={groups}
          allowedGameTypes={metadata.gameTypes}
          presentation='console'
          busy={busy || loading || loadFailure}
          rowActions={(item) => (
            <div className='flex flex-wrap items-center gap-2'>
              <ArcadeButton
                tone='ghost'
                size='xs'
                onClick={() => editItem(item)}
              >
                Edit
              </ArcadeButton>
              <ArcadeButton
                tone='default'
                size='xs'
                disabled={busy || loading || loadFailure}
                onClick={() =>
                  void submitAction({
                    action: 'set-item-active',
                    itemId: item.id,
                    active: item.active === false,
                  })
                }
              >
                {item.active === false ? 'Push To Store' : 'Move To Catalog'}
              </ArcadeButton>
            </div>
          )}
        />
        </div>
        <input
          ref={uploadInputRef}
          type='file'
          accept='application/json,.json'
          className='sr-only'
          tabIndex={-1}
          aria-label='Import Skin Studio JSON'
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            void uploadCatalogImport(file);
            event.currentTarget.value = '';
          }}
        />
    </AdminConsoleFrame>
  );
}

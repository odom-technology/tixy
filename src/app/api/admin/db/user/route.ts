import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { withAdmin } from '@/server/admin/guard';
import { getAccountById } from '@/server/accounts';
import { logSecurityEvent } from '@/lib/secure-logger';
import { query, queryOne } from '@/server/db/client';
import { broadcast } from '@/server/events';
import { getUserOwnedStoreItems } from '@/server/arcade/rewards/store';
import {
  clearRecentFlagRestriction,
  getAntiCheatPlayRestriction,
} from '@/server/arcade/anti-cheat-logs';
import {
  clearGameBan,
  getGameBanStatus,
  MAX_BAN_HOURS,
  MAX_BAN_MINUTES,
  setGameBan,
} from '@/server/arcade/game-bans';
import {
  adjustCurrencyByAdmin,
  getStoreCatalog,
  getUserInventoryAndEquipped,
  getWalletForUser,
  grantStoreItem,
  removeStoreItemOwnership,
} from '@/server/arcade/rewards';
import { getUserGameTimeMetrics } from '@/server/arcade/game-time-metrics';

const tableToGameType: Record<string, string> = {
  snake_scores: 'snake',
  flappy_bird_scores: 'flappy-bird',
  reaction_time_scores: 'reaction-time',
  typing_test_scores: 'typing-test',
  coin_flip_scores: 'coin-flip',
  connections_scores: 'connections',
  pool_stats: '8-ball',
  pool_elo: '8-ball',
  tetris_scores: 'tetris',
};

type DbRow = Record<string, unknown>;

export const dynamic = 'force-dynamic';

export const GET = withAdmin(async (request) => {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  if (!userId || typeof userId !== 'string') {
    return NextResponse.json({ error: 'userId required' }, { status: 400 });
  }

  try {
    if (searchParams.get('view') === 'gift') {
      const recipientUserId = userId.trim();
      if (!recipientUserId) {
        return NextResponse.json({ error: 'userId required' }, { status: 400 });
      }
      const recipient = await getAccountById(recipientUserId);
      if (!recipient) {
        return NextResponse.json({ error: 'User not found.' }, { status: 404 });
      }
      if (recipient.status === 'deleted') {
        return NextResponse.json(
          { error: 'Items cannot be granted to deleted accounts.' },
          { status: 400 },
        );
      }

      // Gift pickers need catalog/ownership only. The full inventory helper
      // initializes wallets and loads reward progress, so avoid it for this read.
      const [storeCatalog, ownedItems] = await Promise.all([
        getStoreCatalog(),
        getUserOwnedStoreItems(recipientUserId),
      ]);
      return NextResponse.json({ userId: recipientUserId, storeCatalog, ownedItems });
    }

    // Fetch user data from all game tables
    const snakeScores = (
      await query<DbRow>(
        'SELECT * FROM snake_scores WHERE od_user_id = $1 ORDER BY created_at DESC',
        [userId],
      )
    ).rows;
    const flappyBirdScores = (
      await query<DbRow>(
        'SELECT * FROM flappy_bird_scores WHERE od_user_id = $1 ORDER BY created_at DESC',
        [userId],
      )
    ).rows;
    const reactionTimeScores = (
      await query<DbRow>(
        'SELECT * FROM reaction_time_scores WHERE od_user_id = $1 ORDER BY created_at DESC',
        [userId],
      )
    ).rows;
    const typingTestScores = (
      await query<DbRow>(
        'SELECT * FROM typing_test_scores WHERE od_user_id = $1 ORDER BY created_at DESC',
        [userId],
      )
    ).rows;
    const poolStats = await queryOne<DbRow>(
      'SELECT * FROM pool_stats WHERE user_id = $1 LIMIT 1',
      [userId],
    );
    const poolElo = await queryOne<DbRow>(
      'SELECT * FROM pool_elo WHERE user_id = $1 LIMIT 1',
      [userId],
    );

    const tetrisScores = (
      await query<DbRow>(
        'SELECT * FROM tetris_scores WHERE od_user_id = $1 ORDER BY created_at DESC',
        [userId],
      )
    ).rows;
    const coinFlipScores = (
      await query<DbRow>(
        'SELECT * FROM coin_flip_scores WHERE od_user_id = $1 ORDER BY created_at DESC',
        [userId],
      )
    ).rows;
    const connectionsScores = (
      await query<DbRow>(
        'SELECT * FROM connections_scores WHERE od_user_id = $1 ORDER BY created_at DESC',
        [userId],
      )
    ).rows;

    const gameBan = await getGameBanStatus(userId);
    const antiCheatRestriction = await getAntiCheatPlayRestriction(userId);
    const wallet = await getWalletForUser(userId);
    const rewards = await getUserInventoryAndEquipped(userId);
    const storeCatalog = await getStoreCatalog();
    const gameTimeMetrics = await getUserGameTimeMetrics(userId);

    return NextResponse.json({
      userId,
      snakeScores,
      flappyBirdScores,
      reactionTimeScores,
      typingTestScores,
      tetrisScores,
      coinFlipScores,
      connectionsScores,
      poolStats: poolStats ?? null,
      poolElo: poolElo ?? null,
      gameBan,
      antiCheatRestriction,
      wallet,
      gameTimeMetrics,
      ownedItems: rewards.ownedItems,
      equippedItems: rewards.equipped,
      storeCatalog,
    });
  } catch (error) {
    console.error('Failed to fetch user data:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
});

export const POST = withAdmin(async (request, { identity }) => {
  try {
    const body = (await request.json()) as {
      userId?: string;
      table?: string;
      id?: string;
      updates?: Record<string, unknown>;
      action?:
        | 'ban'
        | 'unban'
        | 'currency-adjust'
        | 'grant-item'
        | 'remove-item';
      banHours?: number;
      banMinutes?: number;
      banIndefinite?: boolean;
      currencyType?: 'credits';
      amount?: number;
      reason?: string;
      itemId?: string;
      grantToAll?: boolean;
      removeFromAll?: boolean;
    };
    const {
      userId,
      table,
      id,
      updates,
      action,
      banHours,
      banMinutes,
      banIndefinite,
      currencyType,
      amount,
      reason,
      itemId,
      grantToAll,
      removeFromAll,
    } = body;
    if (
      action === 'grant-item' &&
      grantToAll !== undefined &&
      typeof grantToAll !== 'boolean'
    ) {
      return NextResponse.json(
        { error: 'grantToAll must be a boolean.' },
        { status: 400 },
      );
    }
    if (
      !userId &&
      !(
        (action === 'grant-item' && grantToAll === true) ||
        (action === 'remove-item' && removeFromAll)
      )
    ) {
      return NextResponse.json(
        { error: 'userId required' },
        { status: 400 },
      );
    }

    if (action === 'ban') {
      if (!userId) {
        return NextResponse.json({ error: 'userId required' }, { status: 400 });
      }
      if (reason !== undefined && reason !== null && typeof reason !== 'string') {
        return NextResponse.json({ error: 'reason must be a string.' }, { status: 400 });
      }
      const banReason = typeof reason === 'string' ? reason.trim() : '';
      if (banReason.length > 500) {
        return NextResponse.json(
          { error: 'reason must be 500 characters or fewer.' },
          { status: 400 },
        );
      }
      const parsedHours = Number.isFinite(banHours) ? Math.floor(banHours!) : 0;
      const parsedMinutes = Number.isFinite(banMinutes)
        ? Math.floor(banMinutes!)
        : 0;
      const indefinite = Boolean(banIndefinite);
      if (!indefinite) {
        if (
          parsedHours < 0 ||
          parsedHours > MAX_BAN_HOURS ||
          parsedMinutes < 0 ||
          parsedMinutes > MAX_BAN_MINUTES
        ) {
          return NextResponse.json(
            {
              error: `Ban duration must be between 0-${MAX_BAN_HOURS} hours and 0-${MAX_BAN_MINUTES} minutes.`,
            },
            { status: 400 },
          );
        }
      }
      await setGameBan({
        userId,
        bannedBy: identity.userId,
        hours: parsedHours,
        minutes: parsedMinutes,
        indefinite,
        reason: banReason,
      });
      return NextResponse.json({ success: true, gameBan: await getGameBanStatus(userId) });
    }

    if (action === 'unban') {
      if (!userId) {
        return NextResponse.json({ error: 'userId required' }, { status: 400 });
      }
      await clearGameBan(userId);
      const clearedFlagEntries = await clearRecentFlagRestriction(userId);
      return NextResponse.json({
        success: true,
        gameBan: await getGameBanStatus(userId),
        antiCheatRestriction: await getAntiCheatPlayRestriction(userId),
        clearedFlagEntries,
      });
    }

    if (action === 'currency-adjust') {
      if (!userId) {
        return NextResponse.json({ error: 'userId required' }, { status: 400 });
      }
      if (currencyType !== 'credits') {
        return NextResponse.json(
          { error: 'Only Tickets can be adjusted.' },
          { status: 400 },
        );
      }
      const normalizedAmount = Number(amount);
      if (!Number.isInteger(normalizedAmount) || normalizedAmount === 0) {
        return NextResponse.json(
          { error: 'amount must be a non-zero integer.' },
          { status: 400 },
        );
      }
      if (!reason || !reason.trim()) {
        return NextResponse.json({ error: 'reason is required' }, { status: 400 });
      }
      const mutation = await adjustCurrencyByAdmin({
        userId,
        currencyType: 'credits',
        amount: normalizedAmount,
        reason,
        actorUserId: identity.userId,
      });
      return NextResponse.json({
        success: true,
        mutation,
        wallet: await getWalletForUser(userId),
      });
    }

    if (action === 'grant-item') {
      if (!itemId || !itemId.trim()) {
        return NextResponse.json({ error: 'itemId is required.' }, { status: 400 });
      }
      const isGlobalGrant = grantToAll === true;
      const recipientUserId = isGlobalGrant
        ? userId
        : typeof userId === 'string'
          ? userId.trim()
          : undefined;
      if (!isGlobalGrant) {
        if (!recipientUserId) {
          return NextResponse.json({ error: 'userId required' }, { status: 400 });
        }
        const recipient = await getAccountById(recipientUserId);
        if (!recipient) {
          return NextResponse.json({ error: 'User not found.' }, { status: 404 });
        }
        if (recipient.status === 'deleted') {
          return NextResponse.json(
            { error: 'Items cannot be granted to deleted accounts.' },
            { status: 400 },
          );
        }
      }
      const grantResult = await grantStoreItem({
        itemId: itemId.trim(),
        userId: recipientUserId ?? undefined,
        grantToAll: isGlobalGrant,
        actorUserId: identity.userId,
      });
      const userRewards = recipientUserId
        ? await getUserInventoryAndEquipped(recipientUserId)
        : null;
      return NextResponse.json({
        success: true,
        grantResult,
        wallet: recipientUserId ? await getWalletForUser(recipientUserId) : null,
        ownedItems: userRewards?.ownedItems ?? [],
        equippedItems: userRewards?.equipped ?? [],
      });
    }

    if (action === 'remove-item') {
      if (!itemId || !itemId.trim()) {
        return NextResponse.json({ error: 'itemId is required.' }, { status: 400 });
      }
      const removalResult = await removeStoreItemOwnership({
        itemId: itemId.trim(),
        userId: userId ?? undefined,
        removeFromAll: Boolean(removeFromAll),
      });
      const userRewards = userId ? await getUserInventoryAndEquipped(userId) : null;
      return NextResponse.json({
        success: true,
        removalResult,
        wallet: userId ? await getWalletForUser(userId) : null,
        ownedItems: userRewards?.ownedItems ?? [],
        equippedItems: userRewards?.equipped ?? [],
      });
    }

    if (!table || !updates) {
      return NextResponse.json(
        { error: 'table and updates required for score updates' },
        { status: 400 },
      );
    }

    // Basic safety: only allow specific tables and columns
    const allowedTables = [
      'snake_scores',
      'flappy_bird_scores',
      'reaction_time_scores',
      'typing_test_scores',
      'tetris_scores',
      'coin_flip_scores',
      'connections_scores',
      'pool_stats',
      'pool_elo',
    ];
    if (!allowedTables.includes(table)) {
      return NextResponse.json({ error: 'Table not allowed' }, { status: 400 });
    }

    // Build SET clause dynamically but only allow known columns
    const allowedColumns = {
      snake_scores: ['score', 'user_name'],
      flappy_bird_scores: ['score', 'user_name'],
      reaction_time_scores: [
        'score',
        'user_name',
        'average_time',
        'best_time',
        'attempts',
      ],
      typing_test_scores: [
        'wpm',
        'raw_wpm',
        'accuracy',
        'mode',
        'correct_chars',
        'incorrect_chars',
        'total_chars',
        'words_completed',
        'user_name',
      ],
      tetris_scores: ['score', 'level', 'lines', 'best_lines', 'best_lines_score', 'best_lines_level', 'total_games', 'total_lines', 'total_play_time_ms', 'user_name'],
      coin_flip_scores: ['streak', 'user_name'],
      connections_scores: ['puzzle_date', 'mistakes', 'time_seconds', 'solved', 'user_name'],
      pool_stats: [
        'wins',
        'losses',
        'forfeits',
        'current_streak',
        'best_streak',
        'total_shots',
        'total_balls_pocketed',
        'user_name',
      ],
      pool_elo: [
        'elo_rating',
        'total_wins',
        'total_losses',
        'total_games',
        'peak_elo',
        'last_played',
        'user_name',
      ],
    };
    const cols = allowedColumns[table as keyof typeof allowedColumns];
    if (table === 'typing_test_scores') {
      const parsedMode = Number(updates.mode);
      if (parsedMode !== 15 && parsedMode !== 30 && parsedMode !== 60) {
        return NextResponse.json(
          { error: 'Typing Test mode must be 15, 30, or 60.' },
          { status: 400 },
        );
      }
    }
    if (table === 'connections_scores') {
      const puzzleDate = String(updates.puzzle_date ?? '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(puzzleDate)) {
        return NextResponse.json(
          { error: 'Connections puzzle_date must be YYYY-MM-DD.' },
          { status: 400 },
        );
      }
    }

    const toNonNegativeInt = (
      value: unknown,
      fallback = 0,
    ) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.max(0, Math.trunc(parsed));
    };

    if (table === 'pool_stats') {
      const now = Date.now();
      const next = {
        user_name:
          typeof updates.user_name === 'string' && updates.user_name.trim()
            ? updates.user_name.trim()
            : identity.name?.trim() || 'Unknown User',
        wins: toNonNegativeInt(updates.wins),
        losses: toNonNegativeInt(updates.losses),
        forfeits: toNonNegativeInt(updates.forfeits),
        current_streak: toNonNegativeInt(updates.current_streak),
        best_streak: toNonNegativeInt(updates.best_streak),
        total_shots: toNonNegativeInt(updates.total_shots),
        total_balls_pocketed: toNonNegativeInt(updates.total_balls_pocketed),
        updated_at: now,
      };

      const info = await query(
        `INSERT INTO pool_stats (
          user_id, user_name, wins, losses, forfeits, current_streak,
          best_streak, total_shots, total_balls_pocketed, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT(user_id) DO UPDATE SET
          user_name = excluded.user_name,
          wins = excluded.wins,
          losses = excluded.losses,
          forfeits = excluded.forfeits,
          current_streak = excluded.current_streak,
          best_streak = excluded.best_streak,
          total_shots = excluded.total_shots,
          total_balls_pocketed = excluded.total_balls_pocketed,
          updated_at = excluded.updated_at`,
        [
          userId,
          next.user_name,
          next.wins,
          next.losses,
          next.forfeits,
          next.current_streak,
          next.best_streak,
          next.total_shots,
          next.total_balls_pocketed,
          next.updated_at,
        ],
      );

      broadcast('gameLeaderboards', { gameType: '8-ball', updatedAt: now });
      return NextResponse.json({ changes: info.rowCount ?? 0, upserted: true });
    }

    if (table === 'pool_elo') {
      const now = Date.now();
      const totalWins = toNonNegativeInt(updates.total_wins);
      const totalLosses = toNonNegativeInt(updates.total_losses);
      const parsedTotalGames = Number(updates.total_games);
      const totalGames = Number.isFinite(parsedTotalGames)
        ? Math.max(0, Math.trunc(parsedTotalGames))
        : totalWins + totalLosses;
      const eloRating = toNonNegativeInt(updates.elo_rating, 1200);
      const peakElo = Math.max(
        toNonNegativeInt(updates.peak_elo, eloRating),
        eloRating,
      );
      const lastPlayedRaw = Number(updates.last_played);
      const lastPlayed = Number.isFinite(lastPlayedRaw) && lastPlayedRaw > 0
        ? Math.trunc(lastPlayedRaw)
        : null;
      const userName =
        typeof updates.user_name === 'string' && updates.user_name.trim()
          ? updates.user_name.trim()
          : identity.name?.trim() || 'Unknown User';

      const info = await query(
        `INSERT INTO pool_elo (
          user_id, user_name, elo_rating, total_wins, total_losses,
          total_games, peak_elo, last_played, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT(user_id) DO UPDATE SET
          user_name = excluded.user_name,
          elo_rating = excluded.elo_rating,
          total_wins = excluded.total_wins,
          total_losses = excluded.total_losses,
          total_games = excluded.total_games,
          peak_elo = excluded.peak_elo,
          last_played = excluded.last_played`,
        [
          userId,
          userName,
          eloRating,
          totalWins,
          totalLosses,
          totalGames,
          peakElo,
          lastPlayed,
          now,
        ],
      );

      broadcast('gameLeaderboards', { gameType: '8-ball', updatedAt: now });
      return NextResponse.json({ changes: info.rowCount ?? 0, upserted: true });
    }

    const normalizedUpdates: Record<string, unknown> =
      table === 'typing_test_scores'
        ? (() => {
            const parsedMode = Number(updates.mode) as 15 | 30 | 60;
            const wpm = Math.max(0, Math.trunc(Number(updates.wpm) || 0));
            const accuracy = Math.max(
              0,
              Math.min(100, Number(updates.accuracy) || 0),
            );
            const wordsCompleted = Math.max(
              0,
              Math.round(
                Number(updates.words_completed) ||
                  (wpm * parsedMode) / 60,
              ),
            );
            const correctChars = Math.max(
              0,
              Math.round(
                Number(updates.correct_chars) || wordsCompleted * 5,
              ),
            );
            const incorrectChars = Math.max(
              0,
              Math.round(Number(updates.incorrect_chars) || 0),
            );
            const totalChars = Math.max(
              correctChars + incorrectChars,
              Math.round(Number(updates.total_chars) || 0),
            );

            return {
              ...updates,
              mode: parsedMode,
              wpm,
              raw_wpm: Math.max(
                0,
                Math.trunc(Number(updates.raw_wpm) || wpm),
              ),
              accuracy: Number(accuracy.toFixed(1)),
              correct_chars: correctChars,
              incorrect_chars: incorrectChars,
              total_chars: totalChars,
              words_completed: wordsCompleted,
            };
          })()
        : table === 'coin_flip_scores'
          ? (() => {
              const streak = toNonNegativeInt(updates.streak);
              return {
                ...updates,
                streak,
              };
            })()
          : table === 'connections_scores'
            ? (() => {
                const puzzleDate = String(updates.puzzle_date ?? '').trim();
                const mistakes = toNonNegativeInt(updates.mistakes);
                const timeSeconds = Math.max(0, Number(updates.time_seconds) || 0);
                const solved = Number(updates.solved) ? 1 : 0;
                return {
                  ...updates,
                  puzzle_date: puzzleDate,
                  mistakes,
                  time_seconds: Number(timeSeconds.toFixed(2)),
                  solved,
                };
              })()
            : updates;
    const setKeys = Object.keys(normalizedUpdates).filter((k) =>
      cols.includes(k),
    );
    const setParts = setKeys
      .map((k, index) => `${k} = $${index + 1}`)
      .join(', ');
    if (!setParts) {
      return NextResponse.json(
        { error: 'No valid columns to update' },
        { status: 400 },
      );
    }

    const values = setKeys.map((k) => normalizedUpdates[k]);

    if (!id) {
      const requiredColumns = {
        snake_scores: ['score', 'user_name'],
        flappy_bird_scores: ['score', 'user_name'],
        reaction_time_scores: [
          'score',
          'user_name',
          'average_time',
          'best_time',
          'attempts',
        ],
        typing_test_scores: [
          'wpm',
          'raw_wpm',
          'accuracy',
          'mode',
          'correct_chars',
          'incorrect_chars',
          'total_chars',
          'words_completed',
          'user_name',
        ],
        coin_flip_scores: ['streak', 'user_name'],
        connections_scores: [
          'puzzle_date',
          'mistakes',
          'time_seconds',
          'solved',
          'user_name',
        ],
      } as const;
      const required = requiredColumns[table as keyof typeof requiredColumns];
      const missing = required.filter(
        (key) =>
          normalizedUpdates[key] === undefined || normalizedUpdates[key] === null,
      );
      if (missing.length > 0) {
        return NextResponse.json(
          { error: `Missing required fields: ${missing.join(', ')}` },
          { status: 400 },
        );
      }
      const existing = await queryOne<{ id?: string }>(
        table === 'typing_test_scores'
          ? `SELECT id FROM ${table} WHERE od_user_id = $1 AND mode = $2 LIMIT 1`
          : table === 'connections_scores'
            ? `SELECT id FROM ${table} WHERE od_user_id = $1 AND puzzle_date = $2 LIMIT 1`
            : `SELECT id FROM ${table} WHERE od_user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        table === 'typing_test_scores'
          ? [userId, normalizedUpdates.mode]
          : table === 'connections_scores'
            ? [userId, normalizedUpdates.puzzle_date]
            : [userId],
      );

      if (existing?.id) {
        const info = await query(
          `UPDATE ${table} SET ${setParts} WHERE id = $${values.length + 1} AND od_user_id = $${values.length + 2}`,
          [...values, existing.id, userId],
        );
        if (table === 'coin_flip_scores') {
          await query(
            `UPDATE coin_flip_scores
             SET
               chosen_side = 'mixed',
               total_games_played = CASE
                 WHEN total_games_played > 0 THEN total_games_played
                 ELSE 1
               END,
               total_correct_flips = CASE
                 WHEN total_correct_flips >= streak THEN total_correct_flips
                 ELSE streak
               END,
               total_flips = CASE
                 WHEN total_flips >= streak + 1 THEN total_flips
                 ELSE streak + 1
               END
             WHERE id = $1 AND od_user_id = $2`,
            [existing.id, userId],
          );
        }
        const updateGameType = tableToGameType[table];
        if (updateGameType) {
          broadcast('gameLeaderboards', {
            gameType: updateGameType,
            updatedAt: Date.now(),
          });
        }
        return NextResponse.json({ changes: info.rowCount ?? 0, updated: true });
      }

      const insertableUpdates: Record<string, unknown> =
        table === 'coin_flip_scores'
          ? (() => {
              const streak = toNonNegativeInt(normalizedUpdates.streak);
              const totalGamesPlayed = Math.max(
                1,
                toNonNegativeInt(normalizedUpdates.total_games_played),
              );
              const totalCorrectFlips = Math.max(
                streak,
                toNonNegativeInt(normalizedUpdates.total_correct_flips),
              );
              const totalFlips = Math.max(
                streak + 1,
                toNonNegativeInt(normalizedUpdates.total_flips),
              );
              return {
                ...normalizedUpdates,
                streak,
                chosen_side: 'mixed',
                total_games_played: totalGamesPlayed,
                total_correct_flips: totalCorrectFlips,
                total_flips: totalFlips,
              };
            })()
          : normalizedUpdates;

      const insertColumns = [
        'id',
        'od_user_id',
        ...Object.keys(insertableUpdates).filter((k) => cols.includes(k) || k === 'chosen_side'),
        'created_at',
      ];
      const insertValues = [
        randomUUID(),
        userId,
        ...Object.keys(insertableUpdates)
          .filter((k) => cols.includes(k) || k === 'chosen_side')
          .map((k) => insertableUpdates[k]),
        Date.now(),
      ];
      const placeholders = insertColumns
        .map((_, index) => `$${index + 1}`)
        .join(', ');
      const info = await query(
        `INSERT INTO ${table} (${insertColumns.join(', ')}) VALUES (${placeholders})`,
        insertValues,
      );

      // Broadcast leaderboard update so clients refresh
      const insertGameType = tableToGameType[table];
      if (insertGameType) {
        broadcast('gameLeaderboards', {
          gameType: insertGameType,
          updatedAt: Date.now(),
        });
      }

      return NextResponse.json({ changes: info.rowCount ?? 0, inserted: true });
    }

    const info = await query(
      `UPDATE ${table} SET ${setParts} WHERE id = $${values.length + 1} AND od_user_id = $${values.length + 2}`,
      [...values, id, userId],
    );
    if (table === 'coin_flip_scores') {
      await query(
        `UPDATE coin_flip_scores
         SET
           chosen_side = 'mixed',
           total_games_played = CASE
             WHEN total_games_played > 0 THEN total_games_played
             ELSE 1
           END,
           total_correct_flips = CASE
             WHEN total_correct_flips >= streak THEN total_correct_flips
             ELSE streak
           END,
           total_flips = CASE
             WHEN total_flips >= streak + 1 THEN total_flips
             ELSE streak + 1
           END
         WHERE id = $1 AND od_user_id = $2`,
        [id, userId],
      );
    }

    // Broadcast leaderboard update so clients refresh
    const gameType = tableToGameType[table];
    if (gameType) {
      broadcast('gameLeaderboards', { gameType, updatedAt: Date.now() });
    }

    return NextResponse.json({ changes: info.rowCount ?? 0 });
  } catch (error) {
    console.error('Failed to update user data:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}, {
  audit: ({ body }) => {
    const input = (body ?? {}) as Record<string, unknown>;
    const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
    const userId = str(input.userId);
    const itemId = str(input.itemId);
    const reason = str(input.reason);
    const user = { targetType: 'user', targetId: userId };
    switch (input.action) {
      case 'ban':
        return {
          action: 'user.ban',
          ...user,
          reason,
          details: {
            userId,
            banHours: input.banHours,
            banMinutes: input.banMinutes,
            banIndefinite: input.banIndefinite,
          },
        };
      case 'unban':
        return { action: 'user.unban', ...user, details: { userId } };
      case 'currency-adjust':
        return {
          action: 'user.tickets.adjust',
          ...user,
          reason,
          details: { userId, currencyType: input.currencyType, amount: input.amount },
        };
      case 'grant-item':
        return input.grantToAll === true
          ? {
              action: 'user.item.grant_all',
              targetType: 'item',
              targetId: itemId,
              details: { itemId, grantToAll: true },
            }
          : { action: 'user.item.grant', ...user, details: { userId, itemId } };
      case 'remove-item':
        return input.removeFromAll
          ? {
              action: 'user.item.remove_all',
              targetType: 'item',
              targetId: itemId,
              details: { itemId, removeFromAll: true },
            }
          : { action: 'user.item.remove', ...user, details: { userId, itemId } };
      default:
        return {
          action: 'user.scores.edit',
          ...user,
          details: { userId, table: input.table, id: input.id },
        };
    }
  },
});

export const DELETE = withAdmin(async (request, { identity }) => {
  const { searchParams } = new URL(request.url);
  const game = searchParams.get('game');
  const mode = searchParams.get('mode');
  if (!game || typeof game !== 'string') {
    return NextResponse.json({ error: 'game required' }, { status: 400 });
  }

  const clearStatementsByGame: Record<string, string[]> = {
    snake: ['DELETE FROM snake_scores'],
    'flappy-bird': ['DELETE FROM flappy_bird_scores'],
    'reaction-time': ['DELETE FROM reaction_time_scores'],
    'typing-test': ['DELETE FROM typing_test_scores'],
    tetris: ['DELETE FROM tetris_scores'],
    'coin-flip': ['DELETE FROM coin_flip_scores'],
    connections: ['DELETE FROM connections_scores'],
    arcade: ['DELETE FROM arcade_round_history'],
    '2048': ['DELETE FROM game_2048_scores'],
    '8-ball': [
      'DELETE FROM pool_bot_records',
      'DELETE FROM pool_elo_history',
      'DELETE FROM pool_elo',
      'DELETE FROM pool_stats',
    ],
    chess: [
      'DELETE FROM chess_bot_records',
      'DELETE FROM chess_elo_history',
      'DELETE FROM chess_elo',
    ],
  };
  const statements = clearStatementsByGame[game];
  if (!statements) {
    return NextResponse.json({ error: 'Invalid game' }, { status: 400 });
  }

  try {
    let deleted = 0;
    if (game === 'arcade') {
      await query(`
        CREATE TABLE IF NOT EXISTS arcade_round_history (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          user_name TEXT NOT NULL DEFAULT 'Anonymous',
          game_type TEXT NOT NULL,
          wager_amount INTEGER NOT NULL,
          payout_amount INTEGER NOT NULL,
          multiplier REAL NOT NULL,
          seed INTEGER NOT NULL,
          choices_json TEXT,
          outcome_json TEXT,
          created_at INTEGER NOT NULL
        );
      `);
    }
    if (game !== '8-ball' && game !== 'chess' && mode) {
      return NextResponse.json(
        { error: 'mode is only supported for 8-ball and chess leaderboard resets' },
        { status: 400 },
      );
    }

    if (game === '8-ball' && mode) {
      if (mode === 'ranked') {
        deleted += (await query('DELETE FROM pool_elo_history')).rowCount ?? 0;
        deleted += (await query('DELETE FROM pool_elo')).rowCount ?? 0;
      } else if (mode === 'easy' || mode === 'medium' || mode === 'hard') {
        deleted +=
          (
            await query('DELETE FROM pool_bot_records WHERE bot_difficulty = $1', [
              mode,
            ])
          ).rowCount ?? 0;
      } else {
        return NextResponse.json({ error: 'Invalid 8-ball mode' }, { status: 400 });
      }
    } else if (game === 'chess' && mode) {
      if (mode === 'ranked') {
        deleted += (await query('DELETE FROM chess_elo_history')).rowCount ?? 0;
        deleted += (await query('DELETE FROM chess_elo')).rowCount ?? 0;
      } else if (mode === 'easy' || mode === 'medium' || mode === 'hard') {
        deleted +=
          (
            await query('DELETE FROM chess_bot_records WHERE bot_difficulty = $1', [
              mode,
            ])
          ).rowCount ?? 0;
      } else {
        return NextResponse.json({ error: 'Invalid chess mode' }, { status: 400 });
      }
    } else {
      for (const statement of statements) {
        const info = await query(statement);
        deleted += info.rowCount ?? 0;
      }
    }
    await logSecurityEvent.adminAction(
      identity,
      `Reset ${game}${mode ? ` (${mode})` : ''} leaderboard (${deleted} rows deleted)`,
      request,
    );

    // Broadcast leaderboard update so clients refresh
    broadcast('gameLeaderboards', { gameType: game, updatedAt: Date.now() });

    return NextResponse.json({ deleted });
  } catch (error) {
    console.error('Failed to reset leaderboard:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}, {
  audit: ({ searchParams }) => {
    const game = searchParams.get('game');
    const mode = searchParams.get('mode');
    return {
      action: 'leaderboard.reset',
      targetType: 'leaderboard',
      targetId: game ? (mode ? `${game}:${mode}` : game) : null,
      details: { game, mode },
    };
  },
});

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  bigint as pgBigint,
  boolean,
  doublePrecision,
  integer,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => pgBigint(name, { mode: 'number' });

const scoreTable = (name: string) =>
  pgTable(name, {
    id: text('id').primaryKey(),
    odUserId: text('od_user_id').notNull(),
    userName: text('user_name').notNull(),
    score: integer('score').notNull(),
    createdAt: ts('created_at').notNull(),
  }) as any;

// Append-only event log for rolling 7d/30d leaderboards (see migration 0031).
export const gameScoreEvents = pgTable('game_score_events', {
  id: text('id').primaryKey(),
  gameSlug: text('game_slug').notNull(),
  odUserId: text('od_user_id').notNull(),
  userName: text('user_name').notNull(),
  score: doublePrecision('score').notNull(),
  createdAt: ts('created_at').notNull(),
}) as any;

export const snakeScores = scoreTable('snake_scores');
export const flappyBirdScores = scoreTable('flappy_bird_scores');
// One row per player per rules version (migration 0060): rules 1 is last
// season's endless stack, rules 2 the time-based one that gets harder as you
// climb. The board filters on rules.
export const stackScores = pgTable('stack_scores', {
  id: text('id').primaryKey(),
  odUserId: text('od_user_id').notNull(),
  userName: text('user_name').notNull(),
  score: integer('score').notNull(),
  createdAt: ts('created_at').notNull(),
  rules: integer('rules').notNull().default(1),
}) as any;
export const sequenceScores = scoreTable('sequence_scores');
export const breakoutScores = scoreTable('breakout_scores');
export const tumblerScores = scoreTable('tumbler_scores');
export const logSplitterScores = scoreTable('log_splitter_scores');
export const gopherScores = scoreTable('gopher_scores');
export const knifeBoothScores = scoreTable('knife_booth_scores');
export const melonChopScores = scoreTable('melon_chop_scores');
// One row per player per rules version (migration 0057): rules 1 is last
// season's popup range, rules 2 the thirty second gallery. The board filters on rules.
export const tinDuckScores = pgTable('tin_duck_scores', {
  id: text('id').primaryKey(),
  odUserId: text('od_user_id').notNull(),
  userName: text('user_name').notNull(),
  score: integer('score').notNull(),
  createdAt: ts('created_at').notNull(),
  rules: integer('rules').notNull().default(1),
}) as any;
export const boardwalkHopScores = scoreTable('boardwalk_hop_scores');
// One row per player per rules version (migration 0055): rules 1 is last
// season's unbounded run, rules 2 is five swings. The board filters on rules.
export const highStrikerScores = pgTable('high_striker_scores', {
  id: text('id').primaryKey(),
  odUserId: text('od_user_id').notNull(),
  userName: text('user_name').notNull(),
  score: integer('score').notNull(),
  createdAt: ts('created_at').notNull(),
  rules: integer('rules').notNull().default(1),
  bestStrength: doublePrecision('best_strength'),
}) as any;
export const skeeBallScores = scoreTable('skee_ball_scores');
export const gunrushScores = scoreTable('gunrush_scores');
export const ticketStopScores = scoreTable('ticket_stop_scores');
/** Ticket stop rules 2 (the lock): hits, on their own board. */
export const ticketStopLockScores = scoreTable('ticket_stop_lock_scores');
export const stackCabinetScores = scoreTable('stack_cabinet_scores');
/** Ring toss: round scores, one best per player (migration 0067). */
export const ringTossScores = scoreTable('ring_toss_scores');
export const ricochetScores = scoreTable('ricochet_scores');
export const swerveScores = scoreTable('swerve_scores');
export const mathScores = scoreTable('math_scores');
export const blitzTacticsScores = scoreTable('blitz_tactics_scores');
export const bubbleShooterScores = scoreTable('bubble_shooter_scores');
export const gemSwapScores = scoreTable('gem_swap_scores');
export const skyClimberScores = scoreTable('sky_climber_scores');
export const sudokuScores = pgTable('sudoku_scores', {
  id: text('id').primaryKey(),
  odUserId: text('od_user_id').notNull(),
  userName: text('user_name').notNull(),
  difficulty: text('difficulty').notNull(),
  solveTimeMs: integer('solve_time_ms').notNull(),
  createdAt: ts('created_at').notNull(),
}) as any;

export const minesweeperScores = pgTable('minesweeper_scores', {
  id: text('id').primaryKey(),
  odUserId: text('od_user_id').notNull(),
  userName: text('user_name').notNull(),
  difficulty: text('difficulty').notNull(),
  solveTimeMs: integer('solve_time_ms').notNull(),
  createdAt: ts('created_at').notNull(),
}) as any;

export const punchCardScores = pgTable('punch_card_scores', {
  id: text('id').primaryKey(),
  odUserId: text('od_user_id').notNull(),
  userName: text('user_name').notNull(),
  size: text('size').notNull(),
  solveTimeMs: integer('solve_time_ms').notNull(),
  createdAt: ts('created_at').notNull(),
}) as any;

export const freecellScores = pgTable('freecell_scores', {
  id: text('id').primaryKey(),
  odUserId: text('od_user_id').notNull(),
  userName: text('user_name').notNull(),
  // 'daily' | 'free'
  mode: text('mode').notNull(),
  // per-deal scope: daily → the UTC day number; free → 'free' (a single
  // fastest-clear-ever board). One best row per (user, mode, deal_key).
  dealKey: text('deal_key').notNull(),
  solveTimeMs: integer('solve_time_ms').notNull(),
  // leaderboard tiebreak: fewer moves wins on equal time.
  moveCount: integer('move_count').notNull(),
  createdAt: ts('created_at').notNull(),
}) as any;

export const game2048Scores = pgTable('game_2048_scores', {
  id: text('id').primaryKey(),
  odUserId: text('od_user_id').notNull(),
  userName: text('user_name').notNull(),
  score: integer('score').notNull(),
  highestTile: integer('highest_tile').notNull(),
  createdAt: ts('created_at').notNull(),
}) as any;

export const reactionTimeScores = pgTable('reaction_time_scores', {
  id: text('id').primaryKey(),
  odUserId: text('od_user_id').notNull(),
  userName: text('user_name').notNull(),
  score: doublePrecision('score').notNull(),
  averageTime: doublePrecision('average_time').notNull(),
  bestTime: doublePrecision('best_time').notNull(),
  attempts: integer('attempts').notNull(),
  createdAt: ts('created_at').notNull(),
}) as any;

export const typingTestScores = pgTable('typing_test_scores', {
  id: text('id').primaryKey(),
  odUserId: text('od_user_id').notNull(),
  userName: text('user_name').notNull(),
  wpm: doublePrecision('wpm').notNull(),
  rawWpm: doublePrecision('raw_wpm').notNull(),
  accuracy: doublePrecision('accuracy').notNull(),
  mode: integer('mode').notNull(),
  correctChars: integer('correct_chars').notNull(),
  incorrectChars: integer('incorrect_chars').notNull(),
  totalChars: integer('total_chars').notNull(),
  wordsCompleted: integer('words_completed').notNull(),
  createdAt: ts('created_at').notNull(),
}) as any;

export const coinFlipScores = pgTable('coin_flip_scores', {
  id: text('id').primaryKey(),
  odUserId: text('od_user_id').notNull(),
  userName: text('user_name').notNull(),
  streak: integer('streak').notNull(),
  chosenSide: text('chosen_side').notNull(),
  totalGamesPlayed: integer('total_games_played').notNull(),
  totalCorrectFlips: integer('total_correct_flips').notNull(),
  totalFlips: integer('total_flips').notNull(),
  createdAt: ts('created_at').notNull(),
}) as any;

export const connectionsScores = pgTable('connections_scores', {
  id: text('id').primaryKey(),
  odUserId: text('od_user_id').notNull(),
  userName: text('user_name').notNull(),
  puzzleDate: text('puzzle_date').notNull(),
  mistakes: integer('mistakes').notNull(),
  timeSeconds: doublePrecision('time_seconds').notNull(),
  solved: boolean('solved').notNull(),
  createdAt: ts('created_at').notNull(),
}) as any;

export const wordGridScores = pgTable('word_grid_scores', {
  id: text('id').primaryKey(),
  odUserId: text('od_user_id').notNull(),
  userName: text('user_name').notNull(),
  puzzleDate: text('puzzle_date').notNull(),
  guesses: integer('guesses').notNull(),
  solved: boolean('solved').notNull(),
  timeSeconds: doublePrecision('time_seconds').notNull(),
  createdAt: ts('created_at').notNull(),
}) as any;

// Mini golf (migration 0063): one counted round per player per UTC day,
// filled in hole by hole. The board reads finished rounds by strokes.
export const miniGolfRounds = pgTable('mini_golf_rounds', {
  id: text('id').primaryKey(),
  odUserId: text('od_user_id').notNull(),
  userName: text('user_name').notNull(),
  roundDate: text('round_date').notNull(),
  rules: integer('rules').notNull().default(1),
  holesJson: text('holes_json').notNull().default('[]'),
  currentJson: text('current_json').notNull().default('[]'),
  scoresJson: text('scores_json').notNull().default('[]'),
  holesDone: integer('holes_done').notNull().default(0),
  strokes: integer('strokes').notNull().default(0),
  par: integer('par').notNull(),
  aces: integer('aces').notNull().default(0),
  startedAt: ts('started_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
  finishedAt: ts('finished_at'),
}) as any;

export const pangramScores = pgTable('pangram_scores', {
  id: text('id').primaryKey(),
  odUserId: text('od_user_id').notNull(),
  userName: text('user_name').notNull(),
  puzzleDate: text('puzzle_date').notNull(),
  score: integer('score').notNull(),
  wordsFound: integer('words_found').notNull(),
  pangrams: integer('pangrams').notNull(),
  timeSeconds: doublePrecision('time_seconds').notNull(),
  createdAt: ts('created_at').notNull(),
}) as any;

export const tetrisScores = pgTable('tetris_scores', {
  id: text('id').primaryKey(),
  odUserId: text('od_user_id').notNull(),
  userName: text('user_name').notNull(),
  score: integer('score').notNull(),
  level: integer('level').notNull(),
  lines: integer('lines').notNull(),
  bestLines: integer('best_lines').notNull(),
  bestLinesScore: integer('best_lines_score').notNull(),
  bestLinesLevel: integer('best_lines_level').notNull(),
  bestLinesCreatedAt: ts('best_lines_created_at'),
  totalGames: integer('total_games').notNull(),
  totalLines: integer('total_lines').notNull(),
  totalPlayTimeMs: ts('total_play_time_ms').notNull(),
  createdAt: ts('created_at').notNull(),
}) as any;

export const siteSettings = pgTable('site_settings', {
  id: text('id').primaryKey(),
  configJson: text('config_json').notNull(),
  updatedAt: ts('updated_at').notNull(),
  updatedBy: text('updated_by'),
}) as any;

export const arcadeFeedback = pgTable('arcade_feedback', {
  id: text('id').primaryKey(),
  dateKey: text('date_key').notNull(),
  userId: text('user_id'),
  userName: text('user_name'),
  email: text('email'),
  category: text('category').notNull(),
  rating: integer('rating'),
  message: text('message').notNull(),
  pagePath: text('page_path'),
  status: text('status').notNull(),
  adminNote: text('admin_note'),
  statusUpdatedBy: text('status_updated_by'),
  statusUpdatedAt: ts('status_updated_at'),
  userAgent: text('user_agent'),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
}) as any;

export const arcadeNotifications = pgTable('arcade_notifications', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  href: text('href'),
  preferenceKey: text('preference_key'),
  dedupeKey: text('dedupe_key'),
  readAt: ts('read_at'),
  createdAt: ts('created_at').notNull(),
}) as any;

export const arcadeMultiplayerSessions = pgTable('arcade_multiplayer_sessions', {
  id: text('id').primaryKey(),
  gameType: text('game_type').notNull(),
  mode: text('mode').notNull(),
  status: text('status').notNull(),
  ownerUserId: text('owner_user_id').notNull(),
  ownerUserName: text('owner_user_name').notNull(),
  minPlayers: integer('min_players').notNull(),
  maxPlayers: integer('max_players').notNull(),
  currentPlayerCount: integer('current_player_count').notNull(),
  visibility: text('visibility').notNull(),
  metadataJson: text('metadata_json').notNull(),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
  startedAt: ts('started_at'),
  completedAt: ts('completed_at'),
}) as any;

export const arcadeMultiplayerSessionPlayers = pgTable('arcade_multiplayer_session_players', {
  sessionId: text('session_id').notNull(),
  userId: text('user_id').notNull(),
  userName: text('user_name').notNull(),
  seatIndex: integer('seat_index').notNull(),
  role: text('role').notNull(),
  status: text('status').notNull(),
  joinedAt: ts('joined_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
  leftAt: ts('left_at'),
}) as any;

export const arcadeSkillDuelResults = pgTable('arcade_skill_duel_results', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  userId: text('user_id').notNull(),
  userName: text('user_name').notNull(),
  gameType: text('game_type').notNull(),
  gameSessionId: text('game_session_id'),
  modeSec: integer('mode_sec').notNull(),
  wpm: doublePrecision('wpm').notNull(),
  rawWpm: doublePrecision('raw_wpm').notNull(),
  accuracy: doublePrecision('accuracy').notNull(),
  correctChars: integer('correct_chars').notNull(),
  incorrectChars: integer('incorrect_chars').notNull(),
  totalChars: integer('total_chars').notNull(),
  wordsCompleted: integer('words_completed').notNull(),
  createdAt: ts('created_at').notNull(),
}) as any;

const userEloTable = (name: string) =>
  pgTable(name, {
    userId: text('user_id').primaryKey(),
    eloRating: integer('elo_rating').notNull(),
    peakElo: integer('peak_elo').notNull(),
    totalGames: integer('total_games').notNull(),
    totalWins: integer('total_wins').notNull(),
    totalLosses: integer('total_losses').notNull(),
  }) as any;

export const chessElo = userEloTable('chess_elo');
export const poolElo = userEloTable('pool_elo');
poolElo.elo_rating = poolElo.eloRating;
poolElo.peak_elo = poolElo.peakElo;

const botRecordsTable = (name: string) =>
  pgTable(name, {
    userId: text('user_id').notNull(),
    botDifficulty: text('bot_difficulty').notNull(),
    fewestPly: integer('fewest_ply'),
    fewestTurns: integer('fewest_turns'),
    totalThinkingMs: pgBigint('total_thinking_ms', { mode: 'number' }),
    totalTurnDurationMs: pgBigint('total_turn_duration_ms', { mode: 'number' }),
    achievedAt: ts('achieved_at'),
  }) as any;

export const chessBotRecords = botRecordsTable('chess_bot_records');
export const poolBotRecords = botRecordsTable('pool_bot_records');

const eloHistoryTable = (name: string) =>
  pgTable(name, {
    id: text('id').primaryKey(),
    matchId: text('match_id').notNull(),
    playerAId: text('player_a_id').notNull(),
    playerBId: text('player_b_id').notNull(),
    createdAt: ts('created_at').notNull(),
  }) as any;

export const chessEloHistory = eloHistoryTable('chess_elo_history');
export const poolEloHistory = eloHistoryTable('pool_elo_history');

const matchChatTable = (name: string) =>
  pgTable(name, {
    id: text('id').primaryKey(),
    matchId: text('match_id').notNull(),
    senderId: text('sender_id').notNull(),
    senderName: text('sender_name').notNull(),
    message: text('message').notNull(),
    createdAt: ts('created_at').notNull(),
  }) as any;

export const chessMatchChat = matchChatTable('chess_match_chat');
export const poolMatchChat = matchChatTable('pool_match_chat');

const matchTable = (name: string) =>
  pgTable(name, {
    id: text('id').primaryKey(),
    player1Id: text('player1_id').notNull(),
    player1Name: text('player1_name').notNull(),
    player2Id: text('player2_id'),
    player2Name: text('player2_name'),
    invitedUserId: text('invited_user_id'),
    status: text('status').notNull(),
    currentTurn: text('current_turn'),
    winnerId: text('winner_id'),
    winReason: text('win_reason'),
    result: text('result'),
    ply: integer('ply'),
    moveCount: integer('move_count'),
    turnStartedAt: ts('turn_started_at'),
    tournamentMatchId: text('tournament_match_id'),
    wagerStatus: text('wager_status'),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
    completedAt: ts('completed_at'),
  }) as any;

export const chessMatches = matchTable('chess_matches');
export const poolMatches = matchTable('pool_matches');

export const chessMoves = pgTable('chess_moves', {
  id: text('id').primaryKey(),
  matchId: text('match_id').notNull(),
  playerId: text('player_id').notNull(),
  ply: integer('ply').notNull(),
  uci: text('uci').notNull(),
  moveDurationMs: integer('move_duration_ms'),
}) as any;

export const poolMoves = pgTable('pool_moves', {
  id: text('id').primaryKey(),
  matchId: text('match_id').notNull(),
  playerId: text('player_id').notNull(),
  moveNumber: integer('move_number').notNull(),
  turnDurationMs: integer('turn_duration_ms'),
}) as any;

const recentClearsTable = (name: string) =>
  pgTable(name, {
    userId: text('user_id').primaryKey(),
    clearedBeforeTs: ts('cleared_before_ts').notNull(),
  }) as any;

export const chessRecentMatchClears = recentClearsTable('chess_recent_match_clears');
export const poolRecentMatchClears = recentClearsTable('pool_recent_match_clears');

const statsTable = (name: string) =>
  pgTable(name, {
    userId: text('user_id').primaryKey(),
    wins: integer('wins').notNull(),
    losses: integer('losses').notNull(),
    forfeits: integer('forfeits').notNull(),
    currentStreak: integer('current_streak').notNull(),
    bestStreak: integer('best_streak').notNull(),
    totalShots: integer('total_shots').notNull(),
    totalBallsPocketed: integer('total_balls_pocketed').notNull(),
  }) as any;

export const chessStats = statsTable('chess_stats');
export const poolStats = statsTable('pool_stats');
poolStats.total_shots = poolStats.totalShots;
poolStats.total_balls_pocketed = poolStats.totalBallsPocketed;

// ----- Connect Four (PvP, cloned from chess_*; raw SQL is authoritative) -----
export const connectFourMatches = matchTable('connect_four_matches');
export const connectFourElo = userEloTable('connect_four_elo');
export const connectFourEloHistory = eloHistoryTable('connect_four_elo_history');
export const connectFourRecentMatchClears = recentClearsTable('connect_four_recent_match_clears');
export const connectFourBotRecords = botRecordsTable('connect_four_bot_records');
export const connectFourMoves = pgTable('connect_four_moves', {
  id: text('id').primaryKey(),
  matchId: text('match_id').notNull(),
  playerId: text('player_id').notNull(),
  moveNumber: integer('move_number').notNull(),
  ply: integer('ply').notNull(),
  columnIndex: integer('column_index').notNull(),
  boardAfter: text('board_after').notNull(),
  moveDurationMs: pgBigint('move_duration_ms', { mode: 'number' }),
  createdAt: ts('created_at').notNull(),
}) as any;
export const connectFourStats = pgTable('connect_four_stats', {
  userId: text('user_id').primaryKey(),
  userName: text('user_name').notNull(),
  wins: integer('wins').notNull(),
  losses: integer('losses').notNull(),
  draws: integer('draws').notNull(),
  forfeits: integer('forfeits').notNull(),
  currentStreak: integer('current_streak').notNull(),
  bestStreak: integer('best_streak').notNull(),
  totalMoves: integer('total_moves').notNull(),
  foursGiven: integer('fours_given').notNull(),
  updatedAt: ts('updated_at').notNull(),
}) as any;

// ----- Checkers (PvP, cloned from chess_*; raw SQL is authoritative) -----
export const checkersElo = userEloTable('checkers_elo');
export const checkersEloHistory = eloHistoryTable('checkers_elo_history');
export const checkersBotRecords = botRecordsTable('checkers_bot_records');
export const checkersRecentMatchClears = recentClearsTable('checkers_recent_match_clears');
export const checkersStats = statsTable('checkers_stats');
export const checkersMatches = pgTable('checkers_matches', {
  id: text('id').primaryKey(),
  player1Id: text('player1_id').notNull(),
  player1Name: text('player1_name').notNull(),
  player2Id: text('player2_id'),
  player2Name: text('player2_name'),
  invitedUserId: text('invited_user_id'),
  redId: text('red_id'),
  whiteId: text('white_id'),
  status: text('status').notNull(),
  currentTurn: text('current_turn').notNull(),
  board: text('board').notNull(),
  ply: integer('ply'),
  moveCount: integer('move_count'),
  noProgressPlies: integer('no_progress_plies'),
  lastMove: text('last_move'),
  winnerId: text('winner_id'),
  loserId: text('loser_id'),
  winReason: text('win_reason'),
  result: text('result'),
  wagerAmount: integer('wager_amount'),
  wagerStatus: text('wager_status'),
  tournamentMatchId: text('tournament_match_id'),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
  completedAt: ts('completed_at'),
}) as any;
export const checkersMoves = pgTable('checkers_moves', {
  id: text('id').primaryKey(),
  matchId: text('match_id').notNull(),
  playerId: text('player_id').notNull(),
  ply: integer('ply').notNull(),
  notation: text('notation').notNull(),
  moveDurationMs: integer('move_duration_ms'),
}) as any;

// ----- Reversi/Othello (PvP, cloned from connect_four_*; raw SQL authoritative) -----
export const reversiElo = userEloTable('reversi_elo');
export const reversiEloHistory = eloHistoryTable('reversi_elo_history');
export const reversiBotRecords = botRecordsTable('reversi_bot_records');
export const reversiRecentMatchClears = recentClearsTable('reversi_recent_match_clears');
export const reversiMatches = pgTable('reversi_matches', {
  id: text('id').primaryKey(),
  player1Id: text('player1_id').notNull(),
  player1Name: text('player1_name').notNull(),
  player2Id: text('player2_id'),
  player2Name: text('player2_name'),
  invitedUserId: text('invited_user_id'),
  blackId: text('black_id'),
  whiteId: text('white_id'),
  status: text('status').notNull(),
  currentTurn: text('current_turn'),
  board: text('board').notNull(),
  ply: integer('ply'),
  moveCount: integer('move_count'),
  lastMove: text('last_move'),
  result: text('result'),
  winnerId: text('winner_id'),
  loserId: text('loser_id'),
  winReason: text('win_reason'),
  tournamentMatchId: text('tournament_match_id'),
  wagerAmount: integer('wager_amount'),
  wagerStatus: text('wager_status'),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
  completedAt: ts('completed_at'),
}) as any;
export const reversiMoves = pgTable('reversi_moves', {
  id: text('id').primaryKey(),
  matchId: text('match_id').notNull(),
  playerId: text('player_id').notNull(),
  moveNumber: integer('move_number').notNull(),
  ply: integer('ply').notNull(),
  cellIndex: integer('cell_index').notNull(),
  boardAfter: text('board_after').notNull(),
  moveDurationMs: pgBigint('move_duration_ms', { mode: 'number' }),
  createdAt: ts('created_at').notNull(),
}) as any;
export const reversiStats = pgTable('reversi_stats', {
  userId: text('user_id').primaryKey(),
  userName: text('user_name').notNull(),
  wins: integer('wins').notNull(),
  losses: integer('losses').notNull(),
  draws: integer('draws').notNull(),
  forfeits: integer('forfeits').notNull(),
  currentStreak: integer('current_streak').notNull(),
  bestStreak: integer('best_streak').notNull(),
  totalMoves: integer('total_moves').notNull(),
  updatedAt: ts('updated_at').notNull(),
}) as any;

// ----- Battleship (PvP, hidden-board; raw SQL authoritative) -----
export const battleshipElo = userEloTable('battleship_elo');
export const battleshipEloHistory = eloHistoryTable('battleship_elo_history');
export const battleshipBotRecords = botRecordsTable('battleship_bot_records');
export const battleshipRecentMatchClears = recentClearsTable('battleship_recent_match_clears');
export const battleshipMatches = pgTable('battleship_matches', {
  id: text('id').primaryKey(),
  player1Id: text('player1_id').notNull(),
  player1Name: text('player1_name').notNull(),
  player2Id: text('player2_id'),
  player2Name: text('player2_name'),
  invitedUserId: text('invited_user_id'),
  status: text('status').notNull(),
  phase: text('phase').notNull(),
  currentTurn: text('current_turn'),
  // Server-only hidden fleet grids; never sent to the opposing client.
  player1Board: text('player1_board'),
  player2Board: text('player2_board'),
  // Shot history grids (what each player has fired at — safe to reveal to owner).
  player1Shots: text('player1_shots'),
  player2Shots: text('player2_shots'),
  player1Ready: boolean('player1_ready'),
  player2Ready: boolean('player2_ready'),
  ply: integer('ply'),
  moveCount: integer('move_count'),
  lastMove: text('last_move'),
  result: text('result'),
  winnerId: text('winner_id'),
  loserId: text('loser_id'),
  winReason: text('win_reason'),
  tournamentMatchId: text('tournament_match_id'),
  wagerAmount: integer('wager_amount'),
  wagerStatus: text('wager_status'),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
  completedAt: ts('completed_at'),
}) as any;
export const battleshipMoves = pgTable('battleship_moves', {
  id: text('id').primaryKey(),
  matchId: text('match_id').notNull(),
  playerId: text('player_id').notNull(),
  ply: integer('ply').notNull(),
  kind: text('kind').notNull(),
  cell: integer('cell').notNull(),
  outcome: text('outcome'),
  moveDurationMs: pgBigint('move_duration_ms', { mode: 'number' }),
  createdAt: ts('created_at').notNull(),
}) as any;
export const battleshipStats = pgTable('battleship_stats', {
  userId: text('user_id').primaryKey(),
  userName: text('user_name').notNull(),
  wins: integer('wins').notNull(),
  losses: integer('losses').notNull(),
  draws: integer('draws').notNull(),
  forfeits: integer('forfeits').notNull(),
  currentStreak: integer('current_streak').notNull(),
  bestStreak: integer('best_streak').notNull(),
  totalShots: integer('total_shots').notNull(),
  totalHits: integer('total_hits').notNull(),
  updatedAt: ts('updated_at').notNull(),
}) as any;

const tournamentTable = (name: string) =>
  pgTable(name, {
    id: text('id').primaryKey(),
    status: text('status').notNull(),
    participantCount: integer('participant_count').notNull(),
    createdAt: ts('created_at').notNull(),
  }) as any;

export const chessTournaments = tournamentTable('chess_tournaments');
export const poolTournaments = tournamentTable('pool_tournaments');

const tournamentParticipantTable = (name: string) =>
  pgTable(name, {
    tournamentId: text('tournament_id').notNull(),
    userId: text('user_id').notNull(),
    seed: integer('seed'),
    eloAtRegistration: integer('elo_at_registration'),
    eliminatedInRound: integer('eliminated_in_round'),
  }) as any;

export const chessTournamentParticipants = tournamentParticipantTable('chess_tournament_participants');
export const poolTournamentParticipants = tournamentParticipantTable('pool_tournament_participants');

const tournamentMatchTable = (name: string) =>
  pgTable(name, {
    id: text('id').primaryKey(),
    tournamentId: text('tournament_id').notNull(),
    player1Id: text('player1_id'),
    player2Id: text('player2_id'),
    round: integer('round').notNull(),
    position: integer('position').notNull(),
    bracket: text('bracket'),
    status: text('status').notNull(),
    isBye: boolean('is_bye').notNull(),
  }) as any;

export const chessTournamentMatches = tournamentMatchTable('chess_tournament_matches');
export const poolTournamentMatches = tournamentMatchTable('pool_tournament_matches');

const tournamentWagerTable = (name: string) =>
  pgTable(name, {
    id: text('id').primaryKey(),
    tournamentId: text('tournament_id').notNull(),
    tournamentMatchId: text('tournament_match_id'),
    status: text('status').notNull(),
  }) as any;

export const chessTournamentWagers = tournamentWagerTable('chess_tournament_wagers');
export const poolTournamentWagers = tournamentWagerTable('pool_tournament_wagers');

export const connectionsBlackoutDates = pgTable('connections_blackout_dates', {
  date: text('date').primaryKey(),
  reason: text('reason').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: ts('created_at').notNull(),
}) as any;

export const connectionsPuzzles = pgTable('connections_puzzles', {
  id: text('id').primaryKey(),
  sortOrder: integer('sort_order').notNull(),
  puzzleDate: text('puzzle_date'),
  groupsJson: text('groups_json').notNull(),
}) as any;

// Admin-editable daily-word pools (empty ⇒ the game uses its in-code defaults).
export const pangramPuzzles = pgTable('pangram_puzzles', {
  id: text('id').primaryKey(),
  sortOrder: integer('sort_order').notNull(),
  lettersJson: text('letters_json').notNull(),
  center: text('center').notNull(),
}) as any;

export const wordGridPuzzles = pgTable('word_grid_puzzles', {
  id: text('id').primaryKey(),
  sortOrder: integer('sort_order').notNull(),
  answer: text('answer').notNull(),
}) as any;

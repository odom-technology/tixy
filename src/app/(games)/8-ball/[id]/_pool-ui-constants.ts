export const TURN_INDICATOR_TRANSITION_MS = 180;
export const STATUS_BANNER_ENTER_MS = 180;
export const FOUL_TEXT_ENTER_MS = 180;

export const CUE_STRIKE_TOTAL_MS = 100;
export const CUE_BALL_LAUNCH_DELAY_MS = 30;
export const POCKET_ANIMATION_MS = 180;
export const POCKET_FLASH_MS = 140;

export const STATUS_BANNER_DEFAULT_MS = 200;
export const PLAYER_SWITCH_DELAY_MS = 600;
export const FOUL_OVERLAY_MS = 1200;
export const BOT_AIM_PREVIEW_MS = 350;
export const BOT_AIM_SETUP_MS = 50;
/** Number of "thinking" positions shown before the bot places the cue ball. */
export const BOT_PLACEMENT_STEPS = 2;
/** Time each "thinking" position is shown (ms). */
export const BOT_PLACEMENT_STEP_MS = 180;
/** Pause after final placement before the bot aims. */
export const BOT_PLACEMENT_SETTLE_MS = 140;

export const GAME_OVER_ENTRY_DELAY_MS = 140;
export const GAME_OVER_PANEL_MS = 420;
export const CONFETTI_MIN_S = 1.4;
export const CONFETTI_MAX_S = 2.2;
export const CONFETTI_MAX_DELAY_S = 1.1;

// ── Control tuning ────────────────────────────────────────────────────────

/** EMA alpha for aim angle smoothing (0 = no update, 1 = instant snap).
 *  0.55 tracks the cursor closely while still filtering micro-jitter.
 *  Lower values feel laggy; higher values feel jittery on touch. */
export const AIM_SMOOTH_ALPHA = 0.55;

/** Max backward drag distance (table units) for 100% power. */
export const MAX_PULL_DIST = 200;

/** Power drag exponent. 1.0 = linear (predictable muscle memory). */
export const POWER_DRAG_EXPONENT = 1.0;

/** Minimum power to fire a shot (below this, release cancels). */
export const MIN_FIRE_POWER = 0.05;

/** Length of the object ball target direction line (px). */
export const TARGET_LINE_LENGTH = 60;

/** Length of the cue ball deflection direction line (px). */
export const CUE_DEFLECTION_LENGTH = 50;

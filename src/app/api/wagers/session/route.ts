import { gameUnavailableResponse } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';
import { getOrCreateRouteIdentity } from '@/server/auth/route-identity';
import { getGameBanStatus } from '@/server/arcade/game-bans';
import { createArcadeSession, TicketsShortError } from '@/server/arcade/arcade-session';
import { isArcadeGameType, type ArcadeGameType } from '@/server/arcade/arcade-constants';
import { validateMinesConfig } from '@/server/arcade/wager-games/mines';
import { validatePlinkoConfig } from '@/server/arcade/wager-games/plinko';
import { validateDiceConfig } from '@/server/arcade/wager-games/dice';
import { validateChickenConfig } from '@/server/arcade/wager-games/chicken';
import { validateHiLoConfig } from '@/server/arcade/wager-games/hilo';
import { validateCasesConfig } from '@/server/arcade/wager-games/cases';
import { validatePacksConfig } from '@/server/arcade/wager-games/packs';
import { validateDartsConfig } from '@/server/arcade/wager-games/darts';
import { validateLightspeedConfig } from '@/server/arcade/wager-games/lightspeed';
import { validateBlackjackConfig } from '@/server/arcade/wager-games/blackjack';
import { validateLimboConfig } from '@/server/arcade/wager-games/limbo';
import { validateDragonConfig } from '@/server/arcade/wager-games/dragon';
import { validateVideoPokerConfig } from '@/server/arcade/wager-games/video-poker';
import { validateRouletteConfig, getRouletteStake } from '@/server/arcade/wager-games/roulette';
import { validateScratchConfig } from '@/server/arcade/wager-games/scratch';
import { validatePumpConfig } from '@/server/arcade/wager-games/pump';
import { validateKenoConfig } from '@/server/arcade/wager-games/keno';
import { validateWheelConfig } from '@/server/arcade/wager-games/prize-wheel';
import { validateBaccaratConfig } from '@/server/arcade/wager-games/baccarat';
import { validateFortuneConfig } from '@/server/arcade/wager-games/fortune-teller';
import { validateLuckyCageConfig } from '@/server/arcade/wager-games/lucky-cage';
import { validatePrizeClawConfig } from '@/server/arcade/wager-games/prize-claw';

export const dynamic = 'force-dynamic';

type SessionPayload = {
  gameType?: string;
  wager?: number;
  config?: Record<string, unknown>;
};

export async function POST(request: Request) {
  const { identity, attachCookie } = await getOrCreateRouteIdentity();

  const banStatus = await getGameBanStatus(identity.userId);
  if (banStatus.isBanned) {
    return NextResponse.json({ error: 'You are currently banned from games.' }, { status: 403 });
  }

  let payload: SessionPayload;
  try {
    payload = (await request.json()) as SessionPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const { gameType, wager, config } = payload;

  if (!gameType || !isArcadeGameType(gameType)) {
    return NextResponse.json({ error: 'Invalid game type.' }, { status: 400 });
  }
  // Derby Royale is a continuous shared round loop, not a per-session wager
  // game. Its bets go through /api/derby/bet against the live round — never the
  // create-session hold flow — so reject it here explicitly.
  if (gameType === 'arcade-derby') {
    return NextResponse.json(
      { error: 'Derby Royale bets go through /api/derby/bet, not the session flow.' },
      { status: 400 },
    );
  }
  if (typeof wager !== 'number') {
    return NextResponse.json({ error: 'Wager is required.' }, { status: 400 });
  }

  // Game-specific config validation
  let validatedConfig: Record<string, unknown> = {};
  if (gameType === 'arcade-mines') {
    const minesConfig = validateMinesConfig(config);
    if (!minesConfig) {
      return NextResponse.json(
        { error: 'Invalid mines config. mineCount must be 1, 3, 5, 10, or 15.' },
        { status: 400 },
      );
    }
    validatedConfig = minesConfig;
  } else if (gameType === 'arcade-plinko') {
    const plinkoConfig = validatePlinkoConfig(config);
    if (!plinkoConfig) {
      return NextResponse.json(
        { error: 'Invalid plinko config. rows must be 8, 12, or 16; risk must be low, medium, or high.' },
        { status: 400 },
      );
    }
    validatedConfig = plinkoConfig;
  } else if (gameType === 'arcade-dice') {
    const diceConfig = validateDiceConfig(config);
    if (!diceConfig) {
      return NextResponse.json(
        { error: 'Invalid dice config. target must be 2-98; direction must be over or under.' },
        { status: 400 },
      );
    }
    validatedConfig = diceConfig;
  } else if (gameType === 'arcade-chicken') {
    const chickenConfig = validateChickenConfig(config);
    if (!chickenConfig) {
      return NextResponse.json(
        { error: 'Invalid chicken config. difficulty must be easy, medium, hard, or daredevil.' },
        { status: 400 },
      );
    }
    validatedConfig = chickenConfig;
  } else if (gameType === 'arcade-hilo') {
    const hiLoConfig = validateHiLoConfig(config);
    if (!hiLoConfig) {
      return NextResponse.json(
        { error: 'Invalid hi-lo config.' },
        { status: 400 },
      );
    }
    validatedConfig = hiLoConfig;
  } else if (gameType === 'arcade-cases') {
    const casesConfig = validateCasesConfig(config);
    if (!casesConfig) {
      return NextResponse.json(
        { error: 'Invalid cases config. risk must be low, medium, or high.' },
        { status: 400 },
      );
    }
    validatedConfig = casesConfig;
  } else if (gameType === 'arcade-packs') {
    validatedConfig = validatePacksConfig(config);
  } else if (gameType === 'arcade-darts') {
    validatedConfig = validateDartsConfig(config);
  } else if (gameType === 'arcade-lightspeed') {
    const lsConfig = validateLightspeedConfig(config);
    if (!lsConfig) {
      return NextResponse.json(
        { error: 'Invalid lightspeed config.' },
        { status: 400 },
      );
    }
    validatedConfig = lsConfig;
  } else if (gameType === 'arcade-blackjack') {
    const bjConfig = validateBlackjackConfig(config);
    if (!bjConfig) {
      return NextResponse.json(
        { error: 'Invalid blackjack config.' },
        { status: 400 },
      );
    }
    validatedConfig = bjConfig;
  } else if (gameType === 'arcade-limbo') {
    const limboConfig = validateLimboConfig(config);
    if (!limboConfig) {
      return NextResponse.json(
        { error: 'Invalid limbo config. target must be 1.01-1000 (2dp).' },
        { status: 400 },
      );
    }
    validatedConfig = limboConfig;
  } else if (gameType === 'arcade-dragon') {
    const dragonConfig = validateDragonConfig(config);
    if (!dragonConfig) {
      return NextResponse.json(
        { error: 'Invalid dragon config. difficulty must be easy, medium, hard, or expert.' },
        { status: 400 },
      );
    }
    validatedConfig = dragonConfig;
  } else if (gameType === 'arcade-video-poker') {
    validatedConfig = validateVideoPokerConfig(config) ?? {};
  } else if (gameType === 'arcade-roulette') {
    const rouletteConfig = validateRouletteConfig(config);
    if (!rouletteConfig) {
      return NextResponse.json(
        { error: 'Invalid roulette bets. Each bet needs a valid type, pockets, and a positive integer amount (max 60 bets).' },
        { status: 400 },
      );
    }
    if (getRouletteStake(rouletteConfig.bets) !== wager) {
      return NextResponse.json(
        { error: 'Total chips placed must equal the wager.' },
        { status: 400 },
      );
    }
    validatedConfig = rouletteConfig;
  } else if (gameType === 'arcade-scratch') {
    const scratchConfig = validateScratchConfig(config);
    if (!scratchConfig) {
      return NextResponse.json(
        { error: 'Invalid scratch config. tier must be bronze, silver, or gold.' },
        { status: 400 },
      );
    }
    validatedConfig = scratchConfig;
  } else if (gameType === 'arcade-pump') {
    const pumpConfig = validatePumpConfig(config);
    if (!pumpConfig) {
      return NextResponse.json(
        { error: 'Invalid pump config. difficulty must be easy, medium, or hard.' },
        { status: 400 },
      );
    }
    validatedConfig = pumpConfig;
  } else if (gameType === 'arcade-keno') {
    const kenoConfig = validateKenoConfig(config);
    if (!kenoConfig) {
      return NextResponse.json(
        { error: 'Invalid keno config. Pick 1-10 distinct numbers (1-40); profile must be classic, low, medium, or high.' },
        { status: 400 },
      );
    }
    validatedConfig = kenoConfig;
  } else if (gameType === 'arcade-prize-wheel') {
    const wheelConfig = validateWheelConfig(config);
    if (!wheelConfig) {
      return NextResponse.json(
        { error: 'Invalid prize wheel config. segments must be 10, 20, 30, 40, or 50; risk must be low, medium, or high.' },
        { status: 400 },
      );
    }
    validatedConfig = wheelConfig;
  } else if (gameType === 'arcade-baccarat') {
    const baccaratConfig = validateBaccaratConfig(config);
    if (!baccaratConfig) {
      return NextResponse.json(
        { error: 'Invalid baccarat config. bet must be player, banker, or tie.' },
        { status: 400 },
      );
    }
    validatedConfig = baccaratConfig;
  } else if (gameType === 'arcade-fortune-teller') {
    const fortuneConfig = validateFortuneConfig(config);
    if (!fortuneConfig) {
      return NextResponse.json(
        { error: 'Invalid fortune teller config. tier must be apprentice, seer, oracle, or mystic.' },
        { status: 400 },
      );
    }
    validatedConfig = fortuneConfig;
  } else if (gameType === 'arcade-lucky-cage') {
    // One ticket per round, and it must be one of the 51 the board actually
    // sells. The client never sends a multiplier, a probability, or any part of
    // the draw — only which ticket it bought.
    const cageConfig = validateLuckyCageConfig(config);
    if (!cageConfig) {
      return NextResponse.json(
        { error: 'Invalid Lucky Cage ticket. Pick one ticket from the board.' },
        { status: 400 },
      );
    }
    validatedConfig = cageConfig;
  } else if (gameType === 'arcade-prize-claw') {
    // The client picks a cabinet and nothing else. validatePrizeClawConfig
    // mints the PUBLIC bedSeed here with its own CSPRNG draw — it is never
    // derived from (and never equal to) the private session seed the next call
    // generates, and a client-supplied bedSeed is discarded. See the header of
    // wager-games/prize-claw.ts: deriving the bed from the session seed would
    // let a player brute-force the 31-bit seed from the visible bed and only
    // commit on winning rounds.
    const clawConfig = validatePrizeClawConfig(config);
    if (!clawConfig) {
      return NextResponse.json(
        { error: 'Invalid Prize Claw cabinet. Pick Plush Row, Curio Case, or Top Shelf.' },
        { status: 400 },
      );
    }
    validatedConfig = clawConfig;
  }

  try {
    const result = await createArcadeSession(
      identity.userId,
      gameType as ArcadeGameType,
      wager,
      validatedConfig,
    );
    const response = NextResponse.json(result);
    attachCookie(response);
    return response;
  } catch (error) {
    const unavailable = gameUnavailableResponse(error);
    if (unavailable) return unavailable;
    const message = error instanceof Error ? error.message : 'Failed to create session.';
    const isInsufficientBalance = error instanceof TicketsShortError || message.toLowerCase().includes('insufficient');
    return NextResponse.json(
      { error: message },
      { status: isInsufficientBalance ? 402 : 400 },
    );
  }
}

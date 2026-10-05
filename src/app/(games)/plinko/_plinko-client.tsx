'use client';

/* Plinko: one machine in the game shell, on the ticket machine frame. Pick
   a risk (low, medium, high) and rows beside the bet; the board shows that
   table. Drop sends one ball, drop 10 sends ten in a stream, and every ball
   dropped while others are still falling joins the same receipt.

   Every ball is its own server round: /api/wagers/session then
   /api/wagers/settle, exactly as one drop always was. Drop 10 runs ten of
   those back to back and stops when the server says the tickets ran out.
   The receipt adds up what the server settled. The board only plays back a
   settled result. */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useGamesWallet } from '@/features/arcade/components/shell/games-wallet-provider';
import { GameShell, type GameHowTo } from '@/features/arcade/components/shell/game-shell';
import { ArcadeWagerResultPlate } from '@/features/arcade/components/results/arcade-run-result';
import type { WagerReceiptRound } from '@/features/arcade/components/results/wager-receipt';
import {
  ArcadeMachine,
  MachineButton,
  MachineChoice,
  MachineGlass,
  useMachineBet,
  useMachineWide,
} from '@/features/arcade/components/wagers/arcade-machine';
import { isControlTarget, isDialogOpen } from '@/features/arcade/lib/use-first-input';
import { useFeelReducedMotion, useGameFeedback } from '@/features/arcade/lib/use-game-feedback';
import { parseArcadeRunResult, type ArcadeRunAchievement } from '@/features/arcade/lib/run-result';
import { useWagerSession, type WagerResult, type WagerSessionData } from '@/features/arcade/lib/use-wager-session';
import {
  ARCADE_MIN_BET,
  PLINKO_ALLOWED_ROWS,
  PLINKO_MULTIPLIERS,
  type PlinkoRisk,
  type PlinkoRows,
} from '@/server/arcade/arcade-constants';

import { PlinkoBoard, type PlinkoBall, type PlinkoBoardHandle } from './_plinko-board';
import { derivePlinkoPath } from './_plinko-path';

const RISKS: readonly PlinkoRisk[] = ['low', 'medium', 'high'];
const ROWS = PLINKO_ALLOWED_ROWS as readonly PlinkoRows[];
/** Balls in a drop 10. */
const STREAM_COUNT = 10;
/** The least time between two balls of a stream leaving the top. */
const STREAM_GAP_MS = 240;
/** An unsettled round is refunded by the server's cleanup: sessions older
    than 30 minutes, checked every 5 (server/arcade/arcade-session.ts). */
const HOLD_RETURN = 'Held tickets return within 35 minutes.';

const HOW_TO: GameHowTo = {
  lines: [
    'Pick a risk and rows, then press drop, or drop 10 for ten balls on one receipt.',
    "A ball pays its slot's value times your bet, within 2%.",
    'Slots run from 0.2× to 555×, and every machine returns 97% over many drops.',
  ],
};

type Settled = { seed: number; payout: number; multiplier: number; roundId?: string };

type Round = WagerReceiptRound & {
  multiplier: number;
  seed: number;
  stake: number;
  roundId: string | null;
};

/** The open receipt: every ball dropped from the first press until the
    last ball lands, across drops and drop 10s. Risk and rows hold still
    while it is open. */
type Tab = {
  id: number;
  rows: PlinkoRows;
  risk: PlinkoRisk;
  wager: number;
  /** Balls asked for. */
  asked: number;
  rounds: Round[];
  landed: number;
  /** A stream is still asking the server for balls. */
  launching: boolean;
  outOfTickets: boolean;
  /** Rounds whose settle failed or was lost: the server knows, we don't. */
  unconfirmed: number;
  achievements: ArcadeRunAchievement[];
  printed: boolean;
};

type Receipt = Omit<Tab, 'landed' | 'launching' | 'printed'> & { key: string };

function edgesRule(risk: PlinkoRisk, rows: PlinkoRows): string {
  const table = PLINKO_MULTIPLIERS[risk][rows];
  return `${table[0]}× at the edges, ${table[rows / 2]}× in the middle.`;
}

function needTickets(wager: number, balance: number): string {
  return balance < ARCADE_MIN_BET
    ? `You need ${ARCADE_MIN_BET} tickets to play.`
    : `You need ${wager} tickets for this bet.`;
}

/** Server errors in the house voice: tickets, lowercase. */
function tidyServerError(message: string | undefined, fallback: string): string {
  if (!message) return fallback;
  return message.replace(/\bTickets\b/g, 'tickets').replace(/\bcredits\b/gi, 'tickets');
}

function unconfirmedLine(count: number): string {
  return `${count} ${count === 1 ? 'drop' : 'drops'} not confirmed. ${HOLD_RETURN}`;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0';
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export default function PlinkoClient() {
  const { wallet, loaded: walletLoaded, refresh: refreshWallet, adjustCredits } = useGamesWallet();
  const { start: startSession, settle: settleSession } = useWagerSession('arcade-plinko');
  const { trigger } = useGameFeedback();
  const reducedMotion = useFeelReducedMotion();
  const wide = useMachineWide();

  const balance = walletLoaded ? wallet.credits : null;
  const [roundOpen, setRoundOpen] = useState(false);
  const [wager, setWager] = useMachineBet(balance, 10, { locked: roundOpen });
  const [rows, setRows] = useState<PlinkoRows>(12);
  const [risk, setRisk] = useState<PlinkoRisk>('medium');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const board = useRef<PlinkoBoardHandle | null>(null);
  const tabRef = useRef<Tab | null>(null);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const ballId = useRef(0);
  const tabId = useRef(0);
  /** Balls whose payout the strip hasn't shown yet: it rolls in as each
      lands. A refresh from the server shows them all, so it clears this. */
  const unshown = useRef(new Set<number>());
  const balanceRef = useRef(balance);
  balanceRef.current = balance;

  // Leaving the page (the back link is client-side) stops a stream.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** The server's balance replaces the shown one. */
  const syncWallet = useCallback(() => {
    unshown.current.clear();
    void refreshWallet();
  }, [refreshWallet]);

  /** Prints the open receipt once no stream is running and every ball has
      landed. */
  const finish = useCallback(
    (tab: Tab) => {
      if (tab.printed || tab.launching || tab.landed < tab.rounds.length) return;
      if (tabRef.current !== tab) return;
      tab.printed = true;
      setRoundOpen(false);
      syncWallet();
      const { rounds } = tab;
      if (rounds.length === 0) {
        if (tab.unconfirmed > 0) setError(unconfirmedLine(tab.unconfirmed));
        return;
      }
      setReceipt({
        key: `${tab.id}:${rounds[0].roundId ?? rounds[0].seed}`,
        id: tab.id,
        rows: tab.rows,
        risk: tab.risk,
        wager: tab.wager,
        asked: tab.asked,
        rounds: [...rounds],
        outOfTickets: tab.outOfTickets,
        unconfirmed: tab.unconfirmed,
        achievements: [...tab.achievements],
      });
      const stake = rounds.reduce((sum, round) => sum + round.stake, 0);
      const paid = rounds.reduce((sum, round) => sum + round.payout, 0);
      setAnnouncement(
        rounds.length === 1 && tab.asked === 1
          ? `${rounds[0].multiplier}× slot. Paid ${paid} tickets, net ${signed(paid - stake)}.`
          : `${rounds.length} drops. Stake ${stake}, paid ${paid}, net ${signed(paid - stake)} tickets.`,
      );
    },
    [syncWallet],
  );

  const onLand = useCallback(
    (ball: PlinkoBall) => {
      // The payout was credited when the round settled; show it as it lands.
      if (unshown.current.delete(ball.id) && ball.payout > 0) adjustCredits(ball.payout);
      const tab = tabRef.current;
      if (!tab || tab.id !== ball.batchId) return;
      tab.landed += 1;
      finish(tab);
    },
    [adjustCredits, finish],
  );

  const play = useCallback(
    async (count: number) => {
      // Answer the press this frame, before any await.
      trigger('press', { haptic: true });
      if (busyRef.current || balanceRef.current == null) return;

      // A drop while balls are still falling joins their receipt.
      const open = tabRef.current && !tabRef.current.printed ? tabRef.current : null;
      if (!open && wager > balanceRef.current) {
        setError(needTickets(wager, balanceRef.current));
        return;
      }

      busyRef.current = true;
      setBusy(true);
      setError(null);
      const tab: Tab = open ?? {
        id: ++tabId.current,
        rows,
        risk,
        wager,
        asked: 0,
        rounds: [],
        landed: 0,
        launching: true,
        outOfTickets: false,
        unconfirmed: 0,
        achievements: [],
        printed: false,
      };
      if (!open) {
        tabRef.current = tab;
        setReceipt(null);
        setAnnouncement('');
        setRoundOpen(true);
      }
      tab.launching = true;
      tab.asked += count;
      const before = tab.rounds.length;
      let lastLaunch = 0;
      let failed = false;

      for (let i = 0; i < count; i++) {
        if (!alive.current) break;
        if (i > 0) await wait(lastLaunch + STREAM_GAP_MS - performance.now());
        if (!alive.current) break;

        // The server holds the stake, so it decides whether the next ball
        // can be paid for: a 402 ends the stream.
        let session: WagerResult<WagerSessionData>;
        try {
          session = await startSession(tab.wager, { rows: tab.rows, risk: tab.risk });
        } catch {
          setError(`The machine lost its connection. ${HOLD_RETURN}`);
          failed = true;
          break;
        }
        if (!session.ok) {
          if (session.status === 402) tab.outOfTickets = true;
          else setError(`${tidyServerError(session.error, 'The machine could not start the drop.')} ${HOLD_RETURN}`);
          failed = session.status !== 402;
          break;
        }
        adjustCredits(-tab.wager);

        let settled: WagerResult<Settled>;
        try {
          settled = await settleSession<Settled>();
        } catch {
          tab.unconfirmed += 1;
          failed = true;
          break;
        }
        if (!settled.ok) {
          tab.unconfirmed += 1;
          failed = true;
          break;
        }
        const { seed, payout, multiplier } = settled.data;
        tab.achievements.push(...parseArcadeRunResult(settled.data).achievements);
        const { path, slotIndex } = await derivePlinkoPath(seed, tab.rows);
        if (PLINKO_MULTIPLIERS[tab.risk][tab.rows][slotIndex] !== multiplier && process.env.NODE_ENV !== 'production') {
          console.error('plinko: the rebuilt path does not match the settled multiplier', { seed, rows: tab.rows, risk: tab.risk });
        }
        tab.rounds.push({ seed, payout, multiplier, stake: tab.wager, roundId: settled.data.roundId ?? null });
        const id = ++ballId.current;
        unshown.current.add(id);
        if (board.current) {
          board.current.launch({ id, batchId: tab.id, seed, path, slotIndex, multiplier, payout, wager: tab.wager, rows: tab.rows });
        } else {
          tab.landed += 1; // nothing on screen to play it back
        }
        lastLaunch = performance.now();
      }

      tab.launching = false;
      busyRef.current = false;
      if (!alive.current) return;
      setBusy(false);
      const added = tab.rounds.length - before;
      if (tab.outOfTickets && added < count) {
        setError(added === 0 ? needTickets(tab.wager, balanceRef.current ?? 0) : `Out of tickets after ${added} of ${count} drops.`);
      }
      // The stream is over: if anything went wrong, show the server's
      // balance now instead of waiting for the last ball.
      if (failed || tab.outOfTickets) syncWallet();
      finish(tab);
    },
    [adjustCredits, finish, risk, rows, settleSession, startSession, syncWallet, trigger, wager],
  );

  // Space drops a ball.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return;
      if (isControlTarget(event.target) || isDialogOpen()) return;
      event.preventDefault();
      void play(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [play]);

  const affordable = roundOpen || (balance != null && wager <= balance);

  const controls = (
    <>
      <MachineChoice<PlinkoRisk>
        label='risk'
        options={RISKS.map((value) => ({ value, label: value }))}
        value={risk}
        onChange={setRisk}
        disabled={roundOpen}
      />
      <MachineChoice<PlinkoRows>
        label='rows'
        options={ROWS.map((count) => ({ value: count, label: <span className='arcade-num'>{count}</span> }))}
        value={rows}
        onChange={setRows}
        disabled={roundOpen}
      />
    </>
  );

  return (
    <GameShell game='plinko' howTo={HOW_TO}>
      <ArcadeMachine
        name='plinko'
        glass={<MachineGlass rules={[edgesRule(risk, rows)]} />}
        action={
          <>
            <MachineButton
              onClick={() => void play(1)}
              disabled={!affordable}
              aria-disabled={busy || undefined}
              aria-label={`drop, ${wager} tickets`}
            >
              drop
            </MachineButton>
            <MachineButton
              second
              onClick={() => void play(STREAM_COUNT)}
              disabled={!affordable}
              aria-disabled={busy || undefined}
              aria-label={`drop 10, ${wager} tickets each`}
            >
              drop 10
            </MachineButton>
          </>
        }
        bet={{ value: wager, onChange: setWager, balance, disabled: roundOpen }}
        controls={controls}
        receipt={receipt ? <PlinkoReceipt receipt={receipt} /> : null}
        receiptKey={receipt?.key}
        notice={error}
      >
        <PlinkoBoard
          ref={board}
          risk={risk}
          rows={rows}
          reducedMotion={reducedMotion}
          // On a phone the board is a second trigger; on wide screens the
          // buttons are the only one.
          onPress={wide ? undefined : () => void play(1)}
          onLand={onLand}
        />
      </ArcadeMachine>
      <p role='status' aria-live='polite' className='sr-only'>
        {announcement}
      </p>
    </GameShell>
  );
}

function PlinkoReceipt({ receipt }: { receipt: Receipt }) {
  const { rounds } = receipt;
  const stake = rounds.reduce((sum, round) => sum + round.stake, 0);
  const paid = rounds.reduce((sum, round) => sum + round.payout, 0);
  const single = receipt.asked === 1 && rounds.length === 1 && receipt.unconfirmed === 0 ? rounds[0] : null;
  const settings = `${receipt.risk} risk, ${receipt.rows} rows`;
  const drops =
    rounds.length < receipt.asked
      ? `${rounds.length} of ${receipt.asked} drops, ${receipt.wager} tickets each`
      : `${rounds.length} drops, ${receipt.wager} tickets each`;
  return (
    <ArcadeWagerResultPlate
      result={{ payout: paid, stake, multiplier: single ? single.multiplier : null }}
      kicker='plinko'
      headline={single ? `${single.multiplier}×` : undefined}
      detail={
        single ? (
          settings
        ) : (
          <>
            {drops}
            <br />
            {settings}
            {receipt.unconfirmed > 0 ? (
              <>
                <br />
                {unconfirmedLine(receipt.unconfirmed)}
              </>
            ) : null}
          </>
        )
      }
      rounds={single ? undefined : rounds}
      roundNoun='drops'
      fairness={single ? { seedHash: null, revealedSeed: single.seed } : null}
      achievements={receipt.achievements}
      roundId={receipt.key}
    />
  );
}

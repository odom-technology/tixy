'use client';

/**
 * Derby Royale — client composition.
 *
 * The three.js diorama (_derby-scene) always fills the stage; phase-driven
 * overlay chrome (betting board, bet slip, social rail, race HUD, results)
 * floats above it. All data flows from useDerby(); all money truth lives on
 * the server — this file is presentation and orchestration only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Flag } from 'lucide-react';
import { PageHeader, GamesWalletCard } from '@/features/arcade/components/shell/page-header';
import { useGamesWallet } from '@/features/arcade/components/shell/games-wallet-provider';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import {
  RunAchievementReveal,
  TicketPayoutBurst,
} from '@/features/arcade/components/results/arcade-run-result';
import {
  DERBY_MIN_BET,
  DERBY_HORSES,
  type DerbyPhase,
} from '@/server/arcade/derby/derby-shared';
import DerbyScene, { type DerbySceneTick } from './_derby-scene';
import {
  BetSlip,
  FairnessModal,
  HorseCard,
  RaceTicker,
  RecentWinnersStrip,
  SilkSwatch,
  SocialRail,
  TicketList,
  formatClock,
} from './_derby-lobby';
import { useDerby } from './_use-derby';

import './_derby.css';

const PHASE_LABEL: Record<DerbyPhase, string> = {
  betting: 'Betting open',
  locked: 'Post time',
  racing: "They're off!",
  results: "Winner's circle",
};

type Commentary = { text: string; key: number };

export default function DerbyClient({ userId }: { userId: string | null }) {
  const derby = useDerby(userId);
  const wallet = useGamesWallet();
  const {
    status,
    ready,
    round,
    phase,
    horses,
    countdownMs,
    script,
    raceStartsAt,
    myBets,
    chat,
    recentRounds,
    feed,
    lastResults,
    lastPayout,
    serverOffsetMs,
    placeBet,
    sendChat,
  } = derby;

  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [amount, setAmount] = useState(25);
  const [placing, setPlacing] = useState(false);
  const [betFlash, setBetFlash] = useState(false);
  const [betError, setBetError] = useState<string | null>(null);
  const [tab, setTab] = useState<'chat' | 'feed'>('chat');
  const [fairnessOpen, setFairnessOpen] = useState(false);
  const [commentary, setCommentary] = useState<Commentary | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [wireFlash, setWireFlash] = useState(0);
  const [raceOrder, setRaceOrder] = useState<number[]>([]);

  const isGuest = !userId || userId.startsWith('guest:');
  const effectivePhase: DerbyPhase = phase ?? 'betting';
  const bettingOpen = effectivePhase === 'betting' && countdownMs > 300;
  const myHorseIdxs = useMemo(() => myBets.map((b) => b.horseIdx), [myBets]);
  const totalPool = round?.totalWagered ?? 0;

  const resultsForRound = lastResults && round && lastResults.roundId === round.id ? lastResults : null;
  const winnerIdx =
    effectivePhase === 'results' ? (resultsForRound?.winnerIdx ?? script?.winnerIdx ?? null) : null;

  /** server-epoch → client-epoch for the scene's playback clock */
  const raceStartAtClientMs = raceStartsAt != null ? raceStartsAt - serverOffsetMs : null;

  /* ── sounds on phase transitions + countdown ticks ── */
  const prevPhaseRef = useRef<DerbyPhase | null>(null);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = effectivePhase;
    if (prev === null || prev === effectivePhase) return;
    if (effectivePhase === 'locked') SoundManager.play('arcadeReelTick');
    if (effectivePhase === 'racing') SoundManager.play('arcadeSpin');
    if (effectivePhase === 'results') {
      const totalStake = myBets.reduce((sum, bet) => sum + bet.amount, 0);
      const grossPayout = myBets.reduce(
        (sum, bet) =>
          sum + (winnerIdx != null && bet.horseIdx === winnerIdx
            ? Math.round(bet.amount * bet.multiplier)
            : 0),
        0,
      );
      if (grossPayout - totalStake > 0) {
        SoundManager.play(grossPayout / Math.max(1, totalStake) >= 3 ? 'arcadeBigWin' : 'arcadeWin');
      }
      void wallet.refresh();
    }
    if (effectivePhase === 'betting') {
      setPhoto(null);
      setCommentary(null);
      setRaceOrder([]);
      setBetError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivePhase]);

  const lastTickSecRef = useRef(-1);
  useEffect(() => {
    if (effectivePhase !== 'betting') return;
    const sec = Math.ceil(countdownMs / 1000);
    if (sec <= 5 && sec >= 1 && sec !== lastTickSecRef.current) {
      lastTickSecRef.current = sec;
      SoundManager.play('arcadeTick', { volume: 0.6 });
    }
  }, [countdownMs, effectivePhase]);

  useEffect(() => {
    if (lastPayout && lastPayout.payout > 0) void wallet.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastPayout]);

  /* ── race commentary engine (driven by scene ticks) ── */
  const commentaryRef = useRef({ prevLeader: -1, lastAt: 0, saidOff: false, saidStretch: false, key: 0 });
  const handleTick = useCallback(
    (tick: DerbySceneTick) => {
      setRaceOrder(tick.order);
      const state = commentaryRef.current;
      const now = Date.now();
      const say = (text: string) => {
        state.lastAt = now;
        state.key += 1;
        setCommentary({ text, key: state.key });
      };
      const leaderName = DERBY_HORSES[tick.leader].name;
      const leadU = tick.u[tick.leader];
      if (!state.saidOff && tick.raceMs > 600) {
        state.saidOff = true;
        state.prevLeader = tick.leader;
        say("And they're off!");
        return;
      }
      if (now - state.lastAt < 3200) return;
      if (!state.saidStretch && leadU > 0.8) {
        state.saidStretch = true;
        say('Down the stretch they come!');
        return;
      }
      if (state.prevLeader !== -1 && tick.leader !== state.prevLeader && leadU < 0.96) {
        const m = round?.odds.m[tick.leader] ?? 0;
        say(m >= 15 ? `${leaderName} — the longshot — takes the lead!` : `${leaderName} takes the lead!`);
        state.prevLeader = tick.leader;
        SoundManager.play('arcadeReelTick', { volume: 0.5 });
        return;
      }
      state.prevLeader = tick.leader;
      const second = tick.order[1];
      if (second != null && leadU > 0.5 && leadU - tick.u[second] < 0.008) {
        say(`${leaderName} and ${DERBY_HORSES[second].name}, nothing between them!`);
      }
    },
    [round],
  );

  const handleWinnerCross = useCallback((photoUrl: string | null, isPhoto: boolean) => {
    setWireFlash(Date.now());
    SoundManager.play('arcadeReelStop');
    if (isPhoto) {
      setCommentary({ text: 'PHOTO FINISH at the wire!', key: commentaryRef.current.key + 100 });
      if (photoUrl) setPhoto(photoUrl);
    }
  }, []);

  // reset per-race commentary state whenever a new script shows up
  useEffect(() => {
    commentaryRef.current = { prevLeader: -1, lastAt: 0, saidOff: false, saidStretch: false, key: 0 };
  }, [script]);

  /* ── betting ── */
  const handlePlace = useCallback(async () => {
    if (selectedIdx == null || placing) return;
    setPlacing(true);
    setBetError(null);
    const res = await placeBet(selectedIdx, amount);
    setPlacing(false);
    if (res.ok) {
      SoundManager.play('arcadeBet');
      wallet.adjustCredits(-amount);
      setBetFlash(true);
      setTimeout(() => setBetFlash(false), 950);
    } else {
      setBetError(res.error ?? 'Bet failed.');
    }
  }, [selectedIdx, placing, placeBet, amount, wallet]);

  /* ── per-horse form from recent rounds ── */
  const formByHorse = useMemo(() => {
    const last5 = recentRounds.slice(0, 5);
    return DERBY_HORSES.map((h) => last5.map((r) => r.winnerIdx === h.idx));
  }, [recentRounds]);

  const selectedHorse = selectedIdx != null ? horses[selectedIdx] : null;
  const myTotalPayout = useMemo(
    () => myBets.reduce((sum, b) => sum + (b.payout ?? 0), 0),
    [myBets],
  );
  const myTotalStake = useMemo(() => myBets.reduce((sum, b) => sum + b.amount, 0), [myBets]);
  const payoutForRound =
    lastPayout && lastPayout.roundNumber === round?.roundNumber ? lastPayout : null;
  const settledPayout = payoutForRound?.payout ?? myTotalPayout;
  const settledStake = payoutForRound?.stake || myTotalStake;
  const settledNet = settledPayout - settledStake;

  // live running position per horse during the race
  const racePosOf = useMemo(() => {
    if (effectivePhase !== 'racing' || raceOrder.length === 0) return null;
    const pos = new Array(raceOrder.length).fill(0);
    raceOrder.forEach((horseIdx, rank) => {
      pos[horseIdx] = rank + 1;
    });
    return pos;
  }, [effectivePhase, raceOrder]);

  const countdownLabel =
    effectivePhase === 'betting'
      ? 'Post time in'
      : effectivePhase === 'results'
        ? 'Next race in'
        : effectivePhase === 'locked'
          ? 'Gates open in'
          : 'Racing';

  return (
    <div className="min-h-full bg-background text-strong px-2 pt-3 pb-6 sm:px-4">
      <div className="mx-auto w-full max-w-[1500px] space-y-3">
        <div className="hidden sm:block">
          <PageHeader
            eyebrow="Arcade · Live"
            icon={<Flag aria-hidden className="h-6 w-6" />}
            title="Derby Royale"
            subtitle="Eight toy horses. One shared race, every three minutes. Back your pick and watch it run."
            wallet={wallet.wallet}
          />
        </div>
        <div className="sm:hidden">
          <GamesWalletCard wallet={wallet.wallet} compact />
        </div>

        <div className="derby-shell">
          {/* top bar — lives ABOVE the stage, never over it */}
          <div className="derby-topbar derby-panel">
            <span className="derby-live-dot" data-status={status} aria-hidden />
            <span className="derby-title">DERBY ROYALE</span>
            {round ? <span className="derby-round-chip">Race #{round.roundNumber}</span> : null}
            <span className="derby-round-chip">{PHASE_LABEL[effectivePhase]}</span>
            <MuteButton />
            <div className="derby-countdown" data-urgent={effectivePhase === 'betting' && countdownMs < 10_000}>
              <span className="derby-countdown-label">{countdownLabel}</span>
              {effectivePhase !== 'racing' ? (
                <span className="derby-countdown-time">{formatClock(countdownMs)}</span>
              ) : null}
            </div>
          </div>

          <div className="derby-main">
            {/* the diorama: unobstructed viewport; only ephemeral cinematics
                and a slim race HUD ever enter it */}
            <div className="derby-stage" data-phase={effectivePhase}>
              <DerbyScene
                phase={effectivePhase}
                script={script}
                raceStartAtMs={raceStartAtClientMs}
                winnerIdx={winnerIdx}
                myHorseIdxs={myHorseIdxs}
                onTick={handleTick}
                onWinnerCross={handleWinnerCross}
              />

              {/* betting: the countdown is the in-canvas focal point */}
              {effectivePhase === 'betting' ? (
                <div className="derby-commentary" data-urgent={countdownMs < 10_000}>
                  Post time in {formatClock(countdownMs)} — place your bets
                </div>
              ) : null}

              {/* racing HUD: running order + the call */}
              {effectivePhase === 'racing' && raceOrder.length > 0 ? (
                <RaceTicker order={raceOrder} horses={horses} myHorseIdxs={myHorseIdxs} />
              ) : null}
              {effectivePhase === 'racing' && commentary ? (
                <div key={commentary.key} className="derby-commentary">
                  {commentary.text}
                </div>
              ) : null}

              {/* post-time cinematic */}
              {effectivePhase === 'locked' ? (
                <div className="derby-posttime">
                  <div className="derby-posttime-inner">
                    <div className="derby-posttime-title">POST TIME</div>
                    <div className="derby-posttime-sub">Horses at the gate — betting is closed</div>
                  </div>
                </div>
              ) : null}

              {/* wire flash + photo finish polaroid */}
              {wireFlash > 0 && Date.now() - wireFlash < 600 ? <div key={wireFlash} className="derby-flash" /> : null}
              {photo && effectivePhase !== 'betting' ? (
                <div className="derby-photo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo} alt="Photo finish" />
                  <div className="derby-photo-caption">PHOTO FINISH</div>
                </div>
              ) : null}

              {/* results card, lower third — podium stays visible */}
              {effectivePhase === 'results' && winnerIdx != null ? (
                <div className="derby-results">
                  <div className="derby-results-card derby-panel">
                    <div className="derby-results-eyebrow">Winner — Race #{round?.roundNumber}</div>
                    <div className="derby-results-name">
                      <SilkSwatch silks={DERBY_HORSES[winnerIdx].silks} className="derby-feed-silk" />{' '}
                      {DERBY_HORSES[winnerIdx].name}
                    </div>
                    <div className="derby-results-mult">pays {(round?.odds.m[winnerIdx] ?? 0).toFixed(2)}×</div>
                    {myBets.length > 0 ? (
                      settledNet > 0 ? (
                        <div className="mt-3 grid gap-2">
                          <TicketPayoutBurst
                            amount={settledPayout}
                            stake={settledStake}
                            multiplier={settledPayout / Math.max(1, settledStake)}
                            net={settledNet}
                            label="Race payout"
                            sound={false}
                          />
                        </div>
                      ) : settledPayout > 0 ? (
                        <div className="derby-results-lose">
                          {settledPayout.toLocaleString()} 🎟 returned · {Math.abs(settledNet).toLocaleString()} net loss
                        </div>
                      ) : myHorseIdxs.includes(winnerIdx) ? (
                        <div className="derby-results-win">Ticket cashing…</div>
                      ) : (
                        <div className="derby-results-lose">
                          Not this time — {myTotalStake} 🎟 on the track. New field in a moment.
                        </div>
                      )
                    ) : null}
                    <RunAchievementReveal
                      achievements={payoutForRound?.achievements ?? []}
                      className="mt-3"
                    />
                    {resultsForRound && resultsForRound.topWins.length > 0 ? (
                      <div className="derby-topwins">
                        {resultsForRound.topWins.slice(0, 3).map((win, i) => (
                          <span key={i}>
                            {win.name} <span>+{win.payout.toLocaleString()}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="derby-results-next">Next post in {formatClock(countdownMs)}</div>
                  </div>
                </div>
              ) : null}

              {/* first-load veil */}
              {!ready ? (
                <div className="derby-posttime" style={{ background: 'rgba(29,18,9,0.9)', zIndex: 7 }}>
                  <div className="derby-posttime-inner">
                    <div className="derby-posttime-title" style={{ letterSpacing: '0.18em' }}>
                      DERBY ROYALE
                    </div>
                    <div className="derby-posttime-sub">Walking to the track…</div>
                  </div>
                </div>
              ) : null}
            </div>

            {/* right rail: slip morphs in place, chat/feed always available */}
            <aside className="derby-rail">
              <BetSlip
                horse={selectedHorse}
                amount={amount}
                credits={wallet.wallet.credits}
                placing={placing}
                successFlash={betFlash}
                bettingOpen={bettingOpen}
                alreadyBet={selectedIdx != null && myHorseIdxs.includes(selectedIdx)}
                error={betError}
                onAmount={setAmount}
                onPlace={handlePlace}
              />
              <TicketList myBets={myBets} horses={horses} winnerIdx={winnerIdx} />
              <SocialRail
                tab={tab}
                onTab={setTab}
                feed={feed}
                chat={chat}
                horses={horses}
                canChat={!isGuest}
                selfName={null}
                onSend={sendChat}
              />
            </aside>
          </div>

          {/* the field: race card below the stage; becomes a live leaderboard
              while the race runs */}
          <div className="derby-fieldbar derby-panel">
            <span className="derby-fieldbar-title">The field</span>
            <span className="derby-board-pool">Pool {totalPool.toLocaleString()} 🎟</span>
            <RecentWinnersStrip recentRounds={recentRounds} horses={horses} onFairness={() => setFairnessOpen(true)} />
          </div>
          <div className="derby-field-grid">
            {horses.map((horse) => (
              <HorseCard
                key={horse.idx}
                horse={horse}
                selected={selectedIdx === horse.idx}
                mine={myHorseIdxs.includes(horse.idx)}
                poolShare={totalPool > 0 ? horse.betTotal / totalPool : 0}
                formWins={formByHorse[horse.idx]}
                racePos={racePosOf ? racePosOf[horse.idx] : null}
                locked={effectivePhase !== 'betting'}
                onSelect={() => {
                  setSelectedIdx(horse.idx);
                  SoundManager.play('arcadeTick', { volume: 0.4 });
                }}
              />
            ))}
          </div>
        </div>

        {/* fairness modal (viewport level) */}
        {fairnessOpen ? (
          <FairnessModal
            seedHash={round?.seedHash ?? null}
            roundNumber={round?.roundNumber ?? null}
            recentRounds={recentRounds}
            onClose={() => setFairnessOpen(false)}
          />
        ) : null}

        <p className="text-xs text-body/70 px-1">
          A new race every ~3 minutes, around the clock — everyone bets into the same field. Minimum bet{' '}
          {DERBY_MIN_BET} 🎟. Every horse returns the same 96% over time; the odds only change how often you win. Tap
          “Provably fair” to verify any past race.
        </p>
      </div>
    </div>
  );
}

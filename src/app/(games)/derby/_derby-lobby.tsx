'use client';

/**
 * Derby Royale — overlay UI pieces (betting board, slip, social rail,
 * fairness, race HUD, results). Pure presentation; all state lives in
 * _derby-client.tsx / useDerby.
 */

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArcadeBetSelector } from '@/features/arcade/components/wagers/arcade-bet-selector';
import {
  DERBY_BET_INCREMENT,
  DERBY_MAX_BET,
  DERBY_MIN_BET,
  type DerbyChatMessage,
  type DerbyMyBet,
  type DerbyRecentRound,
} from '@/server/arcade/derby/derby-shared';
import type { DerbyFeedItem, DerbyHorseView } from './_use-derby';

export function SilkSwatch({ silks, className }: { silks: [string, string]; className?: string }) {
  return (
    <span
      aria-hidden
      className={className ?? 'derby-silks'}
      style={{
        background: `linear-gradient(135deg, ${silks[0]} 0%, ${silks[0]} 48%, ${silks[1]} 48%, ${silks[1]} 62%, ${silks[0]} 62%, ${silks[0]} 74%, ${silks[1]} 74%)`,
      }}
    />
  );
}

const PERSONALITY_LABEL: Record<string, string> = {
  'front-runner': 'Front-runner',
  stalker: 'Stalker',
  closer: 'Closer',
  erratic: 'Wildcard',
};

export function HorseCard({
  horse,
  selected,
  mine,
  poolShare,
  formWins,
  racePos,
  locked,
  onSelect,
}: {
  horse: DerbyHorseView;
  selected: boolean;
  mine: boolean;
  /** 0..1 share of this round's pool riding on this horse */
  poolShare: number;
  /** last 5 rounds: true where this horse won */
  formWins: boolean[];
  /** live running position during the race (1-based), else null */
  racePos: number | null;
  /** true outside the betting window — the card is a leaderboard row, not a button */
  locked: boolean;
  onSelect: () => void;
}) {
  // flash the odds when the multiplier changes between rounds
  const [flash, setFlash] = useState(false);
  const prevM = useRef(horse.m);
  useEffect(() => {
    if (prevM.current !== horse.m && horse.m > 0 && prevM.current > 0) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 720);
      return () => clearTimeout(t);
    }
    prevM.current = horse.m;
  }, [horse.m]);

  return (
    <button
      type="button"
      className="derby-horse-card"
      data-selected={selected}
      data-mine={mine && racePos == null}
      data-locked={locked}
      onClick={locked ? undefined : onSelect}
      aria-pressed={selected}
      aria-label={`${horse.name}, pays ${horse.m.toFixed(2)}x`}
    >
      {racePos != null ? (
        <span className="derby-race-pos" data-first={racePos === 1}>
          {racePos}
        </span>
      ) : null}
      <SilkSwatch silks={horse.silks} />
      <span className="derby-horse-main">
        <span className="derby-horse-name">{horse.name}</span>
        <span className="derby-horse-sub">
          <span className="derby-personality">{PERSONALITY_LABEL[horse.personality]}</span>
          <span className="derby-form" title="Last 5 races">
            {formWins.map((win, i) => (
              <span key={i} className="derby-form-dot" data-win={win} />
            ))}
          </span>
        </span>
      </span>
      <span className="derby-horse-odds">
        <span className="derby-odds-mult" data-flash={flash}>
          {horse.m > 0 ? `${horse.m.toFixed(2)}×` : '—'}
        </span>
        <span className="derby-odds-backed">
          {horse.betCount > 0 ? `${horse.betTotal.toLocaleString()} 🎟 · ${horse.betCount}` : 'no backers yet'}
        </span>
      </span>
      <span className="derby-heat" aria-hidden>
        <span className="derby-heat-fill" style={{ width: `${Math.round(poolShare * 100)}%` }} />
      </span>
    </button>
  );
}

export function BetSlip({
  horse,
  amount,
  credits,
  placing,
  successFlash,
  bettingOpen,
  alreadyBet,
  error,
  onAmount,
  onPlace,
}: {
  horse: DerbyHorseView | null;
  amount: number;
  credits: number;
  placing: boolean;
  successFlash: boolean;
  bettingOpen: boolean;
  alreadyBet: boolean;
  error: string | null;
  onAmount: (amount: number) => void;
  onPlace: () => void;
}) {
  const potential = horse ? Math.floor(amount * horse.m) : 0;
  const disabled = !horse || placing || !bettingOpen || amount > credits;

  // Custom amount entry: free typing in a draft field, clamped to a valid bet
  // (min/increment/balance) on commit so the preset selector never fights the
  // half-typed value.
  const [draft, setDraft] = useState('');
  const commitDraft = () => {
    const raw = Math.trunc(Number(draft));
    setDraft('');
    if (!Number.isFinite(raw) || raw <= 0) return;
    const cap = Math.min(DERBY_MAX_BET, Math.max(DERBY_MIN_BET, Math.floor(credits / DERBY_BET_INCREMENT) * DERBY_BET_INCREMENT));
    const clamped = Math.max(
      DERBY_MIN_BET,
      Math.min(cap, Math.round(raw / DERBY_BET_INCREMENT) * DERBY_BET_INCREMENT),
    );
    onAmount(clamped);
  };
  const onDraftKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitDraft();
    }
  };

  return (
    <div className="derby-slip derby-panel">
      <div className="derby-slip-title">Bet slip</div>
      {horse ? (
        <div className="derby-slip-horse">
          <SilkSwatch silks={horse.silks} className="derby-silks" />
          <span>
            {horse.name}
            <span style={{ color: 'var(--derby-gold)', marginLeft: '0.45rem' }}>{horse.m.toFixed(2)}×</span>
          </span>
        </div>
      ) : (
        <div className="derby-slip-empty">Pick a horse from the card…</div>
      )}
      <ArcadeBetSelector
        value={amount}
        onChange={onAmount}
        min={DERBY_MIN_BET}
        max={DERBY_MAX_BET}
        balance={credits}
        disabled={!bettingOpen || placing}
      />
      <div className="derby-custom-row">
        <input
          className="derby-chat-input derby-custom-input"
          type="number"
          inputMode="numeric"
          min={DERBY_MIN_BET}
          step={DERBY_BET_INCREMENT}
          placeholder="Custom amount…"
          aria-label="Custom bet amount"
          value={draft}
          disabled={!bettingOpen || placing}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={onDraftKey}
        />
        <button
          type="button"
          className="derby-chip"
          disabled={!bettingOpen || placing || !draft.trim()}
          onClick={commitDraft}
        >
          Set
        </button>
      </div>
      <div className="derby-slip-payout">
        <span>
          Wager <strong>{amount.toLocaleString()} 🎟</strong>
        </span>
        <span>
          Pays <strong>{horse ? potential.toLocaleString() : '—'}</strong>
        </span>
      </div>
      <button
        type="button"
        className="derby-bet-button"
        data-flash={successFlash ? 'success' : undefined}
        disabled={disabled}
        onClick={onPlace}
      >
        {!bettingOpen
          ? 'Betting closed'
          : placing
            ? 'Placing…'
            : amount > credits
              ? 'Not enough Tickets'
              : alreadyBet
                ? 'Update ticket'
                : 'Place bet'}
      </button>
      {error ? <div className="derby-slip-error">{error}</div> : null}
    </div>
  );
}

export function TicketList({
  myBets,
  horses,
  winnerIdx,
}: {
  myBets: DerbyMyBet[];
  horses: DerbyHorseView[];
  winnerIdx: number | null;
}) {
  if (myBets.length === 0) return null;
  return (
    <div className="derby-tickets" aria-label="My tickets">
      {myBets.map((bet) => {
        const horse = horses[bet.horseIdx];
        const won = winnerIdx != null && bet.horseIdx === winnerIdx;
        return (
          <div key={bet.horseIdx} className="derby-ticket" data-won={won}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <SilkSwatch silks={horse.silks} className="derby-feed-silk" />
              {horse.name}
            </span>
            <span>
              {bet.amount} 🎟 @ {bet.multiplier.toFixed(2)}×
              {bet.payout != null && bet.payout > 0 ? (
                <span className="derby-ticket-payout"> → {bet.payout.toLocaleString()}</span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function SocialRail({
  tab,
  onTab,
  feed,
  chat,
  horses,
  canChat,
  selfName,
  onSend,
}: {
  tab: 'chat' | 'feed';
  onTab: (tab: 'chat' | 'feed') => void;
  feed: DerbyFeedItem[];
  chat: DerbyChatMessage[];
  horses: DerbyHorseView[];
  canChat: boolean;
  selfName: string | null;
  onSend: (body: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [draft, setDraft] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);

  // stick to the bottom unless the user scrolled up
  useEffect(() => {
    const el = bodyRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [chat, feed, tab]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    const res = await onSend(body);
    setChatError(res.ok ? null : (res.error ?? 'Could not send.'));
  };

  return (
    <div className="derby-social derby-panel">
      <div className="derby-tabs" role="tablist">
        <button type="button" role="tab" className="derby-tab" data-active={tab === 'chat'} onClick={() => onTab('chat')}>
          Track chat
        </button>
        <button type="button" role="tab" className="derby-tab" data-active={tab === 'feed'} onClick={() => onTab('feed')}>
          Live bets
        </button>
      </div>
      <div
        className="derby-social-body"
        ref={bodyRef}
        onScroll={() => {
          const el = bodyRef.current;
          if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {tab === 'chat' ? (
          chat.length === 0 ? (
            <span className="derby-slip-empty">The rail is quiet. Say something.</span>
          ) : (
            chat.map((msg) => (
              <div key={msg.id} className="derby-chat-row">
                <span className="derby-chat-name" data-self={selfName != null && msg.name === selfName}>
                  {msg.name}
                </span>
                <span className="derby-chat-body">{msg.body}</span>
              </div>
            ))
          )
        ) : feed.length === 0 ? (
          <span className="derby-slip-empty">Bets roll in here as they land.</span>
        ) : (
          feed.map((item) => (
            <div key={item.id} className="derby-feed-row">
              <SilkSwatch silks={horses[item.horseIdx].silks} className="derby-feed-silk" />
              <span>
                {item.name} backed {horses[item.horseIdx].name} for{' '}
                <span className="derby-feed-amt">{item.amount} 🎟</span>
              </span>
            </div>
          ))
        )}
      </div>
      {tab === 'chat' ? (
        canChat ? (
          <form className="derby-chat-form" onSubmit={submit}>
            <input
              className="derby-chat-input"
              value={draft}
              maxLength={280}
              placeholder={chatError ?? 'Call the race…'}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Chat message"
            />
            <button type="submit" className="derby-chat-send" disabled={!draft.trim()}>
              Send
            </button>
          </form>
        ) : (
          <div className="derby-chat-hint">Sign in to join the track chat. Spectating is free.</div>
        )
      ) : null}
    </div>
  );
}

export function RecentWinnersStrip({
  recentRounds,
  horses,
  onFairness,
}: {
  recentRounds: DerbyRecentRound[];
  horses: DerbyHorseView[];
  onFairness: () => void;
}) {
  return (
    <>
      <span className="derby-strip-label">Recent winners</span>
      <span className="derby-strip-run">
        {recentRounds.slice(0, 10).map((round) => (
          <span key={round.roundNumber} className="derby-winner-pip" title={`Round #${round.roundNumber}`}>
            <SilkSwatch silks={horses[round.winnerIdx]?.silks ?? ['#888', '#666']} className="derby-feed-silk" />
            {round.winnerMultiplier.toFixed(1)}×
          </span>
        ))}
        {recentRounds.length === 0 ? <span className="derby-slip-empty">First race of the meet.</span> : null}
      </span>
      <button type="button" className="derby-fairness-chip" onClick={onFairness}>
        ✓ Provably fair
      </button>
    </>
  );
}

export function FairnessModal({
  seedHash,
  roundNumber,
  recentRounds,
  onClose,
}: {
  seedHash: string | null;
  roundNumber: number | null;
  recentRounds: DerbyRecentRound[];
  onClose: () => void;
}) {
  return (
    <div className="derby-modal-scrim" role="dialog" aria-modal="true" aria-label="Provably fair" onClick={onClose}>
      <div className="derby-modal derby-panel" onClick={(e) => e.stopPropagation()}>
        <h3>Every race is decided before you bet</h3>
        <p>
          When betting opens, the house generates a secret 32-byte seed and immediately publishes its SHA-256 hash
          below. The winner, the odds jitter, and the entire race choreography are all derived from that seed with
          HMAC-SHA256 — nothing can be changed after the hash is shown, and no bet can influence the outcome.
        </p>
        {seedHash ? (
          <div className="derby-seed-row">
            <span>Round</span>
            <code>#{roundNumber}</code>
            <span>Commitment</span>
            <code>{seedHash}</code>
          </div>
        ) : null}
        <p>
          When the race ends the seed is revealed. Check any past round: hash the revealed seed and it must equal the
          commitment shown while betting was open. Every horse pays the same 96% expected return — longshots pay more
          because they win less, exactly in proportion.
        </p>
        {recentRounds.slice(0, 3).map((round) => (
          <div key={round.roundNumber} className="derby-seed-row">
            <span>#{round.roundNumber}</span>
            <code>won by {round.winnerIdx + 1} @ {round.winnerMultiplier.toFixed(2)}×</code>
            <span>Seed</span>
            <code>{round.seed}</code>
            <span>Hash</span>
            <code>{round.seedHash}</code>
          </div>
        ))}
        <button type="button" className="derby-modal-close" onClick={onClose}>
          Back to the track
        </button>
      </div>
    </div>
  );
}

export function RaceTicker({
  order,
  horses,
  myHorseIdxs,
}: {
  order: number[];
  horses: DerbyHorseView[];
  myHorseIdxs: number[];
}) {
  // fixed rows; chips translate to their rank slot so reorders glide
  const rankOf = new Array(order.length).fill(0);
  order.forEach((horseIdx, rank) => {
    rankOf[horseIdx] = rank;
  });
  return (
    <div className="derby-hud-ticker" aria-label="Running order">
      <div style={{ position: 'relative', height: `${horses.length * 1.32}rem`, minWidth: '9.5rem' }}>
        {horses.map((horse) => (
          <div key={horse.idx} className="derby-rank-row" style={{ position: 'absolute', inset: '0 0 auto 0' }}>
            <div
              className="derby-rank-chip"
              data-mine={myHorseIdxs.includes(horse.idx)}
              style={{ transform: `translateY(${rankOf[horse.idx] * 1.32}rem)` }}
            >
              <span className="derby-rank-pos">{rankOf[horse.idx] + 1}</span>
              <SilkSwatch silks={horse.silks} className="derby-feed-silk" />
              <span className="derby-rank-name">{horse.name}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

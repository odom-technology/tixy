'use client';

/* The ticket machine frame. A wager game's cabinet: it sits in GameShell
   where GameStage goes and fills the cabinet under the strip.

     <GameShell game='dice' stat={…} howTo={HOW_TO}>
       <ArcadeMachine
         name='dice'
         glass={<MachineGlass name='dice' rules={['Roll under 50 to win.']} paytable={…} />}
         action={<MachineButton onClick={roll} aria-disabled={rolling}>roll</MachineButton>}
         bet={{ value: bet, onChange: setBet, balance, disabled: rolling }}
         receipt={result ? <ArcadeWagerResultPlate … /> : null}
         receiptKey={result?.roundId}
         notice={error}
       >
         …the playfield…
       </ArcadeMachine>
     </GameShell>

   Each machine is a screen with a 5 px bezel, a slim glass band over it
   (the rule and a `pays` button; the paytable is folded into a sheet), and
   its button or lever under it. The bet is a row of four stubs that
   scale with the player's tickets (5, 10, 25, 50 for a guest; see
   lib/bet-presets.ts), smallest first, with a custom amount from the bet
   sheet lit in its place among them, shared by every machine on the page. On phones the order is screen, bet, button.
   The receipt is the end state: it prints in a tray beside the machines on
   wide screens and over the machine on phones, and goes when the next round
   starts. Several machines side by side would use ArcadeMachineBank
   (phones show one at a time with a switcher); no game does now.

   No "All in", no provably fair badge, no risk-tier cards and no paytable
   on screen all the time: `pays` and the ? sheet show it, and the band
   lights the line that paid. The seed is on the receipt. The look is
   MACHINES_LOOK.md; moving a game onto this frame is in SHELL.md, "Moving
   a ticket machine". */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import { X } from 'lucide-react';

import { useShellHowToExtra } from '@/features/arcade/components/shell/game-shell';
import { ArcadeDialog } from '@/features/arcade/components/ui/arcade-sheet';
import { ArcadeButton, ArcadeStub } from '@/features/arcade/components/ui/arcade-ui';
import { formatNum, useNumLocale } from '@/features/arcade/components/ui/num';
import { FIXED_BET_PRESETS, betPresets, betRowStubs } from '@/features/arcade/lib/bet-presets';
import { isControlTarget, isDialogOpen } from '@/features/arcade/lib/use-first-input';
import { ARCADE_MIN_BET, MAX_TICKET_BET } from '@/server/arcade/arcade-constants';

import { MachineBetSheet } from './machine-bet-sheet';
import './arcade-machine.css';

// ── Copy and keys ───────────────────────────────────────────────────────

/** A server or network error in the house voice for `notice`: "tickets",
 *  never "Tickets" or "credits", and a full stop at the end. Falls back to
 *  the game's own sentence when the server sent nothing. */
export function machineError(message: string | null | undefined, fallback: string): string {
  const text = (message ?? '').trim() || fallback;
  const tidy = text.replace(/\bTickets\b/g, 'tickets').replace(/\bcredits\b/gi, 'tickets');
  return /[.!?]$/.test(tidy) ? tidy : `${tidy}.`;
}

/** What the frame tells the keyboard: whether a receipt is showing (and how
 *  to dismiss it) and when the last round ended. One frame is on a page at a
 *  time, so this is a module value, not context. */
const keyGate: { dismiss: ((viaKey: boolean) => void) | null; quietUntil: number } = {
  dismiss: null,
  quietUntil: 0,
};

/** A press this soon after a round ends was most likely meant for that
 *  round, so it never buys the next one. */
const KEY_QUIET_MS = 500;

/** True when the key was spent on the receipt or the quiet period, so the
 *  caller does nothing more with it. */
function gateKey(): boolean {
  if (performance.now() < keyGate.quietUntil) return true;
  if (keyGate.dismiss) {
    keyGate.dismiss(true);
    return true;
  }
  return false;
}

/** A machine's keyboard shortcut (Space by default): the main in-round
 *  action of the phase, or a new round from idle, never a cash out. It
 *  ignores held repeats, presses aimed at a button, a stub, a field or a
 *  link, and presses while a sheet is open. While a receipt is showing it
 *  dismisses the receipt instead, and for half a second after a round ends
 *  it does nothing, so a press meant for the last round can't buy the next. */
export function useMachineKey(action: (() => void) | null, codes: readonly string[] = ['Space']) {
  const ref = useRef(action);
  useEffect(() => {
    ref.current = action;
  });
  const enabled = action != null;
  const key = codes.join(',');
  useEffect(() => {
    if (!enabled) return;
    const list = key.split(',');
    const onKeyDown = (event: KeyboardEvent) => {
      if (!list.includes(event.code) || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isControlTarget(event.target) || isDialogOpen()) return;
      event.preventDefault();
      if (gateKey()) return;
      ref.current?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, key]);
}

// ── Bets ────────────────────────────────────────────────────────────────

/** The stub values for a guest or an unknown balance (PLAN.md, "Ticket
 *  machines"). A player's own stubs come from betPresets(balance). */
export const MACHINE_BET_STUBS = FIXED_BET_PRESETS;

export type MachineBet = {
  value: number;
  onChange: (value: number) => void;
  /** The player's tickets. Stubs above it can't be picked. Null while loading. */
  balance: number | null;
  /** Locks the whole row: a round is being played. */
  disabled?: boolean;
  /** Defaults to betPresets(balance): about 1%, 2.5%, 5% and 10% of the
   *  balance, or the fixed 5, 10, 25 and 50 without one. */
  stubs?: readonly number[];
  /** The game's smallest bet. Defaults to ARCADE_MIN_BET. */
  min?: number;
  /** The game's largest bet, when its own machine sets one lower (coin
   *  pusher: a drop is real coins). Defaults to MAX_TICKET_BET, which only
   *  keeps a round's win under what the ticket columns hold: a bet is any
   *  whole number up to the player's tickets. */
  max?: number;
  /** Leave out the custom amount (the bet sheet). */
  noCustom?: boolean;
  /** Bets go in multiples of this (coin pusher: 5, a coin). Defaults to 1. */
  step?: number;
  /** The row's label, lowercase. Defaults to `bet`; roulette says `chip`. */
  label?: string;
};

/** The bet a player chose, shown as the largest stub they can pay when the
 *  balance falls under it, and back to their choice when it recovers. */
export function affordableBet(
  chosen: number,
  balance: number | null,
  stubs: readonly number[] = betPresets(balance),
): number {
  if (balance == null || chosen <= balance) return chosen;
  const affordable = stubs.filter((stub) => stub <= balance);
  return affordable.length > 0 ? affordable[affordable.length - 1] : chosen;
}

/** Bet state for a machine: `[bet, setBet]`. The bet shown and sent is the
 *  player's choice, stepped down to what the balance can pay. While
 *  `locked` (a round is playing) it holds the value from the last unlocked
 *  render, whatever the balance does. Most games take the stake off the
 *  shown balance in the same render that locks the bet, so a value read
 *  while locked would be stepped down to the balance after the stake (a 50
 *  bet on 60 tickets would read 10). A receipt never takes its stake from
 *  this hook: keep the value the round was bought with, or the server's. */
export function useMachineBet(
  balance: number | null,
  initial = 10,
  options?: { locked?: boolean; stubs?: readonly number[]; step?: number; max?: number },
): [number, (value: number) => void] {
  const [chosen, setChosenRaw] = useState(initial);
  const unit = Math.max(1, Math.floor(options?.step ?? 1));
  const ceiling = Math.min(options?.max ?? MAX_TICKET_BET, MAX_TICKET_BET);
  // Whole numbers (multiples of `step`) up to the ceiling; a bet over the
  // player's tickets is stepped down below, and the server refuses it too.
  const setChosen = useCallback(
    (value: number) => setChosenRaw(Math.max(unit, Math.min(ceiling, Math.round(value / unit) * unit))),
    [unit, ceiling],
  );
  const current = affordableBet(chosen, balance, options?.stubs ?? betPresets(balance, undefined, ceiling));
  const locked = options?.locked ?? false;
  const [lastUnlocked, setLastUnlocked] = useState(current);
  // Derived state, set during render so the shown and sent bet agree.
  if (!locked && lastUnlocked !== current) setLastUnlocked(current);
  return [locked ? lastUnlocked : current, setChosen];
}

function sameStubs(a: readonly number[], b: readonly number[]) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function BetRow({ bet }: { bet: MachineBet }) {
  const min = Math.max(bet.min ?? ARCADE_MIN_BET, ARCADE_MIN_BET);
  // The stubs follow the balance, but hold still while a round plays: the
  // stake comes off the shown balance and the row must not reshuffle.
  const ceiling = Math.min(bet.max ?? MAX_TICKET_BET, MAX_TICKET_BET);
  const live = bet.stubs ?? betPresets(bet.balance, min, ceiling);
  const [held, setHeld] = useState(live);
  const presets = bet.disabled ? held : live;
  if (!bet.disabled && !sameStubs(held, live)) setHeld(live);
  // A bet that isn't a preset (the game's opening 10, or one from the bet
  // sheet) sits among the stubs in its place, smallest first. It stays
  // there after the player picks a preset, so the row doesn't shift under
  // the pointer; the next custom bet takes its place.
  const [extra, setExtra] = useState<number | null>(null);
  const isPreset = presets.includes(bet.value);
  if (!isPreset && bet.value >= min && extra !== bet.value) setExtra(bet.value);
  const stubs = betRowStubs(presets, isPreset ? extra : bet.value, min, ceiling);
  const labelId = useId();
  const locale = useNumLocale();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // On a phone the label, stubs and custom share one line when they fit;
  // five long stubs don't, and then custom moves up beside the label.
  const rowRef = useRef<HTMLDivElement>(null);
  const stacked = useStackWhenCramped(rowRef, stubs.join(','));
  const [sheetOpen, setSheetOpen] = useState(false);
  const payable = (stub: number) => bet.balance != null && stub <= bet.balance && stub >= min;
  const usable = (stub: number) => !bet.disabled && payable(stub);
  const checkedIndex = stubs.indexOf(bet.value);
  // One tab stop: the checked stub, even when it can't be picked now.
  const tabIndexAt = checkedIndex >= 0 ? checkedIndex : 0;
  const canCustom = !bet.disabled && bet.balance != null && bet.balance >= min;
  // A round that starts closes the sheet: the bet row locks mid-round.
  if (sheetOpen && !canCustom) setSheetOpen(false);

  const pick = (index: number) => {
    bet.onChange(stubs[index]);
    refs.current[index]?.focus();
  };

  // A radio group: arrows move and wrap, Home and End jump. Only stubs the
  // player can pay are picked; the rest are skipped.
  const onKeyDown = (event: ReactKeyboardEvent, index: number) => {
    const usableIndexes = stubs.map((stub, i) => (usable(stub) ? i : -1)).filter((i) => i >= 0);
    if (usableIndexes.length === 0) return;
    let next: number | null = null;
    if (event.key === 'Home') next = usableIndexes[0];
    else if (event.key === 'End') next = usableIndexes[usableIndexes.length - 1];
    else {
      const step =
        event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
      if (!step) return;
      for (let k = 1; k <= stubs.length; k++) {
        const i = (index + step * k + stubs.length * k) % stubs.length;
        if (usable(stubs[i])) {
          next = i;
          break;
        }
      }
    }
    event.preventDefault();
    if (next != null) pick(next);
  };

  return (
    <div ref={rowRef} className='arc-machine-bet' data-stacked={stacked || undefined}>
      <span id={labelId} className='arc-machine-label'>
        {bet.label ?? 'bet'}
      </span>
      <div role='radiogroup' aria-labelledby={labelId} className='arc-machine-stubs'>
        {stubs.map((stub, index) => {
          const on = stub === bet.value;
          const ok = usable(stub);
          return (
            <button
              key={stub}
              ref={(el) => {
                refs.current[index] = el;
              }}
              type='button'
              role='radio'
              aria-checked={on}
              aria-label={`${stub} tickets`}
              // aria-disabled keeps a stub focusable, so the group always has
              // its tab stop; presses on it do nothing.
              aria-disabled={!ok || undefined}
              tabIndex={index === tabIndexAt ? 0 : -1}
              className='arc-machine-stub'
              data-on={on || undefined}
              data-unpayable={!payable(stub) || undefined}
              onClick={() => {
                if (ok) bet.onChange(stub);
              }}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <ArcadeStub size='md' muted={!on}>
                {formatNum(stub, { locale })}
              </ArcadeStub>
            </button>
          );
        })}
      </div>
      {bet.noCustom ? null : (
        <>
          {/* Any other amount: opens the bet sheet. The bet it sets joins the
              stubs, lit, in its place. */}
          <button
            type='button'
            className='arc-machine-custom'
            aria-haspopup='dialog'
            aria-label='custom bet'
            aria-disabled={!canCustom || undefined}
            onClick={() => {
              if (canCustom) setSheetOpen(true);
            }}
          >
            custom
          </button>
          <MachineBetSheet
            open={sheetOpen}
            onClose={() => setSheetOpen(false)}
            value={bet.value}
            onSet={bet.onChange}
            balance={bet.balance}
            min={min}
            max={ceiling}
            stubs={presets}
            step={bet.step}
          />
        </>
      )}
    </div>
  );
}

// ── Choices ─────────────────────────────────────────────────────────────

/** A row of options for a machine (plinko's risk and rows, a mine
 *  count). The selected one is lit on the ink (a raised face, paper text),
 *  never the paper of the big button. Each option stays on one line; when
 *  the row doesn't fit its column, the options stack one per line instead. */
export function MachineChoice<T extends string | number>({
  label,
  options,
  value,
  onChange,
  disabled,
  hideLabel,
}: {
  /** Lowercase. */
  label: string;
  /** Keep the label for screen readers only. */
  hideLabel?: boolean;
  options: readonly { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const labelId = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  const stacked = useStackWhenCramped(groupRef, options.map((option) => String(option.value)).join('|'));
  return (
    <div className='arc-machine-choice-wrap' data-stacked={stacked || undefined}>
      <span id={labelId} className={hideLabel ? 'sr-only' : 'arc-machine-label'}>
        {label}
      </span>
      <div
        ref={groupRef}
        role='group'
        aria-labelledby={labelId}
        className='arc-machine-choice'
        data-stacked={stacked || undefined}
      >
        {options.map((option) => (
          <button
            key={String(option.value)}
            type='button'
            aria-pressed={option.value === value}
            disabled={disabled && option.value !== value}
            aria-disabled={disabled || undefined}
            onClick={() => {
              if (!disabled) onChange(option.value);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** True when a row of one-line options is wider than its box. The row's own
 *  width is remembered while it overflows, so the options go back on one
 *  line once the box is wide enough again. */
function useStackWhenCramped(ref: RefObject<HTMLElement | null>, key: string): boolean {
  const [stacked, setStacked] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let need = 0;
    const measure = () => {
      if (el.dataset.stacked == null) {
        if (el.scrollWidth > el.clientWidth + 1) {
          need = el.scrollWidth;
          setStacked(true);
        }
      } else if (need > 0 && el.clientWidth >= need) {
        setStacked(false);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
      setStacked(false);
    };
  }, [ref, key]);
  return stacked;
}

// ── The glass ───────────────────────────────────────────────────────────

/** One paytable line. `lit` marks the line that just paid. */
export type MachinePaytableRow = { label: ReactNode; value: ReactNode; lit?: boolean };

/** How long the band shows the line that paid before the rule comes back. */
export const MACHINE_PAID_MS = 2400;

/** On the band a rule that leads into the paytable ("…pays its bet
 *  times:") ends with a full stop, since the paytable is folded. */
function bandRule(rule: string): string {
  return rule.replace(/:\s*$/, '.');
}

/** What is printed on a machine's glass. The glass is one slim band over the
 *  screen: the rules as a sentence and, when there is a paytable, a `pays`
 *  button. The paytable is folded: `pays` opens a sheet with the rules, the
 *  paytable and `children` (slots' paylines), and the ? sheet shows the
 *  same. When a line pays (`lit`), the band shows that line in red for
 *  MACHINE_PAID_MS in place of the rule. The name shows only in a bank of
 *  machines; a single machine's name is already in the strip.
 *  Lowercase name and labels, rules as sentences, values as numbers. */
export function MachineGlass({
  name,
  rules,
  paytable,
  printed = false,
  children,
}: {
  name?: string;
  rules?: readonly string[];
  paytable?: readonly MachinePaytableRow[];
  /** Print the paytable on the glass, small and quiet, in place of the rule
   *  and the pays button, the way the real machine reads (video poker). The
   *  line that pays lights in place while it pays. */
  printed?: boolean;
  /** More for the pays sheet, under the paytable. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const hasTable = paytable != null && paytable.length > 0;
  const litIndex = paytable?.findIndex((row) => row.lit) ?? -1;
  const lit = litIndex >= 0 ? paytable![litIndex] : null;

  // The line that paid shows on the band for a moment, then the rule.
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (litIndex < 0) {
      setFlash(false);
      return;
    }
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), MACHINE_PAID_MS);
    return () => window.clearTimeout(timer);
  }, [litIndex]);

  const pays = (
    <MachinePays rules={rules} paytable={paytable}>
      {children}
    </MachinePays>
  );
  // The ? sheet shows the paytable too.
  useShellHowToExtra(hasTable ? () => pays : null);

  const rule = rules && rules.length > 0 ? rules.map(bandRule).join(' ') : null;
  // On a wide frame the band is one line; a rule too long for it is cut
  // with an ellipsis, and the whole rule is in the title, `pays` and ?.
  if (!name && !rule && !hasTable) return null;
  if (printed && hasTable) {
    return (
      <div className='arc-machine-glass' data-printed=''>
        {name ? <h2 className='arc-machine-name'>{name}</h2> : null}
        <dl className='arc-machine-printed'>
          {paytable!.map((row, index) => (
            <div key={index} data-lit={row.lit || undefined}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }
  return (
    <div className='arc-machine-glass' data-flash={(flash && lit != null) || undefined}>
      {name ? <h2 className='arc-machine-name'>{name}</h2> : null}
      <div className='arc-machine-glass-line'>
        {rule ? (
          <p className='arc-machine-rule' title={rule}>
            {rule}
          </p>
        ) : null}
        {lit ? (
          <p className='arc-machine-paid' aria-hidden='true'>
            <span>{lit.label}</span>
            <b>{lit.value}</b>
          </p>
        ) : null}
      </div>
      {hasTable ? (
        <>
          <button
            type='button'
            className='arc-machine-pays'
            aria-haspopup='dialog'
            onClick={() => setOpen(true)}
          >
            pays
          </button>
          <ArcadeDialog open={open} onClose={() => setOpen(false)} title={name ? `${name} pays` : 'pays'}>
            {pays}
          </ArcadeDialog>
        </>
      ) : null}
    </div>
  );
}

/** The folded paytable, on paper: the rules, then one line per pay, best
 *  first as the game lists them, the line that just paid in red. */
export function MachinePays({
  rules,
  paytable,
  children,
}: {
  rules?: readonly string[];
  paytable?: readonly MachinePaytableRow[];
  children?: ReactNode;
}) {
  return (
    <div className='arc-machine-pays-sheet'>
      {rules?.map((rule) => (
        <p key={rule}>{rule}</p>
      ))}
      {paytable && paytable.length > 0 ? (
        <dl className='arc-machine-pays-table'>
          {paytable.map((row, index) => (
            <div key={index} data-lit={row.lit || undefined}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {children}
    </div>
  );
}

// ── The button ──────────────────────────────────────────────────────────

/** A machine's big button. Pass any number in `action`; they share the row
 *  equally. `second` is the quieter one (plinko's drop 10). One or two
 *  lowercase words. While a round plays, pass `aria-disabled` instead of
 *  `disabled` so focus stays put; the click is ignored. A crank or a lever
 *  is a different element passed through `action` the same way. */
export function MachineButton({
  second = false,
  className,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { second?: boolean }) {
  const inert = props['aria-disabled'] === true || props['aria-disabled'] === 'true';
  return (
    <ArcadeButton
      {...props}
      tone={second ? 'default' : 'primary'}
      size='lg'
      className={['arc-machine-button', className].filter(Boolean).join(' ')}
      data-second={second || undefined}
      onClick={(event) => {
        if (inert) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    />
  );
}

// ── Layout ──────────────────────────────────────────────────────────────

const WIDE_QUERY = '(min-width: 64rem)';

/** How long a phone shows the round's result before the receipt covers it.
 *  Long enough to read where the ball, the wheel or the cards ended up: at
 *  900 ms the receipt covered the result before it read. The button stays
 *  live under it, so the next round never waits for this. */
const PHONE_RECEIPT_HOLD_MS = 1800;

function subscribeWide(listener: () => void) {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

/** True when the frame shows every machine and a receipt tray (64rem and
 *  up). False on phones and small tablets: one machine at a time, the
 *  receipt over it. */
export function useMachineWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );
}

export type MachineUnit = {
  /** Stable id, also what `active` refers to. */
  id: string;
  /** The machine's name: the switcher's label on phones and its landmark
   *  name. Lowercase. */
  label: string;
  /** Printed above the screen: a <MachineGlass>. */
  glass?: ReactNode;
  /** The playfield. */
  screen: ReactNode;
  /** <MachineButton>s, a crank or a lever. They share the row equally. */
  action: ReactNode;
};

export type ArcadeMachineBankProps = {
  machines: readonly MachineUnit[];
  /** The machine the keyboard plays and phones show. */
  active: string;
  onActiveChange: (id: string) => void;
  /** The stub row. Leave it out for a machine that takes its bet another
   *  way. */
  bet?: MachineBet;
  /** Game options shared by every machine: <MachineChoice> rows. */
  controls?: ReactNode;
  /** The end state: <ArcadeWagerResultPlate>. Null while a round plays. */
  receipt?: ReactNode;
  /** A new value opens the receipt again after it was dismissed (the phone
   *  overlay closes, the wide tray empties). */
  receiptKey?: string | number | null;
  /** Which machine printed the receipt; phones draw it over that machine.
   *  Defaults to `active`. */
  receiptFor?: string;
  /** One sentence when something went wrong, with a full stop: "You need
   *  10 tickets for this bet." */
  notice?: ReactNode;
  /** Locks the phone switcher while a round plays. */
  switcherDisabled?: boolean;
};

/** Several machines side by side, one bet row, one receipt. */
export function ArcadeMachineBank({
  machines,
  active,
  onActiveChange,
  bet,
  controls,
  receipt,
  receiptKey,
  receiptFor,
  notice,
  switcherDisabled,
}: ArcadeMachineBankProps) {
  const wide = useMachineWide();
  const hasReceipt = receipt != null && receipt !== false;
  const [closedKey, setClosedKey] = useState<string | number | null | undefined>(undefined);
  const key = receiptKey ?? null;
  const receiptShown = hasReceipt && closedKey !== key;
  // On phones the receipt covers the screen, so it waits a beat: the round's
  // own result (the line that paid, the hand that won) shows first.
  const [heldKey, setHeldKey] = useState<string | number | null | undefined>(undefined);
  useEffect(() => {
    if (!hasReceipt || wide || heldKey === key) return;
    const timer = window.setTimeout(() => setHeldKey(key), PHONE_RECEIPT_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [hasReceipt, wide, key, heldKey]);
  const overlayOpen = receiptShown && !wide && heldKey === key;
  const owner = receiptFor ?? active;
  const many = machines.length > 1;
  const sections = useRef(new Map<string, HTMLElement>());

  // Closing the receipt puts focus on that machine's first button, so a
  // keyboard or switch player lands where the next round starts.
  // Closing with a key leaves focus alone: a focused button would take the
  // key's release as a press and start the next round.
  const close = useCallback(
    (viaKey = false) => {
      setClosedKey(key);
      if (viaKey) return;
      const section = sections.current.get(owner);
      const button = section?.querySelector<HTMLElement>('.arc-machine-actions button:not([disabled])');
      requestAnimationFrame(() => button?.focus({ preventScroll: true }));
    },
    [key, owner],
  );

  // Tell the keyboard when a round has just ended and while a receipt is up.
  useEffect(() => {
    if (!receiptShown) return;
    keyGate.quietUntil = performance.now() + KEY_QUIET_MS;
  }, [receiptShown, key]);
  useEffect(() => {
    if (!receiptShown) return;
    keyGate.dismiss = close;
    return () => {
      if (keyGate.dismiss === close) keyGate.dismiss = null;
    };
  }, [receiptShown, close]);

  // A machine button that kept focus from the last round would take Space
  // or Enter as a press. While a receipt is up or just printed, that press
  // dismisses the receipt instead.
  useEffect(() => {
    const swallowed = new Set<string>();
    const onDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.code !== 'Enter' && event.code !== 'NumpadEnter') return;
      if (!(event.target instanceof Element) || !event.target.closest('.arc-machine-actions')) return;
      if (event.repeat ? !swallowed.has(event.code) : !gateKey()) return;
      swallowed.add(event.code);
      event.preventDefault();
      event.stopPropagation();
    };
    const onUp = (event: KeyboardEvent) => {
      if (!swallowed.delete(event.code)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
    };
  }, []);

  useEffect(() => {
    if (!overlayOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlayOpen, close]);

  return (
    <div className='arc-machine-frame' data-many={many || undefined} data-wide={wide || undefined}>
      {many ? (
        <div className='arc-machine-switch' data-surface='ink'>
          <MachineChoice
            label='machine'
            options={machines.map((machine) => ({ value: machine.id, label: machine.label }))}
            value={active}
            onChange={onActiveChange}
            disabled={switcherDisabled}
            hideLabel
          />
        </div>
      ) : null}
      <div className='arc-machine-row'>
        {machines.map((machine) => (
          <section
            key={machine.id}
            ref={(el) => {
              if (el) sections.current.set(machine.id, el);
              else sections.current.delete(machine.id);
            }}
            className='arc-machine'
            data-active={machine.id === active || undefined}
            aria-label={machine.label}
            onPointerDownCapture={() => {
              if (machine.id !== active) onActiveChange(machine.id);
            }}
          >
            {/* The receipt layer covers the glass and the screen on phones.
                It is their sibling, outside the ink token scope, so the
                paper receipt keeps paper buttons. */}
            <div className='arc-machine-body'>
              {machine.glass ? <div className='arc-machine-glass-wrap'>{machine.glass}</div> : null}
              <div className='arc-machine-screen border-tixy-bezel' data-surface='ink'>
                {machine.screen}
              </div>
              {overlayOpen && machine.id === owner ? (
                <div
                  className='arc-machine-overlay'
                  onClick={(event) => {
                    if (event.target === event.currentTarget) close();
                  }}
                >
                  {/* The close button sits beside the printer, not under
                      the slip, so a whole receipt fits over a phone's
                      screen without scrolling. */}
                  <div className='arc-machine-overlay-body'>
                    {receipt}
                    <ArcadeButton
                      tone='default'
                      size='icon'
                      onClick={() => close()}
                      className='arc-machine-close'
                      aria-label='close the receipt'
                    >
                      <X size={20} strokeWidth={2.5} strokeLinecap='square' aria-hidden />
                    </ArcadeButton>
                  </div>
                </div>
              ) : null}
            </div>
            <div className='arc-machine-actions' data-surface='ink'>
              {machine.action}
            </div>
          </section>
        ))}
      </div>
      <div className='arc-machine-deck'>
        {bet || controls || notice ? (
          <div className='arc-machine-deck-controls' data-surface='ink'>
            {bet ? <BetRow bet={bet} /> : null}
            {controls ? <div className='arc-machine-controls'>{controls}</div> : null}
            {notice ? (
              <p className='arc-machine-notice' role='alert'>
                {notice}
              </p>
            ) : null}
          </div>
        ) : null}
        {wide ? (
          <div className='arc-machine-tray'>
            {/* Nothing until a receipt prints: the slip brings its own
                printer slot, at the top of the tray, so nothing shifts. */}
            {receiptShown ? receipt : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export type ArcadeMachineProps = Omit<
  ArcadeMachineBankProps,
  'machines' | 'active' | 'onActiveChange' | 'receiptFor' | 'switcherDisabled'
> & {
  /** The machine's name, lowercase: its landmark name for screen readers. */
  name: string;
  glass?: ReactNode;
  action: ReactNode;
  /** The playfield. */
  children: ReactNode;
};

/** One machine: what every wager game uses. */
export function ArcadeMachine({ name, glass, action, children, ...rest }: ArcadeMachineProps) {
  return (
    <ArcadeMachineBank
      {...rest}
      machines={[{ id: name, label: name, glass, screen: children, action }]}
      active={name}
      onActiveChange={noop}
    />
  );
}

function noop() {}

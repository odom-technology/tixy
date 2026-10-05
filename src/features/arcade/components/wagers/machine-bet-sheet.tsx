'use client';

/* The bet sheet: a custom amount for a machine's bet. It opens from the
   "custom" button at the end of the stub row (a bottom sheet on phones, a
   modal from sm up) and holds one field with a number keypad on phones,
   a step down and a step up, the stub presets, the game's minimum and the
   most this player can bet as numbers, an all in button, and what the bet
   leaves of the balance. Any whole number from the minimum to the player's
   tickets (up to `max`, the game's ceiling); the server checks the same
   range and the balance (invalidBetMessage in arcade-constants, and the
   wallet debit). */

import { Minus, Plus } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import { ArcadeButton, ArcadeStub } from '@/features/arcade/components/ui/arcade-ui';
import { ArcadeDialog } from '@/features/arcade/components/ui/arcade-sheet';
import { Num, formatNum, useNumLocale } from '@/features/arcade/components/ui/num';
import { SoundManager } from '@/features/arcade/lib/sound-manager';

import './machine-bet-sheet.css';

/** A held step button repeats after this long, then every REPEAT_MS. */
const HOLD_MS = 380;
const REPEAT_MS = 70;
/** After this many repeats a held step moves by 5. */
const FAST_AFTER = 12;

export function MachineBetSheet({
  open,
  onClose,
  value,
  onSet,
  balance,
  min,
  max,
  stubs,
  step = 1,
}: {
  open: boolean;
  onClose: () => void;
  /** The bet now; the field starts on it. */
  value: number;
  onSet: (value: number) => void;
  balance: number | null;
  min: number;
  /** The game's largest bet. The player can bet up to their tickets, or this. */
  max: number;
  stubs: readonly number[];
  /** Bets go in multiples of this. */
  step?: number;
}) {
  return (
    <ArcadeDialog open={open} onClose={onClose} title='bet' tone='cream' maxWidth={360}>
      {/* Remounted on every open, so the field starts on the current bet. */}
      {open ? (
        <SheetBody
          value={value}
          balance={balance}
          min={min}
          max={max}
          stubs={stubs}
          unit={Math.max(1, Math.floor(step))}
          onSet={(next) => {
            onSet(next);
            onClose();
          }}
        />
      ) : null}
    </ArcadeDialog>
  );
}

function SheetBody({
  value,
  onSet,
  balance,
  min,
  max,
  stubs,
  unit,
}: {
  value: number;
  onSet: (value: number) => void;
  balance: number | null;
  min: number;
  max: number;
  stubs: readonly number[];
  unit: number;
}) {
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);
  const noteId = useId();
  const locale = useNumLocale();
  const fmt = (n: number) => formatNum(n, { locale });

  const amount = draft === '' ? null : Number.parseInt(draft, 10);
  // The most this player can bet: all their tickets, up to the game's ceiling,
  // on the bet grid. With no balance (it can't be, once the sheet opens) the
  // ceiling stands in.
  const top = Math.max(min, Math.floor(Math.min(max, balance ?? max) / unit) * unit);
  const inRange = amount != null && amount >= min && amount <= max && amount % unit === 0;
  const range = unit === 1 ? `from ${min} to ${fmt(max)}` : `in ${unit === 5 ? 'fives' : `steps of ${unit}`}, from ${min} to ${fmt(max)}`;
  const affordable = amount != null && balance != null && amount <= balance;
  const valid = inRange && affordable;
  // All in is the whole balance; under a game's own ceiling it is that
  // ceiling, and says so.
  const allIn = balance != null && balance >= min ? top : null;
  const allInLabel = balance != null && top >= Math.floor(balance / unit) * unit ? 'all in' : 'max';

  // The field takes focus and selects its value, so typing replaces it.
  // The sheet and the modal focus their own container once they have
  // opened; when that happens the focus moves on to the field.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const take = () => {
      input.focus({ preventScroll: true });
      input.select();
    };
    const dialog = input.closest<HTMLElement>('[role="dialog"]');
    const onFocusIn = (event: FocusEvent) => {
      if (event.target === dialog) take();
    };
    dialog?.addEventListener('focusin', onFocusIn);
    const frame = requestAnimationFrame(take);
    return () => {
      cancelAnimationFrame(frame);
      dialog?.removeEventListener('focusin', onFocusIn);
    };
  }, []);

  const set = (next: number) => {
    setDraft(String(Math.max(min, Math.min(top, Math.round(next / unit) * unit))));
  };

  const step = (by: number) => {
    setDraft((current) => {
      const from = current === '' ? (by > 0 ? min - by : min) : Number.parseInt(current, 10);
      // Off the grid (a typed 37 with unit 5): the step lands on the grid.
      const snapped = by > 0 ? Math.floor(from / unit) * unit : Math.ceil(from / unit) * unit;
      return String(Math.max(min, Math.min(top, snapped + by)));
    });
    SoundManager.play('arcadeTick');
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid || amount == null) return;
    SoundManager.play('arcadeBet');
    onSet(amount);
  };

  const onFieldKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      step((event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 5 : 1) * unit);
    }
  };

  let note: ReactNode;
  let tone: 'ok' | 'bad' = 'ok';
  if (amount == null) {
    note = `Type a bet ${range}.`;
  } else if (!inRange) {
    tone = 'bad';
    note = `Bets go ${range}.`;
  } else if (balance == null) {
    note = ' ';
  } else if (!affordable) {
    tone = 'bad';
    note = (
      <>
        You have <Num value={balance} /> tickets.
      </>
    );
  } else {
    const left = balance - amount;
    note = (
      <>
        Leaves <Num value={left} /> {left === 1 ? 'ticket' : 'tickets'}.
      </>
    );
  }

  const atMin = amount != null && amount <= min;
  const atMax = amount != null && amount >= top;

  return (
    <form className='arc-bet-sheet' onSubmit={submit} noValidate>
      <div className='arc-bet-sheet-amount'>
        <StepButton label={unit === 1 ? 'one less' : `${unit} less`} onStep={() => step(-unit)} onFast={() => step(-5 * unit)} disabled={atMin}>
          <Minus size={22} strokeWidth={2.5} strokeLinecap='square' aria-hidden />
        </StepButton>
        <label className='arc-bet-sheet-field'>
          <span className='sr-only'>bet in tickets</span>
          <input
            ref={inputRef}
            type='text'
            inputMode='numeric'
            pattern='[0-9]*'
            enterKeyHint='done'
            autoComplete='off'
            maxLength={String(max).length}
            value={draft}
            aria-describedby={noteId}
            aria-invalid={amount != null && !valid ? true : undefined}
            onChange={(event) => setDraft(event.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, ''))}
            onKeyDown={onFieldKey}
          />
        </label>
        <StepButton label={unit === 1 ? 'one more' : `${unit} more`} onStep={() => step(unit)} onFast={() => step(5 * unit)} disabled={atMax}>
          <Plus size={22} strokeWidth={2.5} strokeLinecap='square' aria-hidden />
        </StepButton>
      </div>
      <div className='arc-bet-sheet-range' aria-hidden='true'>
        <span>
          <Num value={min} /> min
        </span>
        <span>
          <Num value={top} /> max
        </span>
      </div>
      <div className='arc-bet-sheet-stubs' role='group' aria-label='presets'>
        {stubs.map((stub) => (
          <button
            key={stub}
            type='button'
            className='arc-bet-sheet-stub'
            aria-label={`${stub} tickets`}
            aria-pressed={amount === stub}
            onClick={() => {
              set(stub);
              SoundManager.play('arcadeTick');
            }}
          >
            <ArcadeStub size='md' muted={amount !== stub}>
              {fmt(stub)}
            </ArcadeStub>
          </button>
        ))}
      </div>
      {allIn != null ? (
        <button
          type='button'
          className='arc-bet-sheet-allin'
          aria-label={`${allInLabel}, ${fmt(allIn)} tickets`}
          onClick={() => {
            SoundManager.play('arcadeBet');
            onSet(allIn);
          }}
        >
          {allInLabel}
          <span className='arc-bet-sheet-allin-amount'>
            <Num value={allIn} />
          </span>
        </button>
      ) : null}
      <p id={noteId} className='arc-bet-sheet-note' data-tone={tone} aria-live='polite'>
        {note}
      </p>
      <ArcadeButton type='submit' tone='primary' size='lg' disabled={!valid} className='arc-bet-sheet-set'>
        {valid && amount != null ? `bet ${formatNum(amount, { locale })}` : 'bet'}
      </ArcadeButton>
    </form>
  );
}

/** A step button: one step on a press, repeating while held, by 5 once it
 *  has run a while. Keyboard presses step once each. */
function StepButton({
  label,
  onStep,
  onFast,
  disabled,
  children,
}: {
  label: string;
  onStep: () => void;
  onFast: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  const timer = useRef<number | null>(null);
  const held = useRef(false);
  const stepRef = useRef({ onStep, onFast });
  useEffect(() => {
    stepRef.current = { onStep, onFast };
  });

  const stop = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  useEffect(() => {
    if (disabled) stop();
  }, [disabled]);

  const start = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
    held.current = true;
    stepRef.current.onStep();
    let count = 0;
    const repeat = () => {
      count += 1;
      if (count > FAST_AFTER) stepRef.current.onFast();
      else stepRef.current.onStep();
      timer.current = window.setTimeout(repeat, REPEAT_MS);
    };
    timer.current = window.setTimeout(repeat, HOLD_MS);
  };

  return (
    <button
      type='button'
      className='arc-bet-sheet-step'
      aria-label={label}
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(event) => event.preventDefault()}
      onClick={() => {
        // A pointer press already stepped on pointerdown; a key press steps here.
        if (held.current) {
          held.current = false;
          return;
        }
        stepRef.current.onStep();
      }}
    >
      {children}
    </button>
  );
}

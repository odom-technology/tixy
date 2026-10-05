'use client';

/* The site's select: a button that opens a list, in place of a native
   <select> (docs/design/tixy-rebrand/PROFILES.md). Same keyboard as the
   platform's: arrows, Home and End, Enter or Space to pick, Escape to close,
   and typing a few letters jumps to the first match. Options can carry art
   (a game still, an avatar, an item) and a second line. The list opens
   below, or above when the page has no room below; it moves on one axis
   only, and not at all with reduced motion. */

import { Check, ChevronDown } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import './tixy-select.css';

export type TixySelectOption<T extends string = string> = {
  value: T;
  label: string;
  /** A short second line. */
  hint?: string;
  /** Art at the start of the row: an image, a still, a swatch. */
  art?: ReactNode;
  disabled?: boolean;
};

export type TixySelectProps<T extends string = string> = {
  value: T | '';
  onChange: (value: T) => void;
  options: readonly TixySelectOption<T>[];
  /** Shown when nothing is picked. */
  placeholder?: string;
  /** The accessible name, when no visible label is tied by `labelledBy`. */
  label?: string;
  labelledBy?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  /** 'quiet' sits on paper 2 surfaces; the default sits on paper. */
  tone?: 'paper' | 'quiet';
};

export function TixySelect<T extends string = string>({
  value,
  onChange,
  options,
  placeholder = 'pick one',
  label,
  labelledBy,
  id,
  disabled = false,
  className,
  tone = 'paper',
}: TixySelectProps<T>) {
  const autoId = useId();
  const buttonId = id ?? `${autoId}-button`;
  const listId = `${autoId}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = useRef({ text: '', at: 0 });

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  const firstEnabled = useCallback(
    (from: number, step: 1 | -1) => {
      for (let i = from; i >= 0 && i < options.length; i += step) {
        if (!options[i]?.disabled) return i;
      }
      return -1;
    },
    [options],
  );

  const openList = useCallback(
    (at?: number) => {
      if (disabled || options.length === 0) return;
      setActive(at ?? (selectedIndex >= 0 ? selectedIndex : firstEnabled(0, 1)));
      setOpen(true);
    },
    [disabled, options.length, selectedIndex, firstEnabled],
  );

  const close = useCallback((focusButton = true) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  }, []);

  const pick = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    close();
  };

  // Open above when there is no room below.
  useLayoutEffect(() => {
    if (!open) return;
    const button = buttonRef.current;
    const list = listRef.current;
    if (!button || !list) return;
    const rect = button.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    setUp(below < Math.min(list.scrollHeight, 288) + 16 && rect.top > below);
  }, [open]);

  // Keep the active option in view.
  useEffect(() => {
    if (!open || active < 0) return;
    const node = listRef.current?.children[active] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  // A press anywhere else closes the list.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, close]);

  const typeahead = (key: string) => {
    const now = Date.now();
    const state = typed.current;
    state.text = now - state.at > 700 ? key : state.text + key;
    state.at = now;
    const query = state.text.toLowerCase();
    const start = open ? active : selectedIndex;
    const order = options.map((_, i) => (i + Math.max(0, start) + (state.text.length === 1 ? 1 : 0)) % options.length);
    const match = order.find((i) => !options[i]?.disabled && options[i]!.label.toLowerCase().startsWith(query));
    if (match === undefined) return;
    if (open) setActive(match);
    else onChange(options[match]!.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const { key } = event;
    if (!open) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
        event.preventDefault();
        openList();
      } else if (key.length === 1 && /\S/.test(key)) {
        typeahead(key);
      }
      return;
    }
    switch (key) {
      case 'ArrowDown': {
        event.preventDefault();
        const next = firstEnabled(active + 1, 1);
        if (next >= 0) setActive(next);
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        const prev = firstEnabled(active - 1, -1);
        if (prev >= 0) setActive(prev);
        break;
      }
      case 'Home':
        event.preventDefault();
        setActive(firstEnabled(0, 1));
        break;
      case 'End':
        event.preventDefault();
        setActive(firstEnabled(options.length - 1, -1));
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        pick(active);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      case 'Tab':
        close(false);
        break;
      default:
        if (key.length === 1 && /\S/.test(key)) typeahead(key);
    }
  };

  return (
    <div ref={rootRef} className={`tx-select${className ? ` ${className}` : ''}`} data-tone={tone}>
      <button
        ref={buttonRef}
        id={buttonId}
        type='button'
        role='combobox'
        aria-haspopup='listbox'
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy ? `${labelledBy} ${buttonId}` : undefined}
        disabled={disabled}
        className='tx-select-button'
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
      >
        {selected?.art ? <span className='tx-select-art' aria-hidden>{selected.art}</span> : null}
        <span className='tx-select-value' data-empty={selected ? undefined : 'true'}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className='tx-select-chevron' size={18} strokeWidth={2} strokeLinecap='square' aria-hidden />
      </button>
      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role='listbox'
          aria-labelledby={labelledBy}
          aria-label={labelledBy ? undefined : label}
          className='tx-select-list'
          data-up={up ? 'true' : undefined}
          tabIndex={-1}
        >
          {options.map((option, index) => (
            <li
              key={option.value || `empty-${index}`}
              id={`${listId}-${index}`}
              role='option'
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              data-active={index === active ? 'true' : undefined}
              className='tx-select-option'
              onPointerMove={() => !option.disabled && setActive(index)}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => pick(index)}
            >
              {option.art ? <span className='tx-select-art' aria-hidden>{option.art}</span> : null}
              <span className='tx-select-text'>
                <span>{option.label}</span>
                {option.hint ? <small>{option.hint}</small> : null}
              </span>
              {option.value === value ? (
                <Check className='tx-select-check' size={16} strokeWidth={2} strokeLinecap='square' aria-hidden />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

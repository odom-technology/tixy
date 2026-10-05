'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CornerDownLeft, User } from 'lucide-react';

import { ADMIN_COMMANDS, type AdminCommand } from './commands';
import { ADMIN_NAV_ITEMS } from './nav';

const ICON = { size: 15, strokeWidth: 2, strokeLinecap: 'square' as const, 'aria-hidden': true };

type PlayerHit = { id: string; username: string | null; displayName?: string | null; status?: string };

type Entry = {
  id: string;
  group: 'pages' | 'actions' | 'players';
  label: string;
  hint?: string;
  icon: ReactNode;
  run: () => void;
  score: number;
  match: number[];
};

/** Subsequence match: every query character in order. Returns the matched
    indexes and a score that favours early, adjacent and word-start hits. */
function fuzzy(query: string, text: string): { score: number; match: number[] } | null {
  if (!query) return { score: 0, match: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const match: number[] = [];
  let score = 0;
  let from = 0;
  for (const char of q) {
    if (char === ' ') continue;
    const index = t.indexOf(char, from);
    if (index === -1) return null;
    const previous = match.at(-1);
    score += index === 0 || t[index - 1] === ' ' ? 6 : 0;
    score += previous !== undefined && index === previous + 1 ? 4 : 0;
    score -= Math.min(index - from, 6);
    match.push(index);
    from = index + 1;
  }
  // A match smeared across the whole label is noise: 'rad' in 'ledger and'.
  if (match.length > 1 && match.at(-1)! - match[0] > q.replace(/ /g, '').length * 2 + 2) return null;
  if (t.startsWith(q)) score += 20;
  return { score, match };
}

function Highlight({ text, match }: { text: string; match: number[] }) {
  if (!match.length) return <>{text}</>;
  const set = new Set(match);
  return (
    <>
      {Array.from(text).map((char, index) => (set.has(index) ? <mark key={index}>{char}</mark> : <span key={index}>{char}</span>))}
    </>
  );
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [players, setPlayers] = useState<PlayerHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      setQuery('');
      setPlayers([]);
      setCursor(0);
      window.setTimeout(() => input.current?.focus(), 0);
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  // Player lookup: two characters or more, 200 ms after the last key.
  useEffect(() => {
    const term = query.trim();
    if (!open || term.length < 2) {
      setPlayers([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/admin/users?q=${encodeURIComponent(term)}&limit=6`, { signal: controller.signal });
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as { users?: PlayerHit[] };
        setPlayers((data.users ?? []).slice(0, 6));
      } catch {
        if (!controller.signal.aborted) setPlayers([]);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const entries = useMemo<Entry[]>(() => {
    const go = (href: string) => () => {
      onClose();
      router.push(href);
    };
    const term = query.trim();
    const list: Entry[] = [];
    for (const item of ADMIN_NAV_ITEMS) {
      const hit = fuzzy(term, item.label) ?? (item.keywords && term ? (fuzzy(term, item.keywords) ? { score: -20, match: [] } : null) : null);
      if (!hit) continue;
      const Icon = item.icon;
      list.push({
        id: `page:${item.href}`,
        group: 'pages',
        label: item.label,
        hint: item.key ? `g ${item.key}` : undefined,
        icon: <Icon {...ICON} />,
        run: go(item.href),
        score: hit.score,
        match: hit.match,
      });
    }
    for (const command of ADMIN_COMMANDS as AdminCommand[]) {
      const hit = fuzzy(term, command.label) ?? (command.keywords && term ? (fuzzy(term, command.keywords) ? { score: -20, match: [] } : null) : null);
      if (!hit) continue;
      const Icon = command.icon;
      list.push({
        id: `cmd:${command.id}`,
        group: 'actions',
        label: command.label,
        hint: command.hint,
        icon: <Icon {...ICON} />,
        run: go(command.href),
        score: hit.score,
        match: hit.match,
      });
    }
    for (const player of players) {
      const name = player.username ?? player.displayName ?? player.id;
      list.push({
        id: `player:${player.id}`,
        group: 'players',
        label: name,
        hint: player.status && player.status !== 'active' ? player.status : 'open profile',
        icon: <User {...ICON} />,
        run: go(`/admin/users?user=${encodeURIComponent(player.id)}`),
        score: 0,
        match: fuzzy(term, name)?.match ?? [],
      });
    }
    const order = { pages: 0, actions: 1, players: 2 } as const;
    return list.sort((a, b) => (term ? order[a.group] - order[b.group] || b.score - a.score : order[a.group] - order[b.group]));
  }, [onClose, players, query, router]);

  useEffect(() => {
    setCursor((value) => Math.min(value, Math.max(0, entries.length - 1)));
  }, [entries.length]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n')) {
      event.preventDefault();
      setCursor((value) => (entries.length ? (value + 1) % entries.length : 0));
    } else if (event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p')) {
      event.preventDefault();
      setCursor((value) => (entries.length ? (value - 1 + entries.length) % entries.length : 0));
    } else if (event.key === 'Home') {
      setCursor(0);
    } else if (event.key === 'End') {
      setCursor(Math.max(0, entries.length - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      entries[cursor]?.run();
    }
  };

  useEffect(() => {
    document.getElementById(`adm-palette-${cursor}`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  let lastGroup: string | null = null;
  const groupLabel = { pages: 'pages', actions: 'actions', players: 'players' };

  return (
    <dialog
      ref={dialog}
      className='adm-palette'
      aria-label='Search or jump'
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <input
        ref={input}
        className='adm-palette-input'
        placeholder='Search pages, actions or players'
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setCursor(0);
        }}
        onKeyDown={onKeyDown}
        role='combobox'
        aria-expanded='true'
        aria-controls='adm-palette-list'
        aria-activedescendant={entries[cursor] ? `adm-palette-${cursor}` : undefined}
        aria-autocomplete='list'
        autoComplete='off'
        spellCheck={false}
      />
      <ul id='adm-palette-list' className='adm-palette-list' role='listbox' aria-label='Results'>
        {entries.map((entry, index) => {
          const header = entry.group !== lastGroup ? groupLabel[entry.group] : null;
          lastGroup = entry.group;
          return (
            <li key={entry.id} role='presentation'>
              {header ? <div className='adm-palette-group' role='presentation'>{header}</div> : null}
              <div
                id={`adm-palette-${index}`}
                role='option'
                aria-selected={index === cursor}
                className='adm-palette-item'
                onMouseMove={() => setCursor(index)}
                onClick={entry.run}
              >
                {entry.icon}
                <span><Highlight text={entry.label} match={entry.match} /></span>
                {entry.hint ? <span className='adm-palette-hint'>{entry.hint}</span> : null}
              </div>
            </li>
          );
        })}
        {!entries.length ? (
          <li className='adm-palette-group' role='presentation'>
            {searching ? 'Looking up players.' : 'Nothing matches. Players need two letters or more.'}
          </li>
        ) : null}
        {searching && entries.length ? <li className='adm-palette-group' role='presentation'>Looking up players.</li> : null}
      </ul>
      <div className='adm-palette-foot' aria-hidden='true'>
        <span><kbd className='adm-kbd'>↑</kbd> <kbd className='adm-kbd'>↓</kbd> move</span>
        <span><kbd className='adm-kbd'><CornerDownLeft size={11} strokeWidth={2} /></kbd> open</span>
        <span><kbd className='adm-kbd'>esc</kbd> close</span>
      </div>
    </dialog>
  );
}

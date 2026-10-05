"use client";

/* ──────────────────────────────────────────────────────────────────────────
   LUCKY CAGE — the cabinet's own ticket board.

   A walnut and brass panel that sits against the cabinet's base and takes its
   colours from the cabinet's theme, so an equipped skin repaints both. The
   player picks on it: a kind of ticket along the top, then a number, a rack
   or a tier. Numbers are the same cream balls that sit in the cage. While the
   draw runs, each ball that seats is marked on the board, so the pick and the
   draw meet in one place.

   It is two radio groups. Arrow keys move the choice inside a group, Home and
   End jump, and each group is one tab stop. Every cell is at least 44 px.
   ────────────────────────────────────────────────────────────────────────── */

import { useCallback, useRef, type CSSProperties, type KeyboardEvent } from "react";

import {
  LUCKY_CAGE_FAMILIES,
  luckyCageRackNumbers,
  type LuckyCageFamily,
  type LuckyCageTicket,
} from "@/server/arcade/wager-games/lucky-cage";

import type { LuckyCageTheme } from "./_lucky-cage-theme";

const FAMILY_NAMES: Record<LuckyCageFamily, string> = {
  ball: "ball",
  head: "head",
  rack: "rack",
  tier: "tier",
};

/** Columns of the cell grid for each kind of ticket, for arrow keys. */
const COLUMNS: Record<LuckyCageFamily, number> = {
  ball: 5,
  head: 5,
  rack: 5,
  tier: 3,
};

/** What a screen reader hears for a ticket: its name and what it needs. */
export function ticketName(ticket: LuckyCageTicket): string {
  return ticket.family === "ball"
    ? `ball ${ticket.value}`
    : ticket.label.toLowerCase();
}

type BoardProps = {
  theme: LuckyCageTheme;
  family: LuckyCageFamily;
  tickets: readonly LuckyCageTicket[];
  ticketId: string;
  /** Balls that have seated so far in this draw. */
  drawn: ReadonlySet<number>;
  /** The ticket that won the round on screen, if any. */
  wonId: string | null;
  disabled: boolean;
  describe: (ticket: LuckyCageTicket) => string;
  onFamily: (family: LuckyCageFamily) => void;
  onPick: (ticket: LuckyCageTicket) => void;
};

export function LuckyCageBoard({
  theme,
  family,
  tickets,
  ticketId,
  drawn,
  wonId,
  disabled,
  describe,
  onFamily,
  onPick,
}: BoardProps) {
  const tabsRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const style = {
    "--lc-wood": theme.woodMid,
    "--lc-wood-hi": theme.woodHi,
    "--lc-wood-lo": theme.woodLo,
    "--lc-brass": theme.brass,
    "--lc-brass-hi": theme.brassHi,
    "--lc-ball": theme.ballBody,
    "--lc-ball-ink": theme.ballInk,
    "--lc-rack-0": theme.rackBands[0],
    "--lc-rack-1": theme.rackBands[1],
    "--lc-rack-2": theme.rackBands[2],
    "--lc-rack-3": theme.rackBands[3],
    "--lc-rack-4": theme.rackBands[4],
  } as CSSProperties;

  /** Arrow keys inside a radio group: move the choice and its focus. */
  const move = useCallback(
    (
      event: KeyboardEvent<HTMLElement>,
      group: HTMLElement | null,
      count: number,
      current: number,
      columns: number,
      choose: (index: number) => void,
    ) => {
      let next = current;
      switch (event.key) {
        case "ArrowRight":
          next = (current + 1) % count;
          break;
        case "ArrowLeft":
          next = (current - 1 + count) % count;
          break;
        case "ArrowDown":
          next = current + columns < count ? current + columns : current % columns;
          break;
        case "ArrowUp": {
          const up = current - columns;
          if (up >= 0) next = up;
          else {
            const column = current % columns;
            next = column;
            while (next + columns < count) next += columns;
          }
          break;
        }
        case "Home":
          next = 0;
          break;
        case "End":
          next = count - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      if (next === current) return;
      choose(next);
      const cells = group?.querySelectorAll<HTMLElement>('[role="radio"]');
      cells?.[next]?.focus();
    },
    [],
  );

  const familyIndex = LUCKY_CAGE_FAMILIES.indexOf(family);
  const pickedIndex = Math.max(
    0,
    tickets.findIndex((t) => t.id === ticketId),
  );

  return (
    <section className="lc-board" aria-label="ticket board" style={style} data-family={family}>
      <div
        ref={tabsRef}
        className="lc-board-tabs"
        role="radiogroup"
        aria-label="kind of ticket"
        onKeyDown={(e) =>
          !disabled &&
          move(e, tabsRef.current, LUCKY_CAGE_FAMILIES.length, familyIndex, LUCKY_CAGE_FAMILIES.length, (i) =>
            onFamily(LUCKY_CAGE_FAMILIES[i]!),
          )
        }
      >
        {LUCKY_CAGE_FAMILIES.map((f) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={f === family}
            aria-disabled={disabled || undefined}
            tabIndex={f === family ? 0 : -1}
            className="lc-board-tab"
            onClick={() => !disabled && f !== family && onFamily(f)}
          >
            {FAMILY_NAMES[f]}
          </button>
        ))}
      </div>

      <div
        ref={gridRef}
        className="lc-board-grid"
        data-family={family}
        role="radiogroup"
        aria-label={`${FAMILY_NAMES[family]} tickets`}
        onKeyDown={(e) =>
          !disabled &&
          move(e, gridRef.current, tickets.length, pickedIndex, COLUMNS[family], (i) =>
            onPick(tickets[i]!),
          )
        }
      >
        {tickets.map((t) => {
          const selected = t.id === ticketId;
          const rackNumbers = t.family === "rack" ? luckyCageRackNumbers(t.value) : null;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={disabled || undefined}
              aria-label={describe(t)}
              tabIndex={selected ? 0 : -1}
              className="lc-cell"
              data-kind={t.family}
              data-rack={t.family === "rack" ? t.value : undefined}
              data-active={selected || undefined}
              data-drawn={
                t.family === "ball" || t.family === "head"
                  ? drawn.has(t.value) || undefined
                  : undefined
              }
              data-won={wonId === t.id || undefined}
              onClick={() => !disabled && onPick(t)}
            >
              {rackNumbers ? (
                <>
                  <span className="lc-cell-name">{t.value + 1}</span>
                  <span className="lc-rack-balls" aria-hidden="true">
                    {rackNumbers.map((n) => (
                      <span key={n} className="lc-rack-ball" data-drawn={drawn.has(n) || undefined}>
                        {n}
                      </span>
                    ))}
                  </span>
                </>
              ) : t.family === "tier" ? (
                <>
                  <span className="lc-cell-big">{t.value}</span>
                  <span className="lc-cell-name">high</span>
                </>
              ) : (
                <span className="lc-cell-big">{t.value}</span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

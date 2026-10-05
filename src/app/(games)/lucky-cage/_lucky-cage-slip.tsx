/* The receipt's detail: your numbers over the draw, hits marked. Pure view of
   what the server already settled; nothing here decides a payout. */

import {
  LUCKY_CAGE_HIGH_THRESHOLD,
  luckyCageRackNumbers,
  type LuckyCageTicket,
} from "@/server/arcade/wager-games/lucky-cage";

/** The numbers a ticket is waiting on, or null for a tier ticket, which
    counts high balls rather than naming any. */
export function ticketNumbers(ticket: LuckyCageTicket): number[] | null {
  switch (ticket.family) {
    case "ball":
    case "head":
      return [ticket.value];
    case "rack":
      return luckyCageRackNumbers(ticket.value);
    default:
      return null;
  }
}

/** Which of the five drawn balls this ticket counts, by position. */
export function drawHits(ticket: LuckyCageTicket, draw: readonly number[]): boolean[] {
  const numbers = ticketNumbers(ticket);
  return draw.map((ball, index) => {
    if (ticket.family === "head") return index === 0 && ball === ticket.value;
    if (numbers) return numbers.includes(ball);
    return ball >= LUCKY_CAGE_HIGH_THRESHOLD;
  });
}

export function CageSlip({
  ticket,
  draw,
  won,
}: {
  ticket: LuckyCageTicket;
  draw: readonly number[];
  won: boolean;
}) {
  const numbers = ticketNumbers(ticket);
  const hits = drawHits(ticket, draw);
  const hitCount = hits.filter(Boolean).length;
  return (
    <div className="lc-slip">
      <p className="lc-slip-line">
        {ticket.family === "ball" ? `ball ${ticket.value}` : ticket.label.toLowerCase()},{" "}
        {won ? "came in" : "missed"}
      </p>
      <div className="lc-slip-row">
        <span className="lc-slip-label">you</span>
        {numbers ? (
          <ol className="lc-slip-balls" aria-label="your numbers">
            {numbers.map((n) => (
              <li key={n} className="lc-slip-ball" data-hit={draw.includes(n) || undefined}>
                {n}
              </li>
            ))}
          </ol>
        ) : (
          <p className="lc-slip-text">
            exactly {ticket.value} of 5 high ({LUCKY_CAGE_HIGH_THRESHOLD}+)
          </p>
        )}
      </div>
      <div className="lc-slip-row">
        <span className="lc-slip-label">draw</span>
        <ol className="lc-slip-balls" aria-label="the draw, in chute order">
          {draw.map((n, i) => (
            <li key={`${i}-${n}`} className="lc-slip-ball" data-hit={hits[i] || undefined}>
              {n}
              {hits[i] ? <span className="sr-only">, counted</span> : null}
            </li>
          ))}
        </ol>
      </div>
      {numbers === null ? (
        <p className="lc-slip-text">
          {hitCount} high in the draw.
        </p>
      ) : null}
    </div>
  );
}

export type TicketPack = {
  id: string;
  name: string;
  tickets: number;
  amount: number;
  currency: string;
};

// 2026-06 repricing. The old packs (200 / $1.99 … 1400 / $9.99) badly
// undervalued Tickets against the new economy — 200 didn't even cover a 450
// common, and the daily earn cap is now 300. Cosmetic prices are
// common 450 / rare 750 / epic 1200 / legendary 2000.
//
// New curve: the entry pack covers ~2 commons or a rare, and tickets-per-dollar
// improves with pack size (~502 → 601 → 700 → 800 per $) so bigger packs are the
// better deal — the standard, fair IAP shape. Entry ($1.99 = 1,000) is ~3 days
// of capped play, so a purchase skips some grind without trivializing it; the
// top pack ($19.99 = 16,000) is whale-friendly without being absurd.
const DEFAULT_TICKET_PACKS: TicketPack[] = [
  {
    id: 'starter',
    name: 'Pocket Stack',
    tickets: 1000,
    amount: 199,
    currency: 'usd',
  },
  {
    id: 'double',
    name: 'Player Roll',
    tickets: 3000,
    amount: 499,
    currency: 'usd',
  },
  {
    id: 'stack',
    name: 'Ticket Crate',
    tickets: 7000,
    amount: 999,
    currency: 'usd',
  },
  {
    id: 'vault',
    name: 'Grand Vault',
    tickets: 16000,
    amount: 1999,
    currency: 'usd',
  },
];

const normalizePack = (value: unknown): TicketPack | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const tickets = Number(record.tickets);
  const amount = Number(record.amount);
  const currency =
    typeof record.currency === 'string' && record.currency.trim()
      ? record.currency.trim().toLowerCase()
      : 'usd';

  if (!id || !name) return null;
  if (!Number.isInteger(tickets) || tickets <= 0) return null;
  if (!Number.isInteger(amount) || amount <= 0) return null;
  return { id, name, tickets, amount, currency };
};

export function getTicketPacks(): TicketPack[] {
  const raw = process.env.STRIPE_TICKET_PACKS_JSON;
  if (!raw?.trim()) return DEFAULT_TICKET_PACKS;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_TICKET_PACKS;
    const packs = parsed.map(normalizePack).filter((pack): pack is TicketPack => Boolean(pack));
    return packs.length > 0 ? packs : DEFAULT_TICKET_PACKS;
  } catch {
    return DEFAULT_TICKET_PACKS;
  }
}

export function getTicketPack(packId: string) {
  return getTicketPacks().find((pack) => pack.id === packId) ?? null;
}

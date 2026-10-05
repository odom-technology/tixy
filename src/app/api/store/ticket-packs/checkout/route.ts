import { NextResponse } from 'next/server';

import { createTicketPackCheckoutSession } from '@/server/monetization/stripe-checkout';
import { requireIdentity, type ArcadeIdentity } from '@/server/auth';

export const dynamic = 'force-dynamic';

type CheckoutPayload = {
  packId?: string;
};

export async function POST(request: Request) {
  let identity: ArcadeIdentity;
  try {
    // Paid tickets belong to a local account, never a browser guest or proxy identity.
    identity = await requireIdentity({
      allowExternal: false,
      allowGuest: false,
    });
  } catch {
    return NextResponse.json(
      { error: 'Sign in to your Arcade account to buy ticket packs.' },
      { status: 401 },
    );
  }

  if (
    !process.env.STRIPE_SECRET_KEY?.trim() ||
    !process.env.STRIPE_WEBHOOK_SECRET?.trim()
  ) {
    return NextResponse.json(
      { error: 'Ticket purchases are temporarily unavailable.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  let payload: CheckoutPayload;
  try {
    payload = (await request.json()) as CheckoutPayload;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON payload.' },
      { status: 400 },
    );
  }

  const packId =
    typeof payload?.packId === 'string' ? payload.packId.trim() : '';
  if (!packId) {
    return NextResponse.json({ error: 'packId is required.' }, { status: 400 });
  }

  try {
    const checkout = await createTicketPackCheckoutSession({
      userId: identity.userId,
      email: identity.email,
      packId,
    });
    return NextResponse.json(checkout);
  } catch (error) {
    const message = (error as Error).message;
    const publicMessage =
      message === 'Ticket pack not found.' ||
      message ===
        'Ticket purchases are temporarily unavailable for this account.'
        ? message
        : 'Failed to start checkout.';
    if (publicMessage !== message) {
      console.error('Ticket checkout creation failed:', error);
    }
    return NextResponse.json(
      { error: publicMessage },
      { status: publicMessage === message ? 400 : 502 },
    );
  }
}

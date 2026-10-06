import crypto from 'node:crypto';
import Stripe from 'stripe';

import {
  getCombinedWalletForTransaction,
  mutateWalletAndLedgerForTransaction,
  mutateStoreCreditsForTransaction,
} from '@/server/arcade/rewards';
import { getAppBaseUrl } from '@/server/arcade/shared-utils';
import { query, withTransaction } from '@/server/db/client';

import {
  flagMonetizationAccountForTransaction,
  getActiveMonetizationAccountFlag,
} from './account-flags';
import { getTicketPack } from './ticket-packs';

const STRIPE_API_VERSION = '2026-07-29.dahlia';

let stripeClient: Stripe | null = null;

export function getStripeClient() {
  if (stripeClient) return stripeClient;
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is required for ticket purchases.');
  }
  stripeClient = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
  });
  return stripeClient;
}

type TicketPurchaseRow = {
  id: string;
  user_id: string;
  pack_id: string;
  tickets_granted: string | number;
  amount_total: string | number;
  currency: string;
  status: string;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  meta_json: string | null;
  fulfilled_at: string | number | null;
};

type TicketPurchaseCreditTarget = 'store_credits' | 'credits';

const getPurchaseCreditTarget = (
  purchase: Pick<TicketPurchaseRow, 'meta_json' | 'user_id'>,
): TicketPurchaseCreditTarget => {
  if (purchase.user_id.startsWith('guest:')) return 'credits';
  try {
    const meta = JSON.parse(purchase.meta_json ?? '{}') as {
      creditTarget?: unknown;
    };
    return meta.creditTarget === 'credits' ? 'credits' : 'store_credits';
  } catch {
    return 'store_credits';
  }
};

const getPaymentIntentId = (
  value: Stripe.Checkout.Session['payment_intent'],
) => (typeof value === 'string' ? value : (value?.id ?? null));

async function getPaymentIntent(paymentIntentId: string | null) {
  if (!paymentIntentId) return null;
  return getStripeClient().paymentIntents.retrieve(paymentIntentId, {
    expand: ['latest_charge'],
  });
}

export async function createTicketPackCheckoutSession({
  userId,
  email,
  packId,
}: {
  userId: string;
  email?: string | null;
  packId: string;
}) {
  const creditTarget = 'store_credits';
  const pack = getTicketPack(packId);
  if (!pack) throw new Error('Ticket pack not found.');

  const stripe = getStripeClient();
  if (await getActiveMonetizationAccountFlag(userId)) {
    throw new Error(
      'Ticket purchases are temporarily unavailable for this account.',
    );
  }

  const purchaseId = crypto.randomUUID();
  const now = Date.now();
  await query(
    `
      INSERT INTO ticket_purchases (
        id,
        user_id,
        pack_id,
        tickets_granted,
        amount_total,
        currency,
        status,
        created_at,
        updated_at,
        meta_json
      ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $7, $8)
    `,
    [
      purchaseId,
      userId,
      pack.id,
      pack.tickets,
      pack.amount,
      pack.currency,
      now,
      JSON.stringify({ packName: pack.name, creditTarget }),
    ],
  );

  const baseUrl = getAppBaseUrl();
  const ticketProduct = {
    name: `${pack.tickets.toLocaleString()} Store Tickets`,
    description:
      'Store-only arcade Tickets. No cash-out, transfer, resale, or real-world value.',
  };
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card', 'link'],
    client_reference_id: userId,
    customer_email: email ?? undefined,
    success_url: `${baseUrl}/store?ticket_purchase=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/store?ticket_purchase=cancelled`,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: pack.currency,
          unit_amount: pack.amount,
          product_data: ticketProduct,
        },
      },
    ],
    metadata: {
      purchaseId,
      userId,
      packId: pack.id,
      creditTarget,
      ticketsGranted: String(pack.tickets),
    },
    payment_intent_data: {
      metadata: {
        purchaseId,
        userId,
        packId: pack.id,
        creditTarget,
        ticketsGranted: String(pack.tickets),
      },
    },
  });

  await query(
    `
      UPDATE ticket_purchases
      SET stripe_session_id = $1,
          checkout_url = $2,
          updated_at = $3
      WHERE id = $4
    `,
    [session.id, session.url ?? null, Date.now(), purchaseId],
  );

  return {
    purchaseId,
    url: session.url,
  };
}

type ProviderPurchase = {
  paymentIntentId: string | null;
  chargeId: string | null;
  paymentIntent: Stripe.PaymentIntent | null;
  charge: Stripe.Charge | null;
};

type PaymentTransaction = Parameters<Parameters<typeof withTransaction>[0]>[0];

async function resolveProviderPurchase(
  paymentIntentId?: string | null,
  chargeId?: string | null,
): Promise<ProviderPurchase> {
  let charge: Stripe.Charge | null = chargeId
    ? await getStripeClient().charges.retrieve(chargeId)
    : null;
  const intentId =
    paymentIntentId ??
    (typeof charge?.payment_intent === 'string'
      ? charge.payment_intent
      : charge?.payment_intent?.id) ??
    null;
  const paymentIntent = await getPaymentIntent(intentId);
  const latestCharge = paymentIntent?.latest_charge;
  if (!charge && latestCharge) {
    charge =
      typeof latestCharge === 'string'
        ? await getStripeClient().charges.retrieve(latestCharge)
        : latestCharge;
  }
  if (
    charge &&
    intentId &&
    (typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id) !== intentId
  ) {
    throw new Error('Stripe charge does not match payment intent.');
  }
  return {
    paymentIntentId: intentId,
    chargeId: charge?.id ?? chargeId ?? null,
    paymentIntent,
    charge,
  };
}

function validateProviderPurchase(
  purchase: TicketPurchaseRow,
  provider: ProviderPurchase,
) {
  const intent = provider.paymentIntent;
  if (
    !intent ||
    intent.metadata?.purchaseId !== purchase.id ||
    intent.metadata?.userId !== purchase.user_id ||
    intent.metadata?.packId !== purchase.pack_id ||
    intent.amount !== Number(purchase.amount_total) ||
    intent.currency !== purchase.currency ||
    (purchase.stripe_payment_intent_id &&
      purchase.stripe_payment_intent_id !== intent.id) ||
    (purchase.stripe_charge_id &&
      purchase.stripe_charge_id !== provider.chargeId)
  ) {
    throw new Error('Stripe payment does not match ticket purchase.');
  }
  if (
    provider.charge &&
    (provider.charge.amount !== Number(purchase.amount_total) ||
      provider.charge.currency !== purchase.currency)
  ) {
    throw new Error('Stripe charge does not match ticket purchase.');
  }
}

async function findProviderPurchase(
  client: PaymentTransaction,
  provider: ProviderPurchase,
) {
  const purchaseResult = await client.query<TicketPurchaseRow>(
    `SELECT id, user_id, pack_id, tickets_granted, amount_total, currency, status,
            stripe_session_id, stripe_payment_intent_id, stripe_charge_id, meta_json, fulfilled_at
     FROM ticket_purchases
     WHERE ($1::text IS NOT NULL AND stripe_payment_intent_id = $1)
        OR ($2::text IS NOT NULL AND stripe_charge_id = $2)
        OR ($3::text IS NOT NULL AND id = $3)
     ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [
      provider.paymentIntentId,
      provider.chargeId,
      provider.paymentIntent?.metadata?.purchaseId ?? null,
    ],
  );
  const purchase = purchaseResult.rows[0];
  if (!purchase) return null;
  validateProviderPurchase(purchase, provider);
  await client.query(
    `UPDATE ticket_purchases
     SET stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, $1),
         stripe_charge_id = COALESCE(stripe_charge_id, $2)
     WHERE id = $3`,
    [provider.paymentIntentId, provider.chargeId, purchase.id],
  );
  return purchase;
}

async function reversePurchaseForTransaction(
  client: PaymentTransaction,
  purchase: TicketPurchaseRow,
  provider: ProviderPurchase,
  stripeEventId: string,
  reason: 'refunded' | 'disputed',
) {
  if (purchase.status === 'refunded' || purchase.status === 'disputed') {
    return { reversed: true, purchaseId: purchase.id, deduped: true };
  }
  const now = Date.now();
  // A reversal delivered before completion must not consume another purchase's tickets.
  if (!purchase.fulfilled_at) {
    await client.query(
      `UPDATE ticket_purchases SET status = $1, reversed_at = $2,
       reversal_status = 'not_granted', updated_at = $2 WHERE id = $3`,
      [reason, now, purchase.id],
    );
    return { reversed: true, purchaseId: purchase.id, notGranted: true };
  }
  const ticketsGranted = Number(purchase.tickets_granted);
  if (!Number.isInteger(ticketsGranted) || ticketsGranted <= 0) {
    throw new Error('Invalid ticket purchase amount.');
  }
  const wallet = await getCombinedWalletForTransaction(
    client,
    purchase.user_id,
    true,
  );
  const creditTarget = getPurchaseCreditTarget(purchase);
  const availableBalance =
    creditTarget === 'credits' ? wallet.credits : wallet.storeCredits;
  const meta = {
    purchaseId: purchase.id,
    stripePaymentIntentId: provider.paymentIntentId,
    stripeChargeId: provider.chargeId,
    stripeEventId,
    reason,
  };
  if (availableBalance >= ticketsGranted) {
    const input = {
      userId: purchase.user_id,
      amount: -ticketsGranted,
      sourceType: 'stripe_reversal' as const,
      sourceId: `stripe-reversal:${purchase.id}`,
      meta,
    };
    const ledger =
      creditTarget === 'credits'
        ? await mutateWalletAndLedgerForTransaction(client, {
            ...input,
            currencyType: 'credits',
          })
        : await mutateStoreCreditsForTransaction(client, input);
    await client.query(
      `UPDATE ticket_purchases SET status = $1, reversed_at = $2,
       reversal_status = 'reversed', updated_at = $2 WHERE id = $3`,
      [reason, now, purchase.id],
    );
    return {
      reversed: true,
      purchaseId: purchase.id,
      ledgerId: ledger.ledgerId,
    };
  }
  await flagMonetizationAccountForTransaction(client, {
    userId: purchase.user_id,
    reason: `Unable to reverse ${ticketsGranted} ${creditTarget === 'credits' ? 'Tickets' : 'store Tickets'} after Stripe ${reason}.`,
    sourceId: purchase.id,
    meta: {
      ...meta,
      availableCredits: wallet.credits,
      availableStoreCredits: wallet.storeCredits,
      creditTarget,
      ticketsGranted,
    },
  });
  await client.query(
    `UPDATE ticket_purchases SET status = $1, reversed_at = $2,
     reversal_status = 'flagged_insufficient_balance', updated_at = $2 WHERE id = $3`,
    [reason, now, purchase.id],
  );
  return {
    reversed: false,
    purchaseId: purchase.id,
    reason: 'flagged-insufficient-store-credits',
  };
}

async function flagPurchaseForTransaction(
  client: PaymentTransaction,
  purchase: TicketPurchaseRow,
  provider: ProviderPurchase,
  stripeEventId: string,
  reason: string,
  meta?: Record<string, unknown>,
) {
  if (
    ['refunded', 'disputed', 'refund_pending_review'].includes(purchase.status)
  ) {
    return { flagged: false, purchaseId: purchase.id, deduped: true };
  }
  await flagMonetizationAccountForTransaction(client, {
    userId: purchase.user_id,
    reason,
    sourceId: purchase.id,
    meta: {
      purchaseId: purchase.id,
      stripePaymentIntentId: provider.paymentIntentId,
      stripeChargeId: provider.chargeId,
      stripeEventId,
      ...meta,
    },
  });
  await client.query(
    `UPDATE ticket_purchases SET status = 'refund_pending_review',
     reversal_status = 'flagged_manual_review', updated_at = $1 WHERE id = $2`,
    [Date.now(), purchase.id],
  );
  return { flagged: true, purchaseId: purchase.id };
}

export async function fulfillCheckoutSession(
  session: Stripe.Checkout.Session,
  stripeEventId: string,
) {
  if (session.payment_status !== 'paid')
    return { fulfilled: false, reason: 'not-paid' };
  const provider = await resolveProviderPurchase(
    getPaymentIntentId(session.payment_intent),
  );
  return withTransaction(async (client) => {
    const purchaseResult = await client.query<TicketPurchaseRow>(
      `SELECT id, user_id, pack_id, tickets_granted, amount_total, currency, status,
              stripe_session_id, stripe_payment_intent_id, stripe_charge_id, meta_json, fulfilled_at
       FROM ticket_purchases WHERE id = $1 AND stripe_session_id = $2 FOR UPDATE`,
      [session.metadata?.purchaseId ?? null, session.id],
    );
    const purchase = purchaseResult.rows[0];
    if (!purchase)
      throw new Error('Ticket purchase not found for Stripe session.');
    validateProviderPurchase(purchase, provider);
    if (
      session.mode !== 'payment' ||
      session.client_reference_id !== purchase.user_id ||
      session.metadata?.userId !== purchase.user_id ||
      session.metadata?.packId !== purchase.pack_id ||
      session.amount_total !== Number(purchase.amount_total) ||
      session.currency !== purchase.currency
    ) {
      throw new Error('Stripe session does not match ticket purchase.');
    }
    if (
      ['refunded', 'disputed', 'refund_pending_review'].includes(
        purchase.status,
      )
    ) {
      return { fulfilled: false, reason: purchase.status };
    }
    if (
      provider.paymentIntent?.status !== 'succeeded' ||
      !provider.charge?.paid
    ) {
      return { fulfilled: false, reason: 'not-paid' };
    }
    // Reconcile current charge state even if reversal webhooks have not arrived yet.
    if (provider.charge.refunded || provider.charge.disputed) {
      const reason = provider.charge.disputed ? 'disputed' : 'refunded';
      await findProviderPurchase(client, provider);
      await reversePurchaseForTransaction(
        client,
        purchase,
        provider,
        stripeEventId,
        reason,
      );
      return { fulfilled: false, reason };
    }
    if (provider.charge.amount_refunded > 0) {
      await findProviderPurchase(client, provider);
      await flagPurchaseForTransaction(
        client,
        purchase,
        provider,
        stripeEventId,
        'Partial Stripe refund requires manual review before store purchases can continue.',
      );
      return { fulfilled: false, reason: 'refund_pending_review' };
    }
    if (purchase.status === 'fulfilled') {
      return { fulfilled: true, purchaseId: purchase.id, deduped: true };
    }
    if (!['pending', 'failed'].includes(purchase.status)) {
      throw new Error(
        'Ticket purchase cannot be fulfilled from its current state.',
      );
    }
    const ticketsGranted = Number(purchase.tickets_granted);
    if (!Number.isInteger(ticketsGranted) || ticketsGranted <= 0)
      throw new Error('Invalid ticket purchase amount.');
    const meta = {
      purchaseId: purchase.id,
      stripeSessionId: session.id,
      stripePaymentIntentId: provider.paymentIntentId,
      stripeChargeId: provider.chargeId,
      packId: purchase.pack_id,
      amountTotal: Number(purchase.amount_total),
      currency: purchase.currency,
    };
    const input = {
      userId: purchase.user_id,
      amount: ticketsGranted,
      sourceType: 'stripe_purchase' as const,
      sourceId: `stripe:${provider.paymentIntentId}`,
      meta,
    };
    const ledger =
      getPurchaseCreditTarget(purchase) === 'credits'
        ? await mutateWalletAndLedgerForTransaction(client, {
            ...input,
            currencyType: 'credits',
          })
        : await mutateStoreCreditsForTransaction(client, input);
    await client.query(
      `UPDATE ticket_purchases SET status = 'fulfilled',
       stripe_payment_intent_id = COALESCE($1, stripe_payment_intent_id),
       stripe_charge_id = COALESCE($2, stripe_charge_id), stripe_event_id = $3,
       fulfilled_at = COALESCE(fulfilled_at, $4), updated_at = $4 WHERE id = $5`,
      [
        provider.paymentIntentId,
        provider.chargeId,
        stripeEventId,
        Date.now(),
        purchase.id,
      ],
    );
    return {
      fulfilled: true,
      purchaseId: purchase.id,
      ledgerId: ledger.ledgerId,
      balanceAfter: ledger.balanceAfter,
    };
  });
}

export async function reverseTicketPurchaseByProviderId({
  paymentIntentId,
  chargeId,
  stripeEventId,
  reason,
}: {
  paymentIntentId?: string | null;
  chargeId?: string | null;
  stripeEventId: string;
  reason: 'refunded' | 'disputed';
}) {
  if (!paymentIntentId && !chargeId)
    return { reversed: false, reason: 'missing-provider-id' };
  const provider = await resolveProviderPurchase(paymentIntentId, chargeId);
  return withTransaction(async (client) => {
    const purchase = await findProviderPurchase(client, provider);
    if (!purchase) return { reversed: false, reason: 'purchase-not-found' };
    return reversePurchaseForTransaction(
      client,
      purchase,
      provider,
      stripeEventId,
      reason,
    );
  });
}

export async function flagTicketPurchaseByProviderId({
  paymentIntentId,
  chargeId,
  stripeEventId,
  reason,
  meta,
}: {
  paymentIntentId?: string | null;
  chargeId?: string | null;
  stripeEventId: string;
  reason: string;
  meta?: Record<string, unknown>;
}) {
  if (!paymentIntentId && !chargeId)
    return { flagged: false, reason: 'missing-provider-id' };
  const provider = await resolveProviderPurchase(paymentIntentId, chargeId);
  return withTransaction(async (client) => {
    const purchase = await findProviderPurchase(client, provider);
    if (!purchase) return { flagged: false, reason: 'purchase-not-found' };
    return flagPurchaseForTransaction(
      client,
      purchase,
      provider,
      stripeEventId,
      reason,
      meta,
    );
  });
}

export async function markPaymentIntentFailed(
  paymentIntent: Stripe.PaymentIntent,
) {
  const purchaseId = paymentIntent.metadata?.purchaseId?.trim();
  if (!purchaseId) return { updated: false };
  await query(
    `
      UPDATE ticket_purchases
      SET status = 'failed',
          stripe_payment_intent_id = $1,
          updated_at = $2
      WHERE id = $3 AND status = 'pending'
    `,
    [paymentIntent.id, Date.now(), purchaseId],
  );
  return { updated: true };
}

import { NextResponse } from 'next/server';
import type Stripe from 'stripe';

import {
  flagTicketPurchaseByProviderId,
  fulfillCheckoutSession,
  getStripeClient,
  markPaymentIntentFailed,
  reverseTicketPurchaseByProviderId,
} from '@/server/monetization/stripe-checkout';

export const dynamic = 'force-dynamic';

const getChargeId = (value: string | Stripe.Charge | null) =>
  typeof value === 'string' ? value : value?.id ?? null;

const getPaymentIntentIdFromCharge = (
  charge: Stripe.Charge,
): string | null => {
  const paymentIntent = charge.payment_intent;
  return typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id ?? null;
};

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return NextResponse.json(
      { error: 'Stripe webhook is not configured.' },
      { status: 500 },
    );
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing Stripe signature.' }, { status: 400 });
  }

  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = getStripeClient().webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret,
    );
  } catch (error) {
    console.warn('Stripe webhook signature verification failed:', error);
    return NextResponse.json(
      { error: 'Webhook signature verification failed.' },
      { status: 400 },
    );
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        await fulfillCheckoutSession(
          event.data.object as Stripe.Checkout.Session,
          event.id,
        );
        break;
      }
      case 'payment_intent.payment_failed': {
        await markPaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
        break;
      }
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        const paymentIntentId = getPaymentIntentIdFromCharge(charge);
        if (charge.refunded && charge.amount_refunded >= charge.amount) {
          await reverseTicketPurchaseByProviderId({
            paymentIntentId,
            chargeId: charge.id,
            stripeEventId: event.id,
            reason: 'refunded',
          });
        } else if (charge.amount_refunded > 0) {
          await flagTicketPurchaseByProviderId({
            paymentIntentId,
            chargeId: charge.id,
            stripeEventId: event.id,
            reason:
              'Partial Stripe refund requires manual review before store purchases can continue.',
            meta: {
              refundAmount: charge.amount_refunded,
              chargeAmount: charge.amount,
            },
          });
        }
        break;
      }
      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute;
        await reverseTicketPurchaseByProviderId({
          paymentIntentId: null,
          chargeId: getChargeId(dispute.charge),
          stripeEventId: event.id,
          reason: 'disputed',
        });
        break;
      }
      default:
        break;
    }
  } catch (error) {
    console.error('Stripe webhook handling failed:', error);
    return NextResponse.json(
      { error: 'Webhook handling failed.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}

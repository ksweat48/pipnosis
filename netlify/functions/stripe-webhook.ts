import { Handler, HandlerEvent } from '@netlify/functions';
import Stripe from 'stripe';
import { getSupabaseAdmin } from './_shared/supabase-admin';

const headers = {
  'Content-Type': 'application/json',
};

async function isAlreadyProcessed(supabase: ReturnType<typeof getSupabaseAdmin>, eventId: string): Promise<boolean> {
  const { data } = await supabase
    .from('stripe_webhook_events')
    .select('id')
    .eq('stripe_event_id', eventId)
    .maybeSingle();
  return !!data;
}

async function markProcessed(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  eventId: string,
  eventType: string,
  userId: string | null,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await supabase.from('stripe_webhook_events').insert({
    stripe_event_id: eventId,
    event_type: eventType,
    user_id: userId,
    metadata,
  });
}

async function upsertSubscriptionStatus(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
  subscription: Stripe.Subscription,
  pkg: { name: string; token_amount: number } | null
): Promise<void> {
  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  await supabase.from('user_subscription_status').upsert(
    {
      user_id: userId,
      stripe_customer_id: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id ?? null,
      stripe_subscription_id: subscription.id,
      status: subscription.status as string,
      plan_name: pkg?.name ?? null,
      credit_amount: pkg?.token_amount ?? 0,
      current_period_end: periodEnd,
      cancel_at_period_end: subscription.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );
}

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!stripeSecretKey || !webhookSecret) {
      console.error('[Stripe Webhook] Missing Stripe configuration');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Stripe not configured' }),
      };
    }

    const stripe = new Stripe(stripeSecretKey);

    const signature = event.headers['stripe-signature'];
    if (!signature) {
      console.error('[Stripe Webhook] Missing signature');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing signature' }),
      };
    }

    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : event.body || '';

    let stripeEvent: Stripe.Event;
    try {
      stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err: any) {
      console.error('[Stripe Webhook] Signature verification failed:', err.message);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid signature' }),
      };
    }

    const supabase = getSupabaseAdmin();

    // Idempotency guard — skip already-processed events silently
    const alreadyDone = await isAlreadyProcessed(supabase, stripeEvent.id);
    if (alreadyDone) {
      console.log(`[Stripe Webhook] Duplicate event skipped: ${stripeEvent.id} (${stripeEvent.type})`);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ received: true, duplicate: true }),
      };
    }

    console.log('[Stripe Webhook] Processing event:', stripeEvent.type, stripeEvent.id);

    switch (stripeEvent.type) {

      case 'checkout.session.completed': {
        const session = stripeEvent.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId || session.client_reference_id;
        const packageId = session.metadata?.packageId;
        const purchaseType = session.metadata?.purchaseType || 'credits';

        if (!userId || !packageId) {
          console.error('[Stripe Webhook] Missing userId or packageId in metadata');
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Missing metadata' }),
          };
        }

        if (purchaseType === 'membership' || purchaseType === 'membership_upgrade') {
          const amountPaid = (session.amount_total || 0) / 100;
          const isUpgrade = purchaseType === 'membership_upgrade';

          console.log(`[Stripe Webhook] Processing Club ${isUpgrade ? 'upgrade' : 'membership'}: user=${userId}, package=${packageId}, amount=$${amountPaid}`);

          const { data: grantResult, error: grantError } = await supabase.rpc('grant_club_membership', {
            p_user_id: userId,
            p_package_id: packageId,
            p_amount_paid: amountPaid,
            p_stripe_session_id: session.id,
          });

          if (grantError) {
            console.error('[Stripe Webhook] Failed to grant/upgrade membership:', JSON.stringify(grantError));
            return {
              statusCode: 500,
              headers,
              body: JSON.stringify({ error: 'Failed to process membership purchase', pg_message: grantError.message }),
            };
          }

          const result = grantResult as any;
          if (!result?.success) {
            console.error('[Stripe Webhook] Membership processing returned failure:', JSON.stringify(result));
            return {
              statusCode: 500,
              headers,
              body: JSON.stringify({ error: result?.error || 'Membership processing failed' }),
            };
          }

          const action = result.is_upgrade ? 'Upgraded to' : 'Granted';
          console.log(`[Stripe Webhook] ${action} ${result.tier_name} (Tier ${result.tier_level}) for user ${userId}`);

          await markProcessed(supabase, stripeEvent.id, stripeEvent.type, userId, { packageId, amountPaid, tierName: result.tier_name });
          break;
        }

        // Credits purchase
        const { data: pkg, error: pkgError } = await supabase
          .from('token_packages')
          .select('token_amount, name, price_usd')
          .eq('id', packageId)
          .single();

        if (pkgError || !pkg) {
          console.error('[Stripe Webhook] Package not found:', pkgError);
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Package not found' }),
          };
        }

        const creditAmount = pkg.token_amount;

        const { error: creditError } = await supabase.rpc('add_credits_transaction', {
          p_user_id: userId,
          p_amount: creditAmount,
          p_transaction_type: session.mode === 'subscription' ? 'subscription_purchase' : 'package_purchase',
          p_description: `Purchased ${pkg.name} - $${pkg.price_usd}`,
        });

        if (creditError) {
          console.error('[Stripe Webhook] Failed to add credits:', creditError);
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to add credits' }),
          };
        }

        console.log(`[Stripe Webhook] Added ${creditAmount} credits to user ${userId}`);

        await supabase.from('goal_notifications').insert({
          user_id: userId,
          type: 'system_alert',
          priority: 'medium',
          title: 'Credits Purchased',
          message: `Successfully added ${creditAmount} credits to your account. Thank you for your purchase!`,
          metadata: { credits: creditAmount, packageName: pkg.name, amount: pkg.price_usd, sessionId: session.id },
        });

        // If this is a subscription, update subscription status
        if (session.mode === 'subscription' && session.subscription) {
          try {
            const sub = await stripe.subscriptions.retrieve(session.subscription as string);
            await upsertSubscriptionStatus(supabase, userId, sub, { name: pkg.name, token_amount: creditAmount });
          } catch (e: any) {
            console.warn('[Stripe Webhook] Could not upsert subscription status:', e.message);
          }
        }

        await markProcessed(supabase, stripeEvent.id, stripeEvent.type, userId, { packageId, creditAmount });
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = stripeEvent.data.object as Stripe.Invoice;
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
        const userId = subscription.metadata?.userId;
        const packageId = subscription.metadata?.packageId;

        if (!userId || !packageId) {
          console.log('[Stripe Webhook] Skipping invoice - no metadata (likely initial payment handled by checkout.session.completed)');
          await markProcessed(supabase, stripeEvent.id, stripeEvent.type, null, {});
          break;
        }

        // Skip the very first invoice — already handled by checkout.session.completed
        if ((invoice as any).billing_reason === 'subscription_create') {
          console.log('[Stripe Webhook] Skipping first invoice (subscription_create) — handled by checkout event');
          await markProcessed(supabase, stripeEvent.id, stripeEvent.type, userId, { skipped: 'initial_invoice' });
          break;
        }

        const { data: pkg, error: pkgError } = await supabase
          .from('token_packages')
          .select('token_amount, name')
          .eq('id', packageId)
          .single();

        if (pkgError || !pkg) {
          console.error('[Stripe Webhook] Package not found for recurring payment:', pkgError);
          await markProcessed(supabase, stripeEvent.id, stripeEvent.type, userId, { error: 'package_not_found' });
          break;
        }

        const creditAmount = pkg.token_amount;

        const { error: creditError } = await supabase.rpc('add_credits_transaction', {
          p_user_id: userId,
          p_amount: creditAmount,
          p_transaction_type: 'subscription_renewal',
          p_description: `Subscription renewal: ${pkg.name}`,
        });

        if (creditError) {
          console.error('[Stripe Webhook] Failed to add subscription credits:', creditError);
          // Do NOT mark processed so Stripe will retry
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to add renewal credits' }),
          };
        }

        console.log(`[Stripe Webhook] Renewal: Added ${creditAmount} credits to user ${userId}`);

        await upsertSubscriptionStatus(supabase, userId, subscription, { name: pkg.name, token_amount: creditAmount });

        await supabase.from('goal_notifications').insert({
          user_id: userId,
          type: 'system_alert',
          priority: 'medium',
          title: 'Subscription Renewed',
          message: `Your subscription has been renewed. ${creditAmount} credits have been added to your account.`,
          metadata: { credits: creditAmount, packageName: pkg.name, invoiceId: invoice.id },
        });

        await markProcessed(supabase, stripeEvent.id, stripeEvent.type, userId, { creditAmount, invoiceId: invoice.id });
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = stripeEvent.data.object as Stripe.Invoice;
        const subscriptionId = invoice.subscription as string | null;
        if (!subscriptionId) {
          await markProcessed(supabase, stripeEvent.id, stripeEvent.type, null, {});
          break;
        }

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const userId = subscription.metadata?.userId;

        if (userId) {
          await supabase.from('user_subscription_status').upsert(
            { user_id: userId, status: 'past_due', updated_at: new Date().toISOString() },
            { onConflict: 'user_id' }
          );

          await supabase.from('goal_notifications').insert({
            user_id: userId,
            type: 'system_alert',
            priority: 'high',
            title: 'Subscription Payment Failed',
            message: 'Your subscription renewal payment failed. Please update your payment method to keep your credits active.',
            metadata: { invoiceId: invoice.id, subscriptionId },
          });

          console.log(`[Stripe Webhook] Payment failed for user ${userId}, subscription ${subscriptionId}`);
        }

        await markProcessed(supabase, stripeEvent.id, stripeEvent.type, userId ?? null, { subscriptionId });
        break;
      }

      case 'charge.refunded': {
        const charge = stripeEvent.data.object as Stripe.Charge;
        const amountRefunded = (charge.amount_refunded || 0) / 100;

        console.warn(`[Stripe Webhook] Refund issued: charge=${charge.id}, amount=$${amountRefunded}`);

        await markProcessed(supabase, stripeEvent.id, stripeEvent.type, null, {
          chargeId: charge.id,
          amountRefunded,
          customerId: typeof charge.customer === 'string' ? charge.customer : null,
        });
        break;
      }

      case 'charge.dispute.created': {
        const dispute = stripeEvent.data.object as Stripe.Dispute;

        console.error(`[Stripe Webhook] DISPUTE CREATED: dispute=${dispute.id}, charge=${dispute.charge}, amount=$${(dispute.amount || 0) / 100}`);

        await markProcessed(supabase, stripeEvent.id, stripeEvent.type, null, {
          disputeId: dispute.id,
          chargeId: typeof dispute.charge === 'string' ? dispute.charge : null,
          amount: (dispute.amount || 0) / 100,
          reason: dispute.reason,
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = stripeEvent.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.userId;

        if (userId) {
          await supabase.from('user_subscription_status').upsert(
            {
              user_id: userId,
              stripe_subscription_id: subscription.id,
              status: 'canceled',
              cancel_at_period_end: false,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
          );

          await supabase.from('goal_notifications').insert({
            user_id: userId,
            type: 'system_alert',
            priority: 'medium',
            title: 'Subscription Canceled',
            message: 'Your subscription has been canceled. You can still use your remaining credits.',
            metadata: { subscriptionId: subscription.id },
          });
        }

        await markProcessed(supabase, stripeEvent.id, stripeEvent.type, userId ?? null, { subscriptionId: subscription.id });
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = stripeEvent.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.userId;
        const packageId = subscription.metadata?.packageId;

        if (userId) {
          let pkg: { name: string; token_amount: number } | null = null;
          if (packageId) {
            const { data } = await supabase
              .from('token_packages')
              .select('name, token_amount')
              .eq('id', packageId)
              .maybeSingle();
            pkg = data;
          }
          await upsertSubscriptionStatus(supabase, userId, subscription, pkg);
          console.log(`[Stripe Webhook] Subscription updated for user ${userId}: status=${subscription.status}`);
        }

        await markProcessed(supabase, stripeEvent.id, stripeEvent.type, userId ?? null, { subscriptionId: subscription.id });
        break;
      }

      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${stripeEvent.type}`);
        await markProcessed(supabase, stripeEvent.id, stripeEvent.type, null, {});
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ received: true }),
    };
  } catch (error: any) {
    console.error('[Stripe Webhook] Error processing webhook:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Webhook processing failed', details: error.message }),
    };
  }
};

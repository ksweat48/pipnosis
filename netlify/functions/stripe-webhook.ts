import { Handler, HandlerEvent } from '@netlify/functions';
import Stripe from 'stripe';
import { getSupabaseAdmin } from './_shared/supabase-admin';

const headers = {
  'Content-Type': 'application/json',
};

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

    let stripeEvent: any;
    try {
      stripeEvent = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret
      );
    } catch (err: any) {
      console.error('[Stripe Webhook] Signature verification failed:', err.message);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid signature' }),
      };
    }

    const supabase = getSupabaseAdmin();

    console.log('[Stripe Webhook] Processing event:', stripeEvent.type);

    switch (stripeEvent.type) {
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
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

          console.log(`[Stripe Webhook] Processing Club ${isUpgrade ? 'upgrade' : 'membership'}: user=${userId}, package=${packageId}, amount=$${amountPaid}, session=${session.id}`);

          // Use grant_club_membership for both new purchases and upgrades
          // The function now handles upgrade detection and cumulative token allocation internally
          const { data: grantResult, error: grantError } = await supabase.rpc('grant_club_membership', {
            p_user_id: userId,
            p_package_id: packageId,
            p_amount_paid: amountPaid,
            p_stripe_session_id: session.id,
          });

          if (grantError) {
            console.error(`[Stripe Webhook] Failed to grant/upgrade membership:`, JSON.stringify(grantError));
            return {
              statusCode: 500,
              headers,
              body: JSON.stringify({
                error: 'Failed to process membership purchase',
                pg_message: grantError.message,
                pg_code: grantError.code,
                pg_details: grantError.details,
                pg_hint: grantError.hint,
              }),
            };
          }

          const result = grantResult as any;
          if (!result?.success) {
            console.error(`[Stripe Webhook] Membership processing returned failure:`, JSON.stringify(result));
            return {
              statusCode: 500,
              headers,
              body: JSON.stringify({
                error: result?.error || 'Membership processing failed',
                rpc_result: result,
              }),
            };
          }

          // Log cumulative token details
          const action = result.is_upgrade ? 'Upgraded to' : 'Granted';
          console.log(`[Stripe Webhook] ${action} ${result.tier_name} (Tier ${result.tier_level}) for user ${userId}`);
          console.log(`[Stripe Webhook] Cumulative tokens awarded: ${result.total_tokens_awarded} PIP from ${result.tiers_awarded_count} tier(s)`);
          console.log(`[Stripe Webhook] Available balance: ${result.tokens_available} PIP (${result.tokens_locked} locked)`);

          break;
        }

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
          metadata: {
            credits: creditAmount,
            packageName: pkg.name,
            amount: pkg.price_usd,
            sessionId: session.id
          },
        });

        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = stripeEvent.data.object;
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
        const userId = subscription.metadata?.userId;
        const packageId = subscription.metadata?.packageId;

        if (!userId || !packageId) {
          console.log('[Stripe Webhook] Skipping invoice - no metadata (likely initial payment)');
          break;
        }

        const { data: pkg, error: pkgError } = await supabase
          .from('token_packages')
          .select('token_amount, name')
          .eq('id', packageId)
          .single();

        if (pkgError || !pkg) {
          console.error('[Stripe Webhook] Package not found for recurring payment:', pkgError);
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
        } else {
          console.log(`[Stripe Webhook] Renewal: Added ${creditAmount} credits to user ${userId}`);

          await supabase.from('goal_notifications').insert({
            user_id: userId,
            type: 'system_alert',
            priority: 'medium',
            title: 'Subscription Renewed',
            message: `Your subscription has been renewed. ${creditAmount} credits have been added to your account.`,
            metadata: {
              credits: creditAmount,
              packageName: pkg.name,
              invoiceId: invoice.id
            },
          });
        }

        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = stripeEvent.data.object;
        const userId = subscription.metadata?.userId;

        if (userId) {
          await supabase.from('goal_notifications').insert({
            user_id: userId,
            type: 'system_alert',
            priority: 'medium',
            title: 'Subscription Canceled',
            message: 'Your subscription has been canceled. You can still use your remaining credits.',
            metadata: {
              subscriptionId: subscription.id
            },
          });
        }

        break;
      }

      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${stripeEvent.type}`);
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
      body: JSON.stringify({
        error: 'Webhook processing failed',
        details: error.message
      }),
    };
  }
};

import { Handler, HandlerEvent } from '@netlify/functions';
import Stripe from 'stripe';
import { getSupabaseAdmin } from './_shared/supabase-admin';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { sessionId } = JSON.parse(event.body || '{}');

    if (!sessionId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing sessionId' }),
      };
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      console.error('[VerifyPurchase] STRIPE_SECRET_KEY not configured');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Stripe not configured' }),
      };
    }

    const stripe = new Stripe(stripeSecretKey);

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      console.log(`[VerifyPurchase] Session ${sessionId} not paid: ${session.payment_status}`);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Payment not completed', status: session.payment_status }),
      };
    }

    const userId = session.metadata?.userId || session.client_reference_id;
    const packageId = session.metadata?.packageId;
    const purchaseType = session.metadata?.purchaseType;

    if (!userId || !packageId) {
      console.error('[VerifyPurchase] Missing metadata in session', { userId, packageId });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing purchase metadata' }),
      };
    }

    const supabase = getSupabaseAdmin();

    if (purchaseType === 'membership' || purchaseType === 'membership_upgrade') {
      const isUpgrade = purchaseType === 'membership_upgrade';
      const amountPaid = (session.amount_total || 0) / 100;

      if (!isUpgrade) {
        const { data: existing } = await supabase
          .from('club_memberships')
          .select('id')
          .eq('user_id', userId)
          .eq('status', 'active')
          .maybeSingle();

        if (existing) {
          console.log(`[VerifyPurchase] Membership already granted for user ${userId}`);
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, alreadyGranted: true }),
          };
        }
      }

      const rpcName = isUpgrade ? 'upgrade_club_membership' : 'grant_club_membership';
      const rpcParams = isUpgrade
        ? {
            p_user_id: userId,
            p_new_package_id: packageId,
            p_stripe_session_id: session.id,
            p_stripe_payment_intent_id: (session.payment_intent as string) || '',
            p_amount_paid_usd: amountPaid,
          }
        : {
            p_user_id: userId,
            p_package_id: packageId,
            p_stripe_session_id: session.id,
            p_stripe_payment_intent_id: (session.payment_intent as string) || '',
            p_amount_paid_usd: amountPaid,
          };

      const { data: grantResult, error: grantError } = await supabase.rpc(rpcName, rpcParams);

      if (grantError) {
        console.error(`[VerifyPurchase] Failed to ${isUpgrade ? 'upgrade' : 'grant'} membership:`, grantError);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: `Failed to ${isUpgrade ? 'upgrade' : 'grant'} membership`, details: grantError.message }),
        };
      }

      const result = grantResult as any;
      if (!result?.success) {
        console.error(`[VerifyPurchase] ${isUpgrade ? 'Upgrade' : 'Grant'} returned failure:`, result?.error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: result?.error || `Membership ${isUpgrade ? 'upgrade' : 'grant'} failed` }),
        };
      }

      const tierName = isUpgrade ? result.to_tier_name : result.tier_name;
      const tierLevel = isUpgrade ? result.to_tier : result.tier_level;
      const tokensAwarded = isUpgrade ? result.tokens_granted : result.tokens_awarded;
      const tokensLocked = result.tokens_locked;

      console.log(`[VerifyPurchase] ${isUpgrade ? 'Upgraded to' : 'Granted'} ${tierName} for user ${userId} (tokens: ${tokensAwarded})`);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          isUpgrade,
          tierName,
          tierLevel,
          tokensAwarded,
          tokensLocked,
          ...(isUpgrade ? {
            fromTierName: result.from_tier_name,
            tokensReleased: result.tokens_released,
            availableTokens: result.available_tokens,
          } : {}),
        }),
      };
    }

    if (purchaseType === 'credits') {
      const { data: pkg, error: pkgError } = await supabase
        .from('token_packages')
        .select('token_amount, name, price_usd')
        .eq('id', packageId)
        .maybeSingle();

      if (pkgError || !pkg) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Credit package not found' }),
        };
      }

      const { error: creditError } = await supabase.rpc('add_credits_transaction', {
        p_user_id: userId,
        p_amount: pkg.token_amount,
        p_transaction_type: 'package_purchase',
        p_description: `Purchased ${pkg.name} - $${pkg.price_usd} (verified)`,
      });

      if (creditError) {
        if (creditError.message?.includes('duplicate') || creditError.message?.includes('already')) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, alreadyGranted: true }),
          };
        }
        console.error('[VerifyPurchase] Failed to add credits:', creditError);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to add credits' }),
        };
      }

      console.log(`[VerifyPurchase] Added ${pkg.token_amount} credits to user ${userId}`);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, creditsAdded: pkg.token_amount }),
      };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: `Unknown purchase type: ${purchaseType}` }),
    };
  } catch (error: any) {
    console.error('[VerifyPurchase] Error:', error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Verification failed', details: error.message }),
    };
  }
};

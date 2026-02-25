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
      const amountPaid = (session.amount_total || 0) / 100;

      // Capture previous tier name before grant (needed for upgrade success messaging)
      let fromTierName: string | null = null;
      if (purchaseType === 'membership_upgrade') {
        const { data: existingMembership } = await supabase
          .from('club_memberships')
          .select('tier_level, club_membership_packages!inner(name)')
          .eq('user_id', userId)
          .eq('status', 'active')
          .order('tier_level', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existingMembership) {
          fromTierName = (existingMembership as any).club_membership_packages?.name ?? null;
        }
      }

      const { data: grantResult, error: grantError } = await supabase.rpc('grant_club_membership', {
        p_user_id: userId,
        p_package_id: packageId,
        p_stripe_session_id: session.id,
        p_amount_paid: amountPaid,
      });

      if (grantError) {
        console.error(`[VerifyPurchase] Failed to process membership:`, grantError);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to process membership purchase', details: grantError.message }),
        };
      }

      const result = grantResult as any;
      if (!result?.success) {
        // Idempotency: if already processed by webhook, fetch current membership to return valid data
        if (result?.error === 'Already at this tier or higher') {
          const { data: currentMembership } = await supabase
            .from('club_memberships')
            .select('tier_level, tokens_locked, club_membership_packages!inner(name)')
            .eq('user_id', userId)
            .eq('status', 'active')
            .order('tier_level', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (currentMembership) {
            return {
              statusCode: 200,
              headers,
              body: JSON.stringify({
                success: true,
                alreadyGranted: true,
                isUpgrade: purchaseType === 'membership_upgrade',
                tierName: (currentMembership as any).club_membership_packages?.name,
                tierLevel: currentMembership.tier_level,
                tokensAwarded: 0,
                fromTierName: fromTierName ?? undefined,
              }),
            };
          }
        }
        console.error(`[VerifyPurchase] Membership processing returned failure:`, result?.error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: result?.error || 'Membership processing failed' }),
        };
      }

      // RPC returns: success, membership_id, tier_level, tokens_awarded, is_upgrade, tier_breakdown
      // tier_name is NOT returned by the RPC — look it up from the package
      const isUpgrade = result.is_upgrade || false;
      const tierLevel = result.tier_level as number;
      const tokensAwarded = result.tokens_awarded as number;

      const { data: pkg } = await supabase
        .from('club_membership_packages')
        .select('name, required_token_balance')
        .eq('tier_level', tierLevel)
        .maybeSingle();

      const tierName = pkg?.name ?? `Tier ${tierLevel}`;
      const tokensLocked = pkg?.required_token_balance ?? 0;

      console.log(`[VerifyPurchase] ${isUpgrade ? 'Upgraded to' : 'Granted'} ${tierName} (Tier ${tierLevel}) for user ${userId}. Tokens awarded: ${tokensAwarded}`);

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
          tierBreakdown: result.tier_breakdown,
          fromTierName: fromTierName ?? undefined,
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

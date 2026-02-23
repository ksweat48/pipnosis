import { Handler, HandlerEvent } from '@netlify/functions';
import Stripe from 'stripe';
import { getSupabaseAdmin } from './_shared/supabase-admin';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Stripe not configured' }) };
    }

    const { userId } = JSON.parse(event.body || '{}');
    if (!userId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing userId' }) };
    }

    const supabase = getSupabaseAdmin();

    // Look up the Stripe customer ID from user_subscription_status
    const { data: subStatus } = await supabase
      .from('user_subscription_status')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();

    let customerId = subStatus?.stripe_customer_id;

    // Fallback: check the legacy stripe_customers table if it exists
    if (!customerId) {
      const { data: legacyCustomer } = await supabase
        .from('stripe_customers')
        .select('customer_id')
        .eq('user_id', userId)
        .maybeSingle();
      customerId = legacyCustomer?.customer_id;
    }

    if (!customerId) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'No Stripe customer found for this user. Please make a purchase first.' }),
      };
    }

    const stripe = new Stripe(stripeSecretKey);

    const origin = event.headers.origin || event.headers.referer?.replace(/\/$/, '') || 'https://pipnosis.com';

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/credits`,
    });

    console.log(`[Stripe Portal] Created portal session for user ${userId}, customer ${customerId}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ url: portalSession.url }),
    };
  } catch (error: any) {
    console.error('[Stripe Portal] Error creating portal session:', error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to create billing portal session', details: error.message }),
    };
  }
};

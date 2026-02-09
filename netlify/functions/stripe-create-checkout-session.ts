import { Handler, HandlerEvent } from '@netlify/functions';

interface CheckoutSessionRequest {
  priceId: string;
  packageId: string;
  userId: string;
  mode: 'payment' | 'subscription';
  purchaseType?: 'credits' | 'membership';
}

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
    const { priceId, packageId, userId, mode, purchaseType = 'credits' }: CheckoutSessionRequest = JSON.parse(
      event.body || '{}'
    );

    if (!priceId || !packageId || !userId || !mode) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Missing required fields: priceId, packageId, userId, mode',
        }),
      };
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

    if (!stripeSecretKey) {
      console.error('[Stripe] STRIPE_SECRET_KEY not configured');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: 'Stripe not configured. Please add STRIPE_SECRET_KEY to environment variables.',
        }),
      };
    }

    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2024-12-18.acacia',
    });

    const origin = event.headers.origin || event.headers.referer?.replace(/\/$/, '') || 'https://pipnosis.com';

    const isMembership = purchaseType === 'membership';
    const successUrl = isMembership
      ? `${origin}/club?success=true&session_id={CHECKOUT_SESSION_ID}`
      : `${origin}/credits?success=true&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = isMembership
      ? `${origin}/club?canceled=true`
      : `${origin}/credits?canceled=true`;

    const sessionConfig: any = {
      mode,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId,
        packageId,
        purchaseType,
      },
      client_reference_id: userId,
    };

    if (mode === 'subscription') {
      sessionConfig.subscription_data = {
        metadata: {
          userId,
          packageId,
          purchaseType,
        },
      };
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    console.log(`[Stripe] Created ${purchaseType} checkout session: ${session.id}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        sessionId: session.id,
        url: session.url
      }),
    };
  } catch (error: any) {
    console.error('[Stripe] Error creating checkout session:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to create checkout session',
        details: error.message
      }),
    };
  }
};

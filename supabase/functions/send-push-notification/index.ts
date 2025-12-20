import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: any;
  tag?: string;
  vibrate?: number[];
}

interface SendPushRequest {
  user_id: string;
  notification_id?: string;
  payload: PushPayload;
}

async function sendWebPush(
  endpoint: string,
  p256dhKey: string,
  authKey: string,
  payload: PushPayload
): Promise<{ success: boolean; error?: string; statusCode?: number }> {
  try {
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');

    if (!vapidPublicKey || !vapidPrivateKey) {
      console.error('[Push] VAPID keys not configured');
      return { success: false, error: 'VAPID keys not configured' };
    }

    const urlObject = new URL(endpoint);
    const audience = `${urlObject.protocol}//${urlObject.host}`;

    const now = Math.floor(Date.now() / 1000);
    const exp = now + 12 * 60 * 60;

    const header = {
      typ: 'JWT',
      alg: 'ES256'
    };

    const jwtPayload = {
      aud: audience,
      exp: exp,
      sub: 'mailto:support@pipnosis.com'
    };

    const textEncoder = new TextEncoder();
    const headerB64 = btoa(JSON.stringify(header))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    const payloadB64 = btoa(JSON.stringify(jwtPayload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    const unsignedToken = `${headerB64}.${payloadB64}`;

    const privateKeyDer = Uint8Array.from(atob(vapidPrivateKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const importedKey = await crypto.subtle.importKey(
      'pkcs8',
      privateKeyDer,
      {
        name: 'ECDSA',
        namedCurve: 'P-256'
      },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign(
      {
        name: 'ECDSA',
        hash: { name: 'SHA-256' }
      },
      importedKey,
      textEncoder.encode(unsignedToken)
    );

    const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    const jwt = `${unsignedToken}.${signatureB64}`;

    const payloadString = JSON.stringify(payload);
    const payloadBytes = textEncoder.encode(payloadString);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'Authorization': `vapid t=${jwt}, k=${vapidPublicKey}`,
        'TTL': '86400'
      },
      body: payloadBytes
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Push] Push failed:', response.status, errorText);

      return {
        success: false,
        error: `Push failed: ${response.status} ${errorText}`,
        statusCode: response.status
      };
    }

    return { success: true };
  } catch (error) {
    console.error('[Push] Error sending push:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { user_id, notification_id, payload }: SendPushRequest = await req.json();

    if (!user_id || !payload) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: user_id and payload' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('[Push] Sending to user:', user_id);

    const { data: subscriptions, error: fetchError } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh_key, auth_key, device_name')
      .eq('user_id', user_id)
      .eq('is_active', true);

    if (fetchError) {
      console.error('[Push] Error fetching subscriptions:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch subscriptions', details: fetchError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    if (!subscriptions || subscriptions.length === 0) {
      console.warn('[Push] No active subscriptions found for user:', user_id);
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No active subscriptions',
          sent: 0,
          delivered: 0
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('[Push] Found subscriptions:', subscriptions.length);

    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        const result = await sendWebPush(
          sub.endpoint,
          sub.p256dh_key,
          sub.auth_key,
          payload
        );

        if (result.statusCode === 410 || result.statusCode === 404) {
          console.log('[Push] Marking subscription as inactive:', sub.id);
          await supabase
            .from('push_subscriptions')
            .update({ is_active: false })
            .eq('id', sub.id);
        } else if (result.success) {
          await supabase
            .from('push_subscriptions')
            .update({ last_used_at: new Date().toISOString() })
            .eq('id', sub.id);
        }

        return result;
      })
    );

    const sentCount = results.length;
    const deliveredCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failedCount = sentCount - deliveredCount;

    console.log('[Push] Results - Sent:', sentCount, 'Delivered:', deliveredCount, 'Failed:', failedCount);

    if (notification_id) {
      await supabase
        .from('goal_notifications')
        .update({
          push_sent: true,
          push_sent_at: new Date().toISOString(),
          push_delivery_status: deliveredCount > 0 ? 'delivered' : 'failed',
          push_devices_sent_count: sentCount,
          push_devices_delivered_count: deliveredCount,
          push_error_message: failedCount > 0 ? `${failedCount} devices failed` : null
        })
        .eq('id', notification_id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        sent: sentCount,
        delivered: deliveredCount,
        failed: failedCount
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('[Push] Error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

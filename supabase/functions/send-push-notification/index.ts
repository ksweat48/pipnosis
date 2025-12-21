import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

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

interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
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

    console.log('[Push] Configuring web-push with VAPID keys');

    // Configure web-push with VAPID details
    webpush.setVapidDetails(
      'mailto:support@pipnosis.com',
      vapidPublicKey,
      vapidPrivateKey
    );

    // Create push subscription object
    const pushSubscription: PushSubscription = {
      endpoint: endpoint,
      keys: {
        p256dh: p256dhKey,
        auth: authKey
      }
    };

    console.log('[Push] Sending notification to endpoint:', endpoint.substring(0, 50) + '...');

    // Send notification using web-push library (handles all encryption)
    const result = await webpush.sendNotification(
      pushSubscription,
      JSON.stringify(payload),
      {
        TTL: 86400, // 24 hours
        urgency: 'high',
        topic: payload.tag || 'default'
      }
    );

    console.log('[Push] Push sent successfully, status:', result.statusCode);

    return {
      success: true,
      statusCode: result.statusCode
    };
  } catch (error: any) {
    console.error('[Push] Error sending push:', error);

    // Extract status code from error if available
    const statusCode = error?.statusCode || error?.response?.statusCode || 500;
    const errorBody = error?.body || error?.message || 'Unknown error';

    console.error('[Push] Error details - Status:', statusCode, 'Body:', errorBody);

    return {
      success: false,
      error: errorBody,
      statusCode: statusCode
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
    console.log('[Push] Payload:', JSON.stringify(payload).substring(0, 100));

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

    console.log('[Push] Found', subscriptions.length, 'active subscription(s)');

    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        console.log('[Push] Sending to device:', sub.device_name);

        const result = await sendWebPush(
          sub.endpoint,
          sub.p256dh_key,
          sub.auth_key,
          payload
        );

        console.log('[Push] Result for', sub.device_name, ':', result.success ? 'SUCCESS' : 'FAILED', result.statusCode);

        // Mark subscription as inactive if endpoint is gone or not found
        if (result.statusCode === 410 || result.statusCode === 404) {
          console.log('[Push] Marking subscription as inactive:', sub.id);
          await supabase
            .from('push_subscriptions')
            .update({ is_active: false })
            .eq('id', sub.id);
        } else if (result.success) {
          // Update last used timestamp on success
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

    console.log('[Push] FINAL RESULTS - Sent:', sentCount, 'Delivered:', deliveredCount, 'Failed:', failedCount);

    // Log failed results for debugging
    results.forEach((r, i) => {
      if (r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)) {
        const error = r.status === 'rejected' ? r.reason : r.value.error;
        console.error('[Push] Failed device', i, 'error:', error);
      }
    });

    // Update notification status in database if notification_id provided
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
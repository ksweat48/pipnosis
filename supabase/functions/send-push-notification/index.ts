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

// Helper function to convert base64url to Uint8Array
function base64UrlToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Helper function to convert Uint8Array to base64url
function uint8ArrayToBase64Url(array: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...array));
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Web Push encryption using aes128gcm (RFC 8291)
async function encryptPayload(
  plaintext: string,
  p256dhKey: string,
  authKey: string
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; publicKey: Uint8Array }> {
  try {
    // Decode the subscription keys
    const userPublicKey = base64UrlToUint8Array(p256dhKey);
    const userAuth = base64UrlToUint8Array(authKey);

    // Generate a new key pair for this message
    const serverKeyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits']
    );

    // Export the server public key
    const serverPublicKeyRaw = await crypto.subtle.exportKey('raw', serverKeyPair.publicKey);
    const serverPublicKeyBytes = new Uint8Array(serverPublicKeyRaw);

    // Import the user's public key
    const importedUserPublicKey = await crypto.subtle.importKey(
      'raw',
      userPublicKey,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      []
    );

    // Derive shared secret using ECDH
    const sharedSecret = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: importedUserPublicKey },
      serverKeyPair.privateKey,
      256
    );

    // Generate random salt (16 bytes)
    const salt = crypto.getRandomValues(new Uint8Array(16));

    // Create info parameter for HKDF
    const textEncoder = new TextEncoder();
    const contentEncoding = textEncoder.encode('Content-Encoding: aes128gcm\0');

    // Combine info: "WebPush: info" || 0x00 || ua || 0x00 || as
    const info = new Uint8Array([
      ...textEncoder.encode('WebPush: info\0'),
      ...userPublicKey,
      0,
      ...serverPublicKeyBytes
    ]);

    // HKDF to derive the encryption key
    const hkdfKey = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(sharedSecret),
      { name: 'HKDF' },
      false,
      ['deriveBits']
    );

    const prk = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: userAuth,
        info: contentEncoding
      },
      hkdfKey,
      256
    );

    const prkKey = await crypto.subtle.importKey(
      'raw',
      prk,
      { name: 'HKDF' },
      false,
      ['deriveBits']
    );

    const ikm = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: salt,
        info: info
      },
      prkKey,
      256
    );

    // Derive the content encryption key and nonce
    const ikmKey = await crypto.subtle.importKey(
      'raw',
      ikm,
      { name: 'HKDF' },
      false,
      ['deriveBits']
    );

    const cekInfo = new Uint8Array([
      ...textEncoder.encode('Content-Encoding: aes128gcm\0'),
      0x00, 0x00
    ]);

    const cekBits = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: salt,
        info: cekInfo
      },
      ikmKey,
      128
    );

    const nonceInfo = new Uint8Array([
      ...textEncoder.encode('Content-Encoding: nonce\0'),
      0x00, 0x00
    ]);

    const nonceBits = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: salt,
        info: nonceInfo
      },
      ikmKey,
      96
    );

    // Import CEK for AES-GCM
    const contentKey = await crypto.subtle.importKey(
      'raw',
      cekBits,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );

    // Add padding delimiter (0x02) and padding
    const plaintextBytes = textEncoder.encode(plaintext);
    const paddingLength = 0;
    const record = new Uint8Array(plaintextBytes.length + 1 + paddingLength);
    record.set(plaintextBytes);
    record[plaintextBytes.length] = 0x02;

    // Encrypt the payload
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(nonceBits),
        tagLength: 128
      },
      contentKey,
      record
    );

    return {
      ciphertext: new Uint8Array(ciphertext),
      salt: salt,
      publicKey: serverPublicKeyBytes
    };
  } catch (error) {
    console.error('[Push] Encryption error:', error);
    throw error;
  }
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

    console.log('[Push] Encrypting payload...');

    // Encrypt the payload
    const payloadString = JSON.stringify(payload);
    const encrypted = await encryptPayload(payloadString, p256dhKey, authKey);

    console.log('[Push] Payload encrypted, generating VAPID token...');

    // Generate VAPID JWT
    const urlObject = new URL(endpoint);
    const audience = `${urlObject.protocol}//${urlObject.host}`;

    const now = Math.floor(Date.now() / 1000);
    const exp = now + 12 * 60 * 60;

    const header = { typ: 'JWT', alg: 'ES256' };
    const jwtPayload = {
      aud: audience,
      exp: exp,
      sub: 'mailto:support@pipnosis.com'
    };

    const textEncoder = new TextEncoder();
    const headerB64 = uint8ArrayToBase64Url(textEncoder.encode(JSON.stringify(header)));
    const payloadB64 = uint8ArrayToBase64Url(textEncoder.encode(JSON.stringify(jwtPayload)));
    const unsignedToken = `${headerB64}.${payloadB64}`;

    // Import VAPID private key
    const privateKeyDer = base64UrlToUint8Array(vapidPrivateKey);
    const importedKey = await crypto.subtle.importKey(
      'pkcs8',
      privateKeyDer,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    );

    // Sign the JWT
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: { name: 'SHA-256' } },
      importedKey,
      textEncoder.encode(unsignedToken)
    );

    const signatureB64 = uint8ArrayToBase64Url(new Uint8Array(signature));
    const jwt = `${unsignedToken}.${signatureB64}`;

    console.log('[Push] Sending encrypted notification to:', endpoint.substring(0, 50) + '...');

    // Prepare headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'Authorization': `vapid t=${jwt}, k=${vapidPublicKey}`,
      'Crypto-Key': `dh=${uint8ArrayToBase64Url(encrypted.publicKey)}`,
      'Encryption': `salt=${uint8ArrayToBase64Url(encrypted.salt)}`,
      'TTL': '86400'
    };

    // Send the push notification
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: headers,
      body: encrypted.ciphertext
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

    console.log('[Push] Push sent successfully, status:', response.status);

    return {
      success: true,
      statusCode: response.status
    };
  } catch (error: any) {
    console.error('[Push] Error sending push:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      statusCode: 500
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

    console.log('[Push] Processing notification for user:', user_id);

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
      console.warn('[Push] No active subscriptions found');
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

    console.log('[Push] Found', subscriptions.length, 'subscription(s)');

    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        console.log('[Push] Processing device:', sub.device_name);

        const result = await sendWebPush(
          sub.endpoint,
          sub.p256dh_key,
          sub.auth_key,
          payload
        );

        console.log('[Push]', sub.device_name, '-', result.success ? 'SUCCESS' : 'FAILED', result.statusCode);

        if (result.statusCode === 410 || result.statusCode === 404) {
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

    console.log('[Push] === FINAL RESULTS ===');
    console.log('[Push] Sent:', sentCount, '| Delivered:', deliveredCount, '| Failed:', failedCount);

    results.forEach((r, i) => {
      if (r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)) {
        const error = r.status === 'rejected' ? r.reason : r.value.error;
        console.error('[Push] Device', i, 'failed:', error);
      }
    });

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
    console.error('[Push] Critical error:', error);
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
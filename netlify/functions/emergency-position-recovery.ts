/**
 * Emergency Position Recovery - Netlify Cron Job
 *
 * This Netlify function runs every 60 seconds and calls the Supabase edge function
 * to detect and recover stuck positions. It acts as the FINAL SAFETY NET for the
 * TP/SL monitoring system.
 *
 * Purpose:
 * - Calls Supabase emergency-position-recovery edge function
 * - Provides backup monitoring independent of client browsers
 * - Force-recovers positions that failed to close at TP/SL
 * - Logs all recovery attempts for audit trail
 *
 * Scheduled: Every 60 seconds (configured in netlify.toml)
 */

import type { Handler } from '@netlify/functions';

export const handler: Handler = async (event, context) => {
  console.log('[Netlify Emergency Recovery] Starting emergency position recovery check...');

  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Missing Supabase credentials');
    }

    // Call the Supabase edge function
    const response = await fetch(
      `${supabaseUrl}/functions/v1/emergency-position-recovery`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          source: 'netlify_cron',
          timestamp: new Date().toISOString()
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Netlify Emergency Recovery] Edge function call failed:', errorText);
      throw new Error(`Edge function failed with status ${response.status}`);
    }

    const result = await response.json();

    console.log('[Netlify Emergency Recovery] Recovery complete:', result);

    if (result.positions_detected > 0) {
      console.log(`[Netlify Emergency Recovery] ⚠️ Found ${result.positions_detected} stuck position(s)`);
      console.log(`[Netlify Emergency Recovery] ✅ Recovered: ${result.positions_recovered}`);

      if (result.positions_failed > 0) {
        console.error(`[Netlify Emergency Recovery] ❌ Failed: ${result.positions_failed}`);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Emergency recovery check completed',
        ...result
      })
    };

  } catch (error) {
    console.error('[Netlify Emergency Recovery] Critical error:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Emergency recovery check failed'
      })
    };
  }
};

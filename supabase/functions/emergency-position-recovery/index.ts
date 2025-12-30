import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

/**
 * Emergency Position Recovery Function
 *
 * This function acts as the FINAL SAFETY NET for stuck positions.
 * It runs independently of all other monitoring systems.
 *
 * Purpose:
 * - Detect positions that should have closed but didn't
 * - Force-recover stuck positions automatically
 * - Log all recovery attempts for audit trail
 * - Send alerts when positions are recovered
 *
 * This should be called by a cron job every 60 seconds.
 */

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    // Create Supabase admin client (service role)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    console.log('[Emergency Recovery] Starting position recovery scan...');

    // Step 1: Detect stuck positions
    const { data: stuckPositions, error: detectError } = await supabase
      .rpc('detect_stuck_positions');

    if (detectError) {
      console.error('[Emergency Recovery] Failed to detect stuck positions:', detectError);
      throw detectError;
    }

    if (!stuckPositions || stuckPositions.length === 0) {
      console.log('[Emergency Recovery] No stuck positions found. System healthy.');
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No stuck positions found',
          positions_checked: 0,
          positions_recovered: 0
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log(`[Emergency Recovery] Found ${stuckPositions.length} stuck position(s):`);
    stuckPositions.forEach((pos: any) => {
      console.log(`  - ${pos.symbol} (${pos.status}): ${pos.stuck_reason} (${pos.seconds_stuck}s)`);
    });

    // Step 2: Attempt to recover stuck positions
    const { data: recoveryResults, error: recoveryError } = await supabase
      .rpc('recover_stuck_positions');

    if (recoveryError) {
      console.error('[Emergency Recovery] Recovery process failed:', recoveryError);

      // Still return partial success if some were detected
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Recovery process failed',
          error: recoveryError.message,
          positions_detected: stuckPositions.length,
          positions_recovered: 0
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Count successful recoveries
    const successCount = recoveryResults?.filter((r: any) => r.success).length || 0;
    const failureCount = (recoveryResults?.length || 0) - successCount;

    console.log(`[Emergency Recovery] Recovery complete:`);
    console.log(`  - Successful: ${successCount}`);
    console.log(`  - Failed: ${failureCount}`);

    // Log detailed results
    recoveryResults?.forEach((result: any) => {
      if (result.success) {
        console.log(`  ✅ Recovered ${result.symbol}: ${result.recovery_action}`);
      } else {
        console.error(`  ❌ Failed to recover ${result.symbol}: ${result.error_message}`);
      }
    });

    // Step 3: Send admin alerts if there were failures
    if (failureCount > 0) {
      const failedRecoveries = recoveryResults?.filter((r: any) => !r.success) || [];

      console.warn('[Emergency Recovery] Some positions could not be recovered automatically');
      console.warn('Failed positions:', failedRecoveries.map((r: any) => r.symbol).join(', '));

      // Create admin notification for failed recoveries
      const { error: notifError } = await supabase
        .from('goal_notifications')
        .insert({
          user_id: null, // Admin notification
          type: 'system_alert',
          priority: 'urgent',
          title: '⚠️ Emergency Recovery Failed',
          message: `Failed to auto-recover ${failureCount} stuck position(s). Manual intervention required.`,
          metadata: {
            failed_positions: failedRecoveries,
            timestamp: new Date().toISOString(),
            system: 'emergency_position_recovery'
          },
          channels: ['in_app']
        });

      if (notifError) {
        console.error('[Emergency Recovery] Failed to create admin notification:', notifError);
      }
    }

    // Step 4: Return results
    return new Response(
      JSON.stringify({
        success: true,
        message: `Recovered ${successCount} of ${stuckPositions.length} stuck positions`,
        positions_detected: stuckPositions.length,
        positions_recovered: successCount,
        positions_failed: failureCount,
        results: recoveryResults
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('[Emergency Recovery] Unexpected error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Emergency recovery process encountered an error'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

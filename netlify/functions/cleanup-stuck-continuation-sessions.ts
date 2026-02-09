import { Handler, schedule } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase-admin';

/**
 * CRITICAL SERVERLESS FUNCTION
 *
 * PURPOSE: Clean up sessions stuck in 'awaiting_continuation' status
 *
 * WHY THIS EXISTS:
 * - The NoTradesFoundDialog modal has a 60-second JavaScript countdown
 * - BUT if user's phone sleeps, browser closes, or network disconnects, the JS timer stops
 * - Database triggers only fire on UPDATE operations
 * - Without this function, sessions stay stuck in 'awaiting_continuation' forever
 *
 * WHAT IT DOES:
 * - Runs every 1 minute (via Netlify scheduled functions)
 * - Finds sessions in 'awaiting_continuation' for > 60 seconds
 * - Checks for open trades (NEVER close session with open trades)
 * - Auto-closes sessions that have timed out
 *
 * SAFETY:
 * - Defense-in-depth: Checks for open trades before closing
 * - Only closes sessions that have been waiting > 60 seconds
 * - Logs all actions for audit trail
 *
 * CCIP COMPLIANCE:
 * - Single Source of Truth: Only this function does periodic cleanup
 * - Immutability: Can't be bypassed by client-side
 * - Correctness: Never orphans trades
 * - Provenance: Full logging and audit trail
 */

const cleanupHandler: Handler = async (event, context) => {
  const startTime = Date.now();

  console.log('[Continuation Cleanup] Starting periodic cleanup...');

  try {
    const supabase = getSupabaseAdmin();

    // Find all sessions stuck in awaiting_continuation for > 60 seconds
    const { data: stuckSessions, error: fetchError } = await supabase
      .from('goal_sessions')
      .select('id, user_id, awaiting_continuation_since, status')
      .eq('status', 'awaiting_continuation')
      .not('awaiting_continuation_since', 'is', null)
      .lt('awaiting_continuation_since', new Date(Date.now() - 60 * 1000).toISOString());

    if (fetchError) {
      console.error('[Continuation Cleanup] Error fetching stuck sessions:', fetchError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to fetch stuck sessions', details: fetchError.message })
      };
    }

    if (!stuckSessions || stuckSessions.length === 0) {
      console.log('[Continuation Cleanup] No stuck sessions found ✓');
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'No stuck sessions',
          cleaned: 0,
          blocked: 0,
          duration_ms: Date.now() - startTime
        })
      };
    }

    console.log(`[Continuation Cleanup] Found ${stuckSessions.length} stuck sessions`);

    let cleanedCount = 0;
    let blockedCount = 0;

    for (const session of stuckSessions) {
      const secondsElapsed = Math.floor((Date.now() - new Date(session.awaiting_continuation_since!).getTime()) / 1000);

      console.log(`[Continuation Cleanup] Processing session ${session.id} (stuck for ${secondsElapsed}s)`);

      // CRITICAL SAFETY CHECK: Never close sessions with open trades
      const { data: openTrades, error: tradesError } = await supabase
        .from('goal_session_trades')
        .select('id')
        .eq('goal_session_id', session.id)
        .eq('status', 'open')
        .limit(1);

      if (tradesError) {
        console.error(`[Continuation Cleanup] Error checking trades for session ${session.id}:`, tradesError);
        continue; // Skip this session
      }

      const hasOpenTrades = openTrades && openTrades.length > 0;

      if (hasOpenTrades) {
        console.warn(`[Continuation Cleanup] Session ${session.id} has OPEN TRADES - BLOCKING auto-close (safety)`);

        // Clear awaiting_continuation but keep session active
        const { error: updateError } = await supabase
          .from('goal_sessions')
          .update({
            status: 'in_trade',
            awaiting_continuation_since: null,
            updated_at: new Date().toISOString()
          })
          .eq('id', session.id);

        if (updateError) {
          console.error(`[Continuation Cleanup] Error updating session ${session.id}:`, updateError);
        } else {
          console.log(`[Continuation Cleanup] Session ${session.id} kept active (open trades present)`);
          blockedCount++;
        }

        continue; // Don't close this session
      }

      // No open trades - safe to auto-close
      const { error: closeError } = await supabase
        .from('goal_sessions')
        .update({
          status: 'system_stopped',
          completed_at: new Date().toISOString(),
          awaiting_continuation_since: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', session.id);

      if (closeError) {
        console.error(`[Continuation Cleanup] Error closing session ${session.id}:`, closeError);
        continue;
      }

      console.log(`[Continuation Cleanup] ✅ Closed session ${session.id} (${secondsElapsed}s elapsed, no open trades)`);
      cleanedCount++;

      // Send notification to user (non-blocking)
      try {
        await supabase
          .from('goal_notifications')
          .insert({
            user_id: session.user_id,
            goal_session_id: session.id,
            type: 'session_ended',
            title: 'Session Auto-Closed',
            message: `Your session was automatically closed after ${secondsElapsed} seconds with no response.`,
            priority: 'medium',
            metadata: {
              session_id: session.id,
              reason: 'continuation_timeout',
              timeout_seconds: 60,
              actual_seconds: secondsElapsed,
              open_trades_check: false,
              auto_closed_by: 'cleanup_function'
            }
          });
      } catch (notifError) {
        console.error(`[Continuation Cleanup] Error creating notification for session ${session.id}:`, notifError);
        // Don't fail cleanup if notification fails
      }
    }

    const duration = Date.now() - startTime;

    console.log(`[Continuation Cleanup] Cleanup complete: ${cleanedCount} closed, ${blockedCount} blocked, ${duration}ms`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        cleaned: cleanedCount,
        blocked: blockedCount,
        total_found: stuckSessions.length,
        duration_ms: duration,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('[Continuation Cleanup] Fatal error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Cleanup failed',
        message: error instanceof Error ? error.message : String(error)
      })
    };
  }
};

// Run every 1 minute
export const handler = schedule('*/1 * * * *', cleanupHandler);

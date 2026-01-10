/**
 * Autonomous Goal Session Monitor - Netlify Scheduled Function
 *
 * Runs every minute to process active goal sessions autonomously
 * Enables goal sessions to continue running even when browser is closed
 * Users can start sessions from any device and they'll keep running in the cloud
 *
 * Schedule: Every 1 minute (defined in netlify.toml)
 */

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { processGoalSessionIteration, initializeGoalSession } from '../../src/services/goal-session-core-engine';

// Note: Netlify functions use process.env without VITE_ prefix
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export const handler: Handler = async (event, context) => {
  const startTime = Date.now();
  console.log('[Autonomous Monitor] Starting scheduled check...');

  try {
    // Get all active goal sessions that need processing
    const { data: activeSessions, error } = await supabase.rpc('get_sessions_for_server_processing');

    if (error) {
      console.error('[Autonomous Monitor] Error fetching sessions:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: error.message })
      };
    }

    if (!activeSessions || activeSessions.length === 0) {
      console.log('[Autonomous Monitor] No active sessions to process');
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No active sessions',
          processed: 0,
          duration: Date.now() - startTime
        })
      };
    }

    console.log(`[Autonomous Monitor] Processing ${activeSessions.length} active sessions`);

    const results = [];
    let successCount = 0;
    let errorCount = 0;
    let timedOutCount = 0;
    let modalTriggeredCount = 0;

    // Process each session
    for (const session of activeSessions) {
      try {
        console.log(`[Autonomous Monitor] Processing session ${session.session_id} for user ${session.user_id}`);

        /*
         * CRITICAL 60-MINUTE TIMEOUT ENFORCEMENT
         *
         * This section implements the 60-minute scanning limit to prevent resource waste.
         * The flow MUST execute in this exact order:
         *
         * 1. Check for expired timeout (1-minute after modal shown) → auto-close if expired
         * 2. Check if 60 minutes elapsed without trade → show continuation modal
         * 3. If awaiting user response → skip trading operations but KEEP in processing queue
         *
         * IMPORTANT: Sessions with status 'awaiting_continuation' MUST remain in the
         * get_sessions_for_server_processing() result set. If they are excluded, the
         * timeout check (#1) will never run and sessions will waste resources indefinitely.
         *
         * The database migration fix_15min_timeout_enforcement.sql ensures this.
         */

        // CRITICAL: Check for modal timeout and auto-close if expired
        const { data: hasTimedOut } = await supabase.rpc('check_continuation_modal_timeout', {
          p_session_id: session.session_id
        });

        if (hasTimedOut) {
          console.log(`[Autonomous Monitor] ⏰ Session ${session.session_id} modal timeout - auto-closed`);
          timedOutCount++;
          successCount++;
          results.push({
            sessionId: session.session_id,
            success: true,
            message: 'Session auto-closed due to continuation modal timeout',
            action: 'timeout_auto_close'
          });
          continue;
        }

        // CRITICAL: Check if 60 minutes elapsed without trades - trigger modal
        const { data: shouldShowModal } = await supabase.rpc('should_show_continuation_modal', {
          p_session_id: session.session_id
        });

        if (shouldShowModal) {
          console.log(`[Autonomous Monitor] 🕐 Session ${session.session_id} reached 60-min threshold - triggering modal`);
          await supabase.rpc('trigger_continuation_modal', {
            p_session_id: session.session_id
          });
          modalTriggeredCount++;
          successCount++;
          results.push({
            sessionId: session.session_id,
            success: true,
            message: '60-minute threshold reached - awaiting user response',
            action: 'modal_triggered'
          });
          continue;
        }

        // Skip sessions awaiting continuation response (don't do trading operations)
        // NOTE: These sessions remain in the processing queue for timeout checks above
        const { data: sessionStatus } = await supabase
          .from('goal_sessions')
          .select('status, awaiting_continuation_confirmation')
          .eq('id', session.session_id)
          .single();

        if (sessionStatus?.status === 'awaiting_continuation' || sessionStatus?.awaiting_continuation_confirmation) {
          console.log(`[Autonomous Monitor] ⏸️ Session ${session.session_id} awaiting user response - skipping`);
          successCount++;
          results.push({
            sessionId: session.session_id,
            success: true,
            message: 'Awaiting user continuation response',
            action: 'awaiting_response'
          });
          continue;
        }

        // Update heartbeat at start
        await supabase.rpc('update_server_heartbeat', {
          p_session_id: session.session_id,
          p_instance_id: 'netlify-autonomous-monitor'
        });

        // Initialize or load session state (pass supabase client for server-side execution)
        const state = await initializeGoalSession(session.session_id, supabase);

        if (!state) {
          console.error(`[Autonomous Monitor] Failed to initialize session ${session.session_id}`);
          errorCount++;
          continue;
        }

        // Process one iteration (pass supabase client for server-side execution)
        const result = await processGoalSessionIteration(state, supabase);

        // Update server state in database
        await supabase
          .from('goal_session_server_state')
          .upsert({
            goal_session_id: session.session_id,
            user_id: session.user_id,
            last_processed_at: new Date().toISOString(),
            last_tick_price: state.openTrades.length > 0 ? state.openTrades[0].currentPrice : null,
            current_symbol: state.watchlist.join(','),
            trades_executed: (result.tradesExecuted || 0),
            server_decisions: (result.llmCallsMade || 0),
            consecutive_errors: result.success ? 0 : 1,
            last_error: result.success ? null : result.message,
            last_error_at: result.success ? null : new Date().toISOString()
          });

        // Update session with final heartbeat
        await supabase
          .from('goal_sessions')
          .update({
            server_heartbeat: new Date().toISOString(),
            server_last_check: new Date().toISOString(),
            server_error: result.success ? null : result.message,
            execution_mode: 'server'
          })
          .eq('id', session.session_id);

        results.push({
          sessionId: session.session_id,
          success: result.success,
          message: result.message,
          tradesExecuted: result.tradesExecuted,
          triggersDetected: result.triggersDetected,
          llmCallsMade: result.llmCallsMade
        });

        if (result.success) {
          successCount++;
        } else {
          errorCount++;
        }

        console.log(`[Autonomous Monitor] Session ${session.session_id}: ${result.message}`);
      } catch (sessionError) {
        console.error(`[Autonomous Monitor] Error processing session ${session.session_id}:`, sessionError);

        // Log error to database
        await supabase
          .from('goal_session_server_state')
          .upsert({
            goal_session_id: session.session_id,
            user_id: session.user_id,
            last_error: (sessionError as Error).message,
            last_error_at: new Date().toISOString(),
            consecutive_errors: 1
          });

        await supabase
          .from('goal_sessions')
          .update({
            server_error: (sessionError as Error).message
          })
          .eq('id', session.session_id);

        errorCount++;
      }
    }

    // Mark stale sessions
    const { data: staleSessions } = await supabase.rpc('mark_stale_sessions');

    if (staleSessions && staleSessions.length > 0) {
      console.log(`[Autonomous Monitor] Marked ${staleSessions.length} stale sessions`);
    }

    const duration = Date.now() - startTime;
    const summary = {
      processed: activeSessions.length,
      successful: successCount,
      errors: errorCount,
      modalTriggered: modalTriggeredCount,
      timedOut: timedOutCount,
      staleSessions: staleSessions?.length || 0,
      duration,
      results
    };

    console.log('[Autonomous Monitor] Completed:', summary);
    if (modalTriggeredCount > 0) {
      console.log(`[Autonomous Monitor] 🕐 ${modalTriggeredCount} sessions reached 60-minute threshold`);
    }
    if (timedOutCount > 0) {
      console.log(`[Autonomous Monitor] ⏰ ${timedOutCount} sessions auto-closed due to timeout`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify(summary)
    };
  } catch (error) {
    console.error('[Autonomous Monitor] Fatal error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: (error as Error).message,
        duration: Date.now() - startTime
      })
    };
  }
};

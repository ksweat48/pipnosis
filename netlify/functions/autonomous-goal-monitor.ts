/**
 * Autonomous Goal Session Monitor - Netlify Scheduled Function
 *
 * Runs every minute to process active goal sessions autonomously.
 * Sessions persist and continue scanning regardless of browser state.
 *
 * Schedule: Every 1 minute (defined in netlify.toml)
 *
 * CCIP GOVERNANCE:
 * - server_heartbeat is ONLY written after real processing completes (not at start)
 * - shouldContinue=false closes sessions in ALL active statuses (not just 'scanning')
 * - consecutive_errors in goal_session_server_state tracks reliability
 * - cleanup_stuck_sessions_automatic() runs FIRST to remove stuck sessions before processing
 */

import type { Handler } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase-admin';
import { processGoalSessionIteration, initializeGoalSession } from '../../src/services/goal-session-core-engine';

const supabase = getSupabaseAdmin();

const ACTIVE_STATUSES_ALL = ['scanning', 'active', 'initializing', 'in_trade', 'soft_closing', 'trade_pending'];

export const handler: Handler = async (event, context) => {
  const startTime = Date.now();
  console.log('[Autonomous Monitor] Starting scheduled check...');

  try {
    // FIRST: Auto-detect and clean up stuck sessions (independent of processing queue)
    const { data: cleanedCount, error: cleanupError } = await supabase.rpc('cleanup_stuck_sessions_automatic');

    if (cleanupError) {
      console.error('[Autonomous Monitor] Cleanup error:', cleanupError);
    } else if (cleanedCount && cleanedCount > 0) {
      console.log(`[Autonomous Monitor] Auto-cleaned ${cleanedCount} stuck session(s)`);
    }

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

    // Limit to max 10 sessions per run to prevent timeout
    const MAX_SESSIONS_PER_RUN = 10;
    const sessionsToProcess = activeSessions.slice(0, MAX_SESSIONS_PER_RUN);

    if (activeSessions.length > MAX_SESSIONS_PER_RUN) {
      console.log(`[Autonomous Monitor] Processing ${MAX_SESSIONS_PER_RUN} of ${activeSessions.length} sessions (${activeSessions.length - MAX_SESSIONS_PER_RUN} queued for next run)`);
    } else {
      console.log(`[Autonomous Monitor] Processing ${activeSessions.length} active sessions`);
    }

    const results = [];
    let successCount = 0;
    let errorCount = 0;
    let timedOutCount = 0;
    let modalTriggeredCount = 0;

    for (const session of sessionsToProcess) {
      try {
        console.log(`[Autonomous Monitor] Processing session ${session.session_id} for user ${session.user_id}`);

        /*
         * CRITICAL 60-MINUTE TIMEOUT ENFORCEMENT
         *
         * Order MUST be:
         * 1. Check for expired timeout (1-minute after modal shown) → auto-close if expired
         * 2. Check if 60 minutes elapsed without trade → show continuation modal
         * 3. If awaiting user response → skip trading but KEEP in queue for timeout checks
         */

        const { data: hasTimedOut } = await supabase.rpc('check_continuation_modal_timeout', {
          p_session_id: session.session_id
        });

        if (hasTimedOut) {
          console.log(`[Autonomous Monitor] Session ${session.session_id} modal timeout - auto-closed`);
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

        const { data: shouldShowModal } = await supabase.rpc('should_show_continuation_modal', {
          p_session_id: session.session_id
        });

        if (shouldShowModal) {
          console.log(`[Autonomous Monitor] Session ${session.session_id} reached 60-min threshold - triggering modal`);
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

        const { data: sessionStatus } = await supabase
          .from('goal_sessions')
          .select('status')
          .eq('id', session.session_id)
          .maybeSingle();

        if (sessionStatus?.status === 'awaiting_continuation') {
          console.log(`[Autonomous Monitor] Session ${session.session_id} awaiting user response - skipping`);
          successCount++;
          results.push({
            sessionId: session.session_id,
            success: true,
            message: 'Awaiting user continuation response',
            action: 'awaiting_response'
          });
          continue;
        }

        // Initialize session state
        const state = await initializeGoalSession(session.session_id, supabase);

        if (!state) {
          console.error(`[Autonomous Monitor] Failed to initialize session ${session.session_id}`);

          // Track consecutive errors — do NOT update heartbeat on initialization failure
          await supabase
            .from('goal_session_server_state')
            .upsert({
              goal_session_id: session.session_id,
              user_id: session.user_id,
              last_error: 'Failed to initialize session state',
              last_error_at: new Date().toISOString(),
              consecutive_errors: 1,
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'goal_session_id',
              ignoreDuplicates: false
            });

          // Use raw update to increment consecutive_errors atomically
          await supabase.rpc('increment_session_consecutive_errors', {
            p_session_id: session.session_id
          }).maybeSingle();

          errorCount++;
          continue;
        }

        // Process one iteration
        const result = await processGoalSessionIteration(state, supabase);

        // GOVERNANCE: shouldContinue=false means the session MUST stop.
        // This covers ALL active statuses — not just 'scanning'.
        // Previous bug: only stopped 'scanning'/'active'/'initializing',
        // leaving 'in_trade'/'soft_closing' stuck indefinitely.
        if (!result.shouldContinue) {
          console.log(`[Autonomous Monitor] GOVERNANCE: Session ${session.session_id} shouldContinue=false (${result.message}) - closing all active statuses`);

          const { error: stopError } = await supabase
            .from('goal_sessions')
            .update({
              status: 'user_stopped',
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', session.session_id)
            .in('status', ACTIVE_STATUSES_ALL);

          if (stopError) {
            console.error(`[Autonomous Monitor] Failed to stop session ${session.session_id}:`, stopError);
          }
        }

        // CRITICAL FIX: Only update server_heartbeat AFTER real processing succeeds.
        // Previously the heartbeat was updated at the start, masking stuck sessions
        // as "alive" in the admin panel even when processing was failing every minute.
        if (result.success) {
          await supabase
            .from('goal_sessions')
            .update({
              server_heartbeat: new Date().toISOString(),
              server_last_check: new Date().toISOString(),
              server_error: null,
              execution_mode: 'server'
            })
            .eq('id', session.session_id);

          // Reset error counter on success
          await supabase
            .from('goal_session_server_state')
            .upsert({
              goal_session_id: session.session_id,
              user_id: session.user_id,
              last_processed_at: new Date().toISOString(),
              last_tick_price: state.openTrades.length > 0 ? state.openTrades[0].currentPrice : null,
              current_symbol: state.watchlist.join(','),
              trades_executed: result.tradesExecuted || 0,
              server_decisions: result.llmCallsMade || 0,
              consecutive_errors: 0,
              last_error: null,
              last_error_at: null,
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'goal_session_id',
              ignoreDuplicates: false
            });

          successCount++;
        } else {
          // Failure: update error state but do NOT update server_heartbeat
          // This ensures admin panel correctly shows the session as problematic
          await supabase
            .from('goal_sessions')
            .update({
              server_last_check: new Date().toISOString(),
              server_error: result.message,
              execution_mode: 'server'
            })
            .eq('id', session.session_id);

          await supabase
            .from('goal_session_server_state')
            .upsert({
              goal_session_id: session.session_id,
              user_id: session.user_id,
              last_error: result.message,
              last_error_at: new Date().toISOString(),
              consecutive_errors: 1,
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'goal_session_id',
              ignoreDuplicates: false
            });

          await supabase.rpc('increment_session_consecutive_errors', {
            p_session_id: session.session_id
          }).maybeSingle();

          errorCount++;
        }

        results.push({
          sessionId: session.session_id,
          success: result.success,
          message: result.message,
          tradesExecuted: result.tradesExecuted,
          triggersDetected: result.triggersDetected,
          llmCallsMade: result.llmCallsMade,
          shouldContinue: result.shouldContinue
        });

        console.log(`[Autonomous Monitor] Session ${session.session_id}: ${result.message} (shouldContinue=${result.shouldContinue})`);

      } catch (sessionError) {
        const errMsg = (sessionError as Error).message;
        console.error(`[Autonomous Monitor] Error processing session ${session.session_id}:`, sessionError);

        // Do NOT update server_heartbeat on exception
        await supabase
          .from('goal_sessions')
          .update({
            server_last_check: new Date().toISOString(),
            server_error: errMsg
          })
          .eq('id', session.session_id);

        await supabase
          .from('goal_session_server_state')
          .upsert({
            goal_session_id: session.session_id,
            user_id: session.user_id,
            last_error: errMsg,
            last_error_at: new Date().toISOString(),
            consecutive_errors: 1,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'goal_session_id',
            ignoreDuplicates: false
          });

        await supabase.rpc('increment_session_consecutive_errors', {
          p_session_id: session.session_id
        }).maybeSingle();

        errorCount++;
      }
    }

    // Mark stale sessions (existing RPC)
    const { data: staleSessions } = await supabase.rpc('mark_stale_sessions').maybeSingle();

    const duration = Date.now() - startTime;
    const summary = {
      processed: sessionsToProcess.length,
      totalActive: activeSessions.length,
      queued: activeSessions.length - sessionsToProcess.length,
      successful: successCount,
      errors: errorCount,
      modalTriggered: modalTriggeredCount,
      timedOut: timedOutCount,
      staleSessions: staleSessions?.length || 0,
      duration,
      results
    };

    console.log('[Autonomous Monitor] Completed:', JSON.stringify({ ...summary, results: undefined }));

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

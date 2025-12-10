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

    // Process each session
    for (const session of activeSessions) {
      try {
        console.log(`[Autonomous Monitor] Processing session ${session.session_id} for user ${session.user_id}`);

        // Update heartbeat at start
        await supabase.rpc('update_server_heartbeat', {
          p_session_id: session.session_id,
          p_instance_id: 'netlify-autonomous-monitor'
        });

        // Initialize or load session state
        const state = await initializeGoalSession(session.session_id);

        if (!state) {
          console.error(`[Autonomous Monitor] Failed to initialize session ${session.session_id}`);
          errorCount++;
          continue;
        }

        // Process one iteration
        const result = await processGoalSessionIteration(state);

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
      staleSessions: staleSessions?.length || 0,
      duration,
      results
    };

    console.log('[Autonomous Monitor] Completed:', summary);

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

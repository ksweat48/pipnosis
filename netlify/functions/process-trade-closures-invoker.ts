/**
 * Process Trade Closures Invoker - CCIP Governance Wiring
 *
 * SSOT Authority: This is the ONLY scheduled invoker for the
 * process-trade-closures Supabase Edge Function.
 *
 * Runs every minute via Netlify scheduled function.
 * Calls the process-trade-closures edge function which batch-processes
 * all pending trade_closure_events, guaranteeing post-trade processing
 * (notifications, session state, journal entries) even when the browser
 * is offline or the user has closed the app.
 *
 * Architecture:
 * 1. trade closes → close_goal_session_trade() RPC inserts trade_closure_events row
 * 2. THIS function fires every minute → calls process-trade-closures edge function
 * 3. Edge function fetches all pending events and runs the post-processing pipeline
 * 4. Events marked succeeded/failed for audit trail
 *
 * CCIP Governance (2026-02-18):
 * - Session state after closure: user_stopped (no auto-scanning)
 * - Max batch size per run: 50 events
 * - Processing guarantee: within 60 seconds of trade closure
 *
 * Previously: No invoker existed — this was an orphaned edge function
 * Fix: This invoker wires the schedule gap (CCIP change tracking migration applied)
 */

import type { Handler } from '@netlify/functions';
import { getSupabaseUrl } from './_shared/supabase-admin';

const EDGE_FUNCTION_TIMEOUT_MS = 25000;

export const handler: Handler = async () => {
  const executionId = `closure_invoker_${Date.now()}`;
  const startTime = Date.now();

  console.log(`[ClosureInvoker:${executionId}] Invoking process-trade-closures edge function...`);

  try {
    const supabaseUrl = getSupabaseUrl();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error(`[ClosureInvoker:${executionId}] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`);
      return {
        statusCode: 500,
        body: JSON.stringify({
          success: false,
          executionId,
          error: 'Missing environment variables',
        }),
      };
    }

    const edgeFunctionUrl = `${supabaseUrl}/functions/v1/process-trade-closures`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), EDGE_FUNCTION_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
          'X-Invoker-ID': executionId,
        },
        body: JSON.stringify({ invokedBy: 'netlify-scheduler', executionId }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const duration = Date.now() - startTime;

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unreadable');
      console.error(`[ClosureInvoker:${executionId}] Edge function returned ${response.status}: ${errorBody}`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: false,
          executionId,
          edgeFunctionStatus: response.status,
          error: errorBody,
          durationMs: duration,
        }),
      };
    }

    const result = await response.json().catch(() => ({}));

    console.log(
      `[ClosureInvoker:${executionId}] Completed in ${duration}ms — processed: ${result.processedCount ?? 0}, failed: ${result.failedCount ?? 0}`
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        executionId,
        processedCount: result.processedCount ?? 0,
        failedCount: result.failedCount ?? 0,
        totalProcessed: result.totalProcessed ?? 0,
        durationMs: duration,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const isTimeout = error instanceof Error && error.name === 'AbortError';

    console.error(
      `[ClosureInvoker:${executionId}] ${isTimeout ? 'Timeout' : 'Error'} after ${duration}ms:`,
      error
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: false,
        executionId,
        error: isTimeout ? 'Edge function timed out' : (error instanceof Error ? error.message : 'Unknown error'),
        durationMs: duration,
        timestamp: new Date().toISOString(),
      }),
    };
  }
};

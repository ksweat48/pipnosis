import { supabase } from '../lib/supabase';
import { logger, LogCategory } from '../lib/logger';

/**
 * CCIP-2026-0427F-ALWAYS-EXECUTE: SSOT for the user-level execution policy.
 *
 * The Entry Monitor toggle (user_monitor_preferences.entry_price_monitor_enabled)
 * is the sole authority for whether Alpha may fall back to a wait intent when
 * an execute_now decision would land below the recommended-execution floor.
 *
 *   EXECUTE_NOW_ONLY                Toggle OFF.  Alpha must produce execute_now.
 *                                   Low-quality reads are surfaced to the user
 *                                   for manual judgement.
 *   EXECUTE_NOW_OR_WAIT_FALLBACK    Toggle ON or unset.  Alpha first attempts
 *                                   execute_now; if that would be low-quality,
 *                                   Alpha must return a wait intent instead.
 *
 * This module is the single read-path for the policy. Coordinators, the
 * scanner, and execution-mode-resolver all defer to resolveExecutionPolicy()
 * rather than reading user_monitor_preferences directly.
 */

export type ExecutionPolicy = 'EXECUTE_NOW_ONLY' | 'EXECUTE_NOW_OR_WAIT_FALLBACK';

export async function resolveExecutionPolicy(userId: string): Promise<ExecutionPolicy> {
  try {
    const { data, error } = await supabase.rpc('get_user_execution_policy', { p_user_id: userId });
    if (error) throw error;
    if (data === 'EXECUTE_NOW_ONLY' || data === 'EXECUTE_NOW_OR_WAIT_FALLBACK') {
      return data;
    }
    return 'EXECUTE_NOW_OR_WAIT_FALLBACK';
  } catch (err) {
    logger.warn(
      LogCategory.AI_TRADING,
      '[ExecutionPolicyResolver] RPC failed; defaulting to EXECUTE_NOW_OR_WAIT_FALLBACK',
      { userId, error: err }
    );
    return 'EXECUTE_NOW_OR_WAIT_FALLBACK';
  }
}

export function policyAllowsWaitFallback(policy: ExecutionPolicy): boolean {
  return policy === 'EXECUTE_NOW_OR_WAIT_FALLBACK';
}

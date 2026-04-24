import { supabase } from '../lib/supabase';
import { logger, LogCategory } from '../lib/logger';

export type ExecutionMode = 'IMMEDIATE' | 'PENDING' | 'MONITORED';

export interface ExecutionModeResult {
  executionMode: ExecutionMode;
  entryMonitorGateActive: boolean;
}

/**
 * SSOT for resolving whether Alpha's decision should route to IMMEDIATE execution
 * or MONITORED (deferred entry) mode.
 *
 * CCIP-2026-0319A/B/C:
 *   - entry_mode is the sole routing signal from Alpha
 *   - wait_condition is advisory context only (not a routing trigger)
 *   - NO_TRADE decisions always route to IMMEDIATE regardless of entry_mode
 *   - alphaWantsToWait is true only for 'wait_pullback' or 'push_confirmation'
 *   - If monitor pref is off or unreadable, falls back to IMMEDIATE (no orphaned intents)
 *
 * Previously a private method on GoalSessionLiveEngine. Extracted here so both
 * goal-session-live-engine.ts and goal-scanner.ts share a single authoritative
 * implementation without code duplication.
 */
export async function resolveExecutionMode(
  alphaDecision: { action?: string; entry_mode?: string; wait_condition?: unknown },
  userId: string,
  sessionId: string
): Promise<ExecutionModeResult> {
  if (alphaDecision.action === 'NO_TRADE') {
    return { executionMode: 'IMMEDIATE', entryMonitorGateActive: false };
  }

  const alphaWantsToWait =
    alphaDecision.entry_mode === 'wait_pullback'
    || alphaDecision.entry_mode === 'push_confirmation'
    || alphaDecision.entry_mode === 'pending_zone_entry';

  if (!alphaWantsToWait) {
    return { executionMode: 'IMMEDIATE', entryMonitorGateActive: false };
  }

  let executionMode: ExecutionMode = 'MONITORED';
  let entryMonitorGateActive = false;

  try {
    const { data: monitorPref } = await supabase
      .from('user_monitor_preferences')
      .select('entry_price_monitor_enabled')
      .eq('user_id', userId)
      .maybeSingle();

    if (monitorPref?.entry_price_monitor_enabled === true) {
      executionMode = 'MONITORED';
      entryMonitorGateActive = true;
    } else {
      executionMode = 'IMMEDIATE';
      logger.warn(
        LogCategory.AI_TRADING,
        '[ExecutionModeResolver] GOVERNANCE ANOMALY: alphaWantsToWait=true but monitor is off. ' +
        'coordinator-alpha should have blocked this. Falling back to IMMEDIATE to prevent orphaned intent. ' +
        'Review CCIP-2026-0319B.',
        { userId, sessionId, alphaEntryMode: alphaDecision.entry_mode }
      );
    }
  } catch (prefErr) {
    executionMode = 'IMMEDIATE';
    logger.warn(
      LogCategory.AI_TRADING,
      '[ExecutionModeResolver] Failed to read monitor preference — falling back to IMMEDIATE',
      { error: prefErr }
    );
  }

  if (entryMonitorGateActive) {
    try {
      await supabase
        .from('goal_sessions')
        .update({ alpha_entry_monitor_gate_active: true })
        .eq('id', sessionId);
    } catch {
      // non-blocking audit update
    }
  }

  logger.info(
    LogCategory.AI_TRADING,
    '[ExecutionModeResolver] Execution mode resolved',
    {
      executionMode,
      entryMonitorGateActive,
      alphaEntryMode: alphaDecision.entry_mode,
      hasWaitCondition: alphaDecision.wait_condition != null,
      userId,
      sessionId,
    }
  );

  return { executionMode, entryMonitorGateActive };
}

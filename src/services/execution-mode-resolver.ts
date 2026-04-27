import { supabase } from '../lib/supabase';
import { logger, LogCategory } from '../lib/logger';

export type ExecutionMode = 'IMMEDIATE' | 'PENDING' | 'MONITORED' | 'MONITOR_REQUIRED';

export interface MonitorRequiredDetails {
  action: 'BUY' | 'SELL';
  symbol: string;
  waitReasoning: string;
  confidenceTier: string;
  zoneMin?: number;
  zoneMax?: number;
}

export interface ExecutionModeResult {
  executionMode: ExecutionMode;
  entryMonitorGateActive: boolean;
  // CCIP-2026-0429A: Set when Alpha found a deferred setup but the user's monitor is off.
  // The caller should surface this as an upgrade prompt card rather than discarding the setup.
  monitorRequiredDetails?: MonitorRequiredDetails;
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
 *
 * CCIP-2026-0429A:
 *   - When alphaWantsToWait=true but monitor is OFF, returns MONITOR_REQUIRED instead of
 *     silently falling back to IMMEDIATE. Callers surface an upgrade prompt card showing
 *     what Alpha found, with an option to activate the Entry Monitor (Club Tier 1).
 *
 * Previously a private method on GoalSessionLiveEngine. Extracted here so both
 * goal-session-live-engine.ts and goal-scanner.ts share a single authoritative
 * implementation without code duplication.
 */
export async function resolveExecutionMode(
  alphaDecision: {
    action?: string;
    entry_mode?: string;
    wait_condition?: unknown;
    symbol?: string;
    confidence_tier?: string;
    reasoning?: { wait_reasoning?: string } | string;
    [key: string]: unknown;
  },
  userId: string,
  sessionId: string
): Promise<ExecutionModeResult> {
  // CCIP-2026-0427F-ALWAYS-EXECUTE: NO_TRADE no longer reaches this resolver.
  // Alpha always produces BUY or SELL; routing now depends solely on entry_mode.
  const alphaWantsToWait =
    alphaDecision.entry_mode === 'wait_pullback'
    || alphaDecision.entry_mode === 'push_confirmation';

  if (!alphaWantsToWait) {
    return { executionMode: 'IMMEDIATE', entryMonitorGateActive: false };
  }

  let executionMode: ExecutionMode = 'MONITORED';
  let entryMonitorGateActive = false;
  let monitorRequiredDetails: MonitorRequiredDetails | undefined;

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
      // CCIP-2026-0429A: Alpha found a deferred setup but this user's monitor is off.
      // Surface as MONITOR_REQUIRED so the UI can show an upgrade prompt with the setup details.
      executionMode = 'MONITOR_REQUIRED';
      const wc = alphaDecision.wait_condition as Record<string, unknown> | null | undefined;
      const waitReasoning =
        wc?.wait_reasoning as string
        ?? (typeof alphaDecision.reasoning === 'object' && alphaDecision.reasoning !== null
          ? (alphaDecision.reasoning as Record<string, unknown>).wait_reasoning as string
          : undefined)
        ?? 'Alpha identified a deferred entry setup';

      monitorRequiredDetails = {
        action: alphaDecision.action as 'BUY' | 'SELL',
        symbol: alphaDecision.symbol ?? '',
        waitReasoning,
        confidenceTier: alphaDecision.confidence_tier ?? 'confident',
        zoneMin: wc?.target_entry_zone_min as number | undefined,
        zoneMax: wc?.target_entry_zone_max as number | undefined,
      };

      logger.info(
        LogCategory.AI_TRADING,
        '[ExecutionModeResolver] CCIP-2026-0429A: Alpha found deferred setup, monitor off — MONITOR_REQUIRED',
        { userId, sessionId, alphaEntryMode: alphaDecision.entry_mode, symbol: alphaDecision.symbol }
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

  return { executionMode, entryMonitorGateActive, monitorRequiredDetails };
}

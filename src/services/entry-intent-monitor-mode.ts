/**
 * Entry Intent Monitor Mode - DEPRECATED WRAPPER
 *
 * This service now delegates to UnifiedEntryMonitor (SSOT).
 * Kept for backward compatibility during migration.
 *
 * @deprecated Use unifiedEntryMonitor directly
 */

import { unifiedEntryMonitor } from './unified-entry-monitor';
import { tradeStyleRegistry } from './trade-style-registry';
import { type CanonicalTradeStyle as CanonicalStyle } from '../config/timeframe-hierarchy';
import { logger } from '../lib/logger';

export type EntryMonitorState =
  | 'DISCOVERY_SCANNING'
  | 'ENTRY_INTENT_CREATED'
  | 'ENTRY_MONITOR_ACTIVE'
  | 'EXECUTE_PENDING'
  | 'TRADE_ACTIVE'
  | 'ABANDONED_RESCAN_REQUESTED';

export type MonitorDecision =
  | 'EXECUTE_NOW'
  | 'CONTINUE_WAITING'
  | 'ABANDON_INTENT_AND_RESCAN';

export type AbandonReason =
  | 'TIMEOUT_EXCEEDED'
  | 'HARD_INVALIDATION_CROSSED'
  | 'RUNAWAY_DETECTED'
  | 'OPPOSITE_DIRECTION_ACCEPTANCE'
  | 'MANUAL_CANCEL'
  | 'ORDER_REJECTED'
  | 'SESSION_INACTIVE'
  | 'SESSION_MISSING'
  | 'INTENT_INVALID'
  | 'MONITORING_STALLED'
  | 'INTENT_EXPIRED';

export interface EntryIntentData {
  id: string;
  session_id: string;
  user_id: string;
  symbol: string;
  direction: 'long' | 'short';
  entry_zone_min: number;
  entry_zone_max: number;
  abandon_zone_low: number;
  abandon_zone_high: number;
  invalidation_price?: number;
  /**
   * @deprecated Time-based fields are deprecated. Use invalidation_price for setup validity.
   * timeout_at is set to +24h for backward compatibility but monitoring now uses setup validity.
   */
  timeout_at: string;
  /**
   * @deprecated Use invalidation_price instead of time-based limits
   */
  max_wait_seconds: number;
  style: CanonicalStyle;
  atr_at_creation: number;
  consecutive_checks_outside_zone: number;
  market_context?: Record<string, any>;
  alpha_reasoning?: string;

  // Adaptive zone fields (v2.0) - SSOT: Populated by EntryIntentClassifier
  zone_type?: string | null;
  micro_regime_used?: string | null;
  primary_zone_min?: number | null;
  primary_zone_max?: number | null;
  secondary_zone_min?: number | null;
  secondary_zone_max?: number | null;
  zone_reachability_distance_pips?: number | null;
  zone_downgrade_applied?: boolean | null;
  position_size_multiplier?: number | null;

  // Structural Entry Analysis (SSOT: EntryStructureAnalyzer)
  structural_verdict?: 'OPTIMAL_ENTRY' | 'WAIT_FOR_PULLBACK' | null;
  structural_level_price?: number | null;
  structural_level_type?: 'support' | 'resistance' | null;
  structural_level_strength?: number | null;
  structural_level_touches?: number | null;
  pullback_target_price?: number | null;
  pullback_improvement_pips?: number | null;
  pullback_reached_at?: string | null;

  // Fields returned by select('*') but missing from original interface
  status: string;
  actual_entry_price?: number | null;
  execution_price?: number | null;
  alpha_confidence?: number | null;
  advisor_mode?: string | null;
  entry_mode?: string | null;
}

export interface MonitorCheckResult {
  timestamp: Date;
  currentPrice: number;
  inEntryZone: boolean;
  inAbandonZone: boolean;
  distanceToZonePips: number;
  eqs: any | null;
  decision: MonitorDecision;
  abandonReason?: AbandonReason;
  consecutiveOutsideCount: number;
  llmCalled: boolean;
}

interface MonitorCallbacks {
  onExecute: (intentId: string, price: number, eqs: number) => Promise<void>;
  onAbandon: (intentId: string, reason: AbandonReason) => Promise<void>;
  onLog: (intentId: string, log: MonitorCheckResult) => void;
}

/**
 * @deprecated Use UnifiedEntryMonitor instead
 */
export class EntryIntentMonitorMode {
  private intent: EntryIntentData;
  private callbacks: MonitorCallbacks;

  constructor(intent: EntryIntentData, callbacks: MonitorCallbacks) {
    logger.warn('[DEPRECATED] EntryIntentMonitorMode is deprecated. Use UnifiedEntryMonitor instead.');
    this.intent = intent;
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    logger.debug('[DEPRECATED] EntryIntentMonitorMode.start -> delegating to UnifiedEntryMonitor');
    return unifiedEntryMonitor.startMonitoring(this.intent.id, this.intent.user_id);
  }

  async stop(): Promise<void> {
    logger.debug('[DEPRECATED] EntryIntentMonitorMode.stop -> delegating to UnifiedEntryMonitor');
    return unifiedEntryMonitor.stopMonitoring(this.intent.id);
  }
}

export function calculateAbandonZone(
  entryZoneMin: number,
  entryZoneMax: number,
  atr: number
): { abandonZoneLow: number; abandonZoneHigh: number } {
  const entryZoneWidth = entryZoneMax - entryZoneMin;
  const buffer = Math.max(atr * 0.3, entryZoneWidth * 0.5);

  return {
    abandonZoneLow: entryZoneMin - buffer,
    abandonZoneHigh: entryZoneMax + buffer
  };
}

export async function createEntryIntentWithMonitoring(
  sessionId: string,
  userId: string,
  symbol: string,
  direction: 'long' | 'short',
  entryZoneMin: number,
  entryZoneMax: number,
  stopLoss: number,
  takeProfit: number,
  atr: number,
  style: CanonicalStyle,
  maxWaitSeconds: number,
  alphaReasoning: string,
  marketContext: Record<string, any>,
  intentType: 'immediate_momentum' | 'pullback_to_vwap' | 'pullback_to_support' = 'immediate_momentum',
  preFlightAdvisoryLevel?: 'GREEN' | 'AMBER' | 'RED'
): Promise<EntryIntentData | null> {
  const { supabase } = await import('../lib/supabase');
  const { abandonZoneLow, abandonZoneHigh } = calculateAbandonZone(entryZoneMin, entryZoneMax, atr);

  // DEPRECATED: Time-based monitoring replaced with setup validity
  // Set timeout_at to +24h for backward compatibility (setup validity is primary)
  const timeoutAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const normalizedStyle = tradeStyleRegistry.normalize(style);

  console.log('[createEntryIntentWithMonitoring] Creating intent with:', {
    sessionId,
    userId,
    symbol,
    direction,
    status: 'monitoring',
    style: normalizedStyle
  });

  const { data, error } = await supabase
    .from('entry_intents')
    .insert({
      session_id: sessionId,
      user_id: userId,
      symbol,
      direction,
      intent_type: intentType,
      urgency: 'MEDIUM',
      entry_zone_min: entryZoneMin,
      entry_zone_max: entryZoneMax,
      abandon_zone_low: abandonZoneLow,
      abandon_zone_high: abandonZoneHigh,
      invalidation_price: stopLoss,
      timeout_at: timeoutAt,
      max_wait_seconds: maxWaitSeconds,
      style: normalizedStyle,
      atr_at_creation: atr,
      consecutive_checks_outside_zone: 0,
      status: 'monitoring',
      alpha_reasoning: alphaReasoning,
      market_context: {
        ...marketContext,
        stop_loss: stopLoss,
        take_profit: takeProfit
      },
      // Alpha authority restoration fields
      entry_type: 'pullback',  // Default to pullback entry
      zone_revision_count: 0,  // Original zone (not revised)
      original_entry_zone: {   // Preserve Alpha's original zone
        min: entryZoneMin,
        max: entryZoneMax,
        center: (entryZoneMin + entryZoneMax) / 2
      },
      pre_flight_advisory_level: preFlightAdvisoryLevel || 'GREEN'
    })
    .select()
    .single();

  if (error || !data) {
    console.error('[createEntryIntentWithMonitoring] Database error:', error);
    logger.error('[EntryIntentMonitor] Failed to create entry intent', sessionId, symbol, error?.message);
    return null;
  }

  console.log('[createEntryIntentWithMonitoring] ✅ Intent created successfully:', {
    intentId: data.id,
    sessionId: data.session_id,
    status: data.status,
    symbol: data.symbol,
    direction: data.direction,
    created_at: data.created_at
  });

  logger.info('[EntryIntentMonitor] Entry intent created', {
    intentId: data.id,
    symbol,
    direction,
    entryZone: [entryZoneMin, entryZoneMax],
    abandonZone: [abandonZoneLow, abandonZoneHigh],
    timeoutAt
  });

  return data as EntryIntentData;
}

/**
 * Returns ONLY intents that pass the UI's active gate (status IN monitoring | executed).
 * CCIP-2026-0513D: Finalized intents no longer leak through this channel — use
 * getRecentlyFinalizedIntent() for consumers that want to render an "expired" banner.
 * Secondary sort on updated_at DESC so fresher heartbeats win under replica lag.
 */
export async function getActiveEntryIntent(sessionId: string): Promise<EntryIntentData | null> {
  const { supabase } = await import('../lib/supabase');

  const { data, error } = await supabase
    .from('entry_intents')
    .select('*')
    .eq('session_id', sessionId)
    .in('status', ['monitoring', 'executed'])
    .order('created_at', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[getActiveEntryIntent] Query error:', error);
    return null;
  }

  return (data as EntryIntentData) ?? null;
}

/**
 * Returns the most recent finalized intent (canceled | timeout | conditions_changed |
 * expired_no_entry) created within the given recency window. Separate channel so
 * active-gate consumers (EntryPriceMonitor) are not flipped between live and dead rows.
 *
 * SSOT: status values mirror the Supabase `entry_intent_status` enum exactly.
 * Abandonment is tracked via the separate `abandonment_reason` column, not status.
 */
export async function getRecentlyFinalizedIntent(
  sessionId: string,
  windowMs: number = 5 * 60 * 1000
): Promise<EntryIntentData | null> {
  const { supabase } = await import('../lib/supabase');

  const cutoffIso = new Date(Date.now() - windowMs).toISOString();

  const { data, error } = await supabase
    .from('entry_intents')
    .select('*')
    .eq('session_id', sessionId)
    .in('status', ['canceled', 'timeout', 'conditions_changed', 'expired_no_entry'])
    .gte('created_at', cutoffIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[getRecentlyFinalizedIntent] Query error:', error);
    return null;
  }

  return (data as EntryIntentData) ?? null;
}

export async function cancelEntryIntent(intentId: string, reason: string): Promise<void> {
  const { supabase } = await import('../lib/supabase');

  await supabase
    .from('entry_intents')
    .update({
      status: 'canceled',
      canceled_at: new Date().toISOString(),
      canceled_reason: reason
    })
    .eq('id', intentId);
}

export async function markIntentExecuted(intentId: string, actualPrice: number): Promise<void> {
  const { supabase } = await import('../lib/supabase');

  await supabase
    .from('entry_intents')
    .update({
      status: 'executed',
      executed_at: new Date().toISOString(),
      actual_entry_price: actualPrice
    })
    .eq('id', intentId);
}

export async function markIntentExpired(intentId: string, reason: string): Promise<void> {
  const { supabase } = await import('../lib/supabase');

  console.log('[markIntentExpired] Marking intent as expired', {
    intentId: intentId.substring(0, 8),
    reason
  });

  // First, get the intent data to extract user_id, session_id, and symbol for modal
  const { data: intent } = await supabase
    .from('entry_intents')
    .select('user_id, session_id, symbol')
    .eq('id', intentId)
    .maybeSingle();

  if (!intent) {
    logger.error('[markIntentExpired] Intent not found', { intentId: intentId.substring(0, 8) });
    return;
  }

  // Update intent status to timeout
  await supabase
    .from('entry_intents')
    .update({
      status: 'timeout',
      canceled_at: new Date().toISOString(),
      canceled_reason: reason,
      abandonment_reason: 'TIMEOUT'
    })
    .eq('id', intentId);

  // SSOT: Use atomic function to create modal AND update session state
  console.log('[markIntentExpired] Creating continuation modal atomically', {
    intentId: intentId.substring(0, 8),
    sessionId: intent.session_id?.substring(0, 8),
    symbol: intent.symbol
  });

  const { data: atomicResult, error: atomicError } = await supabase.rpc('create_continuation_modal_atomic', {
    p_user_id: intent.user_id,
    p_session_id: intent.session_id,
    p_intent_id: intentId,
    p_symbol: intent.symbol,
    p_reason: `Entry monitoring timed out: ${reason}`
  });

  if (atomicError || !atomicResult?.success) {
    const errorMsg = atomicError?.message || atomicResult?.error || '';
    const isAlreadyExists = errorMsg.includes('already exists') || errorMsg.includes('Continuation modal already exists');

    if (isAlreadyExists) {
      // Expected race condition: Browser and server-side monitors both detected timeout
      logger.debug('[markIntentExpired] Continuation modal already exists (expected with dual monitoring)', {
        intentId: intentId.substring(0, 8),
        note: 'Browser or server-side monitor already created the modal - this is normal'
      });
    } else {
      // Unexpected error
      logger.error('[markIntentExpired] Failed to create continuation modal atomically', {
        intentId: intentId.substring(0, 8),
        error: errorMsg
      });
    }
  } else {
    console.log('[markIntentExpired] ✅ Continuation modal created and session updated atomically', {
      modalId: atomicResult.modal_id,
      deadline: atomicResult.deadline
    });
  }

  logger.info('[markIntentExpired] Intent marked as expired with atomic modal creation', {
    intentId: intentId.substring(0, 8),
    reason,
    success: atomicResult?.success || false
  });
}

/**
 * Get entry intent by ID
 * SSOT for fetching a single intent by its unique identifier
 */
export async function getEntryIntentById(intentId: string): Promise<EntryIntentData | null> {
  const { supabase } = await import('../lib/supabase');

  const { data, error } = await supabase
    .from('entry_intents')
    .select('*')
    .eq('id', intentId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as EntryIntentData;
}

/**
 * Get entry intent with goal session relations
 * SSOT for fetching intent with joined goal_sessions data
 * Used by execution coordinator to validate session context
 */
export async function getEntryIntentWithSession(intentId: string): Promise<any | null> {
  const { supabase } = await import('../lib/supabase');

  const { data, error } = await supabase
    .from('entry_intents')
    .select('*, goal_sessions(*)')
    .eq('id', intentId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data;
}

/**
 * Get all active intents for a user
 * SSOT for fetching user's monitoring intents
 *
 * This function now validates:
 * - Intent has active session
 * - Intent is not expired
 * - Intent has valid session_id
 */
export async function getUserActiveIntents(userId: string): Promise<EntryIntentData[]> {
  const { supabase } = await import('../lib/supabase');
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('entry_intents')
    .select('*, goal_sessions!inner(id, status)')
    .eq('user_id', userId)
    .eq('status', 'monitoring')
    .eq('goal_sessions.status', 'active')
    .not('session_id', 'is', null)
    .gte('timeout_at', now)
    .order('urgency', { ascending: false })
    .order('created_at', { ascending: true });

  if (error || !data) {
    return [];
  }

  return data as EntryIntentData[];
}

/**
 * Entry Intent Monitor Mode - DEPRECATED WRAPPER
 *
 * This service now delegates to UnifiedEntryMonitor (SSOT).
 * Kept for backward compatibility during migration.
 *
 * @deprecated Use unifiedEntryMonitor directly
 */

import { unifiedEntryMonitor } from './unified-entry-monitor';
import { tradeStyleRegistry, type CanonicalStyle } from './trade-style-registry';
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
  | 'ORDER_REJECTED';

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
  timeout_at: string;
  max_wait_seconds: number;
  style: CanonicalStyle;
  atr_at_creation: number;
  consecutive_checks_outside_zone: number;
  market_context?: Record<string, any>;
  alpha_reasoning?: string;
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
  intentType: 'immediate_momentum' | 'pullback_to_vwap' | 'pullback_to_support' = 'immediate_momentum'
): Promise<EntryIntentData | null> {
  const { supabase } = await import('../lib/supabase');
  const { abandonZoneLow, abandonZoneHigh } = calculateAbandonZone(entryZoneMin, entryZoneMax, atr);

  const timeoutAt = new Date(Date.now() + maxWaitSeconds * 1000).toISOString();
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
        stopLoss,
        takeProfit
      }
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

export async function getActiveEntryIntent(sessionId: string): Promise<EntryIntentData | null> {
  const { supabase } = await import('../lib/supabase');

  console.log('%c[getActiveEntryIntent] 🔍 Querying for session:', 'color: #ff9800; font-weight: bold', sessionId);

  const { data, error } = await supabase
    .from('entry_intents')
    .select('*')
    .eq('session_id', sessionId)
    .eq('status', 'monitoring')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('%c[getActiveEntryIntent] ❌ Query error:', 'color: #f44336; font-weight: bold', error);
    return null;
  }

  if (!data) {
    console.log('%c[getActiveEntryIntent] ⚠️ No intent found with status=monitoring for session:', 'color: #ff9800; font-weight: bold', sessionId);

    // Debug: Check if ANY intents exist for this session
    const { data: allIntents } = await supabase
      .from('entry_intents')
      .select('id, status, created_at, symbol, direction')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false})
      .limit(10);

    console.log('%c[getActiveEntryIntent] 📊 ALL intents for session (last 10):', 'color: #2196f3; font-weight: bold', {
      sessionId,
      totalFound: allIntents?.length || 0,
      intents: allIntents?.map(i => ({
        id: i.id,
        status: i.status,
        symbol: i.symbol,
        direction: i.direction,
        created: new Date(i.created_at).toLocaleTimeString()
      }))
    });
    return null;
  }

  console.log('%c[getActiveEntryIntent] ✅ Found active intent:', 'color: #4caf50; font-weight: bold', {
    id: data.id,
    status: data.status,
    symbol: data.symbol,
    direction: data.direction,
    created_at: new Date(data.created_at).toLocaleString(),
    entry_zone: `${data.entry_zone_min} - ${data.entry_zone_max}`,
    max_wait_seconds: data.max_wait_seconds
  });

  return data as EntryIntentData;
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
 */
export async function getUserActiveIntents(userId: string): Promise<EntryIntentData[]> {
  const { supabase } = await import('../lib/supabase');

  const { data, error } = await supabase
    .from('entry_intents')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'monitoring')
    .order('urgency', { ascending: false })
    .order('created_at', { ascending: true });

  if (error || !data) {
    return [];
  }

  return data as EntryIntentData[];
}

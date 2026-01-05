export type EntryIntentType =
  | 'immediate_momentum'
  | 'pullback_to_vwap'
  | 'pullback_to_support'
  | 'break_and_retest'
  | 'range_extreme'
  | 'retest_structure'
  | 'wait_for_volatility';

export type EntryUrgencyLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export type TimeoutAction = 'EXECUTE_AT_MARKET' | 'CANCEL';

export type EntryIntentStatus =
  | 'monitoring'
  | 'executed'
  | 'timeout'
  | 'canceled'
  | 'conditions_changed';

export interface EntryIntent {
  id: string;
  session_id: string;
  user_id: string;
  symbol: string;
  intent_type: EntryIntentType;
  urgency: EntryUrgencyLevel;
  direction: 'long' | 'short';
  entry_zone_min: number;
  entry_zone_max: number;
  timeout_minutes: number;
  timeout_at: string;
  max_wait_seconds: number;
  timeout_action: TimeoutAction;
  invalidation_price?: number;
  status: EntryIntentStatus;
  alpha_reasoning?: string;
  market_context?: Record<string, any>;
  created_at: string;
  executed_at?: string;
  canceled_at?: string;
  canceled_reason?: string;
  actual_entry_price?: number;
}

export interface EntryMonitoringLog {
  id: string;
  intent_id: string;
  timestamp: string;
  current_price: number;
  distance_to_zone_pips?: number;
  conditions_met?: Record<string, boolean>;
  message?: string;
  candle_data?: Record<string, any>;
  market_conditions?: Record<string, any>;
}

export interface EntryQualityScore {
  id: string;
  trade_id: string;
  intent_id?: string;
  ideal_entry_price: number;
  actual_entry_price: number;
  entry_quality_score: number;
  slippage_pips: number;
  intent_type?: EntryIntentType;
  urgency?: EntryUrgencyLevel;
  timeout_used_seconds?: number;
  monitoring_duration_seconds?: number;
  conditions_at_entry?: Record<string, any>;
  created_at: string;
}

export interface ActiveEntryIntent {
  intent_id: string;
  session_id: string;
  symbol: string;
  intent_type: EntryIntentType;
  urgency: EntryUrgencyLevel;
  direction: 'long' | 'short';
  entry_zone_min: number;
  entry_zone_max: number;
  timeout_at: string;
  created_at: string;
  alpha_reasoning?: string;
  minutes_remaining: number;
  seconds_remaining: number;
  max_wait_seconds: number;
  timeout_action: TimeoutAction;
  invalidation_price?: number;
  latest_price?: number;
  distance_to_zone_pips?: number;
}

export interface EntryConditions {
  vwap_touch?: boolean;
  support_resistance_hold?: boolean;
  breakout_confirmed?: boolean;
  retest_hold?: boolean;
  momentum_sustained?: boolean;
  volume_confirmation?: boolean;
  candle_pattern_confirmed?: boolean;
  range_boundary_reached?: boolean;
}

export interface EntryValidationResult {
  is_valid: boolean;
  conditions_met: EntryConditions;
  should_execute: boolean;
  should_wait: boolean;
  should_cancel: boolean;
  cancel_reason?: string;
  message: string;
}

export interface EntryPlannerDecision {
  intent_id: string;
  action: 'execute' | 'wait' | 'cancel';
  entry_price?: number;
  conditions_met: EntryConditions;
  quality_score_estimate: number;
  reasoning: string;
  user_message: string;
}

export interface EntryIntentRequest {
  session_id: string;
  symbol: string;
  intent_type: EntryIntentType;
  urgency: EntryUrgencyLevel;
  direction: 'long' | 'short';
  entry_zone_min: number;
  entry_zone_max: number;
  timeout_minutes: number;
  max_wait_seconds: number;
  timeout_action: TimeoutAction;
  invalidation_price?: number;
  alpha_reasoning: string;
  market_context?: Record<string, any>;
}

export interface EntryMetrics {
  total_intents: number;
  executed_intents: number;
  timeout_intents: number;
  canceled_intents: number;
  average_quality_score: number;
  average_time_to_entry: number;
  success_rate_by_urgency: Record<EntryUrgencyLevel, number>;
  success_rate_by_intent_type: Record<EntryIntentType, number>;
}

export type EQERejectionReason =
  | 'CHASING_IMPULSE_MOVE'
  | 'EXHAUSTION_DETECTED'
  | 'TOO_FAR_FROM_VWAP'
  | 'FAILED_MICROSTRUCTURE';

export type EEGRejectionReason =
  | 'TTF_EXCEEDS_TIER4'
  | 'INSUFFICIENT_ATR'
  | 'ENTRY_TOO_FAR_FROM_PRICE'
  | 'FAILED_ECONOMIC_PRECHECK';

export type EEGAction =
  | 'EXECUTE_IMMEDIATELY'
  | 'EXECUTE_WITH_ADVISORY'
  | 'CONVERT_TO_VOLATILITY_WAIT'
  | 'HARD_BLOCK';

export interface VolatilityWaitIntent {
  id: string;
  session_id: string;
  user_id: string;
  symbol: string;
  direction: 'long' | 'short';
  original_ttf_minutes: number;
  target_atr: number;
  current_atr: number;
  wait_start: string;
  max_wait_hours: number;
  recheck_interval_minutes: number;
  status: 'waiting' | 'conditions_met' | 'expired' | 'canceled';
  alpha_reasoning?: string;
  created_at: string;
  resolved_at?: string;
}

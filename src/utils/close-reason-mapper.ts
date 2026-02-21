/**
 * Close Reason Mapper - SSOT for Close Reason Mapping
 *
 * This is the SINGLE SOURCE OF TRUTH for all close reason mapping logic.
 * All conversions between database strings, app types, and display text
 * must go through this module.
 *
 * CRITICAL: Any new close reason must be added here ONLY, not scattered across services.
 */

import { CloseReason } from '../types/position';

/**
 * Database close reason strings (as stored in goal_session_trades.close_reason)
 */
export type DatabaseCloseReason =
  | 'manual'
  | 'stop_loss'
  | 'sl'
  | 'take_profit'
  | 'take_profit_1'
  | 'take_profit_2'
  | 'tp'
  | 'tp1'
  | 'tp2'
  | 'goal_achieved'
  | 'goal_met'
  | 'goal_expired'
  | 'session_ended'
  | 'risk_limit'
  | 'trailing_stop'
  | 'breakeven'
  | 'weekend_protection'
  | 'holiday_closure'
  | 'force_closed'
  | 'market_closed';

/**
 * Analysis close reason strings (used in learning systems)
 *
 * CCIP NOTE: 'near_miss' and 'tp1_only' are virtual analysis reasons derived
 * from trade data at analysis time. They do not exist in the database
 * close_reason column — they are classification labels the learning system
 * assigns so Alpha can distinguish directional-win-but-TP-too-far events
 * from flat losses and full TP hits.
 */
export type AnalysisCloseReason =
  | 'tp_hit'
  | 'tp1_only'
  | 'sl_hit'
  | 'near_miss'
  | 'manual_close'
  | 'timeout'
  | 'weekend_protection'
  | 'holiday_closure'
  | 'force_closed'
  | 'market_closed';

/**
 * Map database close reason string to CloseReason type
 * SSOT for database → app type conversion
 */
export function mapDatabaseToCloseReason(dbReason: string | null | undefined): CloseReason {
  if (!dbReason) return 'manual';

  const normalized = dbReason.toLowerCase().trim();

  switch (normalized) {
    case 'stop_loss':
    case 'sl':
      return 'stop_loss';

    case 'take_profit_1':
    case 'tp1':
      return 'take_profit_1';

    case 'take_profit_2':
    case 'tp2':
      return 'take_profit_2';

    case 'take_profit':
    case 'tp':
      return 'take_profit';

    case 'goal_achieved':
    case 'goal_met':
      return 'goal_achieved';

    case 'goal_expired':
      return 'goal_expired';

    case 'session_ended':
      return 'session_ended';

    case 'risk_limit':
      return 'risk_limit';

    case 'trailing_stop':
      return 'trailing_stop';

    case 'weekend_protection':
      return 'weekend_protection';

    case 'holiday_closure':
      return 'holiday_closure';

    case 'force_closed':
      return 'force_closed';

    case 'market_closed':
      return 'market_closed';

    case 'manual':
    default:
      return 'manual';
  }
}

/**
 * Map CloseReason type to analysis close reason string
 * SSOT for app type → analysis string conversion
 */
export function mapCloseReasonToAnalysis(reason: CloseReason): AnalysisCloseReason {
  switch (reason) {
    case 'stop_loss':
      return 'sl_hit';

    case 'take_profit':
    case 'take_profit_1':
    case 'take_profit_2':
      return 'tp_hit';

    case 'session_ended':
    case 'goal_expired':
      return 'timeout';

    case 'weekend_protection':
      return 'weekend_protection';

    case 'holiday_closure':
      return 'holiday_closure';

    case 'force_closed':
      return 'force_closed';

    case 'market_closed':
      return 'market_closed';

    case 'manual':
    case 'goal_achieved':
    case 'risk_limit':
    case 'trailing_stop':
    default:
      return 'manual_close';
  }
}

/**
 * Map analysis close reason string to CloseReason type
 * SSOT for analysis string → app type conversion
 */
export function mapAnalysisToCloseReason(analysisReason: string): CloseReason {
  const normalized = analysisReason.toLowerCase().trim();

  switch (normalized) {
    case 'tp_hit':
      return 'take_profit';

    case 'sl_hit':
      return 'stop_loss';

    case 'timeout':
      return 'session_ended';

    case 'weekend_protection':
      return 'weekend_protection';

    case 'holiday_closure':
      return 'holiday_closure';

    case 'force_closed':
      return 'force_closed';

    case 'market_closed':
      return 'market_closed';

    case 'manual_close':
    default:
      return 'manual';
  }
}

/**
 * Get human-readable text for close reason
 * SSOT for display text
 */
export function getCloseReasonText(reason: CloseReason): string {
  switch (reason) {
    case 'stop_loss':
      return 'Stop Loss Hit';
    case 'take_profit':
      return 'Take Profit Hit';
    case 'take_profit_1':
      return 'Take Profit 1 Hit';
    case 'take_profit_2':
      return 'Take Profit 2 Hit';
    case 'manual':
      return 'Manually Closed';
    case 'goal_achieved':
      return 'Goal Achieved';
    case 'goal_expired':
      return 'Goal Expired';
    case 'session_ended':
      return 'Session Ended';
    case 'risk_limit':
      return 'Risk Limit Reached';
    case 'trailing_stop':
      return 'Trailing Stop';
    case 'weekend_protection':
      return 'Weekend Market Closure';
    case 'holiday_closure':
      return 'Holiday Market Closure';
    case 'force_closed':
      return 'Force Closed by System';
    case 'market_closed':
      return 'Market Closed';
    default:
      return 'Trade Closed';
  }
}

/**
 * Get color gradient class for close reason
 * SSOT for gradient styling
 */
export function getCloseReasonColor(reason: CloseReason): string {
  switch (reason) {
    case 'stop_loss':
      return 'from-red-500 to-orange-500';
    case 'take_profit':
    case 'take_profit_1':
    case 'take_profit_2':
    case 'goal_achieved':
      return 'from-emerald-500 to-blue-500';
    case 'trailing_stop':
      return 'from-blue-500 to-cyan-500';
    case 'weekend_protection':
    case 'holiday_closure':
    case 'force_closed':
    case 'market_closed':
      return 'from-slate-500 to-gray-500';
    default:
      return 'from-gray-500 to-gray-600';
  }
}

/**
 * Derive the learning-system analysis close reason from raw trade data.
 *
 * This is the SSOT for converting a closed trade's database state into the
 * AnalysisCloseReason label the learning pipeline uses. It must be called
 * ONCE per trade at analysis time — never re-derived inside individual services.
 *
 * Priority order (most specific first):
 *  1. tp1_only  — TP1 hit but TP2 not hit (partial victory, full learning)
 *  2. tp_hit    — Any TP variant fully hit
 *  3. sl_hit    — Stop loss hit
 *  4. near_miss — Manual/session close, direction was correct, peak_hit_ratio >= 0.70
 *  5. manual_close / timeout / system reasons
 */
export function deriveAnalysisCloseReason(params: {
  dbCloseReason: string | null | undefined;
  tp1Hit: boolean;
  tp2Hit: boolean;
  peakHitRatio?: number | null;
  finalPnl: number;
}): AnalysisCloseReason {
  const { dbCloseReason, tp1Hit, tp2Hit, peakHitRatio, finalPnl } = params;
  const normalized = (dbCloseReason || '').toLowerCase().trim();

  if (normalized === 'take_profit_1' || normalized === 'tp1') {
    return tp2Hit ? 'tp_hit' : 'tp1_only';
  }

  if (
    normalized === 'take_profit_2' ||
    normalized === 'tp2' ||
    normalized === 'take_profit' ||
    normalized === 'tp'
  ) {
    return 'tp_hit';
  }

  if (normalized === 'goal_achieved') {
    return 'tp_hit';
  }

  if (normalized === 'stop_loss' || normalized === 'sl') {
    return 'sl_hit';
  }

  if (normalized === 'weekend_protection') return 'weekend_protection';
  if (normalized === 'holiday_closure') return 'holiday_closure';
  if (normalized === 'force_closed') return 'force_closed';
  if (normalized === 'market_closed') return 'market_closed';
  if (normalized === 'session_ended' || normalized === 'goal_expired') return 'timeout';

  if (normalized === 'manual' || normalized === 'trailing_stop' || normalized === 'risk_limit') {
    const NEAR_MISS_THRESHOLD = 0.70;
    if (
      finalPnl <= 0 &&
      peakHitRatio != null &&
      peakHitRatio >= NEAR_MISS_THRESHOLD
    ) {
      return 'near_miss';
    }
    return 'manual_close';
  }

  return 'manual_close';
}

/**
 * Get badge color class for close reason
 * SSOT for badge styling
 */
export function getCloseReasonBadgeColor(reason: CloseReason): string {
  switch (reason) {
    case 'stop_loss':
      return 'bg-red-500/20 text-red-400';
    case 'take_profit':
    case 'take_profit_1':
    case 'take_profit_2':
    case 'goal_achieved':
      return 'bg-emerald-500/20 text-emerald-400';
    case 'trailing_stop':
      return 'bg-blue-500/20 text-blue-400';
    case 'weekend_protection':
    case 'holiday_closure':
    case 'force_closed':
    case 'market_closed':
      return 'bg-slate-500/20 text-slate-400';
    default:
      return 'bg-gray-500/20 text-gray-400';
  }
}

/**
 * Position Types - Type-safe position management
 *
 * These types match the goal_session_trades database schema exactly
 * and provide compile-time safety for all position operations.
 */

import { calculateDollarPerPip, calculatePipDistance, roundPnL } from '../utils/currencyHelpers';

export type PositionStatus = 'pending' | 'open' | 'closed' | 'rejected';
export type PositionDirection = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';
export type CloseReason =
  | 'manual'
  | 'stop_loss'
  | 'take_profit'
  | 'take_profit_1'
  | 'take_profit_2'
  | 'goal_achieved'
  | 'goal_expired'
  | 'session_ended'
  | 'risk_limit'
  | 'trailing_stop'
  | 'weekend_protection'
  | 'holiday_closure'
  | 'force_closed'
  | 'market_closed'
  | 'emergency_atr_stop'
  | 'entry_edge_loss'
  | 'breakeven_stop'
  | 'system_close';

// NOTE: take_profit_1 and take_profit_2 kept in type for backwards-compat with historical trades in DB

/**
 * Runtime array of all valid CloseReason values.
 * SSOT: This must mirror the CloseReason union above AND the DB CHECK constraint.
 * Used for runtime validation and mapping from external/legacy values.
 */
export const CLOSE_REASONS: readonly CloseReason[] = [
  'manual',
  'stop_loss',
  'take_profit',
  'take_profit_1',
  'take_profit_2',
  'goal_achieved',
  'goal_expired',
  'session_ended',
  'risk_limit',
  'trailing_stop',
  'weekend_protection',
  'holiday_closure',
  'force_closed',
  'market_closed',
  'emergency_atr_stop',
  'entry_edge_loss',
  'breakeven_stop',
  'system_close'
] as const;

/**
 * System close reasons that should NOT affect Alpha's learning
 * These are external factors, not trading decisions
 */
export const SYSTEM_CLOSE_REASONS: CloseReason[] = [
  'weekend_protection',
  'holiday_closure',
  'force_closed',
  'market_closed',
  'emergency_atr_stop',
  'entry_edge_loss',
  'breakeven_stop',
  'system_close'
];

/**
 * Milestone close reasons - trades that reached a valid exit point
 * These SHOULD affect Alpha's learning as they are natural outcomes
 */
export const MILESTONE_CLOSE_REASONS: CloseReason[] = [
  'stop_loss',
  'take_profit',
  'take_profit_1',  // historical only
  'take_profit_2',  // historical only
  'trailing_stop'
];

/**
 * Check if a close reason is a system closure (should not affect Alpha learning)
 */
export function isSystemClosure(closeReason: CloseReason | null | undefined): boolean {
  if (!closeReason) return false;
  return SYSTEM_CLOSE_REASONS.includes(closeReason);
}

/**
 * Check if a close reason is a milestone (trade reached a valid exit point)
 * These should be included in Alpha's learning
 */
export function isMilestoneClose(closeReason: CloseReason | null | undefined): boolean {
  if (!closeReason) return false;
  return MILESTONE_CLOSE_REASONS.includes(closeReason);
}

/**
 * Database row from goal_session_trades
 * This is the complete schema including all columns
 */
export interface GoalSessionTrade {
  id: string;
  goal_session_id: string;
  external_trade_record_id: string | null; // RENAMED: was trade_id (FK to trade_records for MT5 integration)
  user_id: string;
  symbol: string;
  direction: PositionDirection;
  position_type: PositionDirection;
  entry_price: number;
  exit_price: number | null;
  current_price: number | null;
  stop_loss: number;
  take_profit: number;
  position_size: number;
  lot_size: number;
  profit_loss: number;
  current_pnl: number;
  status: PositionStatus;
  order_type: OrderType;
  limit_price: number | null;
  opened_at: string | null;
  closed_at: string | null;
  close_reason: CloseReason | null;
  created_at: string;

  // Additional tracking fields
  simulated_position_id: string | null;
  strategy_used: string | null;
  flow_v2_signal_id: string | null;
  mae: number;
  mfe: number;
  breakeven_moved: boolean;
  trailing_active: boolean;
  partial_closes: any[];
  early_exit_reason: string | null;
  playbook_id: string | null;
  regime_bucket: string | null;
  risk_dollars: number | null;

  // Legacy TP1/TP2 fields — retained for historical data reads only. New trades use single TP.
  tp1_hit?: boolean | null;
  tp1_hit_at?: string | null;
  tp2_hit?: boolean | null;
  tp1_price?: number | null;
  tp2_price?: number | null;
  partial_close_pct?: number | null;
  tp1_pnl?: number | null;
  tp2_pnl?: number | null;
  tp1_breakeven_price?: number | null;
  sl_moved_to_breakeven_at?: string | null;
}

/**
 * Insert type - fields required when creating a new position
 */
export interface GoalSessionTradeInsert {
  goal_session_id: string;
  user_id: string;
  symbol: string;
  direction: PositionDirection;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  position_size: number;
  status?: PositionStatus;
  order_type?: OrderType;
  limit_price?: number | null;
  playbook_id?: string | null;
  regime_bucket?: string | null;
  risk_dollars?: number | null;
  strategy_used?: string | null;
  current_price?: number | null;
}

/**
 * Update type - fields that can be updated on an existing position
 */
export interface GoalSessionTradeUpdate {
  current_price?: number | null;
  current_pnl?: number;
  exit_price?: number | null;
  status?: PositionStatus;
  closed_at?: string | null;
  close_reason?: CloseReason | null;
  profit_loss?: number;
  stop_loss?: number;
  take_profit?: number;
  mae?: number;
  mfe?: number;
  breakeven_moved?: boolean;
  trailing_active?: boolean;
  partial_closes?: any[];
  early_exit_reason?: string | null;
}

/**
 * Application-level Position interface for UI components
 * Simplified view with renamed fields for better readability
 */
export interface Position {
  id: string;
  goalSessionId: string;
  userId: string;
  symbol: string;
  positionType: PositionDirection;
  orderType: OrderType;
  lotSize: number;
  entryPrice: number;
  currentPrice: number | null;
  stopLoss: number;
  takeProfit: number;
  status: PositionStatus;
  currentPnl: number;
  profitLoss: number;
  openedAt: string | null;
  closedAt: string | null;
  closeReason: CloseReason | null;
  limitPrice: number | null;
  playbookId: string | null;
  regimeBucket: string | null;
  riskDollars: number | null;
}

/**
 * Convert database row to application Position interface
 */
export function dbToPosition(trade: GoalSessionTrade): Position {
  return {
    id: trade.id,
    goalSessionId: trade.goal_session_id,
    userId: trade.user_id,
    symbol: trade.symbol,
    positionType: trade.direction,
    orderType: trade.order_type,
    lotSize: trade.position_size || trade.lot_size,
    entryPrice: trade.entry_price,
    currentPrice: trade.current_price,
    stopLoss: trade.stop_loss,
    takeProfit: trade.take_profit,
    status: trade.status,
    currentPnl: trade.current_pnl,
    profitLoss: trade.profit_loss,
    openedAt: trade.opened_at,
    closedAt: trade.closed_at,
    closeReason: trade.close_reason,
    limitPrice: trade.limit_price,
    playbookId: trade.playbook_id,
    regimeBucket: trade.regime_bucket,
    riskDollars: trade.risk_dollars
  };
}

/**
 * Convert application Position to database update
 */
export function positionToDbUpdate(position: Partial<Position>): GoalSessionTradeUpdate {
  const update: GoalSessionTradeUpdate = {};

  if (position.currentPrice !== undefined) update.current_price = position.currentPrice;
  if (position.currentPnl !== undefined) update.current_pnl = position.currentPnl;
  if (position.status !== undefined) update.status = position.status;
  if (position.stopLoss !== undefined) update.stop_loss = position.stopLoss;
  if (position.takeProfit !== undefined) update.take_profit = position.takeProfit;
  if (position.closeReason !== undefined) update.close_reason = position.closeReason;
  if (position.closedAt !== undefined) update.closed_at = position.closedAt;

  return update;
}

/**
 * Type guard to check if a position is open
 */
export function isOpenPosition(position: GoalSessionTrade | Position): boolean {
  return position.status === 'open' || position.status === 'pending';
}

/**
 * Type guard to check if a position is closed
 */
export function isClosedPosition(position: GoalSessionTrade | Position): boolean {
  return position.status === 'closed';
}

/**
 * Calculate P&L for a position given current price
 * CRITICAL: Uses currency-specific pip values for accurate calculations
 */
export function calculatePnL(
  direction: PositionDirection,
  entryPrice: number,
  currentPrice: number,
  lotSize: number,
  symbol: string
): number {
  // Calculate pip distance between entry and current price
  const pipDistance = calculatePipDistance(symbol, entryPrice, currentPrice);

  // Calculate dollar value per pip for this lot size
  const dollarPerPip = calculateDollarPerPip(symbol, lotSize);

  // Calculate P&L based on direction
  const priceDiff = direction === 'buy'
    ? currentPrice - entryPrice
    : entryPrice - currentPrice;

  // If price moved in favorable direction, profit; otherwise loss
  const pnl = priceDiff >= 0
    ? pipDistance * dollarPerPip
    : -pipDistance * dollarPerPip;

  // Round to 2 decimal places to prevent floating point precision issues
  return roundPnL(pnl);
}

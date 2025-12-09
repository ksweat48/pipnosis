/**
 * Position Types - Type-safe position management
 *
 * These types match the goal_session_trades database schema exactly
 * and provide compile-time safety for all position operations.
 */

export type PositionStatus = 'pending' | 'open' | 'closed' | 'rejected' | 'soft_closing';
export type PositionDirection = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';
export type CloseReason = 'manual' | 'stop_loss' | 'take_profit' | 'goal_achieved' | 'goal_expired' | 'session_ended' | 'risk_limit' | 'trailing_stop';

/**
 * Database row from goal_session_trades
 * This is the complete schema including all columns
 */
export interface GoalSessionTrade {
  id: string;
  goal_session_id: string;
  trade_id: string | null;
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
    lotSize: trade.lot_size || trade.position_size,
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
 */
export function calculatePnL(
  direction: PositionDirection,
  entryPrice: number,
  currentPrice: number,
  lotSize: number
): number {
  const pipValue = 100000; // Standard forex calculation
  const priceDiff = direction === 'buy'
    ? currentPrice - entryPrice
    : entryPrice - currentPrice;

  return priceDiff * lotSize * pipValue;
}

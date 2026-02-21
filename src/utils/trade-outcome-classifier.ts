/**
 * Trade Outcome Classifier - SSOT for Win/Loss Determination
 *
 * This is the SINGLE SOURCE OF TRUTH for determining whether a trade
 * was a winning or losing trade based on database row data.
 *
 * CRITICAL: All services that need to classify trade outcomes MUST use
 * these functions. Never inline close_reason checks against raw database values.
 *
 * Database close_reason values: 'take_profit', 'take_profit_1', 'take_profit_2',
 *   'manual', 'stop_loss', 'session_ended', 'force_closed', 'goal_achieved', etc.
 * Database P&L column: 'profit_loss' (NOT 'realized_pnl')
 */

const TP_CLOSE_REASONS = ['take_profit', 'take_profit_1', 'take_profit_2', 'tp', 'tp1', 'tp2', 'goal_achieved'];
const SL_CLOSE_REASONS = ['stop_loss', 'sl'];

export function isWinningTrade(trade: { close_reason?: string | null; profit_loss?: number | string | null }): boolean {
  const closeReason = (trade.close_reason || '').toLowerCase().trim();
  const pnl = typeof trade.profit_loss === 'string' ? parseFloat(trade.profit_loss) : (trade.profit_loss || 0);

  if (TP_CLOSE_REASONS.includes(closeReason)) return true;
  if (closeReason === 'manual' && pnl > 0) return true;
  if (closeReason === 'trailing_stop' && pnl > 0) return true;

  return false;
}

export function isLosingTrade(trade: { close_reason?: string | null; profit_loss?: number | string | null }): boolean {
  const closeReason = (trade.close_reason || '').toLowerCase().trim();
  const pnl = typeof trade.profit_loss === 'string' ? parseFloat(trade.profit_loss) : (trade.profit_loss || 0);

  if (SL_CLOSE_REASONS.includes(closeReason)) return true;
  if (pnl < 0) return true;

  return false;
}

export function getTradeProfit(trade: { profit_loss?: number | string | null }): number {
  if (trade.profit_loss === null || trade.profit_loss === undefined) return 0;
  return typeof trade.profit_loss === 'string' ? parseFloat(trade.profit_loss) : trade.profit_loss;
}

export function calculateWinRate(trades: Array<{ close_reason?: string | null; profit_loss?: number | string | null }>): number {
  if (trades.length === 0) return 0;
  const wins = trades.filter(isWinningTrade).length;
  return (wins / trades.length) * 100;
}

/**
 * Determine if a closed trade is a near-miss.
 *
 * A near-miss is: Alpha correctly identified the direction (price moved toward TP
 * and reached >= 70% of the distance), but the trade ultimately closed in a loss
 * because the TP target was placed too far and price reversed before hitting it.
 *
 * Near-miss trades are NOT losses — they are TP placement failures.
 * They enter the learning pipeline with the 'near_miss' analysis reason so Alpha
 * can adjust TP targets for this symbol/style going forward.
 *
 * SSOT: This is the only place that defines near-miss classification logic.
 */
export function isNearMissTrade(trade: {
  close_reason?: string | null;
  profit_loss?: number | string | null;
  peak_hit_ratio?: number | null;
}): boolean {
  const pnl = typeof trade.profit_loss === 'string'
    ? parseFloat(trade.profit_loss)
    : (trade.profit_loss ?? 0);
  const peakHitRatio = trade.peak_hit_ratio ?? null;
  const closeReason = (trade.close_reason || '').toLowerCase().trim();

  const isNonMilestoneClose =
    closeReason === 'manual' ||
    closeReason === 'session_ended' ||
    closeReason === 'goal_expired' ||
    closeReason === 'risk_limit';

  return (
    isNonMilestoneClose &&
    pnl <= 0 &&
    peakHitRatio != null &&
    peakHitRatio >= 0.70
  );
}

/**
 * Get the near-miss classification data for a trade.
 * Returns null if the trade is not a near-miss.
 *
 * Used by post-trade-analyzer to write structured near-miss records.
 */
export function getNearMissData(trade: {
  close_reason?: string | null;
  profit_loss?: number | string | null;
  peak_hit_ratio?: number | null;
}): { isNearMiss: true; peakHitRatio: number; severity: 'critical' | 'significant' | 'mild' } | null {
  if (!isNearMissTrade(trade)) return null;

  const peakHitRatio = trade.peak_hit_ratio!;

  let severity: 'critical' | 'significant' | 'mild';
  if (peakHitRatio >= 0.90) {
    severity = 'critical';
  } else if (peakHitRatio >= 0.80) {
    severity = 'significant';
  } else {
    severity = 'mild';
  }

  return { isNearMiss: true, peakHitRatio, severity };
}

/**
 * Determine if a TP1-hit trade never reached TP2.
 * Used by post-trade-analyzer to write tp1_only_log records.
 */
export function isTP1OnlyTrade(trade: {
  close_reason?: string | null;
  tp1_hit?: boolean | null;
  tp2_hit?: boolean | null;
}): boolean {
  return (
    (trade.tp1_hit === true) &&
    (trade.tp2_hit !== true) &&
    (trade.close_reason || '').toLowerCase().trim() !== 'take_profit_2'
  );
}

export function calculateProfitFactor(trades: Array<{ profit_loss?: number | string | null }>): number {
  const totalWins = trades.reduce((sum, t) => {
    const pnl = getTradeProfit(t);
    return pnl > 0 ? sum + pnl : sum;
  }, 0);

  const totalLosses = trades.reduce((sum, t) => {
    const pnl = getTradeProfit(t);
    return pnl < 0 ? sum + Math.abs(pnl) : sum;
  }, 0);

  if (totalLosses === 0) return totalWins > 0 ? 999 : 1;
  return totalWins / totalLosses;
}

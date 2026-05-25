/**
 * Display Formatters - Single Source of Truth for Financial Data Display
 *
 * This module provides CONSISTENT formatting for all financial data across:
 * - UI Components (mobile, desktop, cards, tables)
 * - Notifications (push, in-app, modals)
 * - AI Messages (LLM responses, analysis)
 * - Admin Panels (user management, analytics)
 *
 * CRITICAL: All display logic MUST use these formatters to ensure consistency.
 * DO NOT use manual .toFixed() calls anywhere in the codebase.
 */

import {
  formatCurrencyPrice,
  formatLotSize as currencyFormatLotSize,
  formatPnL as currencyFormatPnL,
  roundPnL,
  getCurrencyPipInfo
} from './currencyHelpers';

/**
 * Display context determines formatting precision and verbosity
 */
export type DisplayContext =
  | 'mobile'          // Compact, fewer decimals
  | 'desktop'         // Full precision
  | 'notification'    // Brief, clear
  | 'ai-message'      // Natural language
  | 'admin'           // Full detail
  | 'chart';          // Technical precision

/**
 * Format account balance based on display context
 * - Mobile: No decimals (e.g., "$10,234")
 * - Desktop: 2 decimals (e.g., "$10,234.56")
 * - Notification: 2 decimals with compact notation for large numbers
 */
export function formatAccountBalance(
  balance: number,
  context: DisplayContext = 'desktop'
): string {
  if (balance === null || balance === undefined || isNaN(balance)) {
    return '$0.00';
  }

  const rounded = roundPnL(balance);

  switch (context) {
    case 'mobile':
      return `$${rounded.toFixed(0)}`;

    case 'notification':
      if (rounded >= 100000) {
        return `$${(rounded / 1000).toFixed(1)}k`;
      }
      return `$${rounded.toFixed(2)}`;

    case 'desktop':
    case 'admin':
    case 'chart':
    case 'ai-message':
    default:
      return `$${rounded.toFixed(2)}`;
  }
}

/**
 * Format profit/loss with sign and context-appropriate precision
 * - Always includes +/- sign
 * - Mobile: No decimals
 * - Desktop/Admin: 2 decimals
 * - Notification: Brief format
 */
export function formatProfitLoss(
  pnl: number,
  context: DisplayContext = 'desktop'
): string {
  if (pnl === null || pnl === undefined || isNaN(pnl)) {
    return '$0.00';
  }

  const rounded = roundPnL(pnl);
  const sign = rounded >= 0 ? '+' : '';

  switch (context) {
    case 'mobile':
      return `${sign}$${rounded.toFixed(0)}`;

    case 'notification':
      return `${sign}$${Math.abs(rounded).toFixed(2)}`;

    case 'desktop':
    case 'admin':
    case 'chart':
    case 'ai-message':
    default:
      return `${sign}$${rounded.toFixed(2)}`;
  }
}

/**
 * Format position price with symbol-specific precision.
 * Context-aware: mobile context enforces 2 decimal places (CCIP mobile standard).
 * - mobile:  2 decimals for ALL symbols
 * - desktop/admin/chart: symbol-specific precision (e.g. 5 for forex, 2 for gold)
 * - JPY pairs: 3 decimals (desktop)
 * - Standard forex: 5 decimals (desktop)
 * - Gold (XAU): 2 decimals (desktop)
 * - Crypto: 2 decimals (desktop)
 */
export function formatPositionPrice(
  price: number | null,
  symbol: string,
  context: DisplayContext = 'desktop'
): string {
  if (price === null || price === undefined || isNaN(price)) {
    return 'N/A';
  }

  const isMobile = context === 'mobile';
  return formatCurrencyPrice(symbol, price, isMobile);
}

/**
 * Format lot size consistently (always 2 decimals)
 * Examples: "0.01", "0.15", "1.00"
 */
export function formatLotSize(
  lotSize: number,
  context: DisplayContext = 'desktop'
): string {
  if (lotSize === null || lotSize === undefined || isNaN(lotSize)) {
    return '0.00';
  }

  return currencyFormatLotSize(lotSize);
}

/**
 * Format risk/reward ratio consistently
 * Examples: "1:2.50", "1:1.85"
 */
export function formatRiskReward(
  riskReward: number,
  context: DisplayContext = 'desktop'
): string {
  if (riskReward === null || riskReward === undefined || isNaN(riskReward)) {
    return '1:0.00';
  }

  switch (context) {
    case 'mobile':
    case 'notification':
      return `1:${riskReward.toFixed(1)}`;

    case 'desktop':
    case 'admin':
    case 'chart':
    case 'ai-message':
    default:
      return `1:${riskReward.toFixed(2)}`;
  }
}

/**
 * Format percentage with consistent precision
 * Examples: "75.5%", "12.34%"
 */
export function formatPercentage(
  value: number,
  decimals: number = 1,
  context: DisplayContext = 'desktop'
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '0.0%';
  }

  switch (context) {
    case 'mobile':
      return `${value.toFixed(0)}%`;

    case 'notification':
      return `${value.toFixed(decimals)}%`;

    case 'desktop':
    case 'admin':
    case 'chart':
    case 'ai-message':
    default:
      return `${value.toFixed(decimals)}%`;
  }
}

/**
 * Format pip distance for display
 * Examples: "25.5 pips", "150.0 pips"
 */
export function formatPipDistance(
  pips: number,
  context: DisplayContext = 'desktop'
): string {
  if (pips === null || pips === undefined || isNaN(pips)) {
    return '0.0 pips';
  }

  switch (context) {
    case 'mobile':
    case 'notification':
      return `${pips.toFixed(0)} pips`;

    case 'desktop':
    case 'admin':
    case 'chart':
    case 'ai-message':
    default:
      return `${pips.toFixed(1)} pips`;
  }
}

/**
 * Format duration in human-readable format
 * Examples: "2h 15m", "45m", "12m"
 */
export function formatDuration(
  startTime: string | Date,
  endTime: string | Date = new Date(),
  context: DisplayContext = 'desktop'
): string {
  const start = typeof startTime === 'string' ? new Date(startTime) : startTime;
  const end = typeof endTime === 'string' ? new Date(endTime) : endTime;

  const diffMs = end.getTime() - start.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }

  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;

  switch (context) {
    case 'mobile':
    case 'notification':
      return `${hours}h ${minutes}m`;

    case 'desktop':
    case 'admin':
    case 'ai-message':
      if (hours >= 24) {
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        return `${days}d ${remainingHours}h`;
      }
      return `${hours}h ${minutes}m`;

    case 'chart':
      return `${diffMinutes}m`;

    default:
      return `${hours}h ${minutes}m`;
  }
}

/**
 * Format timestamp for display
 * Mobile: "Dec 25, 2:30 PM"
 * Desktop: "Dec 25, 2024 at 2:30 PM"
 */
export function formatTimestamp(
  timestamp: string | Date,
  context: DisplayContext = 'desktop'
): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;

  if (isNaN(date.getTime())) {
    return 'Invalid date';
  }

  switch (context) {
    case 'mobile':
    case 'notification':
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

    case 'desktop':
    case 'admin':
    case 'ai-message':
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

    case 'chart':
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

    default:
      return date.toLocaleString();
  }
}

/**
 * Format trade direction for display
 */
export function formatDirection(
  direction: 'buy' | 'sell',
  context: DisplayContext = 'desktop'
): string {
  return direction.toUpperCase();
}

/**
 * Format close reason for display
 */
export function formatCloseReason(
  reason: string | null,
  context: DisplayContext = 'desktop'
): string {
  if (!reason) return 'Manual';

  const reasonMap: Record<string, string> = {
    'manual': 'Manual',
    'stop_loss': 'Stop Loss',
    'take_profit': 'Take Profit',
    'goal_achieved': 'Goal Achieved',
    'session_ended': 'Session Ended',
    'risk_limit': 'Risk Limit',
    'trailing_stop': 'Trailing Stop',
    'goal_expired': 'Time Limit'
  };

  return reasonMap[reason] || reason;
}

/**
 * Format trade summary for notifications
 * Example: "EURUSD BUY +$15.50 (Take Profit)"
 */
export function formatTradeNotification(params: {
  symbol: string;
  direction: 'buy' | 'sell';
  pnl: number;
  closeReason?: string;
}): string {
  const { symbol, direction, pnl, closeReason } = params;
  const formattedPnl = formatProfitLoss(pnl, 'notification');
  const formattedReason = closeReason ? ` (${formatCloseReason(closeReason, 'notification')})` : '';

  return `${symbol} ${formatDirection(direction)} ${formattedPnl}${formattedReason}`;
}

/**
 * Format trade entry message for AI/notifications
 * Example: "Entered BUY EURUSD at 1.08456 with 0.15 lots"
 */
export function formatTradeEntry(params: {
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  lotSize: number;
  stopLoss: number;
  takeProfit: number;
}): string {
  const { symbol, direction, entryPrice, lotSize, stopLoss, takeProfit } = params;

  return `Entered ${formatDirection(direction)} ${symbol} at ${formatPositionPrice(entryPrice, symbol)} ` +
         `with ${formatLotSize(lotSize)} lots ` +
         `(SL: ${formatPositionPrice(stopLoss, symbol)}, ` +
         `TP: ${formatPositionPrice(takeProfit, symbol)})`;
}

/**
 * Format goal progress display
 * Example: "$45.50 / $200.00 (22.8%)"
 */
export function formatGoalProgress(
  currentProgress: number,
  targetGoal: number,
  context: DisplayContext = 'desktop'
): string {
  const percentage = (currentProgress / targetGoal) * 100;
  const formattedCurrent = formatAccountBalance(currentProgress, context);
  const formattedTarget = formatAccountBalance(targetGoal, context);
  const formattedPercentage = formatPercentage(percentage, 1, context);

  return `${formattedCurrent} / ${formattedTarget} (${formattedPercentage})`;
}

/**
 * Format position summary for cards/displays
 * Includes all key metrics in one formatted string
 */
export function formatPositionSummary(params: {
  symbol: string;
  direction: 'buy' | 'sell';
  lotSize: number;
  entryPrice: number;
  currentPrice: number | null;
  stopLoss: number;
  takeProfit: number;
  currentPnl: number;
  context?: DisplayContext;
}): {
  header: string;
  entry: string;
  current: string;
  stopLoss: string;
  takeProfit: string;
  pnl: string;
} {
  const context = params.context || 'desktop';

  return {
    header: `${params.symbol} ${formatDirection(params.direction)} ${formatLotSize(params.lotSize, context)} lots`,
    entry: formatPositionPrice(params.entryPrice, params.symbol, context),
    current: formatPositionPrice(params.currentPrice, params.symbol, context),
    stopLoss: formatPositionPrice(params.stopLoss, params.symbol, context),
    takeProfit: formatPositionPrice(params.takeProfit, params.symbol, context),
    pnl: formatProfitLoss(params.currentPnl, context)
  };
}

/**
 * VALIDATION: Detect manual formatting in runtime (development mode only)
 */
export function warnManualFormatting(location: string, value: any): void {
  if (import.meta.env.DEV) {
    const valueStr = String(value);
    if (valueStr.includes('.toFixed(') || valueStr.match(/\.\d+$/)) {
      console.warn(
        `[Display Formatter] Manual formatting detected at ${location}. ` +
        `Use displayFormatters instead for consistency.`,
        { value }
      );
    }
  }
}

/**
 * Export shorthand aliases for common use cases
 */
export const format = {
  balance: formatAccountBalance,
  pnl: formatProfitLoss,
  price: formatPositionPrice,
  lots: formatLotSize,
  rr: formatRiskReward,
  percent: formatPercentage,
  pips: formatPipDistance,
  duration: formatDuration,
  timestamp: formatTimestamp,
  direction: formatDirection,
  closeReason: formatCloseReason,
  tradeNotification: formatTradeNotification,
  tradeEntry: formatTradeEntry,
  goalProgress: formatGoalProgress,
  positionSummary: formatPositionSummary
};

/**
 * Type-safe formatter function selector
 */
export type FormatterType = keyof typeof format;

/**
 * Get formatter by type name (useful for dynamic scenarios)
 */
export function getFormatter(type: FormatterType): Function {
  return format[type];
}

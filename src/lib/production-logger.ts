/**
 * Production Logger - Clean console output
 *
 * Only logs important events:
 * - Errors (always)
 * - Trade executions
 * - AI decisions
 * - Chart interactions
 *
 * Silences:
 * - Tick updates
 * - Price polling
 * - Verbose status messages
 */

export enum ProductionLogCategory {
  ERROR = 'ERROR',
  TRADE = 'TRADE',
  AI_DECISION = 'AI',
  CHART = 'CHART',
  POSITION = 'POSITION'
}

class ProductionLogger {
  private enabled = true;
  private isDev: boolean;

  constructor() {
    this.isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true;
  }

  /**
   * Always log errors
   */
  error(category: ProductionLogCategory, message: string, data?: any) {
    console.error(`[${category}]`, message, data || '');
  }

  /**
   * General info logging (dev only to reduce production noise)
   */
  info(message: string, data?: any) {
    if (!this.enabled || !this.isDev) return;
    console.log(message, data || '');
  }

  /**
   * Log trade executions
   */
  trade(action: string, symbol: string, details: any) {
    if (!this.enabled) return;
    console.log(
      `%c[TRADE] ${action} ${symbol}`,
      'color: #10b981; font-weight: bold',
      details
    );
  }

  /**
   * Log AI decisions
   */
  aiDecision(type: string, message: string, reasoning?: string) {
    if (!this.enabled) return;
    console.log(
      `%c[AI] ${type}`,
      'color: #3b82f6; font-weight: bold',
      message,
      reasoning ? `\n💭 ${reasoning}` : ''
    );
  }

  /**
   * Log chart interactions (only in dev)
   */
  chart(action: string, details?: any) {
    if (!this.enabled || !this.isDev) return;
    console.log(
      `%c[CHART] ${action}`,
      'color: #8b5cf6',
      details || ''
    );
  }

  /**
   * Log position changes
   */
  position(action: string, symbol: string, pnl?: number) {
    if (!this.enabled) return;
    const pnlText = pnl !== undefined
      ? ` | P&L: $${pnl.toFixed(2)}`
      : '';
    const color = pnl && pnl >= 0 ? '#10b981' : '#ef4444';
    console.log(
      `%c[POSITION] ${action} ${symbol}${pnlText}`,
      `color: ${color}; font-weight: bold`
    );
  }

  /**
   * Development-only logging
   */
  dev(...args: any[]) {
    if (this.isDev) {
      console.log(...args);
    }
  }

  /**
   * Silent stub for removed logs
   */
  silent(...args: any[]) {
    // Intentionally empty - replaces verbose logs
  }

  /**
   * Toggle logging on/off
   */
  toggle(enabled: boolean) {
    this.enabled = enabled;
    console.log(`Production logging ${enabled ? 'enabled' : 'disabled'}`);
  }
}

export const prodLogger = new ProductionLogger();

// Make available globally
if (typeof window !== 'undefined') {
  (window as any).prodLogger = prodLogger;
}

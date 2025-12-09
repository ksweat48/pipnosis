/**
 * Centralized Watchlist Configuration
 *
 * Defines the default symbols for multi-symbol trading mode.
 * The AI analyzes all symbols every cycle and selects the best opportunity.
 */

export const DEFAULT_WATCHLIST = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'US30'] as const;

export type WatchlistSymbol = typeof DEFAULT_WATCHLIST[number];

export interface WatchlistConfig {
  symbols: string[];
  minSymbols: number;
  maxSymbols: number;
}

export const WATCHLIST_CONFIG: WatchlistConfig = {
  symbols: [...DEFAULT_WATCHLIST],
  minSymbols: 1,
  maxSymbols: 10
};

export function validateWatchlist(symbols: string[]): boolean {
  if (!symbols || symbols.length < WATCHLIST_CONFIG.minSymbols) {
    return false;
  }
  if (symbols.length > WATCHLIST_CONFIG.maxSymbols) {
    return false;
  }
  return symbols.every(s => typeof s === 'string' && s.length > 0);
}

export function getDefaultWatchlist(): string[] {
  return [...DEFAULT_WATCHLIST];
}

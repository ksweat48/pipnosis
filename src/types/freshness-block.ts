/**
 * Freshness Block Categories and Types
 *
 * Used for distinct logging and analytics of trade execution blocks
 */

export enum FreshnessBlockCategory {
  BLOCK_STALE_OMEGA_INTELLIGENCE = 'BLOCK_STALE_OMEGA_INTELLIGENCE',
  BLOCK_STALE_ALPHA_INTELLIGENCE = 'BLOCK_STALE_ALPHA_INTELLIGENCE',
  BLOCK_PRICE_DRIFT = 'BLOCK_PRICE_DRIFT',
  BLOCK_STALE_PRICE_FEED = 'BLOCK_STALE_PRICE_FEED',
  BLOCK_NO_PRICE_DATA = 'BLOCK_NO_PRICE_DATA',
  BLOCK_PERSISTENT_STALENESS = 'BLOCK_PERSISTENT_STALENESS'
}

export interface BlockMetadata {
  symbol?: string;
  timeframe?: string;
  ageSeconds?: number;
  maxAgeSeconds?: number;
  staleBrains?: string[];
  driftPips?: number;
  driftPercent?: number;
  maxDrift?: number;
  signalPrice?: number;
  currentPrice?: number;
  wasAutoRefreshed?: boolean;
  refreshAttempted?: boolean;
}

export interface CategorizedBlockResult {
  canExecute: boolean;
  blockCategory?: FreshnessBlockCategory;
  blockMetadata?: BlockMetadata;
  reason?: string;
}

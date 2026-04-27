/**
 * Trade Style Registry - STYLE CONFIG AUTHORITY
 *
 * SSOT COMPLIANCE (CCIP-2026-0308B):
 * - CanonicalStyle TYPE is re-exported from timeframe-hierarchy.ts (SSOT)
 * - Style alias resolution delegates to resolveCanonicalStyle() (SSOT)
 * - This file's UNIQUE responsibility: StyleConfig (poll intervals, timeouts, chase distances)
 *
 * Authority Boundary:
 * - TYPE + ALIASES: timeframe-hierarchy.ts owns these
 * - STYLE CONFIGS (operational parameters): THIS FILE owns these
 *
 * CCIP-2026-0318B: eqsThreshold removed from StyleConfig.
 * EQS is no longer an execution gate — Alpha receives EQS as market context
 * and reasons about it directly. No code path may use EQS to block a trade.
 *
 * All style normalization calls go through timeframe-hierarchy.resolveCanonicalStyle().
 * Duplication of the alias map has been removed.
 */

import { resolveCanonicalStyle, type CanonicalTradeStyle } from '../config/timeframe-hierarchy';

export type CanonicalStyle = CanonicalTradeStyle;

export interface StyleConfig {
  canonical: CanonicalStyle;
  displayName: string;
  pollIntervalMs: number;
  timeoutMinutes: number;
  maxChaseDistance: number;
}

// CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform.
const STYLE_CONFIGS: Record<CanonicalStyle, StyleConfig> = {
  MICRO_INTRADAY: {
    canonical: 'MICRO_INTRADAY',
    displayName: 'Micro Intraday',
    pollIntervalMs: 3000,
    timeoutMinutes: 5,
    maxChaseDistance: 10
  }
};

export class TradeStyleRegistry {
  private static instance: TradeStyleRegistry;

  private constructor() {}

  static getInstance(): TradeStyleRegistry {
    if (!TradeStyleRegistry.instance) {
      TradeStyleRegistry.instance = new TradeStyleRegistry();
    }
    return TradeStyleRegistry.instance;
  }

  normalize(style: string): CanonicalStyle {
    return resolveCanonicalStyle(style, 'MICRO_INTRADAY');
  }

  getConfig(style: string): StyleConfig {
    const canonical = this.normalize(style);
    return STYLE_CONFIGS[canonical];
  }

  getAllCanonicalStyles(): CanonicalStyle[] {
    // CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform.
    return ['MICRO_INTRADAY'];
  }

  isValid(style: string): boolean {
    const result = resolveCanonicalStyle(style);
    return result !== undefined;
  }
}

export const tradeStyleRegistry = TradeStyleRegistry.getInstance();

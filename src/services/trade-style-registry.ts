/**
 * Trade Style Registry - SINGLE SOURCE OF TRUTH
 *
 * Central authority for:
 * - Style normalization (scalper -> SCALP, etc.)
 * - Style-specific configurations
 * - Timeouts, poll intervals, EQS thresholds
 *
 * All style handling MUST go through this registry.
 */

import { ALPHA_IDENTITY } from '../config/alpha-identity';

export type CanonicalStyle = 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';

export interface StyleConfig {
  canonical: CanonicalStyle;
  displayName: string;
  pollIntervalMs: number;
  timeoutMinutes: number;
  eqsThreshold: number;
  maxChaseDistance: number;
}

const STYLE_ALIASES: Record<string, CanonicalStyle> = {
  // SCALP variants
  'SCALP': 'SCALP',
  'scalp': 'SCALP',
  'Scalp': 'SCALP',
  'scalper': 'SCALP',
  'SCALPER': 'SCALP',
  'Scalper': 'SCALP',

  // MICRO_INTRADAY variants
  'MICRO_INTRADAY': 'MICRO_INTRADAY',
  'micro_intraday': 'MICRO_INTRADAY',
  'MicroIntraday': 'MICRO_INTRADAY',
  'micro': 'MICRO_INTRADAY',
  'MICRO': 'MICRO_INTRADAY',
  'Micro': 'MICRO_INTRADAY',

  // INTRADAY variants
  'INTRADAY': 'INTRADAY',
  'intraday': 'INTRADAY',
  'Intraday': 'INTRADAY',
  'day': 'INTRADAY',
  'DAY': 'INTRADAY',
  'Day': 'INTRADAY'
};

const STYLE_CONFIGS: Record<CanonicalStyle, StyleConfig> = {
  SCALP: {
    canonical: 'SCALP',
    displayName: 'Scalp',
    pollIntervalMs: 2000,
    timeoutMinutes: 3,
    eqsThreshold: ALPHA_IDENTITY.EQS_EXECUTION_THRESHOLD,  // Unified 80%
    maxChaseDistance: 5
  },
  MICRO_INTRADAY: {
    canonical: 'MICRO_INTRADAY',
    displayName: 'Micro Intraday',
    pollIntervalMs: 3000,
    timeoutMinutes: 5,
    eqsThreshold: ALPHA_IDENTITY.EQS_EXECUTION_THRESHOLD,  // Unified 80%
    maxChaseDistance: 10
  },
  INTRADAY: {
    canonical: 'INTRADAY',
    displayName: 'Intraday',
    pollIntervalMs: 5000,
    timeoutMinutes: 15,
    eqsThreshold: ALPHA_IDENTITY.EQS_EXECUTION_THRESHOLD,  // Unified 80%
    maxChaseDistance: 15
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

  /**
   * Normalize any style variant to canonical form
   */
  normalize(style: string): CanonicalStyle {
    const canonical = STYLE_ALIASES[style];

    if (!canonical) {
      console.warn(`[StyleRegistry] Unknown style '${style}', defaulting to MICRO_INTRADAY`);
      return 'MICRO_INTRADAY';
    }

    return canonical;
  }

  /**
   * Get configuration for a style
   */
  getConfig(style: string): StyleConfig {
    const canonical = this.normalize(style);
    return STYLE_CONFIGS[canonical];
  }

  /**
   * Get all supported canonical styles
   */
  getAllCanonicalStyles(): CanonicalStyle[] {
    return ['SCALP', 'MICRO_INTRADAY', 'INTRADAY'];
  }

  /**
   * Check if a style is valid
   */
  isValid(style: string): boolean {
    return style in STYLE_ALIASES;
  }
}

export const tradeStyleRegistry = TradeStyleRegistry.getInstance();

/**
 * Volatility-Aware Patience System Configuration
 *
 * Three-layer intelligent gating system for execution discipline:
 * - Layer 0 (EEG Precheck): Fail-fast on hard impossibilities
 * - Layer 1 (Stricter EQE): Microstructure discipline
 * - Layer 2 (Tiered TTF + Volatility Wait): Economic graduation
 */

export const VOLATILITY_PATIENCE_CONFIG = {
  enabled: true,

  // Layer 1: Entry Qualification Engine (EQE) - Microstructure Discipline
  eqe: {
    chaseDetection: {
      enabled: true,
      impulseMoveThreshold: 0.8, // Impulse > 0.8x ATR over N candles
      lookbackCandles: 3,
      action: 'WAIT_FOR_PULLBACK' as const
    },
    exhaustionDetection: {
      enabled: true,
      largeBodyThreshold: 0.7, // Body > 70% of range
      closeNearExtremeThreshold: 0.15, // Close within 15% of high/low
      action: 'WAIT_FOR_CONFIRMATION' as const
    },
    vwapDistanceLimits: {
      enabled: true,
      maxDistanceFromVWAP: 1.2, // Max 1.2x ATR from VWAP
      action: 'WAIT_FOR_PULLBACK' as const
    }
  },

  // Layer 2: Execution Eligibility Gate (EEG) - Economic Graduation
  eeg: {
    precheck: {
      enabled: true,
      skipExpensiveAnalysisOnFail: true
    },

    // Time-To-Fill (TTF) Tiering
    ttfTiers: {
      tier1: {
        maxMinutes: 150,
        action: 'EXECUTE_IMMEDIATELY' as const,
        description: 'Optimal window - execute immediately'
      },
      tier2: {
        maxMinutes: 240,
        action: 'EXECUTE_WITH_ADVISORY' as const,
        description: 'Marginal but acceptable - execute with warning'
      },
      tier3: {
        maxMinutes: 360,
        action: 'CONVERT_TO_VOLATILITY_WAIT' as const,
        description: 'Redirect to volatility wait intent'
      },
      tier4: {
        maxMinutes: 480,
        action: 'HARD_BLOCK' as const,
        description: 'Exceeds intraday physics - reject'
      }
    },

    // Volatility-Based Wait Conversion
    volatilityWait: {
      enabled: true,
      minATRForPatience: 0.0005, // Min ATR to justify waiting (50 pips for forex)
      maxWaitHours: 4, // Max 4h wait for volatility pickup
      recheckIntervalMinutes: 15 // Recheck conditions every 15min
    },

    // Hard Block Conditions (Precheck Layer)
    hardBlocks: {
      maxTTFMinutes: 480, // 8h hard boundary
      minRequiredATR: 0.0003, // Min ATR to consider trade (30 pips)
      maxDistanceFromEntry: 3.0 // Max 3x ATR distance from current price
    }
  },

  // Monitoring & Validation
  monitoring: {
    logAllDecisions: true,
    trackConversionRates: true,
    alertOnAnomalies: true
  }
} as const;

export type VolatilityPatienceConfig = typeof VOLATILITY_PATIENCE_CONFIG;

export const getVolatilityPatienceConfig = () => VOLATILITY_PATIENCE_CONFIG;

/**
 * Execution Eligibility Gate (Legacy Stub)
 *
 * DEPRECATED: Eligibility checking is now handled by UnifiedRiskAuthority.
 * This stub exists only for backward compatibility with goal-session-live-engine.
 *
 * New eligibility logic is in:
 * - src/services/unified-risk-authority.ts (comprehensive risk assessment)
 * - src/services/alpha-trade-executor.ts (trade capacity checks)
 */

import type { TradingMode } from '../config/execution-eligibility';

export interface ExecutionEligibilityInput {
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  userId: string;
  accountBalance: number;
  baseRiskPercent: number;
  tradingMode?: TradingMode;
}

export interface ExecutionEligibilityResult {
  allowed: boolean;
  blockReason?: string;
  warnings: string[];
  styleTracking?: {
    alphaStyle: string;
    durationBand: string;
    expectedDurationHours: number;
    durationDeviation: number;
    confidencePenalty: number;
    durationPenaltyApplied: boolean;
    durationRewardApplied: boolean;
  };
}

class ExecutionEligibilityGate {
  /**
   * Evaluate trade eligibility (stub - always allows)
   * Real validation now happens in UnifiedRiskAuthority
   */
  evaluate(input: ExecutionEligibilityInput): ExecutionEligibilityResult {
    console.log('[ExecutionEligibilityGate] STUB: evaluate called (UnifiedRiskAuthority handles validation)');

    // Always allow - real validation in UnifiedRiskAuthority
    return {
      allowed: true,
      warnings: [],
      styleTracking: {
        alphaStyle: 'scalp', // Default
        durationBand: '< 4h',
        expectedDurationHours: 2,
        durationDeviation: 0,
        confidencePenalty: 0,
        durationPenaltyApplied: false,
        durationRewardApplied: false
      }
    };
  }

  /**
   * Format block message for user (stub)
   */
  formatBlockMessageForUser(result: ExecutionEligibilityResult): string {
    if (!result.blockReason) {
      return '';
    }
    return result.blockReason;
  }
}

export const executionEligibilityGate = new ExecutionEligibilityGate();

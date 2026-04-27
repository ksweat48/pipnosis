/**
 * Execution Style Resolver
 *
 * CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform.
 * Pipnosis is single-style — only MICRO_INTRADAY remains. This resolver returns
 * the unified MICRO_INTRADAY constraint profile regardless of input.
 *
 * GUIDING PRINCIPLE:
 * "Alpha decides direction and intent. The system defines the execution envelope."
 * All trades MUST close before market close. Maximum trade duration: 4 hours.
 */

import type { TradingMode } from '../config/execution-eligibility';
import { logger, LogCategory } from '../lib/logger';

// CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform.
export type TradeStyle = 'MICRO_INTRADAY';
export type RiskMode = 'LOW' | 'MEDIUM' | 'HIGH';

export interface StyleResolutionInput {
  requestedStyle: TradeStyle;
  riskMode?: RiskMode;
  atrPercent?: number;
  sessionType?: 'asian' | 'london' | 'nyse';
}

export interface StyleResolutionResult {
  executionMode: TradingMode; // Always INTRADAY for Pipnosis platform
  immutableStyle: TradeStyle; // ✅ IMMUTABLE: MICRO_INTRADAY (sole style)
  advisory?: string;
  constraintProfile: {
    isScalpOriented: boolean;
    sessionMultiplier: number;
    slAtrMultiplier: number;
  };
}

class ExecutionStyleResolver {
  /**
   * ✅ Single-style platform: returns MICRO_INTRADAY constraint profile.
   */
  resolve(input: StyleResolutionInput): StyleResolutionResult {
    const { requestedStyle, riskMode, atrPercent, sessionType } = input;

    logger.info(
      LogCategory.AI_TRADING,
      `[Style Resolver] ✅ Providing MICRO_INTRADAY constraints (requested: ${requestedStyle}, risk: ${riskMode || 'N/A'}, ATR: ${atrPercent ? (atrPercent * 100).toFixed(2) + '%' : 'N/A'})`
    );

    return {
      executionMode: 'INTRADAY',
      immutableStyle: 'MICRO_INTRADAY',
      advisory: 'MICRO_INTRADAY style: M5 execution. TP1 = fast scalp partial, TP2 = full intraday target.',
      constraintProfile: {
        isScalpOriented: false,
        sessionMultiplier: this.getSessionMultiplier(sessionType),
        slAtrMultiplier: 0.95
      }
    };
  }

  /**
   * Get session-specific time-to-fill multiplier (CCIP-2026-0427E-STYLE-CONSOLIDATION).
   */
  private getSessionMultiplier(
    sessionType: 'asian' | 'london' | 'nyse' | undefined
  ): number {
    if (!sessionType) return 1.0;

    const multipliers = {
      asian: 1.1,   // 10% more time allowed (lower volatility)
      london: 1.0,  // Standard
      nyse: 0.9     // 10% less time (more volatile, should fill faster)
    };

    return multipliers[sessionType];
  }

  /**
   * Format resolution for logging.
   */
  formatResolution(result: StyleResolutionResult): string {
    return `Alpha Style: ${result.immutableStyle} (IMMUTABLE) | Execution Mode: ${result.executionMode}`;
  }
}

export const executionStyleResolver = new ExecutionStyleResolver();

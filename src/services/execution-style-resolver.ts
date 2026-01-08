/**
 * Execution Style Resolver
 *
 * SINGLE SOURCE OF TRUTH for mapping Alpha's TradeStyle to execution TradingMode.
 *
 * AUTHORITY MODEL:
 * - Pipnosis is INTRADAY-ONLY platform - NO SWING TRADES
 * - SCALP maps to INTRADAY (fast, 20min-2hr duration)
 * - MICRO maps to INTRADAY (medium, 1hr-6hr duration)
 * - INTRADAY maps to INTRADAY (longer, 2hr-10hr duration)
 *
 * GUIDING PRINCIPLE:
 * All trades MUST close before market close
 * Maximum trade duration: 10 hours
 * NO multi-day positions allowed
 */

import type { TradingMode } from '../config/execution-eligibility';
import { logger, LogCategory } from '../lib/logger';

export type TradeStyle = 'SCALP' | 'MICRO' | 'INTRADAY';
export type RiskMode = 'LOW' | 'MEDIUM' | 'HIGH';

export interface StyleResolutionInput {
  requestedStyle: TradeStyle;
  riskMode?: RiskMode;
  atrPercent?: number;
  sessionType?: 'asian' | 'london' | 'nyse';
}

export interface StyleResolutionResult {
  executionMode: TradingMode;
  wasDowngraded: boolean;
  originalStyle: TradeStyle;
  advisory?: string;
  constraintProfile: {
    isScalpOriented: boolean;
    sessionMultiplier: number;
    slAtrMultiplier: number;
  };
}

class ExecutionStyleResolver {
  /**
   * Resolve Alpha's requested style to executable TradingMode
   */
  resolve(input: StyleResolutionInput): StyleResolutionResult {
    const { requestedStyle, riskMode, atrPercent, sessionType } = input;

    logger.info(
      LogCategory.AI_TRADING,
      `[Style Resolver] Resolving ${requestedStyle} (risk: ${riskMode || 'N/A'}, ATR: ${atrPercent ? (atrPercent * 100).toFixed(2) + '%' : 'N/A'})`
    );

    // SCALP: Fast intraday trades (20min-2hr)
    if (requestedStyle === 'SCALP') {
      logger.info(
        LogCategory.AI_TRADING,
        '[Style Resolver] SCALP → INTRADAY (fast, scalp-oriented constraints applied)'
      );

      return {
        executionMode: 'INTRADAY',
        wasDowngraded: false,
        originalStyle: 'SCALP',
        advisory: 'Scalp style: Fast intraday trades with tighter time-to-fill constraints',
        constraintProfile: {
          isScalpOriented: true,
          sessionMultiplier: this.getSessionMultiplier(sessionType, true),
          slAtrMultiplier: 0.85 // Slightly tighter SL caps for scalps
        }
      };
    }

    // MICRO: Medium duration intraday trades (1hr-6hr)
    if (requestedStyle === 'MICRO') {
      logger.info(
        LogCategory.AI_TRADING,
        '[Style Resolver] MICRO → INTRADAY (medium duration, balanced constraints)'
      );

      return {
        executionMode: 'INTRADAY',
        wasDowngraded: false,
        originalStyle: 'MICRO',
        advisory: 'Micro style: Medium duration intraday trades',
        constraintProfile: {
          isScalpOriented: false,
          sessionMultiplier: this.getSessionMultiplier(sessionType, false),
          slAtrMultiplier: 0.95 // Slightly tighter than full intraday
        }
      };
    }

    // INTRADAY: Longer duration intraday trades (2hr-10hr)
    logger.info(
      LogCategory.AI_TRADING,
      '[Style Resolver] INTRADAY → INTRADAY (longer duration, standard constraints)'
    );

    return {
      executionMode: 'INTRADAY',
      wasDowngraded: false,
      originalStyle: 'INTRADAY',
      advisory: 'Intraday style: Longer duration trades, closes before market close',
      constraintProfile: {
        isScalpOriented: false,
        sessionMultiplier: this.getSessionMultiplier(sessionType, false),
        slAtrMultiplier: 1.0
      }
    };
  }

  /**
   * Get session-specific time-to-fill multiplier
   * Asian: 10% more time (lower volatility)
   * London: Standard
   * NYSE: 10% less time (higher volatility)
   */
  private getSessionMultiplier(
    sessionType: 'asian' | 'london' | 'nyse' | undefined,
    isScalp: boolean
  ): number {
    if (!sessionType) return 1.0;

    // Scalps get tighter multipliers
    if (isScalp) {
      const scalpMultipliers = {
        asian: 0.8,  // Scalps need to be faster even in Asian
        london: 0.7,
        nyse: 0.6
      };
      return scalpMultipliers[sessionType];
    }

    // Standard intraday gets session-based tolerance
    const intradayMultipliers = {
      asian: 1.1,   // 10% more time allowed
      london: 1.0,  // Standard
      nyse: 0.9     // 10% less time (more volatile, should fill faster)
    };

    return intradayMultipliers[sessionType];
  }

  /**
   * Format resolution for logging
   */
  formatResolution(result: StyleResolutionResult): string {
    const downgradeNote = result.wasDowngraded
      ? ` (downgraded from ${result.originalStyle})`
      : '';

    const profileNote = result.constraintProfile.isScalpOriented
      ? ' with scalp-oriented constraints'
      : '';

    return `Execution Mode: ${result.executionMode}${downgradeNote}${profileNote}`;
  }
}

export const executionStyleResolver = new ExecutionStyleResolver();

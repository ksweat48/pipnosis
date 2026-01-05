/**
 * Execution Style Resolver
 *
 * SINGLE SOURCE OF TRUTH for mapping Alpha's TradeStyle to execution TradingMode.
 *
 * AUTHORITY MODEL:
 * - Pipnosis is intraday-only platform
 * - SCALP maps to INTRADAY (with tighter constraints)
 * - INTRADAY maps to INTRADAY (standard constraints)
 * - SWING is rejected (violates product philosophy)
 *
 * GUIDING PRINCIPLE:
 * Style downgrade is allowed (SCALP → INTRADAY)
 * Style promotion is forbidden (no swing trades)
 */

import type { TradingMode } from '../config/execution-eligibility';
import { logger, LogCategory } from '../lib/logger';

export type TradeStyle = 'SCALP' | 'INTRADAY' | 'SWING';
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

    // SWING is hard blocked - violates intraday-only philosophy
    if (requestedStyle === 'SWING') {
      logger.warn(
        LogCategory.AI_TRADING,
        '[Style Resolver] SWING style requested but Pipnosis is intraday-only. Rejecting.'
      );

      return {
        executionMode: 'INTRADAY',
        wasDowngraded: true,
        originalStyle: 'SWING',
        advisory: 'SWING trades are not supported. Pipnosis executes intraday trades only.',
        constraintProfile: {
          isScalpOriented: false,
          sessionMultiplier: 1.0,
          slAtrMultiplier: 1.0
        }
      };
    }

    // SCALP downgrades to INTRADAY (with tighter constraints)
    if (requestedStyle === 'SCALP') {
      logger.info(
        LogCategory.AI_TRADING,
        '[Style Resolver] SCALP → INTRADAY (scalp-oriented constraints applied)'
      );

      return {
        executionMode: 'INTRADAY',
        wasDowngraded: true,
        originalStyle: 'SCALP',
        advisory: 'Scalp style mapped to intraday execution with tighter time-to-fill constraints',
        constraintProfile: {
          isScalpOriented: true,
          sessionMultiplier: this.getSessionMultiplier(sessionType, true),
          slAtrMultiplier: 0.85 // Slightly tighter SL caps for scalps
        }
      };
    }

    // INTRADAY maps directly to INTRADAY
    logger.info(
      LogCategory.AI_TRADING,
      '[Style Resolver] INTRADAY → INTRADAY (standard constraints)'
    );

    return {
      executionMode: 'INTRADAY',
      wasDowngraded: false,
      originalStyle: 'INTRADAY',
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

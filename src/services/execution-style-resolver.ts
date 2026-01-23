/**
 * Execution Style Resolver
 *
 * ALPHA AUTHORITY MODEL (v3.0 - ADVISORY ONLY)
 * ============================================
 *
 * This resolver is now ADVISORY ONLY. It does NOT mutate Alpha's style decision.
 *
 * AUTHORITY MODEL:
 * - Alpha decides style based on execution mechanics (M5 swing, pip targets, etc.)
 * - Style is IMMUTABLE after Alpha decides
 * - This resolver only provides constraint profiles for execution
 * - Duration deviations apply confidence penalties, NOT style changes
 *
 * CONSTRAINT PROFILES (ADVISORY):
 * - SCALP: Fast intraday execution with tight constraints
 * - MICRO_INTRADAY: Medium duration with balanced constraints
 * - INTRADAY: Longer duration with standard constraints
 *
 * GUIDING PRINCIPLE:
 * "Alpha decides. Engines validate. Trades degrade intelligently — they do not silently mutate."
 * All trades MUST close before market close. Maximum trade duration: 10 hours.
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
  executionMode: TradingMode; // Always INTRADAY for Pipnosis platform
  immutableStyle: TradeStyle; // ✅ IMMUTABLE: Alpha's chosen style (never changes)
  advisory?: string;
  constraintProfile: {
    isScalpOriented: boolean;
    sessionMultiplier: number;
    slAtrMultiplier: number;
  };
}

class ExecutionStyleResolver {
  /**
   * ✅ ALPHA AUTHORITY MODEL: Provide constraint profile for Alpha's IMMUTABLE style
   * This method does NOT change the style - it only provides execution constraints
   */
  resolve(input: StyleResolutionInput): StyleResolutionResult {
    const { requestedStyle, riskMode, atrPercent, sessionType } = input;

    logger.info(
      LogCategory.AI_TRADING,
      `[Style Resolver] ✅ Providing constraints for Alpha's ${requestedStyle} style (risk: ${riskMode || 'N/A'}, ATR: ${atrPercent ? (atrPercent * 100).toFixed(2) + '%' : 'N/A'})`
    );

    // SCALP: Fast intraday trades with tight M5 execution
    if (requestedStyle === 'SCALP') {
      logger.info(
        LogCategory.AI_TRADING,
        '[Style Resolver] ✅ SCALP style retained - applying fast execution constraints (style IMMUTABLE)'
      );

      return {
        executionMode: 'INTRADAY', // Platform execution mode (all trades are intraday)
        immutableStyle: 'SCALP', // ✅ Alpha's style - NEVER CHANGES
        advisory: 'SCALP style: M5 execution targeting one swing leg. Duration may vary - penalties applied if extended.',
        constraintProfile: {
          isScalpOriented: true,
          sessionMultiplier: this.getSessionMultiplier(sessionType, true),
          slAtrMultiplier: 0.85 // Slightly tighter SL caps for scalps
        }
      };
    }

    // MICRO: Medium duration intraday trades
    if (requestedStyle === 'MICRO') {
      logger.info(
        LogCategory.AI_TRADING,
        '[Style Resolver] ✅ MICRO_INTRADAY style retained - applying balanced constraints (style IMMUTABLE)'
      );

      return {
        executionMode: 'INTRADAY',
        immutableStyle: 'MICRO',
        advisory: 'MICRO_INTRADAY style: Medium duration trades. Duration may vary - penalties applied if extended.',
        constraintProfile: {
          isScalpOriented: false,
          sessionMultiplier: this.getSessionMultiplier(sessionType, false),
          slAtrMultiplier: 0.95 // Slightly tighter than full intraday
        }
      };
    }

    // INTRADAY: Longer duration intraday trades
    logger.info(
      LogCategory.AI_TRADING,
      '[Style Resolver] ✅ INTRADAY style retained - applying standard constraints (style IMMUTABLE)'
    );

    return {
      executionMode: 'INTRADAY',
      immutableStyle: 'INTRADAY',
      advisory: 'INTRADAY style: Longer duration trades closing before market close. Duration may vary - penalties applied if extended.',
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
   * Format resolution for logging (ALPHA AUTHORITY MODEL)
   */
  formatResolution(result: StyleResolutionResult): string {
    const profileNote = result.constraintProfile.isScalpOriented
      ? ' with scalp-oriented constraints'
      : '';

    // ✅ ALPHA AUTHORITY MODEL: Style is immutable, never downgraded
    return `Alpha Style: ${result.immutableStyle} (IMMUTABLE) | Execution Mode: ${result.executionMode}${profileNote}`;
  }
}

export const executionStyleResolver = new ExecutionStyleResolver();

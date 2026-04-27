/**
 * Session Constraint Coordinator
 *
 * RESPONSIBILITY:
 * Provides session-related market observations for downstream consumers.
 * This is the SINGLE SOURCE OF TRUTH for session classification data.
 *
 * CCIP-2026-0329A — ALPHA SOVEREIGNTY ENFORCEMENT:
 * All session weight multipliers, confidence penalties, and penalty returns
 * have been removed from this module. Session timing is market data that
 * Alpha receives and interprets himself. No code may pre-score session
 * conditions as penalties or reductions to Alpha's confidence.
 *
 * PRINCIPLE:
 * - 24/7 markets (crypto) → No session concept applies
 * - Forex-hours markets → Session timing is an observable fact, not a gate
 * - Alpha knows what session he is in from the raw regime data
 * - Alpha decides whether that session timing affects his edge
 *
 * SSOT GUARANTEE:
 * If you add a new crypto symbol, update SYMBOL_REGISTRY with marketSchedule: '24/7'
 * and ALL session logic automatically adjusts. No code changes needed elsewhere.
 */

import { assetClassifier } from './asset-classifier';

export type SessionConstraintPolicy = 'ADVISORY' | 'NONE';

interface SessionWeightContext {
  symbol: string;
  hour: number;
  session: 'asian' | 'london' | 'ny' | 'dead';
}

class SessionConstraintCoordinator {
  /**
   * Get session constraint policy for a symbol and trade style.
   *
   * CCIP-2026-0329A: Returns NONE for 24/7 markets and ADVISORY for all
   * forex-hours markets. ADVISORY means Alpha receives session context as
   * information — it never blocks and carries no penalty arithmetic.
   */
  getSessionConstraintPolicy(
    symbol: string,
    _tradeStyle: string
  ): SessionConstraintPolicy {
    if (assetClassifier.is24HourMarket(symbol)) {
      return 'NONE';
    }
    return 'ADVISORY';
  }

  /**
   * Get session weight context for a symbol.
   *
   * CCIP-2026-0329A: Always returns 1.0. Session timing is not a confidence
   * multiplier. It is a raw market fact. Alpha observes session from the
   * regime snapshot and applies his own judgment.
   */
  getSessionWeight(_context: SessionWeightContext): number {
    return 1.0;
  }

  /**
   * Check if session weight should be applied to risk calculations.
   *
   * CCIP-2026-0329A: Always returns false. No session weight is applied.
   */
  shouldApplySessionWeight(_symbol: string): boolean {
    return false;
  }

  /**
   * Check if volatility multipliers should be applied based on session.
   *
   * CCIP-2026-0329A: Always returns false. Session does not modify volatility
   * multipliers in the system. Raw ATR measurements are passed to Alpha.
   */
  shouldApplySessionVolatilityMultiplier(_symbol: string): boolean {
    return false;
  }

  /**
   * Get session volatility multiplier for symbol.
   *
   * CCIP-2026-0329A: Always returns 1.0. No session-based multipliers.
   */
  getSessionVolatilityMultiplier(
    _symbol: string,
    _session: 'asian' | 'london' | 'ny' | 'overlap' | 'sydney' | 'dead'
  ): number {
    return 1.0;
  }

  /**
   * Check if the current hour falls in a low-liquidity window for forex pairs.
   *
   * CCIP-2026-0329A: This is a neutral factual observation surfaced to Alpha
   * as market context. It does not block trades or reduce confidence.
   * Alpha decides how to factor liquidity into his edge assessment.
   */
  isLowLiquidityWindow(symbol: string, hour: number): boolean {
    if (assetClassifier.is24HourMarket(symbol)) {
      return false;
    }
    return hour >= 21 || hour < 0;
  }

  /**
   * Calculate session penalty.
   *
   * CCIP-2026-0329A: Always returns 1.0 (no penalty). Session timing is
   * context Alpha receives, not a code-imposed confidence modifier.
   */
  calculateSessionPenalty(
    _symbol: string,
    // CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform.
    _tradeStyle: 'MICRO_INTRADAY',
    _sessionTimeRemainingMinutes: number,
    _estimatedDurationMinutes: number
  ): number {
    return 1.0;
  }

  /**
   * Helper: Format policy for logging
   */
  formatPolicy(policy: SessionConstraintPolicy): string {
    switch (policy) {
      case 'ADVISORY':
        return 'ADVISORY - Session data passed to Alpha as context';
      case 'NONE':
        return 'NONE - No session constraints (24/7 market)';
    }
  }
}

export const sessionConstraintCoordinator = new SessionConstraintCoordinator();

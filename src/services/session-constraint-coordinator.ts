/**
 * Session Constraint Coordinator - Business Logic Authority for Session Constraints
 *
 * RESPONSIBILITY:
 * Determines if and how session constraints apply to trades.
 * This is the SINGLE SOURCE OF TRUTH for all session-related trading decisions.
 *
 * AUTHORITY:
 * All session constraint logic MUST go through this coordinator.
 * Consumers NEVER make session decisions - they ALWAYS delegate.
 *
 * UPDATED PRINCIPLE (DE-PARALYZED ALPHA):
 * - 24/7 markets (crypto) → NO session constraints, EVER
 * - Forex-hours markets → Session constraints are ADVISORY ONLY (confidence penalties, never blocks)
 * - Trade style modifies PENALTY SEVERITY (SCALP = heavier penalty for overruns)
 * - Alpha ALWAYS has final authority to proceed despite session warnings
 *
 * CRITICAL CHANGE:
 * NO MORE 'ENFORCED' MODE. All session constraints are now advisory.
 * Session mismatches apply confidence penalties, never block trades.
 *
 * SSOT GUARANTEE:
 * If you add a new crypto symbol, update SYMBOL_REGISTRY with marketSchedule: '24/7'
 * and ALL session logic automatically adjusts. No code changes needed elsewhere.
 */

import { assetClassifier } from './asset-classifier';

// UPDATED: Removed 'ENFORCED' - all constraints are now ADVISORY or NONE
export type SessionConstraintPolicy = 'ADVISORY' | 'NONE';

interface SessionWeightContext {
  symbol: string;
  hour: number; // UTC hour (0-23)
  session: 'asian' | 'london' | 'ny' | 'dead';
}

class SessionConstraintCoordinator {
  /**
   * Get session constraint policy for a symbol and trade style
   *
   * This is the MASTER DECISION FUNCTION for session constraints.
   *
   * UPDATED (DE-PARALYZED ALPHA):
   * Returns:
   * - 'NONE': No session constraints apply (24/7 markets or SWING style)
   * - 'ADVISORY': Session constraints provide warnings and confidence penalties
   *               (SCALP/INTRADAY styles on forex-hours markets)
   *
   * CRITICAL: Never returns 'ENFORCED' anymore. All session constraints are advisory.
   * Style determines PENALTY SEVERITY, not whether to block.
   */
  getSessionConstraintPolicy(
    symbol: string,
    tradeStyle: 'MICRO_INTRADAY' | 'SCALP' | 'INTRADAY' | 'SWING'
  ): SessionConstraintPolicy {
    // 24/7 markets NEVER have session constraints, regardless of style
    if (assetClassifier.is24HourMarket(symbol)) {
      console.log(`[Session Constraints - ADVISORY] ${symbol}: NONE (24/7 market)`);
      return 'NONE';
    }

    // Forex-hours markets: policy depends on trade style
    switch (tradeStyle) {
      case 'MICRO_INTRADAY':
        // MICRO_INTRADAY: Very fast trades, ADVISORY with HEAVIEST penalties
        // Applies -20% confidence penalty if exceeds session (worse than SCALP)
        console.log(`[Session Constraints - ADVISORY] ${symbol}: ADVISORY (MICRO_INTRADAY - heaviest penalties for session overruns)`);
        return 'ADVISORY';

      case 'SCALP':
        // SCALP: Session constraints ADVISORY with HEAVIER penalties for overruns
        // Was ENFORCED - now applies -15% confidence penalty if exceeds session
        console.log(`[Session Constraints - ADVISORY] ${symbol}: ADVISORY (SCALP - heavier penalties for session overruns)`);
        return 'ADVISORY';

      case 'INTRADAY':
        // INTRADAY: Session constraints ADVISORY with LIGHTER penalties
        // Applies -5% confidence penalty for awareness only
        console.log(`[Session Constraints - ADVISORY] ${symbol}: ADVISORY (INTRADAY - light penalties for awareness)`);
        return 'ADVISORY';

      case 'SWING':
        // SWING: Session constraints NONE (multi-session trade by design)
        console.log(`[Session Constraints - ADVISORY] ${symbol}: NONE (SWING style - multi-session by design)`);
        return 'NONE';

      default:
        // Default to ADVISORY for unknown styles
        console.warn(`[Session Constraints - ADVISORY] Unknown trade style: ${tradeStyle}, defaulting to ADVISORY`);
        return 'ADVISORY';
    }
  }

  /**
   * Get symbol-specific session weight
   *
   * Returns 1.0 for 24/7 markets (no session penalty)
   * Returns symbol-specific weight for forex-hours markets
   *
   * Weight represents confidence/liquidity multiplier:
   * - 1.0 = Full confidence (active session)
   * - 0.85 = Slight reduction (less active but tradeable)
   * - 0.70 = Moderate reduction (lower liquidity)
   * - 0.55 = Heavy reduction (dead zone for this symbol)
   */
  getSessionWeight(context: SessionWeightContext): number {
    const { symbol, hour } = context;

    // 24/7 markets: Always return 1.0 (no session penalty)
    if (assetClassifier.is24HourMarket(symbol)) {
      return 1.0;
    }

    // Forex-hours markets: Symbol-specific session profiles
    return this.getSymbolSpecificSessionWeight(symbol, hour);
  }

  /**
   * Check if session weight should be applied to risk calculations
   *
   * Returns FALSE for 24/7 markets
   * Returns TRUE for forex-hours markets
   */
  shouldApplySessionWeight(symbol: string): boolean {
    return !assetClassifier.is24HourMarket(symbol);
  }

  /**
   * Check if volatility multipliers should be applied based on session
   *
   * Returns FALSE for 24/7 markets (no session-based volatility adjustment)
   * Returns TRUE for forex-hours markets (session affects volatility)
   */
  shouldApplySessionVolatilityMultiplier(symbol: string): boolean {
    return !assetClassifier.is24HourMarket(symbol);
  }

  /**
   * Get session volatility multiplier for symbol
   *
   * Returns 1.0 for 24/7 markets (constant volatility profile)
   * Returns session-specific multiplier for forex-hours markets
   */
  getSessionVolatilityMultiplier(
    symbol: string,
    session: 'asian' | 'london' | 'ny' | 'overlap' | 'sydney' | 'dead'
  ): number {
    // 24/7 markets: No session-based volatility adjustment
    if (assetClassifier.is24HourMarket(symbol)) {
      return 1.0;
    }

    // Forex-hours markets: Session affects volatility
    switch (session) {
      case 'london':
      case 'ny':
      case 'overlap':
        return 1.2; // Higher volatility during major sessions

      case 'asian':
      case 'sydney':
        return 0.8; // Lower volatility during Asian session

      case 'dead':
        return 0.6; // Lowest volatility during dead zone

      default:
        return 1.0;
    }
  }

  /**
   * PRIVATE: Symbol-specific session weight calculation
   *
   * Different symbols have different activity levels during various sessions.
   * This encapsulates the business logic for symbol-session interactions.
   */
  private getSymbolSpecificSessionWeight(symbol: string, hour: number): number {
    const normalizedSymbol = symbol.toUpperCase();

    switch (normalizedSymbol) {
      case 'EURUSD':
      case 'GBPUSD':
      case 'EURGBP':
        // European pairs - true dead zone during NY close
        if (hour >= 21 || hour < 0) return 0.55;  // 21:00-00:00 UTC: 45% reduction
        if (hour < 7) return 0.75;                 // 00:00-07:00 UTC (Asian): 25% reduction
        return 1.0;

      case 'XAUUSD':
        // Metals - semi-active in all sessions
        if (hour >= 21 || hour < 0) return 0.85;  // Still trades but lower liquidity
        return 1.0;

      case 'USDJPY':
      case 'AUDJPY':
      case 'EURJPY':
      case 'GBPJPY':
        // Japanese Yen pairs - ACTIVE after 23:00 UTC (Tokyo session starts)
        if (hour >= 23 || hour < 7) return 1.0;   // Tokyo active hours - NO penalty!
        return 0.9;                                // Slightly reduced outside Tokyo

      case 'AUDUSD':
      case 'NZDUSD':
      case 'EURAUD':
        // Oceanic pairs - active during Asian/Sydney session
        if (hour >= 22 || hour < 8) return 1.0;   // Sydney/Tokyo active
        if (hour >= 8 && hour < 16) return 0.95;  // London session - still active
        return 0.85;                               // NY session - reduced

      case 'US30':
      case 'NAS100':
      case 'SPX500':
        // US Indices - low volume after NY close
        if (hour >= 21 || hour < 1) return 0.70;  // 30% reduction
        return 1.0;

      case 'UK100':
      case 'GER40':
        // European indices - align with European hours
        if (hour >= 16 || hour < 8) return 0.70;  // Outside European hours
        return 1.0;

      case 'USOIL':
      case 'UKOIL':
        // Energy - active during major sessions
        if (hour >= 21 || hour < 1) return 0.75;  // Reduced after hours
        return 1.0;

      default:
        // Unknown symbol - apply moderate dead zone penalty
        console.warn(`[Session Constraints] Unknown symbol ${symbol} - applying default session weights`);
        if (hour >= 21 || hour < 0) return 0.70;
        return 1.0;
    }
  }

  /**
   * Helper: Format policy for logging
   *
   * UPDATED: ENFORCED mode removed - all constraints are advisory now
   */
  formatPolicy(policy: SessionConstraintPolicy): string {
    switch (policy) {
      case 'ADVISORY':
        return '🟡 ADVISORY - Confidence penalties apply, Alpha has final authority';
      case 'NONE':
        return '🟢 NONE - No session constraints';
    }
  }

  /**
   * Helper: Check if dead zone is active (forex-hours markets only)
   */
  isDeadZoneActive(symbol: string, hour: number): boolean {
    // 24/7 markets never have dead zones
    if (assetClassifier.is24HourMarket(symbol)) {
      return false;
    }

    // Forex-hours markets: 21:00-00:00 UTC is typically dead zone
    return hour >= 21 || hour < 0;
  }

  /**
   * Calculate session-based confidence penalty for a trade
   *
   * NEW METHOD for de-paralyzed Alpha system.
   * Replaces hard blocks with quantified confidence penalties.
   *
   * Returns:
   * - 1.0 = no penalty (within ideal session window)
   * - 0.95 = -5% penalty (INTRADAY session transition warning)
   * - 0.85 = -15% penalty (SCALP exceeds session window)
   *
   * @param symbol Trading symbol
   * @param tradeStyle SCALP/INTRADAY/SWING
   * @param sessionTimeRemainingMinutes Minutes left in current session
   * @param estimatedDurationMinutes Expected trade duration
   */
  calculateSessionPenalty(
    symbol: string,
    tradeStyle: 'SCALP' | 'INTRADAY' | 'SWING',
    sessionTimeRemainingMinutes: number,
    estimatedDurationMinutes: number
  ): number {
    // SWING trades ignore sessions completely
    if (tradeStyle === 'SWING') {
      return 1.0; // No penalty
    }

    // 24/7 markets never have session penalties
    if (assetClassifier.is24HourMarket(symbol)) {
      return 1.0; // No penalty
    }

    // Calculate if trade would exceed session window
    const wouldExceedSession = estimatedDurationMinutes > sessionTimeRemainingMinutes;

    if (!wouldExceedSession) {
      // Within session - small reward
      return 1.05; // +5% confidence reward for ideal timing
    }

    // Exceeds session - apply penalty based on style
    if (tradeStyle === 'SCALP') {
      // SCALP exceeding session is suboptimal but Alpha can still proceed
      console.log(`[Session Penalty] SCALP trade exceeds session by ${estimatedDurationMinutes - sessionTimeRemainingMinutes}min → -15% confidence penalty`);
      return 0.85; // -15% penalty
    }

    if (tradeStyle === 'INTRADAY') {
      // INTRADAY expected to possibly span sessions - light penalty for awareness
      console.log(`[Session Penalty] INTRADAY trade spans sessions → -5% confidence penalty (awareness only)`);
      return 0.95; // -5% penalty
    }

    return 1.0; // Default no penalty
  }
}

export const sessionConstraintCoordinator = new SessionConstraintCoordinator();

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
 * PRINCIPLE:
 * - 24/7 markets (crypto) → NO session constraints, EVER
 * - Forex-hours markets → Session constraints apply (symbol-specific weights)
 * - Trade style modifies how constraints apply (SCALP vs INTRADAY vs SWING)
 *
 * SSOT GUARANTEE:
 * If you add a new crypto symbol, update SYMBOL_REGISTRY with marketSchedule: '24/7'
 * and ALL session logic automatically adjusts. No code changes needed elsewhere.
 */

import { assetClassifier } from './asset-classifier';

export type SessionConstraintPolicy = 'ENFORCED' | 'ADVISORY' | 'NONE';

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
   * Returns:
   * - 'NONE': No session constraints apply (24/7 markets or SWING style)
   * - 'ADVISORY': Session constraints provide guidance (INTRADAY style)
   * - 'ENFORCED': Session constraints are hard limits (SCALP style on forex-hours markets)
   */
  getSessionConstraintPolicy(
    symbol: string,
    tradeStyle: 'SCALP' | 'INTRADAY' | 'SWING'
  ): SessionConstraintPolicy {
    // 24/7 markets NEVER have session constraints, regardless of style
    if (assetClassifier.is24HourMarket(symbol)) {
      console.log(`[Session Constraints] ${symbol}: NONE (24/7 market)`);
      return 'NONE';
    }

    // Forex-hours markets: policy depends on trade style
    switch (tradeStyle) {
      case 'SCALP':
        // SCALP: Session constraints ENFORCE (trade must complete in session)
        console.log(`[Session Constraints] ${symbol}: ENFORCED (SCALP on forex-hours market)`);
        return 'ENFORCED';

      case 'INTRADAY':
        // INTRADAY: Session constraints ADVISORY (trade may extend beyond session)
        console.log(`[Session Constraints] ${symbol}: ADVISORY (INTRADAY on forex-hours market)`);
        return 'ADVISORY';

      case 'SWING':
        // SWING: Session constraints NONE (multi-session trade)
        console.log(`[Session Constraints] ${symbol}: NONE (SWING style)`);
        return 'NONE';

      default:
        // Default to ADVISORY for unknown styles
        console.warn(`[Session Constraints] Unknown trade style: ${tradeStyle}, defaulting to ADVISORY`);
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
      case 'XAGUSD':
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
   */
  formatPolicy(policy: SessionConstraintPolicy): string {
    switch (policy) {
      case 'ENFORCED':
        return '🔴 ENFORCED - Hard session limits apply';
      case 'ADVISORY':
        return '🟡 ADVISORY - Session guidance only';
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
}

export const sessionConstraintCoordinator = new SessionConstraintCoordinator();

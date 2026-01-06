/**
 * Omega-7: Market Context Brain (Deterministic)
 *
 * Zero-cost market regime analyzer that provides sentiment-like context
 * by analyzing price action, volatility, and session timing.
 *
 * REPLACES: LLM-based sentiment analysis with external API calls
 * PROVIDES: Same AggregatedSentiment output format, but from pure price action
 *
 * Key Principle: Market regime is observable from ANY liquid instrument's
 * price action, volatility, and session timing. No external data required.
 */

import { regimeOracle, type RegimeSnapshot, type Candle, type MarketState } from '@/services/regime-oracle';

export interface MarketContextInput {
  symbol: string;
  candles: Candle[];
  marketState: MarketState;
  timestamp: Date;
}

export interface MarketContextOutput {
  sentiment: 'risk_on' | 'risk_off' | 'mixed';
  usd_strength: 'strong' | 'weak' | 'neutral';
  volatility: 'high' | 'medium' | 'low';
  bias: 'bullish' | 'bearish' | 'neutral';
  warnings: string[];
  confidence: number;
  summary: string;
  timestamp: Date;
  sources_used: string[];
}

class MarketContextBrain {
  /**
   * Evaluate market context from regime analysis (zero LLM calls)
   */
  evaluateContext(input: MarketContextInput): MarketContextOutput {
    const regime = regimeOracle.evaluate(
      input.marketState,
      input.timestamp,
      input.candles,
      input.symbol
    );

    const sentiment = this.deriveSentiment(regime);
    const usdStrength = this.deriveUSDStrength(regime, input.marketState);
    const volatility = this.deriveVolatility(regime);
    const bias = this.deriveBias(regime);
    const warnings = this.collectWarnings(regime);
    const confidence = this.calculateConfidence(regime);
    const summary = this.buildSummary(regime, sentiment, warnings);

    return {
      sentiment,
      usd_strength: usdStrength,
      volatility,
      bias,
      warnings,
      confidence,
      summary,
      timestamp: input.timestamp,
      sources_used: ['regime_oracle', 'volatility_engine', 'structure_analyzer']
    };
  }

  /**
   * Derive risk-on/risk-off sentiment from regime
   *
   * RISK-ON conditions:
   * - London/NY sessions (high liquidity)
   * - Clean trending structure
   * - Normal volatility (not extreme)
   * - Low wick risk
   *
   * RISK-OFF conditions:
   * - Dead zone (21:00-00:00 UTC)
   * - High wick risk (stop hunting)
   * - Extreme volatility
   * - Choppy structure
   */
  private deriveSentiment(regime: RegimeSnapshot): 'risk_on' | 'risk_off' | 'mixed' {
    let riskOnScore = 0;
    let riskOffScore = 0;

    if (regime.time_regime.is_london_session || regime.time_regime.is_ny_session) {
      riskOnScore += 2;
    }

    if (regime.time_regime.is_dead_zone) {
      riskOffScore += 3;
    }

    if (regime.trend_regime.structure_quality === 'clean') {
      riskOnScore += 1;
    } else if (regime.trend_regime.structure_quality === 'choppy') {
      riskOffScore += 1;
    }

    if (regime.volatility_regime.volatility_score >= 15 && regime.volatility_regime.volatility_score <= 75) {
      riskOnScore += 1;
    } else if (regime.volatility_regime.volatility_score < 15 || regime.volatility_regime.volatility_score > 90) {
      riskOffScore += 2;
    }

    if (regime.volatility_regime.wick_risk_level === 'high') {
      riskOffScore += 2;
    } else if (regime.volatility_regime.wick_risk_level === 'low') {
      riskOnScore += 1;
    }

    if (regime.trend_regime.trend_strength_score >= 50) {
      riskOnScore += 1;
    }

    if (regime.volatility_regime.atr_compression && regime.trend_regime.structure_type === 'range') {
      riskOffScore += 2;
    }

    if (riskOnScore > riskOffScore + 1) {
      return 'risk_on';
    } else if (riskOffScore > riskOnScore + 1) {
      return 'risk_off';
    } else {
      return 'mixed';
    }
  }

  /**
   * Derive USD strength from momentum and session context
   *
   * Strong USD indicators:
   * - Negative momentum in risk-on environments (flight to safety)
   * - London session with downward bias
   * - Risk-off conditions
   *
   * Weak USD indicators:
   * - Positive momentum in risk-on environments
   * - Upward bias across sessions
   */
  private deriveUSDStrength(regime: RegimeSnapshot, marketState: MarketState): 'strong' | 'weak' | 'neutral' {
    const momentum = marketState.momentum;
    const isRiskOff = regime.time_regime.is_dead_zone || regime.volatility_regime.wick_risk_level === 'high';

    if (isRiskOff && momentum < 0) {
      return 'strong';
    }

    if (regime.trend_regime.market_bias === 'bear' && regime.time_regime.is_london_session) {
      return 'strong';
    }

    if (regime.trend_regime.market_bias === 'bull' && !isRiskOff) {
      return 'weak';
    }

    if (momentum > 0.5) {
      return 'weak';
    } else if (momentum < -0.5) {
      return 'strong';
    }

    return 'neutral';
  }

  /**
   * Derive volatility classification from regime
   */
  private deriveVolatility(regime: RegimeSnapshot): 'high' | 'medium' | 'low' {
    const score = regime.volatility_regime.volatility_score;

    if (score >= 75 || regime.volatility_regime.atr_expansion) {
      return 'high';
    } else if (score <= 25 || regime.volatility_regime.atr_compression) {
      return 'low';
    } else {
      return 'medium';
    }
  }

  /**
   * Derive market bias from regime
   */
  private deriveBias(regime: RegimeSnapshot): 'bullish' | 'bearish' | 'neutral' {
    if (regime.trend_regime.market_bias === 'bull') {
      return 'bullish';
    } else if (regime.trend_regime.market_bias === 'bear') {
      return 'bearish';
    } else {
      return 'neutral';
    }
  }

  /**
   * Collect warnings from regime analysis
   */
  private collectWarnings(regime: RegimeSnapshot): string[] {
    const warnings: string[] = [];

    if (regime.time_regime.is_dead_zone) {
      warnings.push('dead_zone');
    }

    if (regime.volatility_regime.wick_risk_level === 'high') {
      warnings.push('high_wick_risk');
    }

    if (regime.volatility_regime.volatility_score > 90) {
      warnings.push('extreme_volatility');
    }

    if (regime.volatility_regime.volatility_score < 15) {
      warnings.push('dead_market');
    }

    if (regime.volatility_regime.atr_compression && regime.trend_regime.structure_type === 'range') {
      warnings.push('atr_compression_range');
    }

    if (regime.trend_regime.structure_quality === 'choppy') {
      warnings.push('choppy_structure');
    }

    if (regime.volatility_regime.spread_risk === 'high') {
      warnings.push('high_spread_risk');
    }

    if (regime.time_regime.is_session_overlap) {
      warnings.push('session_overlap');
    }

    return warnings;
  }

  /**
   * Calculate confidence based on regime quality
   *
   * High confidence:
   * - Clean structure
   * - Normal volatility
   * - Strong trend
   * - Active session
   *
   * Low confidence:
   * - Choppy structure
   * - Extreme volatility
   * - Ranging market
   * - Dead zone
   */
  private calculateConfidence(regime: RegimeSnapshot): number {
    let confidence = 50;

    if (regime.trend_regime.structure_quality === 'clean') {
      confidence += 15;
    } else if (regime.trend_regime.structure_quality === 'choppy') {
      confidence -= 15;
    }

    if (regime.trend_regime.trend_strength_score >= 60) {
      confidence += 10;
    } else if (regime.trend_regime.trend_strength_score <= 30) {
      confidence -= 10;
    }

    if (regime.volatility_regime.volatility_score >= 30 && regime.volatility_regime.volatility_score <= 70) {
      confidence += 10;
    } else if (regime.volatility_regime.volatility_score < 15 || regime.volatility_regime.volatility_score > 90) {
      confidence -= 20;
    }

    if (regime.time_regime.is_london_session || regime.time_regime.is_ny_session) {
      confidence += 10;
    } else if (regime.time_regime.is_dead_zone) {
      confidence -= 15;
    }

    if (regime.volatility_regime.wick_risk_level === 'low') {
      confidence += 5;
    } else if (regime.volatility_regime.wick_risk_level === 'high') {
      confidence -= 15;
    }

    if (regime.trend_regime.structure_type === 'range' && regime.volatility_regime.atr_compression) {
      confidence -= 10;
    }

    return Math.max(1, Math.min(100, confidence));
  }

  /**
   * Build human-readable summary
   */
  private buildSummary(regime: RegimeSnapshot, sentiment: string, warnings: string[]): string {
    const session = regime.time_regime.session.toUpperCase();
    const structure = regime.trend_regime.structure_type;
    const volatility = regime.volatility_regime.volatility_score;
    const trendStrength = regime.trend_regime.trend_strength_score;

    if (warnings.includes('dead_zone')) {
      return `${session} dead zone with ${structure} structure - low confidence conditions`;
    }

    if (warnings.includes('extreme_volatility')) {
      return `Extreme volatility (${volatility}%) during ${session} - high risk environment`;
    }

    if (warnings.includes('high_wick_risk')) {
      return `High wick risk detected in ${session} - stop hunting probable`;
    }

    if (sentiment === 'risk_on') {
      return `${session} session with clean ${structure} structure - optimal trading conditions`;
    }

    if (sentiment === 'risk_off') {
      return `${session} session with ${warnings[0] || 'suboptimal'} conditions - reduced confidence`;
    }

    return `${session} session with ${structure} structure (trend: ${trendStrength}%, vol: ${volatility}%)`;
  }
}

export const marketContextBrain = new MarketContextBrain();

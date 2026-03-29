/**
 * Omega-7: Market Context Brain (Deterministic)
 *
 * Zero-cost market regime analyzer that exposes raw regime observations
 * for downstream consumers. The raw RegimeSnapshot is the authoritative output.
 *
 * SSOT / CCIP CONTRACT (2026-02-24):
 * This service exposes raw regime measurements only.
 * Derived verdict fields (sentiment, usd_strength, volatility, bias) are
 * @deprecated — kept for backward compatibility with consumers that have not
 * yet been migrated. New consumers must read from regime_snapshot directly.
 * Alpha (coordinator-alpha.ts) must never inject these verdict labels into
 * LLM prompts — use raw regime_snapshot fields instead.
 *
 * Key Principle: Market regime is observable from ANY liquid instrument's
 * price action, volatility, and session timing. No external data required.
 *
 * CCIP-2026-0329A: Removed all numeric confidence penalties and biasing
 * summary language (dead zone, low confidence conditions, etc.).
 * Omega-7 reports raw regime observations only. Alpha is the sole authority
 * for interpreting these measurements into a trade decision. No pre-verdict,
 * no penalty arithmetic, no nudging language is permitted in this module.
 */

import { regimeOracle, type RegimeSnapshot, type Candle, type MarketState } from '@/services/regime-oracle';

export interface MarketContextInput {
  symbol: string;
  candles: Candle[];
  marketState: MarketState;
  timestamp: Date;
}

export interface MarketContextOutput {
  /** Raw regime snapshot - authoritative source. Prefer this over all derived fields. */
  regime_snapshot: RegimeSnapshot;
  /** @deprecated Use regime_snapshot.volatility_regime.volatility_score / session data instead */
  sentiment: 'risk_on' | 'risk_off' | 'mixed';
  /** @deprecated Use regime_snapshot.trend_regime.market_bias and session indicators instead */
  usd_strength: 'strong' | 'weak' | 'neutral';
  /** @deprecated Use regime_snapshot.volatility_regime.volatility_score instead */
  volatility: 'high' | 'medium' | 'low';
  /** @deprecated Use regime_snapshot.trend_regime.market_bias instead */
  bias: 'bullish' | 'bearish' | 'neutral';
  /** Raw observation keys from regime detection — neutral labels only, no trade recommendations */
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
    const warnings = this.collectObservations(regime);
    const confidence = this.calculateConfidence(regime);
    const summary = this.buildSummary(regime, sentiment);

    return {
      regime_snapshot: regime,
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
   * Derive risk-on/risk-off sentiment from regime.
   *
   * Reports the balance of observable conditions. No condition is treated
   * as a trade recommendation or penalty. Alpha reads this as one data point.
   */
  private deriveSentiment(regime: RegimeSnapshot): 'risk_on' | 'risk_off' | 'mixed' {
    let riskOnScore = 0;
    let riskOffScore = 0;

    if (regime.time_regime.is_london_session || regime.time_regime.is_ny_session) {
      riskOnScore += 2;
    }

    if (regime.trend_regime.structure_quality === 'clean') {
      riskOnScore += 1;
    } else if (regime.trend_regime.structure_quality === 'choppy') {
      riskOffScore += 1;
    }

    if (regime.volatility_regime.volatility_score >= 15 && regime.volatility_regime.volatility_score <= 75) {
      riskOnScore += 1;
    } else if (regime.volatility_regime.volatility_score < 15 || regime.volatility_regime.volatility_score > 90) {
      riskOffScore += 1;
    }

    if (regime.volatility_regime.wick_risk_level === 'high') {
      riskOffScore += 2;
    } else if (regime.volatility_regime.wick_risk_level === 'low') {
      riskOnScore += 1;
    }

    if (regime.trend_regime.trend_strength_score >= 50) {
      riskOnScore += 1;
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
   */
  private deriveUSDStrength(regime: RegimeSnapshot, marketState: MarketState): 'strong' | 'weak' | 'neutral' {
    const momentum = marketState.momentum;
    const isHighWickRisk = regime.volatility_regime.wick_risk_level === 'high';

    if (isHighWickRisk && momentum < 0) {
      return 'strong';
    }

    if (regime.trend_regime.market_bias === 'bear' && regime.time_regime.is_london_session) {
      return 'strong';
    }

    if (regime.trend_regime.market_bias === 'bull' && !isHighWickRisk) {
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
   * Collect raw regime observation keys.
   *
   * CCIP-2026-0329A: Keys are neutral descriptors of what the regime
   * detector observed. They carry no trade recommendation or penalty weight.
   * Alpha receives these as factual measurements to reason from.
   */
  private collectObservations(regime: RegimeSnapshot): string[] {
    const observations: string[] = [];

    if (regime.time_regime.is_dead_zone) {
      observations.push('low_liquidity_window');
    }

    if (regime.volatility_regime.wick_risk_level === 'high') {
      observations.push('high_wick_activity');
    }

    if (regime.volatility_regime.volatility_score > 90) {
      observations.push('elevated_volatility');
    }

    if (regime.volatility_regime.volatility_score < 15) {
      observations.push('compressed_volatility');
    }

    if (regime.volatility_regime.atr_compression && regime.trend_regime.structure_type === 'range') {
      observations.push('atr_compression_range');
    }

    if (regime.trend_regime.structure_quality === 'choppy') {
      observations.push('choppy_structure');
    }

    if (regime.volatility_regime.spread_risk === 'high') {
      observations.push('elevated_spread_risk');
    }

    if (regime.time_regime.is_session_overlap) {
      observations.push('session_overlap');
    }

    return observations;
  }

  /**
   * Calculate a neutral regime quality score.
   *
   * CCIP-2026-0329A: This value reflects market structure quality as a
   * raw measurement. It is NOT applied to Alpha's confidence. Alpha's
   * confidence is set solely by Alpha himself from the full market picture.
   * This score is surfaced as an informational field only.
   */
  private calculateConfidence(regime: RegimeSnapshot): number {
    let score = 50;

    if (regime.trend_regime.structure_quality === 'clean') {
      score += 10;
    } else if (regime.trend_regime.structure_quality === 'choppy') {
      score -= 10;
    }

    if (regime.trend_regime.trend_strength_score >= 60) {
      score += 10;
    } else if (regime.trend_regime.trend_strength_score <= 30) {
      score -= 5;
    }

    if (regime.volatility_regime.volatility_score >= 30 && regime.volatility_regime.volatility_score <= 70) {
      score += 5;
    }

    if (regime.time_regime.is_london_session || regime.time_regime.is_ny_session) {
      score += 5;
    }

    if (regime.volatility_regime.wick_risk_level === 'low') {
      score += 5;
    } else if (regime.volatility_regime.wick_risk_level === 'high') {
      score -= 5;
    }

    return Math.max(1, Math.min(100, score));
  }

  /**
   * Build neutral, factual summary.
   *
   * CCIP-2026-0329A: No trade-steering language. No "dead zone", "low confidence
   * conditions", "avoid", or "caution" labels. Alpha knows what session he is in
   * and what the structure looks like. Summary describes what the regime detector
   * measured — nothing more.
   */
  private buildSummary(regime: RegimeSnapshot, sentiment: string): string {
    const session = regime.time_regime.session.toUpperCase();
    const structure = regime.trend_regime.structure_type;
    const volatility = regime.volatility_regime.volatility_score;
    const trendStrength = regime.trend_regime.trend_strength_score;

    return `${session} session | ${structure} structure | trend: ${trendStrength}% | vol: ${volatility}% | sentiment: ${sentiment}`;
  }
}

export const marketContextBrain = new MarketContextBrain();

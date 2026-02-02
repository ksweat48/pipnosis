/**
 * Adversarial Detector - Stop Hunt & Manipulation Detection
 *
 * Detects hostile market behavior using ONLY local computations (no LLM calls).
 * Identifies stop runs, fake breakouts, whipsaws, and news spikes.
 *
 * UPDATED ROLE: Advisory-only system that applies confidence penalties.
 * NO LONGER BLOCKS TRADES - provides risk assessment for Alpha to consider.
 * Alpha has final authority to proceed despite adverse conditions if justified.
 */

import type { RegimeSnapshot } from './regime-oracle';
import { safeExtractATRValue, safeExtractATRTimeframe, type ATRValue } from '../types/atr';

/**
 * ✅ GOVERNANCE FIX (2026-02-02): SSOT for Manipulation Detection Thresholds
 *
 * These thresholds determine when volatility spikes are considered manipulation.
 * Defined as multiples of average candle range (ATR proxy).
 *
 * MANIPULATION_SPIKE_THRESHOLD: Standard manipulation detection (2.2x ATR)
 * EXTREME_MANIPULATION_THRESHOLD: Extreme/catastrophic volatility (4.0x ATR)
 *
 * RATIONALE:
 * - 2.2x catches most stop hunts and fake breakouts
 * - 4.0x reserved for truly extreme events (flash crashes, major news)
 */
const MANIPULATION_SPIKE_THRESHOLD = 2.2;
const EXTREME_MANIPULATION_THRESHOLD = 4.0;

export interface AdversarialSignal {
  is_adversarial: boolean;
  level: 'none' | 'mild' | 'moderate' | 'severe';
  suspicion_score: number; // 0-100
  patterns: string[]; // ["stop_run_high", "whipsaw_cluster"]
  recommended_action: 'normal' | 'reduce_size' | 'delay'; // REMOVED: 'avoid' - never blocks
  confidence_penalty?: number; // Penalty multiplier (0.75 = -25% confidence, 0.80 = -20%, etc.)
  notes: string; // short, 80 chars max
  stop_run_classification?: {
    type: 'active_stop_run' | 'historical_sweep' | 'manipulation_spike' | 'none';
    candles_ago: number; // How many candles ago the stop run occurred
    has_bos: boolean; // Break of structure after sweep
    should_block: boolean; // DEPRECATED: Always false - kept for backward compatibility
    requires_omega9_validation?: boolean; // If true, Omega-9 must validate before proceeding
    reasoning: string;
  };
}

export interface MarketState {
  price: number;
  ema20: number;
  ema50: number;
  ema200?: number;
  atr: number | ATRValue;
  rsi: number;
  vwap?: number;
  swingHigh?: number;
  swingLow?: number;
  spread?: number;
}

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  time?: number;
  open_time?: string | Date;
}

interface CandleAnalysis {
  wick_high: number;
  wick_low: number;
  body: number;
  direction: 'up' | 'down';
  range: number;
}

class AdversarialDetector {
  /**
   * Evaluate market for adversarial patterns
   * Returns adversarial signal with suspicion score and recommended action
   */
  evaluate(
    marketState: MarketState,
    recentCandles: Candle[],
    regime?: RegimeSnapshot
  ): AdversarialSignal {
    if (!recentCandles || recentCandles.length < 10) {
      return this.createCleanSignal();
    }

    // SSOT: Extract ATR value and validate timeframe if available
    const atrValue = safeExtractATRValue(marketState.atr, 'AdversarialDetector.evaluate');
    const atrTimeframe = safeExtractATRTimeframe(marketState.atr, 'AdversarialDetector.evaluate');

    if (atrTimeframe) {
      console.log(`[Adversarial] Using ${atrTimeframe} ATR: ${atrValue.toFixed(5)}`);
    }

    const normalizedState: MarketState & { atr: number } = {
      ...marketState,
      atr: atrValue
    };

    const patterns: string[] = [];
    let suspicion_score = 0;

    // Analyze recent candles for patterns
    const candleAnalyses = this.analyzeCandleSet(recentCandles);
    const avgCandleRange = this.calculateAverageCandleRange(recentCandles);

    // A) STOP RUN DETECTION
    const stopRunPatterns = this.detectStopRuns(
      recentCandles,
      candleAnalyses,
      normalizedState
    );
    patterns.push(...stopRunPatterns);
    suspicion_score += stopRunPatterns.length * 20;

    // B) FAKE BREAKOUT DETECTION
    const fakeBreakoutPatterns = this.detectFakeBreakouts(
      recentCandles,
      normalizedState
    );
    patterns.push(...fakeBreakoutPatterns);
    suspicion_score += fakeBreakoutPatterns.length * 20;

    // C) NEWS SPIKE DETECTION
    const spikePatterns = this.detectNewsSpikes(
      recentCandles,
      avgCandleRange
    );
    patterns.push(...spikePatterns);
    if (spikePatterns.includes('extreme_spike')) {
      suspicion_score += 35;
    } else if (spikePatterns.includes('news_spike')) {
      suspicion_score += 25;
    }

    // D) WHIPSAW CLUSTER DETECTION
    const whipsawDetected = this.detectWhipsawCluster(candleAnalyses);
    if (whipsawDetected) {
      patterns.push('whipsaw_cluster');
      suspicion_score += 20;
    }

    // E) SPREAD SPIKE DETECTION (if available)
    if (normalizedState.spread !== undefined) {
      const spreadAvg = normalizedState.atr * 0.1; // Estimate
      if (normalizedState.spread > spreadAvg * 2) {
        patterns.push('spread_spike');
        suspicion_score += 15;
      }
    }

    // F) REGIME-AWARE ENHANCEMENTS
    if (regime) {
      const regimeBonus = this.calculateRegimeBonus(patterns, regime);
      suspicion_score += regimeBonus;
    }

    // Clamp score to 0-100
    suspicion_score = Math.min(100, Math.max(0, suspicion_score));

    // G) REFINED STOP-RUN CLASSIFICATION
    const stopRunClassification = this.classifyStopRuns(
      patterns,
      recentCandles,
      candleAnalyses,
      normalizedState,
      avgCandleRange
    );

    // Classify level and determine action
    const level = this.classifyLevel(suspicion_score);
    const recommended_action = this.determineAction(level);
    const is_adversarial = level !== 'none';
    const notes = this.generateNotes(patterns, level);

    // Calculate confidence penalty based on stop run classification and level
    const confidence_penalty = this.calculateConfidencePenalty(
      stopRunClassification,
      level,
      patterns
    );

    console.log(`[Adversarial - ADVISORY] Score: ${suspicion_score}, Level: ${level}`);
    if (confidence_penalty && confidence_penalty < 1.0) {
      console.log(`[Adversarial - ADVISORY] Confidence Penalty: ${((1 - confidence_penalty) * 100).toFixed(0)}%`);
    }
    if (patterns.length > 0) {
      console.log(`[Adversarial - ADVISORY] Patterns: ${patterns.join(', ')}`);
    }

    // Log stop-run classification
    if (stopRunClassification.type !== 'none') {
      console.log(`[Adversarial - ADVISORY] Stop-Run: ${stopRunClassification.type} (${stopRunClassification.candles_ago} candles ago)`);
      console.log(`[Adversarial - ADVISORY] BOS: ${stopRunClassification.has_bos}, Requires Omega-9: ${stopRunClassification.requires_omega9_validation || false}`);
      console.log(`[Adversarial - ADVISORY] ${stopRunClassification.reasoning}`);
    }

    return {
      is_adversarial,
      level,
      suspicion_score,
      patterns,
      recommended_action,
      confidence_penalty,
      notes,
      stop_run_classification: stopRunClassification
    };
  }

  /**
   * Analyze a set of candles for basic metrics
   */
  private analyzeCandleSet(candles: Candle[]): CandleAnalysis[] {
    return candles.map(c => this.analyzeCandle(c));
  }

  /**
   * Analyze single candle
   */
  private analyzeCandle(candle: Candle): CandleAnalysis {
    const body = Math.abs(candle.close - candle.open);
    const maxOC = Math.max(candle.open, candle.close);
    const minOC = Math.min(candle.open, candle.close);
    const wick_high = candle.high - maxOC;
    const wick_low = minOC - candle.low;
    const direction = candle.close >= candle.open ? 'up' : 'down';
    const range = candle.high - candle.low;

    return { wick_high, wick_low, body, direction, range };
  }

  /**
   * Detect stop runs (long wicks rejecting back into range)
   */
  private detectStopRuns(
    candles: Candle[],
    analyses: CandleAnalysis[],
    marketState: MarketState
  ): string[] {
    const patterns: string[] = [];
    const recentCount = Math.min(20, candles.length);
    const recentCandles = candles.slice(-recentCount);
    const recentAnalyses = analyses.slice(-recentCount);

    for (let i = 1; i < recentCandles.length; i++) {
      const candle = recentCandles[i];
      const analysis = recentAnalyses[i];
      const prevCandle = recentCandles[i - 1];

      // Long upper wick (potential stop run high)
      const longUpperWick =
        analysis.wick_high > analysis.body * 2 &&
        analysis.wick_high > marketState.atr * 0.5;

      if (longUpperWick) {
        // Check if it rejected near resistance (swing high or recent high)
        const nearResistance = marketState.swingHigh
          ? Math.abs(candle.high - marketState.swingHigh) < marketState.atr * 0.3
          : false;

        // Check if closed back inside previous range
        const closedInsideRange =
          candle.close < Math.max(prevCandle.open, prevCandle.close);

        if (nearResistance || closedInsideRange) {
          patterns.push('stop_run_high');
        }
      }

      // Long lower wick (potential stop run low)
      const longLowerWick =
        analysis.wick_low > analysis.body * 2 &&
        analysis.wick_low > marketState.atr * 0.5;

      if (longLowerWick) {
        // Check if it rejected near support (swing low or recent low)
        const nearSupport = marketState.swingLow
          ? Math.abs(candle.low - marketState.swingLow) < marketState.atr * 0.3
          : false;

        // Check if closed back inside previous range
        const closedInsideRange =
          candle.close > Math.min(prevCandle.open, prevCandle.close);

        if (nearSupport || closedInsideRange) {
          patterns.push('stop_run_low');
        }
      }
    }

    // Remove duplicates
    return Array.from(new Set(patterns));
  }

  /**
   * Detect fake breakouts
   */
  private detectFakeBreakouts(
    candles: Candle[],
    marketState: MarketState
  ): string[] {
    const patterns: string[] = [];

    if (!marketState.swingHigh && !marketState.swingLow) {
      return patterns;
    }

    const recentCount = Math.min(10, candles.length);
    const recentCandles = candles.slice(-recentCount);

    for (let i = 1; i < recentCandles.length; i++) {
      const candle = recentCandles[i];
      const prevCandle = recentCandles[i - 1];

      // Fake breakout UP
      if (marketState.swingHigh) {
        const breakoutDistance = candle.high - marketState.swingHigh;
        const brokeAbove = breakoutDistance > marketState.atr * 0.2;
        const closedBelow = candle.close < marketState.swingHigh;

        if (brokeAbove && closedBelow) {
          patterns.push('fake_breakout_up');
        }
      }

      // Fake breakout DOWN
      if (marketState.swingLow) {
        const breakoutDistance = marketState.swingLow - candle.low;
        const brokeBelow = breakoutDistance > marketState.atr * 0.2;
        const closedAbove = candle.close > marketState.swingLow;

        if (brokeBelow && closedAbove) {
          patterns.push('fake_breakout_down');
        }
      }
    }

    // Remove duplicates
    return Array.from(new Set(patterns));
  }

  /**
   * Detect news spikes / extreme volatility candles
   */
  private detectNewsSpikes(
    candles: Candle[],
    avgCandleRange: number
  ): string[] {
    const patterns: string[] = [];

    if (candles.length < 2) {
      return patterns;
    }

    const lastCandle = candles[candles.length - 1];
    const lastRange = lastCandle.high - lastCandle.low;

    // News spike: 2.5x average range
    if (lastRange > avgCandleRange * 2.5) {
      patterns.push('news_spike');
    }

    // Extreme spike: 3.5x average range
    if (lastRange > avgCandleRange * 3.5) {
      patterns.push('extreme_spike');
    }

    return patterns;
  }

  /**
   * Detect whipsaw cluster (excessive direction changes)
   */
  private detectWhipsawCluster(analyses: CandleAnalysis[]): boolean {
    const recentCount = Math.min(10, analyses.length);
    const recentAnalyses = analyses.slice(-recentCount);

    let flips = 0;
    for (let i = 1; i < recentAnalyses.length; i++) {
      if (recentAnalyses[i].direction !== recentAnalyses[i - 1].direction) {
        flips++;
      }
    }

    // 7+ flips in 10 candles = whipsaw cluster
    return flips >= 7;
  }

  /**
   * Calculate average candle range
   */
  private calculateAverageCandleRange(candles: Candle[]): number {
    const count = Math.min(50, candles.length);
    const recentCandles = candles.slice(-count);

    const sum = recentCandles.reduce((acc, c) => acc + (c.high - c.low), 0);
    return sum / recentCandles.length;
  }

  /**
   * Calculate regime-based scoring bonus
   */
  private calculateRegimeBonus(
    patterns: string[],
    regime: RegimeSnapshot
  ): number {
    let bonus = 0;

    // High volatility bonus
    if (regime.volatility_score > 80) {
      bonus += 10;
    }

    // Session open + manipulation patterns
    const hasManipulation =
      patterns.some(p => p.includes('stop_run')) ||
      patterns.some(p => p.includes('fake_breakout')) ||
      patterns.some(p => p.includes('spike'));

    if (hasManipulation) {
      if (regime.session === 'ny_open' || regime.session_open) {
        bonus += 15;
      } else if (regime.session === 'london_open') {
        bonus += 10;
      }
    }

    // Range structure + stop runs
    if (regime.structure === 'range' && patterns.some(p => p.includes('stop_run'))) {
      bonus += 10;
    }

    return bonus;
  }

  /**
   * Classify suspicion level
   */
  private classifyLevel(score: number): 'none' | 'mild' | 'moderate' | 'severe' {
    if (score >= 70) return 'severe';
    if (score >= 40) return 'moderate';
    if (score >= 20) return 'mild';
    return 'none';
  }

  /**
   * Determine recommended action based on level
   */
  /**
   * Determine recommended action (ADVISORY ONLY - never blocks)
   *
   * UPDATED: No longer returns 'avoid'. All recommendations are advisory.
   * Alpha has final authority to proceed despite adverse conditions.
   */
  private determineAction(
    level: 'none' | 'mild' | 'moderate' | 'severe'
  ): 'normal' | 'reduce_size' | 'delay' {
    switch (level) {
      case 'severe':
        return 'delay'; // Was 'avoid' - now advisory delay with heavy penalty
      case 'moderate':
        return 'delay';
      case 'mild':
        return 'reduce_size';
      default:
        return 'normal';
    }
  }

  /**
   * Calculate confidence penalty based on adversarial patterns
   *
   * Returns a multiplier (0.65 = -35% confidence, 0.80 = -20%, 1.0 = no penalty)
   * This replaces hard blocks with quantified risk assessment.
   */
  private calculateConfidencePenalty(
    stopRunClassification: {
      type: 'active_stop_run' | 'historical_sweep' | 'manipulation_spike' | 'none';
      candles_ago: number;
      has_bos: boolean;
      should_block: boolean;
      requires_omega9_validation?: boolean;
      reasoning: string;
    },
    level: 'none' | 'mild' | 'moderate' | 'severe',
    patterns: string[]
  ): number {
    let penalty = 1.0; // Start with no penalty

    // Stop run classification penalties
    if (stopRunClassification.type === 'active_stop_run') {
      penalty = Math.min(penalty, 0.75); // -25% for active stop run
    } else if (stopRunClassification.type === 'manipulation_spike') {
      if (stopRunClassification.requires_omega9_validation) {
        if (stopRunClassification.candles_ago <= 1) {
          penalty = Math.min(penalty, 0.65); // -35% for extreme recent spike
        } else {
          penalty = Math.min(penalty, 0.80); // -20% for unstable spike
        }
      } else {
        penalty = Math.min(penalty, 0.90); // -10% for historical spike
      }
    }

    // General level-based penalties
    if (level === 'severe') {
      penalty = Math.min(penalty, 0.70); // At least -30% for severe conditions
    } else if (level === 'moderate') {
      penalty = Math.min(penalty, 0.85); // At least -15% for moderate conditions
    } else if (level === 'mild') {
      penalty = Math.min(penalty, 0.95); // At least -5% for mild conditions
    }

    // Additional pattern-based penalties
    if (patterns.includes('extreme_spike')) {
      penalty = Math.min(penalty, 0.75); // -25% for extreme spike
    }
    if (patterns.includes('whipsaw_cluster')) {
      penalty = Math.min(penalty, 0.85); // -15% for whipsaw
    }

    return penalty;
  }

  /**
   * Generate short diagnostic notes
   */
  private generateNotes(
    patterns: string[],
    level: 'none' | 'mild' | 'moderate' | 'severe'
  ): string {
    if (patterns.length === 0) {
      return 'Clean market conditions';
    }

    // Build concise summary
    const stopRuns = patterns.filter(p => p.includes('stop_run')).length;
    const fakeBreakouts = patterns.filter(p => p.includes('fake_breakout')).length;
    const hasWhipsaw = patterns.includes('whipsaw_cluster');
    const hasSpike = patterns.some(p => p.includes('spike'));
    const hasSpread = patterns.includes('spread_spike');

    const parts: string[] = [];

    if (stopRuns > 0) {
      parts.push(`${stopRuns} stop run${stopRuns > 1 ? 's' : ''}`);
    }
    if (fakeBreakouts > 0) {
      parts.push(`${fakeBreakouts} fakeout${fakeBreakouts > 1 ? 's' : ''}`);
    }
    if (hasWhipsaw) {
      parts.push('whipsaw');
    }
    if (hasSpike) {
      parts.push(patterns.includes('extreme_spike') ? 'extreme spike' : 'spike');
    }
    if (hasSpread) {
      parts.push('wide spread');
    }

    let notes = parts.join(', ');

    // Add level prefix for severe/moderate
    if (level === 'severe') {
      notes = 'HOSTILE: ' + notes;
    } else if (level === 'moderate') {
      notes = 'CAUTION: ' + notes;
    }

    // Truncate to 80 chars
    if (notes.length > 80) {
      notes = notes.substring(0, 77) + '...';
    }

    return notes;
  }

  /**
   * Classify stop-run patterns with refined logic
   */
  private classifyStopRuns(
    patterns: string[],
    candles: Candle[],
    analyses: CandleAnalysis[],
    marketState: MarketState,
    avgCandleRange: number
  ): {
    type: 'active_stop_run' | 'historical_sweep' | 'manipulation_spike' | 'none';
    candles_ago: number;
    has_bos: boolean;
    should_block: boolean;
    reasoning: string;
  } {
    // Check if any stop-run patterns exist
    const hasStopRun = patterns.some(p => p.includes('stop_run'));
    if (!hasStopRun) {
      return {
        type: 'none',
        candles_ago: 0,
        has_bos: false,
        should_block: false,
        reasoning: 'No stop-run patterns detected'
      };
    }

    // Find the most recent stop-run candle
    let stopRunCandleIndex = -1;
    const recentCount = Math.min(20, candles.length);
    const recentCandles = candles.slice(-recentCount);
    const recentAnalyses = analyses.slice(-recentCount);

    for (let i = recentCandles.length - 1; i >= 1; i--) {
      const analysis = recentAnalyses[i];

      // Check for long wick (ATR-relative)
      const hasLongUpperWick =
        analysis.wick_high > analysis.body * 2 &&
        analysis.wick_high > marketState.atr * 0.5;

      const hasLongLowerWick =
        analysis.wick_low > analysis.body * 2 &&
        analysis.wick_low > marketState.atr * 0.5;

      if (hasLongUpperWick || hasLongLowerWick) {
        stopRunCandleIndex = i;
        break;
      }
    }

    if (stopRunCandleIndex === -1) {
      return {
        type: 'none',
        candles_ago: 0,
        has_bos: false,
        should_block: false,
        reasoning: 'Stop-run pattern in history but not recent'
      };
    }

    const candlesAgo = recentCandles.length - 1 - stopRunCandleIndex;

    // A) Check for manipulation spike with TIME-BASED EXPIRATION
    // ✅ GOVERNANCE FIX (2026-02-02): Import from SSOT instead of hardcoded 2.2 and 4.0
    const stopRunCandle = recentCandles[stopRunCandleIndex];
    const stopRunRange = stopRunCandle.high - stopRunCandle.low;
    const spikeMultiplier = stopRunRange / avgCandleRange;
    const isManipulationSpike = spikeMultiplier > MANIPULATION_SPIKE_THRESHOLD;

    if (isManipulationSpike) {
      // CRITICAL FIX: Only block VERY recent AND severe spikes
      const isExtremeSpike = spikeMultiplier >= EXTREME_MANIPULATION_THRESHOLD;
      const isVeryRecentSpike = candlesAgo <= 1; // Very recent = within 1 candle (current candle only)
      const isAgedSpike = candlesAgo >= 5; // Aged = 5+ candles old (reduced from 10)

      // CONVERTED TO ADVISORY: Extreme spike = -35% confidence penalty + Omega-9 validation
      if (isVeryRecentSpike && isExtremeSpike) {
        console.warn(`[Adversarial] Extreme Manipulation Spike Detected (${spikeMultiplier.toFixed(1)}x, ${candlesAgo} candles ago) → -35% CONFIDENCE PENALTY + Omega-9 Validation Required`);
        return {
          type: 'manipulation_spike',
          candles_ago: candlesAgo,
          has_bos: false,
          should_block: false, // ADVISORY ONLY - Alpha has final authority
          requires_omega9_validation: true, // Require additional validation
          reasoning: `Extreme volatility spike (${spikeMultiplier.toFixed(1)}x ATR, ${candlesAgo} candles ago) - confidence reduced, requires Omega-9 validation`
        };
      }

      // Aged spikes (5+ candles): downgrade to Omega-9 validation instead of hard block
      if (isAgedSpike) {
        console.log(`[Adversarial] Aged manipulation spike (${spikeMultiplier.toFixed(1)}x, ${candlesAgo} candles ago) → needs Omega-9 validation`);
        return {
          type: 'manipulation_spike',
          candles_ago: candlesAgo,
          has_bos: false,
          should_block: false, // Let Omega-9 decide after sufficient time has passed
          reasoning: `Historical manipulation spike (${spikeMultiplier.toFixed(1)}x ATR, ${candlesAgo} candles ago) - requires additional validation`
        };
      }

      // Mid-range spikes (2-4 candles): check for market stabilization
      console.log(`[Adversarial] Mid-aged manipulation spike (${spikeMultiplier.toFixed(1)}x, ${candlesAgo} candles ago) → checking stabilization...`);
      const hasStabilized = this.checkMarketStabilization(recentCandles, stopRunCandleIndex, avgCandleRange);

      if (hasStabilized) {
        console.log('[Adversarial] Market has stabilized → ALLOW with Omega-9 validation');
        return {
          type: 'manipulation_spike',
          candles_ago: candlesAgo,
          has_bos: false,
          should_block: false,
          reasoning: `Manipulation spike stabilized (${spikeMultiplier.toFixed(1)}x ATR, ${candlesAgo} candles ago) - market normalized`
        };
      }

      console.warn(`[Adversarial] Manipulation spike still unstable → -20% CONFIDENCE PENALTY`);
      return {
        type: 'manipulation_spike',
        candles_ago: candlesAgo,
        has_bos: false,
        should_block: false, // ADVISORY ONLY - Alpha has final authority
        requires_omega9_validation: true, // Require stabilization check
        reasoning: `Manipulation spike (${spikeMultiplier.toFixed(1)}x ATR, ${candlesAgo} candles ago) - waiting for stabilization, confidence reduced`
      };
    }

    // B) CONVERTED TO ADVISORY: Active stop run = -25% confidence penalty (not block)
    if (candlesAgo <= 0) {
      console.warn('[Adversarial] Active Stop Run Detected → -25% CONFIDENCE PENALTY');
      return {
        type: 'active_stop_run',
        candles_ago: candlesAgo,
        has_bos: false,
        should_block: false, // ADVISORY ONLY - Alpha has final authority
        requires_omega9_validation: false, // Current candle, Alpha can decide
        reasoning: `Stop run occurring in current candle - confidence reduced but Alpha may proceed if setup justifies`
      };
    }

    // C) Historical sweep - check for Break of Structure (BOS)
    const hasBOS = this.checkBreakOfStructure(
      recentCandles,
      stopRunCandleIndex,
      marketState
    );

    if (hasBOS) {
      console.log('[Adversarial] Historical sweep detected, checking BOS...');
      console.log('[Adversarial] Sweep resolved, BOS confirmed → ALLOW');
      return {
        type: 'historical_sweep',
        candles_ago: candlesAgo,
        has_bos: true,
        should_block: false,
        reasoning: `Historical sweep with BOS - valid reversal setup`
      };
    }

    // D) Historical sweep without BOS - require Omega-9 validation
    console.log('[Adversarial] Historical sweep without BOS → needs Omega-9 approval');
    return {
      type: 'historical_sweep',
      candles_ago: candlesAgo,
      has_bos: false,
      should_block: false, // Let Omega-9 decide
      reasoning: `Historical sweep without clear BOS - requires additional validation`
    };
  }

  /**
   * Check if market has stabilized after a manipulation spike
   * Returns true if recent candles show normal volatility
   */
  private checkMarketStabilization(
    candles: Candle[],
    spikeIndex: number,
    avgCandleRange: number
  ): boolean {
    if (spikeIndex >= candles.length - 3) {
      return false; // Not enough candles after spike to assess stability
    }

    const candlesAfterSpike = candles.slice(spikeIndex + 1);

    // Check if all candles after spike are within normal range (< 1.5x ATR)
    const allNormalVolatility = candlesAfterSpike.every(c => {
      const range = c.high - c.low;
      return range < avgCandleRange * 1.5;
    });

    if (!allNormalVolatility) {
      return false;
    }

    // Check if there's no new extreme wicks in recent candles
    const recentCandles = candlesAfterSpike.slice(-3);
    const hasExtremeWicks = recentCandles.some(c => {
      const body = Math.abs(c.close - c.open);
      const maxOC = Math.max(c.open, c.close);
      const minOC = Math.min(c.open, c.close);
      const wickHigh = c.high - maxOC;
      const wickLow = minOC - c.low;

      return wickHigh > avgCandleRange * 0.8 || wickLow > avgCandleRange * 0.8;
    });

    return !hasExtremeWicks;
  }

  /**
   * Check for Break of Structure (BOS) after a stop run
   * BOS = price broke through a previous swing high/low, indicating trend shift
   */
  private checkBreakOfStructure(
    candles: Candle[],
    stopRunIndex: number,
    marketState: MarketState
  ): boolean {
    if (stopRunIndex >= candles.length - 2) {
      return false; // Not enough candles after stop run
    }

    const stopRunCandle = candles[stopRunIndex];
    const candlesAfter = candles.slice(stopRunIndex + 1);

    // Determine stop run direction
    const isUpperWick = (stopRunCandle.high - Math.max(stopRunCandle.open, stopRunCandle.close)) >
                        (Math.min(stopRunCandle.open, stopRunCandle.close) - stopRunCandle.low);

    if (isUpperWick) {
      // Stop run high → look for bearish BOS (break below structure)
      // Check if price closed below swing low after the stop run
      const hasBreakLow = candlesAfter.some(c =>
        c.close < stopRunCandle.low - marketState.atr * 0.3
      );
      return hasBreakLow;
    } else {
      // Stop run low → look for bullish BOS (break above structure)
      // Check if price closed above swing high after the stop run
      const hasBreakHigh = candlesAfter.some(c =>
        c.close > stopRunCandle.high + marketState.atr * 0.3
      );
      return hasBreakHigh;
    }
  }

  /**
   * Create clean signal (no adversarial patterns detected)
   */
  private createCleanSignal(): AdversarialSignal {
    return {
      is_adversarial: false,
      level: 'none',
      suspicion_score: 0,
      patterns: [],
      recommended_action: 'normal',
      notes: 'Clean market conditions',
      stop_run_classification: {
        type: 'none',
        candles_ago: 0,
        has_bos: false,
        should_block: false,
        reasoning: 'No stop-run patterns detected'
      }
    };
  }
}

export const adversarialDetector = new AdversarialDetector();

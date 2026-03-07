/**
 * Adversarial Detector - Stop Hunt & Manipulation Detection
 *
 * Detects hostile market behavior using ONLY local computations (no LLM calls).
 * Identifies stop runs, fake breakouts, whipsaws, and news spikes.
 *
 * SSOT / CCIP CONTRACT (2026-02-24):
 * This service outputs RAW OBSERVATIONS ONLY.
 * It does NOT compute level classifications, recommended actions, or advisory notes.
 * Alpha is the sole authority for interpreting raw scores into decisions.
 * Raw outputs: suspicion_score (0-100), patterns (string[]), stop_run_classification,
 * avg_candle_range, and whipsaw_flip_count.
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
 *
 * CCIP-2026-03-07: STOP_RUN_ACTIVE_WINDOW — candles within this window are
 * classified as active_stop_run; beyond this window → historical_sweep.
 * This prevents a single historical wick from being indefinitely mis-labelled
 * as an active threat, giving Alpha accurate recency context.
 */
const MANIPULATION_SPIKE_THRESHOLD = 2.2;
const EXTREME_MANIPULATION_THRESHOLD = 4.0;
const STOP_RUN_ACTIVE_WINDOW = 5; // candles — beyond this → historical_sweep

/**
 * Raw adversarial observation contract.
 * All fields are direct sensor observations — no verdicts, recommendations, or level labels.
 * Alpha is the sole authority for interpreting these raw measurements.
 */
export interface AdversarialSignal {
  is_adversarial: boolean;
  suspicion_score: number; // 0-100 raw accumulated score
  patterns: string[]; // ["stop_run_high", "whipsaw_cluster"] — observed pattern names
  avg_candle_range: number; // average candle range used for spike detection
  whipsaw_flip_count: number; // number of direction flips in last 10 candles
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
    const whipsawFlipCount = this.countWhipsawFlips(candleAnalyses);
    if (whipsawFlipCount >= 7) {
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

    const is_adversarial = suspicion_score >= 20;

    console.log(`[Adversarial - RAW] Score: ${suspicion_score}/100 | is_adversarial: ${is_adversarial}`);
    if (patterns.length > 0) {
      console.log(`[Adversarial - RAW] Patterns: ${patterns.join(', ')}`);
    }

    if (stopRunClassification.type !== 'none') {
      console.log(`[Adversarial - RAW] Stop-Run: ${stopRunClassification.type} (${stopRunClassification.candles_ago} candles ago)`);
      console.log(`[Adversarial - RAW] BOS: ${stopRunClassification.has_bos}, Requires Omega-9: ${stopRunClassification.requires_omega9_validation || false}`);
    }

    return {
      is_adversarial,
      suspicion_score,
      patterns,
      avg_candle_range: avgCandleRange,
      whipsaw_flip_count: whipsawFlipCount,
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
   *
   * CCIP-2026-03-07: Deduplication fix.
   * Previously this loop pushed stop_run_high once PER qualifying candle across
   * all 20 candles, causing suspicion_score to accumulate 20x for a single event.
   * Fix: scan newest-to-oldest, record the SINGLE most-recent qualifying event per
   * direction, then return at most one pattern per direction (two total maximum).
   * classifyStopRuns() continues to own recency/time-decay classification.
   */
  private detectStopRuns(
    candles: Candle[],
    analyses: CandleAnalysis[],
    marketState: MarketState
  ): string[] {
    const recentCount = Math.min(20, candles.length);
    const recentCandles = candles.slice(-recentCount);
    const recentAnalyses = analyses.slice(-recentCount);

    let foundHigh = false;
    let foundLow = false;

    // Scan newest-to-oldest so the first match is the most recent event
    for (let i = recentCandles.length - 1; i >= 1; i--) {
      if (foundHigh && foundLow) break; // both directions captured

      const candle = recentCandles[i];
      const analysis = recentAnalyses[i];
      const prevCandle = recentCandles[i - 1];

      if (!foundHigh) {
        const longUpperWick =
          analysis.wick_high > analysis.body * 2 &&
          analysis.wick_high > marketState.atr * 0.5;

        if (longUpperWick) {
          const nearResistance = marketState.swingHigh
            ? Math.abs(candle.high - marketState.swingHigh) < marketState.atr * 0.3
            : false;

          const closedInsideRange =
            candle.close < Math.max(prevCandle.open, prevCandle.close);

          if (nearResistance || closedInsideRange) {
            foundHigh = true;
          }
        }
      }

      if (!foundLow) {
        const longLowerWick =
          analysis.wick_low > analysis.body * 2 &&
          analysis.wick_low > marketState.atr * 0.5;

        if (longLowerWick) {
          const nearSupport = marketState.swingLow
            ? Math.abs(candle.low - marketState.swingLow) < marketState.atr * 0.3
            : false;

          const closedInsideRange =
            candle.close > Math.min(prevCandle.open, prevCandle.close);

          if (nearSupport || closedInsideRange) {
            foundLow = true;
          }
        }
      }
    }

    const patterns: string[] = [];
    if (foundHigh) patterns.push('stop_run_high');
    if (foundLow) patterns.push('stop_run_low');
    return patterns;
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
   * Count direction flip count in last 10 candles (raw measurement)
   */
  private countWhipsawFlips(analyses: CandleAnalysis[]): number {
    const recentCount = Math.min(10, analyses.length);
    const recentAnalyses = analyses.slice(-recentCount);

    let flips = 0;
    for (let i = 1; i < recentAnalyses.length; i++) {
      if (recentAnalyses[i].direction !== recentAnalyses[i - 1].direction) {
        flips++;
      }
    }

    return flips;
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

      // ADVISORY SIGNAL: Very recent extreme spike — surface for Alpha awareness
      if (isVeryRecentSpike && isExtremeSpike) {
        console.log(`[Adversarial - ADVISORY] Extreme volatility spike observed (${spikeMultiplier.toFixed(1)}x ATR, ${candlesAgo} candles ago) — Omega-9 validation flagged`);
        return {
          type: 'manipulation_spike',
          candles_ago: candlesAgo,
          has_bos: false,
          should_block: false, // ADVISORY ONLY - Alpha has final authority
          requires_omega9_validation: true,
          reasoning: `Extreme volatility spike (${spikeMultiplier.toFixed(1)}x ATR, ${candlesAgo} candles ago) — advisory signal for Alpha, Omega-9 validation recommended`
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

      console.log(`[Adversarial - ADVISORY] Manipulation spike still unstabilised (${spikeMultiplier.toFixed(1)}x ATR, ${candlesAgo} candles ago) — surfaced for Alpha awareness`);
      return {
        type: 'manipulation_spike',
        candles_ago: candlesAgo,
        has_bos: false,
        should_block: false, // ADVISORY ONLY - Alpha has final authority
        requires_omega9_validation: true,
        reasoning: `Manipulation spike (${spikeMultiplier.toFixed(1)}x ATR, ${candlesAgo} candles ago) — market still stabilising, advisory signal for Alpha`
      };
    }

    // B) ADVISORY SIGNAL: Active stop run within STOP_RUN_ACTIVE_WINDOW candles
    // CCIP-2026-03-07: Time-decay boundary — if the most recent stop run wick is
    // within STOP_RUN_ACTIVE_WINDOW candles it is labelled active_stop_run so Alpha
    // has accurate recency context. Beyond the window it falls through to
    // historical_sweep (section C/D below).
    if (candlesAgo <= STOP_RUN_ACTIVE_WINDOW) {
      console.log(`[Adversarial - ADVISORY] Stop run wick observed (${candlesAgo} candles ago, within active window of ${STOP_RUN_ACTIVE_WINDOW}) — surfaced for Alpha awareness`);
      return {
        type: 'active_stop_run',
        candles_ago: candlesAgo,
        has_bos: false,
        should_block: false, // ADVISORY ONLY - Alpha has final authority
        requires_omega9_validation: false,
        reasoning: `Stop run wick (${candlesAgo} candles ago) — within active window, advisory signal for Alpha`
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
      suspicion_score: 0,
      patterns: [],
      avg_candle_range: 0,
      whipsaw_flip_count: 0,
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

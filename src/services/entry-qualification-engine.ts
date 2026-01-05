/**
 * Entry Qualification Engine
 *
 * SINGLE SOURCE OF TRUTH for entry timing validation.
 *
 * RESPONSIBILITY:
 * Owns WHETHER and WHEN to enter a trade after Alpha signals direction/levels.
 *
 * SSOT COMPLIANCE:
 * - Entry timing quality: THIS SERVICE (NEW)
 * - Entry price monitoring: entry-execution-coordinator.ts
 * - Execution economics: execution-eligibility-gate.ts
 * - Strategy decision: coordinator-alpha.ts
 * - Risk boundaries: omega9-constraint-provider.ts
 *
 * PHILOSOPHY:
 * Alpha tells us WHAT to trade and WHERE (symbol, direction, levels).
 * Entry Qualification Engine tells us WHEN (timing quality, microstructure).
 * Execution Eligibility Gate tells us IF (economics, physics).
 *
 * FLOW INTEGRATION:
 * 1. Alpha decides: BUY/SELL EURUSD @ 1.0850, SL 1.0840, TP 1.0870
 * 2. Entry Qualification (THIS): Check M5 microstructure, momentum, confluence
 *    - ACCEPT_ENTRY → proceed to execution eligibility
 *    - WAIT_FOR_BETTER → create entry intent, monitor for improvement
 *    - REJECT_ENTRY → convert to NO_TRADE
 * 3. Execution Eligibility Gate: Check economics (spread, profit, time-to-fill)
 * 4. Execution: Enter trade or create entry intent
 *
 * HARD BLOCKS (non-negotiable):
 * - Wrong side of M5 VWAP (fade play only)
 * - M5 momentum against trade direction (no counter-trend)
 * - Price in no-trade zone (25-75% of range, choppy middle)
 * - Recent false breakout on M5 (< 3 candles ago)
 * - M5 volume dead (< 40% of 20-period average)
 *
 * ADVISORY CHECKS (recommend WAIT but allow override):
 * - Entry at M15 resistance/support instead of retracement
 * - M5 RSI extreme (> 75 or < 25)
 * - Multiple M5 timeframe confluence weak
 * - Spread elevated (> 1.5x 24h average)
 */

import { calculatePipDistance } from '../utils/currencyHelpers';
import { getSymbolConfig } from '../config/symbol-registry';
import { logger } from '../lib/logger';

export type EntryQualificationStatus =
  | 'ACCEPT_ENTRY'          // Good timing, execute immediately
  | 'WAIT_FOR_BETTER'       // Timing suboptimal, wait for improvement
  | 'REJECT_ENTRY';         // Timing poor, convert to NO_TRADE

export interface EntryQualificationInput {
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;

  // M5 microstructure data
  m5Candles: M5Candle[];
  m5VWAP: number;
  m5EMA20: number;
  m5RSI: number;
  m5VolumeAvg20: number;

  // M15 context (for confluence)
  m15Trend: 'bullish' | 'bearish' | 'sideways';
  m15SupportResistance?: {
    nearestSupport?: number;
    nearestResistance?: number;
  };

  // Market conditions
  currentSpreadPips: number;
  averageSpreadPips: number;
  atr: number;
}

export interface M5Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface EntryQualificationBlock {
  code: string;
  message: string;
  severity: 'HARD_BLOCK' | 'ADVISORY';
  suggestion: string;
}

export interface EntryQualificationResult {
  status: EntryQualificationStatus;
  blocks: EntryQualificationBlock[];
  advisories: EntryQualificationBlock[];
  qualityScore: number; // 0-100
  waitRecommendation?: {
    reason: string;
    estimatedImprovementMinutes: number;
    expectedQualityImprovement: number;
  };
  metrics: {
    vwapAlignment: boolean;
    momentumConfirmation: boolean;
    volumeConfirmation: boolean;
    rangePosition: 'top' | 'middle' | 'bottom';
    confluenceScore: number; // 0-100
    microstructureGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  };
}

class EntryQualificationEngine {
  /**
   * Evaluate entry timing quality
   * Returns qualification decision with detailed reasoning
   */
  evaluate(input: EntryQualificationInput): EntryQualificationResult {
    const blocks: EntryQualificationBlock[] = [];
    const advisories: EntryQualificationBlock[] = [];

    // Calculate metrics
    const metrics = this.calculateMetrics(input);

    // Run hard blocks
    this.checkVWAPAlignment(input, metrics, blocks);
    this.checkMomentumDirection(input, metrics, blocks);
    this.checkRangePosition(input, metrics, blocks);
    this.checkFalseBreakout(input, blocks);
    this.checkVolumeConfirmation(input, metrics, blocks);

    // If any hard blocks, REJECT immediately
    if (blocks.length > 0) {
      console.error('%c[ENTRY QUALIFICATION] REJECTED', 'color: #f44336; font-weight: bold; font-size: 14px');
      blocks.forEach(b => {
        console.error(`  ${b.code}: ${b.message}`);
        console.error(`    Suggestion: ${b.suggestion}`);
      });

      return {
        status: 'REJECT_ENTRY',
        blocks,
        advisories,
        qualityScore: this.calculateQualityScore(metrics, blocks, advisories),
        metrics
      };
    }

    // Run advisory checks
    this.checkStructureAlignment(input, metrics, advisories);
    this.checkRSIExtremes(input, metrics, advisories);
    this.checkConfluence(input, metrics, advisories);
    this.checkSpread(input, advisories);

    // Calculate quality score
    const qualityScore = this.calculateQualityScore(metrics, blocks, advisories);

    // Decision logic
    if (qualityScore >= 75) {
      // High quality entry - execute immediately
      console.log('%c[ENTRY QUALIFICATION] ACCEPTED (HIGH QUALITY)', 'color: #4caf50; font-weight: bold');
      console.log(`  Quality Score: ${qualityScore}/100 | Grade: ${metrics.microstructureGrade}`);
      console.log(`  VWAP: ${metrics.vwapAlignment ? '✓' : '✗'} | Momentum: ${metrics.momentumConfirmation ? '✓' : '✗'} | Volume: ${metrics.volumeConfirmation ? '✓' : '✗'}`);

      return {
        status: 'ACCEPT_ENTRY',
        blocks,
        advisories,
        qualityScore,
        metrics
      };
    } else if (qualityScore >= 50 && advisories.length === 0) {
      // Acceptable quality - execute
      console.log('%c[ENTRY QUALIFICATION] ACCEPTED (ACCEPTABLE)', 'color: #8bc34a; font-weight: bold');
      console.log(`  Quality Score: ${qualityScore}/100 | Grade: ${metrics.microstructureGrade}`);

      return {
        status: 'ACCEPT_ENTRY',
        blocks,
        advisories,
        qualityScore,
        metrics
      };
    } else if (qualityScore >= 40) {
      // Marginal quality - recommend wait
      console.log('%c[ENTRY QUALIFICATION] WAIT_FOR_BETTER', 'color: #ff9800; font-weight: bold');
      console.log(`  Quality Score: ${qualityScore}/100 | Advisories: ${advisories.length}`);

      const waitRecommendation = this.generateWaitRecommendation(input, metrics, advisories);

      return {
        status: 'WAIT_FOR_BETTER',
        blocks,
        advisories,
        qualityScore,
        waitRecommendation,
        metrics
      };
    } else {
      // Poor quality - reject
      console.error('%c[ENTRY QUALIFICATION] REJECTED (LOW QUALITY)', 'color: #f44336; font-weight: bold');
      console.error(`  Quality Score: ${qualityScore}/100 | Grade: ${metrics.microstructureGrade}`);

      return {
        status: 'REJECT_ENTRY',
        blocks,
        advisories,
        qualityScore,
        metrics
      };
    }
  }

  /**
   * Calculate all metrics upfront
   */
  private calculateMetrics(input: EntryQualificationInput): EntryQualificationResult['metrics'] {
    const { m5Candles, m5VWAP, m5EMA20, m5RSI, m5VolumeAvg20, entryPrice, direction } = input;

    // VWAP alignment
    const vwapAlignment = this.isVWAPAligned(entryPrice, m5VWAP, direction);

    // Momentum confirmation
    const momentumConfirmation = this.isMomentumConfirmed(m5Candles, direction);

    // Volume confirmation
    const currentVolume = m5Candles[m5Candles.length - 1]?.volume || 0;
    const volumeConfirmation = currentVolume >= (m5VolumeAvg20 * 0.4);

    // Range position
    const rangePosition = this.calculateRangePosition(m5Candles, entryPrice);

    // Confluence score
    const confluenceScore = this.calculateConfluenceScore(input);

    // Microstructure grade
    const microstructureGrade = this.calculateMicrostructureGrade(
      vwapAlignment,
      momentumConfirmation,
      volumeConfirmation,
      rangePosition,
      confluenceScore
    );

    return {
      vwapAlignment,
      momentumConfirmation,
      volumeConfirmation,
      rangePosition,
      confluenceScore,
      microstructureGrade
    };
  }

  /**
   * HARD BLOCK: Check VWAP alignment
   * Trades should enter on correct side of VWAP (with-trend)
   * Fading VWAP only allowed with explicit fade setup
   */
  private checkVWAPAlignment(
    input: EntryQualificationInput,
    metrics: EntryQualificationResult['metrics'],
    blocks: EntryQualificationBlock[]
  ): void {
    if (!metrics.vwapAlignment) {
      blocks.push({
        code: 'VWAP_FADE',
        message: `Entry on wrong side of M5 VWAP (${input.direction} but price ${input.entryPrice > input.m5VWAP ? 'above' : 'below'} VWAP ${input.m5VWAP.toFixed(5)})`,
        severity: 'HARD_BLOCK',
        suggestion: 'Wait for price to return to correct side of VWAP or cancel trade'
      });
    }
  }

  /**
   * HARD BLOCK: Check momentum direction
   * No counter-trend entries on M5
   */
  private checkMomentumDirection(
    input: EntryQualificationInput,
    metrics: EntryQualificationResult['metrics'],
    blocks: EntryQualificationBlock[]
  ): void {
    if (!metrics.momentumConfirmation) {
      blocks.push({
        code: 'MOMENTUM_AGAINST',
        message: `M5 momentum does not confirm ${input.direction} direction`,
        severity: 'HARD_BLOCK',
        suggestion: 'Wait for M5 momentum to align with trade direction'
      });
    }
  }

  /**
   * HARD BLOCK: Check range position
   * Avoid choppy middle (25-75% of range)
   */
  private checkRangePosition(
    input: EntryQualificationInput,
    metrics: EntryQualificationResult['metrics'],
    blocks: EntryQualificationBlock[]
  ): void {
    if (metrics.rangePosition === 'middle') {
      blocks.push({
        code: 'CHOPPY_MIDDLE',
        message: 'Entry in middle of M5 range (choppy zone, 25-75%)',
        severity: 'HARD_BLOCK',
        suggestion: 'Wait for price to reach range extreme (top/bottom 25%)'
      });
    }
  }

  /**
   * HARD BLOCK: Check for recent false breakout
   * If last 3 M5 candles showed false breakout, avoid entry
   */
  private checkFalseBreakout(
    input: EntryQualificationInput,
    blocks: EntryQualificationBlock[]
  ): void {
    const { m5Candles, direction } = input;
    const recent3 = m5Candles.slice(-3);

    if (recent3.length < 3) return;

    const hadFalseBreakout = this.detectFalseBreakout(recent3, direction);

    if (hadFalseBreakout) {
      blocks.push({
        code: 'RECENT_FALSE_BREAKOUT',
        message: 'Recent false breakout detected in last 3 M5 candles',
        severity: 'HARD_BLOCK',
        suggestion: 'Wait for clean price action to re-establish before entry'
      });
    }
  }

  /**
   * HARD BLOCK: Check volume confirmation
   * Volume must be at least 40% of 20-period average
   */
  private checkVolumeConfirmation(
    input: EntryQualificationInput,
    metrics: EntryQualificationResult['metrics'],
    blocks: EntryQualificationBlock[]
  ): void {
    if (!metrics.volumeConfirmation) {
      const currentVolume = input.m5Candles[input.m5Candles.length - 1]?.volume || 0;
      const volumePercent = (currentVolume / input.m5VolumeAvg20) * 100;

      blocks.push({
        code: 'VOLUME_DEAD',
        message: `M5 volume too low (${volumePercent.toFixed(0)}% of average, need 40%+)`,
        severity: 'HARD_BLOCK',
        suggestion: 'Wait for volume to pick up before entering'
      });
    }
  }

  /**
   * ADVISORY: Check structure alignment
   * Best entries at M15 support/resistance retests
   */
  private checkStructureAlignment(
    input: EntryQualificationInput,
    metrics: EntryQualificationResult['metrics'],
    advisories: EntryQualificationBlock[]
  ): void {
    if (!input.m15SupportResistance) return;

    const { nearestSupport, nearestResistance } = input.m15SupportResistance;
    const { entryPrice, direction } = input;

    // Check if entering at structure (good) or mid-range (advisory)
    const atSupport = nearestSupport && Math.abs(calculatePipDistance(input.symbol, entryPrice, nearestSupport)) < 5;
    const atResistance = nearestResistance && Math.abs(calculatePipDistance(input.symbol, entryPrice, nearestResistance)) < 5;

    const isAtStructure = (direction === 'BUY' && atSupport) || (direction === 'SELL' && atResistance);

    if (!isAtStructure) {
      advisories.push({
        code: 'STRUCTURE_MISALIGNMENT',
        message: 'Entry not at key M15 support/resistance level',
        severity: 'ADVISORY',
        suggestion: 'Consider waiting for retracement to M15 structure for better R:R'
      });
    }
  }

  /**
   * ADVISORY: Check RSI extremes
   * RSI > 75 or < 25 suggests potential reversal
   */
  private checkRSIExtremes(
    input: EntryQualificationInput,
    metrics: EntryQualificationResult['metrics'],
    advisories: EntryQualificationBlock[]
  ): void {
    const { m5RSI, direction } = input;

    if (direction === 'BUY' && m5RSI > 75) {
      advisories.push({
        code: 'RSI_OVERBOUGHT',
        message: `M5 RSI overbought (${m5RSI.toFixed(1)})`,
        severity: 'ADVISORY',
        suggestion: 'Consider waiting for RSI pullback before entering long'
      });
    } else if (direction === 'SELL' && m5RSI < 25) {
      advisories.push({
        code: 'RSI_OVERSOLD',
        message: `M5 RSI oversold (${m5RSI.toFixed(1)})`,
        severity: 'ADVISORY',
        suggestion: 'Consider waiting for RSI bounce before entering short'
      });
    }
  }

  /**
   * ADVISORY: Check confluence score
   * Warn if confluence is weak
   */
  private checkConfluence(
    input: EntryQualificationInput,
    metrics: EntryQualificationResult['metrics'],
    advisories: EntryQualificationBlock[]
  ): void {
    if (metrics.confluenceScore < 60) {
      advisories.push({
        code: 'WEAK_CONFLUENCE',
        message: `Multiple timeframe confluence weak (${metrics.confluenceScore}/100)`,
        severity: 'ADVISORY',
        suggestion: 'Wait for stronger M5/M15 alignment before entering'
      });
    }
  }

  /**
   * ADVISORY: Check spread conditions
   * Warn if spread elevated
   */
  private checkSpread(
    input: EntryQualificationInput,
    advisories: EntryQualificationBlock[]
  ): void {
    const { currentSpreadPips, averageSpreadPips } = input;
    const spreadRatio = currentSpreadPips / averageSpreadPips;

    if (spreadRatio > 1.5) {
      advisories.push({
        code: 'ELEVATED_SPREAD',
        message: `Spread elevated (${currentSpreadPips.toFixed(1)} pips vs ${averageSpreadPips.toFixed(1)} avg, ${spreadRatio.toFixed(1)}x)`,
        severity: 'ADVISORY',
        suggestion: 'Consider waiting for spread to normalize'
      });
    }
  }

  /**
   * Helper: Check if VWAP aligned with trade direction
   */
  private isVWAPAligned(entryPrice: number, vwap: number, direction: 'BUY' | 'SELL'): boolean {
    if (direction === 'BUY') {
      // For longs, price should be near or slightly above VWAP
      return entryPrice >= vwap * 0.9995; // Allow 0.05% below for pullback entries
    } else {
      // For shorts, price should be near or slightly below VWAP
      return entryPrice <= vwap * 1.0005; // Allow 0.05% above for pullback entries
    }
  }

  /**
   * Helper: Check if momentum confirmed
   */
  private isMomentumConfirmed(candles: M5Candle[], direction: 'BUY' | 'SELL'): boolean {
    if (candles.length < 3) return false;

    const last3 = candles.slice(-3);

    if (direction === 'BUY') {
      // For longs, last 2 of 3 candles should be bullish
      const bullishCount = last3.filter(c => c.close > c.open).length;
      return bullishCount >= 2;
    } else {
      // For shorts, last 2 of 3 candles should be bearish
      const bearishCount = last3.filter(c => c.close < c.open).length;
      return bearishCount >= 2;
    }
  }

  /**
   * Helper: Calculate range position
   */
  private calculateRangePosition(candles: M5Candle[], currentPrice: number): 'top' | 'middle' | 'bottom' {
    if (candles.length < 20) return 'middle';

    const recent20 = candles.slice(-20);
    const high = Math.max(...recent20.map(c => c.high));
    const low = Math.min(...recent20.map(c => c.low));
    const range = high - low;

    if (range === 0) return 'middle';

    const position = ((currentPrice - low) / range) * 100;

    if (position > 75) return 'top';
    if (position < 25) return 'bottom';
    return 'middle';
  }

  /**
   * Helper: Detect false breakout
   */
  private detectFalseBreakout(candles: M5Candle[], direction: 'BUY' | 'SELL'): boolean {
    if (candles.length < 3) return false;

    // Look for pattern: breakout candle followed by immediate reversal
    const [first, second, third] = candles;

    if (direction === 'BUY') {
      // False bullish breakout: strong up candle, then reversal down
      const firstBullish = first.close > first.open && (first.close - first.open) > (first.high - first.low) * 0.7;
      const thirdBearish = third.close < third.open && (third.open - third.close) > (third.high - third.low) * 0.7;
      return firstBullish && thirdBearish && third.close < first.open;
    } else {
      // False bearish breakout: strong down candle, then reversal up
      const firstBearish = first.close < first.open && (first.open - first.close) > (first.high - first.low) * 0.7;
      const thirdBullish = third.close > third.open && (third.close - third.open) > (third.high - third.low) * 0.7;
      return firstBearish && thirdBullish && third.close > first.open;
    }
  }

  /**
   * Helper: Calculate confluence score
   */
  private calculateConfluenceScore(input: EntryQualificationInput): number {
    let score = 0;

    // M5/M15 trend alignment (40 points)
    const m5Bullish = input.m5EMA20 < input.entryPrice;
    const m15Bullish = input.m15Trend === 'bullish';
    const trendsAlign = (m5Bullish && m15Bullish && input.direction === 'BUY') ||
                        (!m5Bullish && !m15Bullish && input.direction === 'SELL');
    if (trendsAlign) score += 40;

    // VWAP + EMA alignment (30 points)
    const vwapEMAAlign = (input.entryPrice > input.m5VWAP && input.entryPrice > input.m5EMA20 && input.direction === 'BUY') ||
                         (input.entryPrice < input.m5VWAP && input.entryPrice < input.m5EMA20 && input.direction === 'SELL');
    if (vwapEMAAlign) score += 30;

    // RSI alignment (30 points)
    const rsiAligned = (input.m5RSI > 50 && input.direction === 'BUY') ||
                       (input.m5RSI < 50 && input.direction === 'SELL');
    if (rsiAligned) score += 30;

    return score;
  }

  /**
   * Helper: Calculate microstructure grade
   */
  private calculateMicrostructureGrade(
    vwap: boolean,
    momentum: boolean,
    volume: boolean,
    range: 'top' | 'middle' | 'bottom',
    confluence: number
  ): 'A' | 'B' | 'C' | 'D' | 'F' {
    let points = 0;

    if (vwap) points += 25;
    if (momentum) points += 25;
    if (volume) points += 20;
    if (range !== 'middle') points += 15;
    points += (confluence / 100) * 15;

    if (points >= 85) return 'A';
    if (points >= 70) return 'B';
    if (points >= 55) return 'C';
    if (points >= 40) return 'D';
    return 'F';
  }

  /**
   * Helper: Calculate quality score
   */
  private calculateQualityScore(
    metrics: EntryQualificationResult['metrics'],
    blocks: EntryQualificationBlock[],
    advisories: EntryQualificationBlock[]
  ): number {
    let score = 100;

    // Hard blocks = immediate 0
    if (blocks.length > 0) return 0;

    // Deduct for missing core confirmations
    if (!metrics.vwapAlignment) score -= 25;
    if (!metrics.momentumConfirmation) score -= 25;
    if (!metrics.volumeConfirmation) score -= 20;
    if (metrics.rangePosition === 'middle') score -= 15;

    // Deduct for advisories
    score -= advisories.length * 5;

    // Add for confluence
    score += (metrics.confluenceScore / 100) * 15;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Generate wait recommendation
   */
  private generateWaitRecommendation(
    input: EntryQualificationInput,
    metrics: EntryQualificationResult['metrics'],
    advisories: EntryQualificationBlock[]
  ): EntryQualificationResult['waitRecommendation'] {
    const primaryIssue = advisories[0];

    let estimatedMinutes = 15; // Default wait time
    let expectedImprovement = 15; // Expected quality score improvement

    // Adjust based on primary issue
    if (primaryIssue?.code === 'RSI_OVERBOUGHT' || primaryIssue?.code === 'RSI_OVERSOLD') {
      estimatedMinutes = 10;
      expectedImprovement = 20;
    } else if (primaryIssue?.code === 'ELEVATED_SPREAD') {
      estimatedMinutes = 5;
      expectedImprovement = 10;
    } else if (primaryIssue?.code === 'WEAK_CONFLUENCE') {
      estimatedMinutes = 20;
      expectedImprovement = 25;
    }

    return {
      reason: primaryIssue?.message || 'Entry timing suboptimal',
      estimatedImprovementMinutes: estimatedMinutes,
      expectedQualityImprovement: expectedImprovement
    };
  }

  /**
   * Format result for user display
   */
  formatForUser(result: EntryQualificationResult): string {
    if (result.status === 'ACCEPT_ENTRY') {
      return `✅ Entry timing: ${result.metrics.microstructureGrade} grade (${result.qualityScore}/100)\n` +
             `M5 microstructure: ${result.metrics.vwapAlignment ? '✓' : '✗'} VWAP | ${result.metrics.momentumConfirmation ? '✓' : '✗'} Momentum | ${result.metrics.volumeConfirmation ? '✓' : '✗'} Volume`;
    }

    if (result.status === 'WAIT_FOR_BETTER' && result.waitRecommendation) {
      return `⏳ Entry timing suboptimal (${result.qualityScore}/100)\n` +
             `${result.waitRecommendation.reason}\n` +
             `Recommendation: Wait ${result.waitRecommendation.estimatedImprovementMinutes}min for better entry`;
    }

    if (result.status === 'REJECT_ENTRY' && result.blocks.length > 0) {
      const primaryBlock = result.blocks[0];
      return `❌ Entry rejected: ${primaryBlock.message}\n` +
             `${primaryBlock.suggestion}`;
    }

    return `Entry qualification: ${result.status} (${result.qualityScore}/100)`;
  }
}

export const entryQualificationEngine = new EntryQualificationEngine();

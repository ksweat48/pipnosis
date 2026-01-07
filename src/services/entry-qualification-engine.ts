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
import { VOLATILITY_PATIENCE_CONFIG } from '../config/volatility-aware-patience-config';
import type { ATRValue } from '../types/atr';

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
  /**
   * Average True Range with explicit timeframe tracking
   * Now uses typed ATRValue for SSOT compliance
   * See /src/types/atr.ts for details
   */
  atr: number | ATRValue; // Accept both during migration period
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

/**
 * Enhanced Entry Acceptance Interfaces (BOLT Implementation)
 */
export interface CandleAcceptanceResult {
  accepted: boolean;
  consecutiveCloses: number;
  bodyDominance: number; // 0-1
  closeQuality: 'excellent' | 'good' | 'poor';
  expansionDetected: boolean;
  details: string;
}

export interface PullbackQualityResult {
  grade: 'A' | 'B' | 'C';
  pullbackPercent: number;
  quality: 'shallow' | 'medium' | 'deep';
  score: number; // 0-100
  recommendation: string;
}

export interface CompressionExpansionResult {
  compressionDetected: boolean;
  compressionCandles: number;
  expansionFollows: boolean;
  qualityBonus: number; // 0-20 points
  pattern: string;
}

export interface FailedMoveResult {
  failedMoveDetected: boolean;
  failureType: 'false_breakout' | 'exhaustion' | 'rejection' | 'none';
  confirmationPresent: boolean;
  entryViable: boolean;
  details: string;
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
  // Enhanced acceptance metrics (BOLT)
  candleAcceptance?: CandleAcceptanceResult;
  pullbackQuality?: PullbackQualityResult;
  compressionExpansion?: CompressionExpansionResult;
  failedMove?: FailedMoveResult;
}

class EntryQualificationEngine {
  /**
   * Evaluate entry timing quality
   * Returns qualification decision with detailed reasoning
   *
   * UPDATED: Now includes enhanced BOLT entry acceptance logic
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

    // New stricter checks (Volatility-Aware Patience System)
    if (VOLATILITY_PATIENCE_CONFIG.eqe.chaseDetection.enabled) {
      this.checkChaseDetection(input, blocks);
    }
    if (VOLATILITY_PATIENCE_CONFIG.eqe.exhaustionDetection.enabled) {
      this.checkExhaustionDetection(input, blocks);
    }
    if (VOLATILITY_PATIENCE_CONFIG.eqe.vwapDistanceLimits.enabled) {
      this.checkVWAPDistanceLimits(input, blocks);
    }

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

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ENHANCED ENTRY ACCEPTANCE CHECKS (BOLT IMPLEMENTATION)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // A. Candle Acceptance Logic
    const candleAcceptance = this.checkCandleAcceptance(input.m5Candles, input.direction);
    logger.debug(`[EQE] Candle Acceptance: ${candleAcceptance.details}`);

    // B. Pullback Quality Grading
    const pullbackQuality = this.checkPullbackQuality(input.m5Candles, input.direction);
    logger.debug(`[EQE] Pullback Quality: Grade ${pullbackQuality.grade} (${pullbackQuality.pullbackPercent.toFixed(1)}%)`);

    // C. Compression & Expansion Detection
    const compressionExpansion = this.checkCompressionExpansion(input.m5Candles);
    logger.debug(`[EQE] Compression/Expansion: ${compressionExpansion.pattern}`);

    // D. Failed Move Confirmation
    const failedMove = this.checkFailedMove(input.m5Candles, input.direction);
    logger.debug(`[EQE] Failed Move: ${failedMove.details}`);

    // E. Confidence-Weighted Entry Aggression
    const confidenceAdjustment = this.applyConfidenceWeightedAggression(
      input.confidence,
      candleAcceptance
    );
    logger.debug(`[EQE] Confidence Aggression: ${confidenceAdjustment.aggressionLevel} (${confidenceAdjustment.recommendation})`);

    // Run advisory checks
    this.checkStructureAlignment(input, metrics, advisories);
    this.checkRSIExtremes(input, metrics, advisories);
    this.checkConfluence(input, metrics, advisories);
    this.checkSpread(input, advisories);

    // Calculate base quality score
    let qualityScore = this.calculateQualityScore(metrics, blocks, advisories);

    // Apply enhanced acceptance bonuses
    if (candleAcceptance.accepted) {
      qualityScore += 10;
      logger.debug('[EQE] +10 bonus: Candle acceptance confirmed');
    }

    if (pullbackQuality.grade === 'A') {
      qualityScore += pullbackQuality.score * 0.1; // +10 points for A grade
      logger.debug(`[EQE] +10 bonus: Grade A pullback (${pullbackQuality.pullbackPercent.toFixed(1)}%)`);
    } else if (pullbackQuality.grade === 'B') {
      qualityScore += pullbackQuality.score * 0.075; // +5.6 points for B grade
      logger.debug(`[EQE] +5.6 bonus: Grade B pullback (${pullbackQuality.pullbackPercent.toFixed(1)}%)`);
    }

    qualityScore += compressionExpansion.qualityBonus;
    if (compressionExpansion.qualityBonus > 0) {
      logger.debug(`[EQE] +${compressionExpansion.qualityBonus} bonus: Compression → Expansion pattern`);
    }

    if (failedMove.entryViable) {
      qualityScore += 15;
      logger.debug('[EQE] +15 bonus: Failed move confirmation present');
    }

    // Apply confidence-weighted aggression adjustment
    qualityScore += confidenceAdjustment.adjustedScore;
    logger.debug(`[EQE] ${confidenceAdjustment.adjustedScore >= 0 ? '+' : ''}${confidenceAdjustment.adjustedScore} adjustment: ${confidenceAdjustment.aggressionLevel} aggression`);

    // Cap quality score at 100
    qualityScore = Math.min(100, qualityScore);

    // Decision logic
    if (qualityScore >= 75) {
      // High quality entry - execute immediately
      console.log('%c[ENTRY QUALIFICATION] ACCEPTED (HIGH QUALITY)', 'color: #4caf50; font-weight: bold');
      console.log(`  Quality Score: ${qualityScore}/100 | Grade: ${metrics.microstructureGrade}`);
      console.log(`  VWAP: ${metrics.vwapAlignment ? '✓' : '✗'} | Momentum: ${metrics.momentumConfirmation ? '✓' : '✗'} | Volume: ${metrics.volumeConfirmation ? '✓' : '✗'}`);
      console.log(`  Candle Acceptance: ${candleAcceptance.accepted ? '✓' : '✗'} | Pullback: Grade ${pullbackQuality.grade}`);
      console.log(`  Aggression: ${confidenceAdjustment.aggressionLevel}`);

      return {
        status: 'ACCEPT_ENTRY',
        blocks,
        advisories,
        qualityScore,
        metrics,
        candleAcceptance,
        pullbackQuality,
        compressionExpansion,
        failedMove
      };
    } else if (qualityScore >= 50 && advisories.length === 0) {
      // Acceptable quality - execute
      console.log('%c[ENTRY QUALIFICATION] ACCEPTED (ACCEPTABLE)', 'color: #8bc34a; font-weight: bold');
      console.log(`  Quality Score: ${qualityScore}/100 | Grade: ${metrics.microstructureGrade}`);
      console.log(`  Pullback: Grade ${pullbackQuality.grade} | Aggression: ${confidenceAdjustment.aggressionLevel}`);

      return {
        status: 'ACCEPT_ENTRY',
        blocks,
        advisories,
        qualityScore,
        metrics,
        candleAcceptance,
        pullbackQuality,
        compressionExpansion,
        failedMove
      };
    } else if (qualityScore >= 40) {
      // Marginal quality - recommend wait
      console.log('%c[ENTRY QUALIFICATION] WAIT_FOR_BETTER', 'color: #ff9800; font-weight: bold');
      console.log(`  Quality Score: ${qualityScore}/100 | Advisories: ${advisories.length}`);
      console.log(`  ${confidenceAdjustment.recommendation}`);

      const waitRecommendation = this.generateWaitRecommendation(input, metrics, advisories);

      return {
        status: 'WAIT_FOR_BETTER',
        blocks,
        advisories,
        qualityScore,
        waitRecommendation,
        metrics,
        candleAcceptance,
        pullbackQuality,
        compressionExpansion,
        failedMove
      };
    } else {
      // Poor quality - reject
      console.error('%c[ENTRY QUALIFICATION] REJECTED (LOW QUALITY)', 'color: #f44336; font-weight: bold');
      console.error(`  Quality Score: ${qualityScore}/100 | Grade: ${metrics.microstructureGrade}`);
      console.error(`  Candle Acceptance: ${candleAcceptance.accepted ? '✓' : '✗'} (${candleAcceptance.details})`);

      return {
        status: 'REJECT_ENTRY',
        blocks,
        advisories,
        qualityScore,
        metrics,
        candleAcceptance,
        pullbackQuality,
        compressionExpansion,
        failedMove
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
   * NEW STRICTER CHECK: Chase Detection
   * Block entries after strong impulse moves (> 0.8x ATR)
   * Action: WAIT_FOR_PULLBACK
   */
  private checkChaseDetection(
    input: EntryQualificationInput,
    blocks: EntryQualificationBlock[]
  ): void {
    const config = VOLATILITY_PATIENCE_CONFIG.eqe.chaseDetection;
    const { m5Candles, atr: atrInput, direction } = input;

    if (m5Candles.length < config.lookbackCandles) return;

    // Extract ATR value (support both legacy number and typed ATRValue)
    const atr = typeof atrInput === 'number' ? atrInput : atrInput.value;
    const atrTimeframe = typeof atrInput === 'number' ? undefined : atrInput.timeframe;

    // Log timeframe for debugging
    if (atrTimeframe) {
      logger.debug(`[EQE] Chase detection using ${atrTimeframe} ATR: ${atr.toFixed(5)}`);
    } else {
      logger.warn('[EQE] Chase detection using legacy raw ATR - update caller to typed ATRValue');
    }

    const recentCandles = m5Candles.slice(-config.lookbackCandles);
    const totalMove = Math.abs(recentCandles[recentCandles.length - 1].close - recentCandles[0].open);
    const impulseMoveThreshold = atr * config.impulseMoveThreshold;

    const isImpulseMove = totalMove > impulseMoveThreshold;
    const moveWithDirection = (direction === 'BUY' && recentCandles[recentCandles.length - 1].close > recentCandles[0].open) ||
                               (direction === 'SELL' && recentCandles[recentCandles.length - 1].close < recentCandles[0].open);

    if (isImpulseMove && moveWithDirection) {
      blocks.push({
        code: 'CHASING_IMPULSE',
        message: `Chasing impulse move (${totalMove.toFixed(5)} over ${config.lookbackCandles} candles, ${(totalMove/atr).toFixed(2)}x ATR)`,
        severity: 'HARD_BLOCK',
        suggestion: `Wait for pullback to VWAP or support/resistance before entering. Action: ${config.action}`
      });
    }
  }

  /**
   * NEW STRICTER CHECK: Exhaustion Detection
   * Block entries on large-body candles closing near extremes
   * Action: WAIT_FOR_CONFIRMATION
   */
  private checkExhaustionDetection(
    input: EntryQualificationInput,
    blocks: EntryQualificationBlock[]
  ): void {
    const config = VOLATILITY_PATIENCE_CONFIG.eqe.exhaustionDetection;
    const { m5Candles, direction } = input;

    if (m5Candles.length === 0) return;

    const lastCandle = m5Candles[m5Candles.length - 1];
    const range = lastCandle.high - lastCandle.low;
    const body = Math.abs(lastCandle.close - lastCandle.open);

    if (range === 0) return;

    const bodyRatio = body / range;
    const isLargeBody = bodyRatio > config.largeBodyThreshold;

    let closeNearExtreme = false;
    if (direction === 'BUY') {
      const distanceFromHigh = (lastCandle.high - lastCandle.close) / range;
      closeNearExtreme = distanceFromHigh < config.closeNearExtremeThreshold;
    } else {
      const distanceFromLow = (lastCandle.close - lastCandle.low) / range;
      closeNearExtreme = distanceFromLow < config.closeNearExtremeThreshold;
    }

    if (isLargeBody && closeNearExtreme) {
      blocks.push({
        code: 'EXHAUSTION_CANDLE',
        message: `Exhaustion detected: Large body (${(bodyRatio*100).toFixed(0)}%) closing near ${direction === 'BUY' ? 'high' : 'low'}`,
        severity: 'HARD_BLOCK',
        suggestion: `Wait for confirmation candle before entering. Action: ${config.action}`
      });
    }
  }

  /**
   * NEW STRICTER CHECK: VWAP Distance Limits
   * Block entries too far from VWAP (> 1.2x ATR)
   * Action: WAIT_FOR_PULLBACK
   */
  private checkVWAPDistanceLimits(
    input: EntryQualificationInput,
    blocks: EntryQualificationBlock[]
  ): void {
    const config = VOLATILITY_PATIENCE_CONFIG.eqe.vwapDistanceLimits;
    const { entryPrice, m5VWAP, atr: atrInput } = input;

    // Extract ATR value (support both legacy number and typed ATRValue)
    const atr = typeof atrInput === 'number' ? atrInput : atrInput.value;
    const atrTimeframe = typeof atrInput === 'number' ? undefined : atrInput.timeframe;

    // Log timeframe for debugging
    if (atrTimeframe) {
      logger.debug(`[EQE] VWAP distance check using ${atrTimeframe} ATR: ${atr.toFixed(5)}`);
    }

    const distanceFromVWAP = Math.abs(entryPrice - m5VWAP);
    const maxAllowedDistance = atr * config.maxDistanceFromVWAP;

    if (distanceFromVWAP > maxAllowedDistance) {
      blocks.push({
        code: 'TOO_FAR_FROM_VWAP',
        message: `Entry too far from M5 VWAP (${distanceFromVWAP.toFixed(5)} vs max ${maxAllowedDistance.toFixed(5)}, ${(distanceFromVWAP/atr).toFixed(2)}x ATR)`,
        severity: 'HARD_BLOCK',
        suggestion: `Wait for price to return closer to VWAP before entering. Action: ${config.action}`
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

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * ENHANCED ENTRY ACCEPTANCE LOGIC (BOLT IMPLEMENTATION)
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   *
   * A. Candle Acceptance Logic
   * B. Pullback Quality Grading
   * C. Compression & Expansion Detection
   * D. Failed Move Confirmation
   * E. Confidence-Weighted Entry Aggression
   */

  /**
   * A. CANDLE ACCEPTANCE LOGIC (HIGH PRIORITY)
   *
   * Validates that the most recent candles show genuine acceptance
   * of the trade direction, not just weak attempts.
   *
   * REQUIREMENTS:
   * - ≥2 consecutive closes in trade direction
   * - Body dominance (body ≥60% of candle range)
   * - Closes near high (BUY) or low (SELL) - within 20% of extreme
   * - Range expansion OR controlled compression → expansion
   *
   * @param candles - Recent M5 candles (minimum 5)
   * @param direction - Trade direction (BUY/SELL)
   * @returns CandleAcceptanceResult with acceptance decision and quality metrics
   */
  checkCandleAcceptance(candles: M5Candle[], direction: 'BUY' | 'SELL'): CandleAcceptanceResult {
    if (candles.length < 2) {
      return {
        accepted: false,
        consecutiveCloses: 0,
        bodyDominance: 0,
        closeQuality: 'poor',
        expansionDetected: false,
        details: 'Insufficient candle data (need at least 2 candles)'
      };
    }

    const recentCandles = candles.slice(-5); // Last 5 candles
    let consecutiveCloses = 0;
    let totalBodyDominance = 0;
    let closeQualitySum = 0;

    // Check consecutive closes in direction
    for (let i = recentCandles.length - 1; i >= 0; i--) {
      const candle = recentCandles[i];
      const isDirectionalClose = direction === 'BUY'
        ? candle.close > candle.open
        : candle.close < candle.open;

      if (isDirectionalClose) {
        consecutiveCloses++;

        // Calculate body dominance
        const range = candle.high - candle.low;
        const body = Math.abs(candle.close - candle.open);
        const bodyDominance = range > 0 ? body / range : 0;
        totalBodyDominance += bodyDominance;

        // Calculate close quality (distance from extreme)
        let closeNearExtreme = 0;
        if (direction === 'BUY') {
          closeNearExtreme = (candle.close - candle.low) / range;
        } else {
          closeNearExtreme = (candle.high - candle.close) / range;
        }
        closeQualitySum += closeNearExtreme;
      } else {
        break; // Stop counting if streak breaks
      }
    }

    // Calculate averages
    const avgBodyDominance = consecutiveCloses > 0 ? totalBodyDominance / consecutiveCloses : 0;
    const avgCloseQuality = consecutiveCloses > 0 ? closeQualitySum / consecutiveCloses : 0;

    // Determine close quality grade
    let closeQuality: 'excellent' | 'good' | 'poor';
    if (avgCloseQuality >= 0.8) {
      closeQuality = 'excellent';
    } else if (avgCloseQuality >= 0.6) {
      closeQuality = 'good';
    } else {
      closeQuality = 'poor';
    }

    // Check for range expansion
    const expansionDetected = this.detectRangeExpansion(recentCandles);

    // Acceptance decision
    const accepted =
      consecutiveCloses >= 2 &&
      avgBodyDominance >= 0.6 &&
      avgCloseQuality >= 0.6;

    const details = `${consecutiveCloses} consecutive ${direction} closes | ` +
                   `Body: ${(avgBodyDominance * 100).toFixed(0)}% | ` +
                   `Close quality: ${closeQuality} (${(avgCloseQuality * 100).toFixed(0)}%) | ` +
                   `Expansion: ${expansionDetected ? 'Yes' : 'No'}`;

    return {
      accepted,
      consecutiveCloses,
      bodyDominance: avgBodyDominance,
      closeQuality,
      expansionDetected,
      details
    };
  }

  /**
   * B. PULLBACK QUALITY GRADING
   *
   * Grades the quality of a pullback relative to the prior impulse move.
   * Better pullbacks = better risk/reward entries.
   *
   * GRADING SCALE:
   * - Grade A: 30-50% pullback (shallow, ideal)
   * - Grade B: 50-70% pullback (medium, acceptable)
   * - Grade C: >70% pullback (deep, caution)
   *
   * @param candles - Recent M5 candles (minimum 10)
   * @param direction - Trade direction (BUY/SELL)
   * @returns PullbackQualityResult with grade and recommendation
   */
  checkPullbackQuality(candles: M5Candle[], direction: 'BUY' | 'SELL'): PullbackQualityResult {
    if (candles.length < 10) {
      return {
        grade: 'C',
        pullbackPercent: 0,
        quality: 'deep',
        score: 0,
        recommendation: 'Insufficient data to grade pullback quality'
      };
    }

    const recent10 = candles.slice(-10);

    // Find the impulse move (largest directional move in recent 10)
    let impulseStart = 0;
    let impulseEnd = 0;
    let maxImpulse = 0;

    for (let i = 0; i < recent10.length - 3; i++) {
      for (let j = i + 2; j < recent10.length; j++) {
        const move = direction === 'BUY'
          ? recent10[j].high - recent10[i].low
          : recent10[i].high - recent10[j].low;

        if (move > maxImpulse) {
          maxImpulse = move;
          impulseStart = i;
          impulseEnd = j;
        }
      }
    }

    // Calculate pullback from impulse high/low to current price
    const currentPrice = recent10[recent10.length - 1].close;
    let pullbackAmount = 0;

    if (direction === 'BUY') {
      const impulseHigh = recent10[impulseEnd].high;
      const impulseLow = recent10[impulseStart].low;
      pullbackAmount = impulseHigh - currentPrice;
      maxImpulse = impulseHigh - impulseLow;
    } else {
      const impulseLow = recent10[impulseEnd].low;
      const impulseHigh = recent10[impulseStart].high;
      pullbackAmount = currentPrice - impulseLow;
      maxImpulse = impulseHigh - impulseLow;
    }

    const pullbackPercent = maxImpulse > 0 ? (pullbackAmount / maxImpulse) * 100 : 0;

    // Grade the pullback
    let grade: 'A' | 'B' | 'C';
    let quality: 'shallow' | 'medium' | 'deep';
    let score: number;
    let recommendation: string;

    if (pullbackPercent <= 50 && pullbackPercent >= 30) {
      grade = 'A';
      quality = 'shallow';
      score = 100;
      recommendation = 'Excellent entry - shallow pullback with strong R:R';
    } else if (pullbackPercent <= 70) {
      grade = 'B';
      quality = 'medium';
      score = 75;
      recommendation = 'Good entry - medium pullback, acceptable R:R';
    } else {
      grade = 'C';
      quality = 'deep';
      score = 50;
      recommendation = 'Caution - deep pullback may indicate trend weakening';
    }

    return {
      grade,
      pullbackPercent,
      quality,
      score,
      recommendation
    };
  }

  /**
   * C. COMPRESSION & EXPANSION DETECTION
   *
   * Detects price compression followed by expansion, which often
   * indicates the start of a new directional move.
   *
   * PATTERN:
   * - Compression: 3+ consecutive narrow-range candles
   * - Expansion: Candle with range >1.5x average compression range
   *
   * Quality bonus: +20 points if pattern present
   *
   * @param candles - Recent M5 candles (minimum 5)
   * @returns CompressionExpansionResult with pattern details
   */
  checkCompressionExpansion(candles: M5Candle[]): CompressionExpansionResult {
    if (candles.length < 5) {
      return {
        compressionDetected: false,
        compressionCandles: 0,
        expansionFollows: false,
        qualityBonus: 0,
        pattern: 'Insufficient data for compression/expansion detection'
      };
    }

    const recent = candles.slice(-7); // Last 7 candles
    const ranges = recent.map(c => c.high - c.low);
    const avgRange = ranges.reduce((sum, r) => sum + r, 0) / ranges.length;

    // Detect compression phase (3+ narrow candles)
    let compressionStart = -1;
    let compressionCandles = 0;

    for (let i = 0; i < recent.length - 1; i++) {
      const range = ranges[i];
      const isNarrow = range < avgRange * 0.6; // Narrow = <60% of avg

      if (isNarrow) {
        if (compressionStart === -1) {
          compressionStart = i;
        }
        compressionCandles++;
      } else {
        if (compressionCandles >= 3) {
          break; // Found compression phase
        }
        compressionStart = -1;
        compressionCandles = 0;
      }
    }

    const compressionDetected = compressionCandles >= 3;

    // Check if expansion follows compression
    let expansionFollows = false;
    if (compressionDetected && compressionStart >= 0) {
      const compressionEndIndex = compressionStart + compressionCandles - 1;
      if (compressionEndIndex < recent.length - 1) {
        const nextCandle = recent[compressionEndIndex + 1];
        const nextRange = nextCandle.high - nextCandle.low;
        const compressionAvgRange = ranges.slice(compressionStart, compressionEndIndex + 1)
          .reduce((sum, r) => sum + r, 0) / compressionCandles;

        expansionFollows = nextRange > compressionAvgRange * 1.5;
      }
    }

    // Calculate quality bonus
    const qualityBonus = (compressionDetected && expansionFollows) ? 20 : 0;

    const pattern = compressionDetected
      ? `Compression (${compressionCandles} candles) ${expansionFollows ? '→ Expansion ✓' : 'detected'}`
      : 'No compression pattern detected';

    return {
      compressionDetected,
      compressionCandles,
      expansionFollows,
      qualityBonus,
      pattern
    };
  }

  /**
   * D. FAILED MOVE CONFIRMATION
   *
   * Detects failed directional attempts and confirms the counter-move
   * is valid for entry.
   *
   * FAILED MOVE TYPES:
   * - False breakout: Break above/below level, then immediate rejection
   * - Exhaustion: Large candle closes mid-range with no follow-through
   * - Rejection: Strong move hits resistance/support and reverses
   *
   * @param candles - Recent M5 candles (minimum 5)
   * @param direction - Trade direction (opposite of failed move)
   * @returns FailedMoveResult with failure details
   */
  checkFailedMove(candles: M5Candle[], direction: 'BUY' | 'SELL'): FailedMoveResult {
    if (candles.length < 5) {
      return {
        failedMoveDetected: false,
        failureType: 'none',
        confirmationPresent: false,
        entryViable: false,
        details: 'Insufficient data for failed move detection'
      };
    }

    const recent5 = candles.slice(-5);
    let failureType: 'false_breakout' | 'exhaustion' | 'rejection' | 'none' = 'none';
    let confirmationPresent = false;

    // Check for false breakout (already has method)
    const oppositeDirection = direction === 'BUY' ? 'SELL' : 'BUY';
    const falseBreakout = this.detectFalseBreakout(recent5.slice(-3), oppositeDirection);

    if (falseBreakout) {
      failureType = 'false_breakout';

      // Check for confirmation candle in our direction
      const lastCandle = recent5[recent5.length - 1];
      confirmationPresent = direction === 'BUY'
        ? lastCandle.close > lastCandle.open && (lastCandle.close - lastCandle.open) > (lastCandle.high - lastCandle.low) * 0.6
        : lastCandle.close < lastCandle.open && (lastCandle.open - lastCandle.close) > (lastCandle.high - lastCandle.low) * 0.6;
    }

    // Check for exhaustion
    if (!falseBreakout) {
      const prevCandle = recent5[recent5.length - 2];
      const range = prevCandle.high - prevCandle.low;
      const body = Math.abs(prevCandle.close - prevCandle.open);
      const bodyRatio = range > 0 ? body / range : 0;

      // Large body but closes in middle (not at extreme)
      if (bodyRatio > 0.7) {
        const closedNearMiddle = oppositeDirection === 'BUY'
          ? (prevCandle.high - prevCandle.close) / range > 0.3 && (prevCandle.high - prevCandle.close) / range < 0.7
          : (prevCandle.close - prevCandle.low) / range > 0.3 && (prevCandle.close - prevCandle.low) / range < 0.7;

        if (closedNearMiddle) {
          failureType = 'exhaustion';

          // Check current candle for reversal confirmation
          const lastCandle = recent5[recent5.length - 1];
          confirmationPresent = direction === 'BUY'
            ? lastCandle.close > prevCandle.close
            : lastCandle.close < prevCandle.close;
        }
      }
    }

    // Check for rejection at level
    if (failureType === 'none') {
      const last3 = recent5.slice(-3);
      const highestHigh = Math.max(...last3.map(c => c.high));
      const lowestLow = Math.min(...last3.map(c => c.low));
      const currentClose = last3[last3.length - 1].close;

      // Price tested extreme and rejected back
      if (oppositeDirection === 'BUY') {
        const testedHigh = last3.some(c => c.high === highestHigh);
        const rejectedDown = currentClose < highestHigh * 0.995;
        if (testedHigh && rejectedDown) {
          failureType = 'rejection';
          confirmationPresent = direction === 'SELL';
        }
      } else {
        const testedLow = last3.some(c => c.low === lowestLow);
        const rejectedUp = currentClose > lowestLow * 1.005;
        if (testedLow && rejectedUp) {
          failureType = 'rejection';
          confirmationPresent = direction === 'BUY';
        }
      }
    }

    const failedMoveDetected = failureType !== 'none';
    const entryViable = failedMoveDetected && confirmationPresent;

    const details = failedMoveDetected
      ? `${failureType.replace('_', ' ')} detected | Confirmation: ${confirmationPresent ? 'Yes ✓' : 'No'}`
      : 'No failed move pattern detected';

    return {
      failedMoveDetected,
      failureType,
      confirmationPresent,
      entryViable,
      details
    };
  }

  /**
   * E. CONFIDENCE-WEIGHTED ENTRY AGGRESSION
   *
   * Adjusts entry timing requirements based on Alpha's confidence level.
   * Higher confidence = more aggressive entry at first signal.
   * Lower confidence = wait for stronger confirmation.
   *
   * CONFIDENCE TIERS:
   * - High (85%+): Accept entry at first directional signal
   * - Medium (70-85%): Wait for 2nd confirmation candle
   * - Low (<70%): Wait for full retest or skip
   *
   * @param confidence - Alpha's confidence (0-100)
   * @param candleAcceptance - Candle acceptance result
   * @returns Adjusted quality score and recommendation
   */
  applyConfidenceWeightedAggression(
    confidence: number,
    candleAcceptance: CandleAcceptanceResult
  ): { adjustedScore: number; recommendation: string; aggressionLevel: 'aggressive' | 'moderate' | 'conservative' } {

    let aggressionLevel: 'aggressive' | 'moderate' | 'conservative';
    let scoreAdjustment = 0;
    let recommendation = '';

    if (confidence >= 85) {
      // High confidence - aggressive entry
      aggressionLevel = 'aggressive';

      if (candleAcceptance.consecutiveCloses >= 1) {
        scoreAdjustment = +15;
        recommendation = 'High confidence: Enter aggressively at first signal';
      } else {
        scoreAdjustment = +5;
        recommendation = 'High confidence: Accept entry despite weak confirmation';
      }
    } else if (confidence >= 70) {
      // Medium confidence - moderate entry
      aggressionLevel = 'moderate';

      if (candleAcceptance.consecutiveCloses >= 2) {
        scoreAdjustment = +10;
        recommendation = 'Medium confidence: Enter after 2nd confirmation';
      } else {
        scoreAdjustment = -10;
        recommendation = 'Medium confidence: Wait for 2nd confirmation candle';
      }
    } else {
      // Low confidence - conservative entry
      aggressionLevel = 'conservative';

      if (candleAcceptance.consecutiveCloses >= 2 && candleAcceptance.closeQuality === 'excellent') {
        scoreAdjustment = 0;
        recommendation = 'Low confidence: Requires full retest and excellent quality';
      } else {
        scoreAdjustment = -20;
        recommendation = 'Low confidence: Skip or wait for stronger confirmation';
      }
    }

    return {
      adjustedScore: scoreAdjustment,
      recommendation,
      aggressionLevel
    };
  }

  /**
   * Helper: Detect range expansion in recent candles
   */
  private detectRangeExpansion(candles: M5Candle[]): boolean {
    if (candles.length < 3) return false;

    const ranges = candles.map(c => c.high - c.low);
    const avgRange = ranges.slice(0, -1).reduce((sum, r) => sum + r, 0) / (ranges.length - 1);
    const lastRange = ranges[ranges.length - 1];

    return lastRange > avgRange * 1.3; // 30% larger than average
  }
}

export const entryQualificationEngine = new EntryQualificationEngine();

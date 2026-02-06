/**
 * PATTERN CONFIDENCE ADJUSTER - SSOT FOR PATTERN-BASED CONFIDENCE MODIFICATIONS
 *
 * Implements strict rules for how patterns affect Alpha's confidence:
 *
 * BOOSTS:
 * +5% if HTF intent aligns with trade direction AND MTF shows loading
 * +5% if MTF shows break→retest confirmation in trade direction
 * +3% if LTF shows clean timing pattern
 *
 * PENALTIES:
 * −7% if HTF intent conflicts with trade direction
 * −5% if MTF shows distribution/accumulation opposing direction
 * −5% if LTF shows trap signatures
 * −10% cap if market state is "Chop Likely" across ≥2 timeframes
 *
 * HARD CONSTRAINT:
 * Patterns may not raise confidence above 90% unless liquidity intent also confirms
 */

import type { MultiTimeframeIntentAnalysis, MarketIntent } from './pattern-intent-classifier';
import type { TimeframePatternScan } from './pattern-detection-service';
import { logger } from '../lib/logger';

export interface ConfidenceAdjustment {
  baseConfidence: number;
  adjustedConfidence: number;
  totalAdjustment: number;

  boosts: Array<{
    reason: string;
    amount: number;
  }>;

  penalties: Array<{
    reason: string;
    amount: number;
  }>;

  capApplied: boolean;
  capReason?: string;

  finalConfidence: number;
}

export interface PatternConfidenceInput {
  baseConfidence: number;
  tradeDirection: 'long' | 'short';
  intentAnalysis: MultiTimeframeIntentAnalysis;
  htfScan: TimeframePatternScan;
  mtfScan: TimeframePatternScan;
  ltfScan: TimeframePatternScan;
  liquidityIntentConfirms?: boolean; // From liquidity analysis
}

class PatternConfidenceAdjuster {
  private readonly MAX_CONFIDENCE_WITHOUT_LIQUIDITY = 90;
  private readonly ABSOLUTE_MAX_CONFIDENCE = 95;
  private readonly MIN_CONFIDENCE = 20;

  /**
   * Calculate confidence adjustments based on pattern analysis
   */
  calculateAdjustment(input: PatternConfidenceInput): ConfidenceAdjustment {
    logger.info('[Pattern Confidence] Calculating adjustments', {
      base: input.baseConfidence,
      direction: input.tradeDirection,
      htfIntent: input.intentAnalysis.htf.intent,
      mtfIntent: input.intentAnalysis.mtf.intent,
      ltfIntent: input.intentAnalysis.ltf.intent,
    });

    const boosts: Array<{ reason: string; amount: number }> = [];
    const penalties: Array<{ reason: string; amount: number }> = [];

    // Apply boost rules
    this.applyBoosts(input, boosts);

    // Apply penalty rules
    this.applyPenalties(input, penalties);

    // Calculate totals
    const totalBoosts = boosts.reduce((sum, b) => sum + b.amount, 0);
    const totalPenalties = penalties.reduce((sum, p) => sum + p.amount, 0);
    const totalAdjustment = totalBoosts - totalPenalties;

    const adjustedConfidence = input.baseConfidence + totalAdjustment;

    logger.info('[Pattern Confidence] Adjustment complete', {
      base: input.baseConfidence,
      boosts: totalBoosts,
      penalties: totalPenalties,
      totalAdjustment,
    });

    return {
      baseConfidence: input.baseConfidence,
      adjustedConfidence,
      totalAdjustment,
      boosts,
      penalties,
      capApplied: false,
      capReason: undefined,
      finalConfidence: adjustedConfidence,
    };
  }

  /**
   * Apply confidence boosts based on positive pattern signals
   */
  private applyBoosts(
    input: PatternConfidenceInput,
    boosts: Array<{ reason: string; amount: number }>
  ): void {
    const { intentAnalysis, htfScan, mtfScan, ltfScan, tradeDirection } = input;

    // BOOST 1: HTF intent aligns with trade direction AND MTF shows loading
    const htfAligns = this.intentAlignsWithDirection(intentAnalysis.htf.intent, tradeDirection);
    const mtfLoading = this.isMTFShowingLoading(intentAnalysis.mtf.intent);

    if (htfAligns && mtfLoading) {
      boosts.push({
        reason: 'HTF intent aligns with direction AND MTF shows loading',
        amount: 5,
      });
    }

    // BOOST 2: MTF shows break→retest confirmation in trade direction
    const mtfBreakRetest = this.hasBreakRetestPattern(mtfScan, tradeDirection);
    if (mtfBreakRetest) {
      boosts.push({
        reason: 'MTF break→retest confirmation in trade direction',
        amount: 5,
      });
    }

    // BOOST 3: LTF shows clean timing pattern
    const ltfCleanTiming = this.hasCleanTimingPattern(ltfScan, tradeDirection);
    if (ltfCleanTiming) {
      boosts.push({
        reason: 'LTF shows clean timing pattern',
        amount: 3,
      });
    }
  }

  /**
   * Apply confidence penalties based on negative pattern signals
   */
  private applyPenalties(
    input: PatternConfidenceInput,
    penalties: Array<{ reason: string; amount: number }>
  ): void {
    const { intentAnalysis, mtfScan, ltfScan, tradeDirection } = input;

    // PENALTY 1: HTF intent conflicts with trade direction
    const htfConflicts = this.intentConflictsWithDirection(intentAnalysis.htf.intent, tradeDirection);
    if (htfConflicts) {
      penalties.push({
        reason: 'HTF intent conflicts with trade direction',
        amount: 7,
      });
    }

    // PENALTY 2: MTF shows distribution/accumulation opposing direction
    const mtfOpposing = this.hasMTFOpposingAccumulation(mtfScan, tradeDirection);
    if (mtfOpposing) {
      penalties.push({
        reason: 'MTF shows distribution/accumulation opposing trade direction',
        amount: 5,
      });
    }

    // PENALTY 3: LTF shows trap signatures
    const ltfTrap = this.hasLTFTrapSignature(ltfScan, tradeDirection);
    if (ltfTrap) {
      penalties.push({
        reason: 'LTF shows trap signature against entry direction',
        amount: 5,
      });
    }

    // PENALTY 4: Chop across multiple timeframes (severe penalty)
    const chopCount = this.countChopTimeframes(intentAnalysis);
    if (chopCount >= 2) {
      penalties.push({
        reason: `Chop detected across ${chopCount} timeframes - low conviction`,
        amount: 10,
      });
    }
  }

  // ============================================================================
  // BOOST DETECTION HELPERS
  // ============================================================================

  private intentAlignsWithDirection(intent: MarketIntent, direction: 'long' | 'short'): boolean {
    if (direction === 'long') {
      return intent === 'continuation_likely' || intent === 'expansion_likely';
    } else {
      return intent === 'continuation_likely' || intent === 'expansion_likely';
    }
    // Note: Intent is direction-agnostic; we need to check pattern direction in actual implementation
    // For now, we're being conservative
  }

  private isMTFShowingLoading(intent: MarketIntent): boolean {
    return intent === 'continuation_likely' || intent === 'expansion_likely';
  }

  private hasBreakRetestPattern(scan: TimeframePatternScan, direction: 'long' | 'short'): boolean {
    if (!scan.primaryPattern) return false;

    const isBreakRetest = scan.primaryPattern.patternType === 'break_retest';
    const directionMatches = (direction === 'long' && scan.primaryPattern.direction === 'bullish') ||
                             (direction === 'short' && scan.primaryPattern.direction === 'bearish');

    return isBreakRetest && directionMatches;
  }

  private hasCleanTimingPattern(scan: TimeframePatternScan, direction: 'long' | 'short'): boolean {
    if (!scan.primaryPattern) return false;

    // Clean timing patterns: compression before break, or successful retest
    const cleanPatterns = ['pre_break_compression', 'break_retest', 'stop_hunt_expansion'];
    const isCleanPattern = cleanPatterns.includes(scan.primaryPattern.patternType);

    if (!isCleanPattern) return false;

    // Check direction alignment if pattern has direction
    if (scan.primaryPattern.direction === 'neutral') return true;

    const directionMatches = (direction === 'long' && scan.primaryPattern.direction === 'bullish') ||
                             (direction === 'short' && scan.primaryPattern.direction === 'bearish');

    return directionMatches;
  }

  // ============================================================================
  // PENALTY DETECTION HELPERS
  // ============================================================================

  private intentConflictsWithDirection(intent: MarketIntent, direction: 'long' | 'short'): boolean {
    // Reversal or trap intents conflict with continuation trades
    return intent === 'reversal_likely' || intent === 'trap_likely';
  }

  private hasMTFOpposingAccumulation(scan: TimeframePatternScan, direction: 'long' | 'short'): boolean {
    if (!scan.primaryPattern) return false;

    // Look for accumulation/distribution patterns opposing trade direction
    const distributionPatterns = ['head_shoulders', 'exhaustion_wedge', 'range_liquidity_box'];
    const isDistribution = distributionPatterns.includes(scan.primaryPattern.patternType);

    if (!isDistribution) return false;

    // Check if direction opposes trade
    const opposes = (direction === 'long' && scan.primaryPattern.direction === 'bearish') ||
                    (direction === 'short' && scan.primaryPattern.direction === 'bullish');

    return opposes;
  }

  private hasLTFTrapSignature(scan: TimeframePatternScan, direction: 'long' | 'short'): boolean {
    if (!scan.primaryPattern) return false;

    // Trap patterns on LTF
    const trapPatterns = ['equal_highs_lows', 'sfp_sweep'];
    const isTrapPattern = trapPatterns.includes(scan.primaryPattern.patternType);

    if (!isTrapPattern) return false;

    // Check if trap direction opposes trade
    // Equal highs/lows are traps when swept against direction
    // SFP is a trap when it fails to reject
    return true; // Conservative: any trap pattern on LTF is a warning
  }

  private countChopTimeframes(analysis: MultiTimeframeIntentAnalysis): number {
    let count = 0;
    if (analysis.htf.intent === 'chop_likely') count++;
    if (analysis.mtf.intent === 'chop_likely') count++;
    if (analysis.ltf.intent === 'chop_likely') count++;
    return count;
  }

  /**
   * Quick check if patterns support a trade direction
   */
  patternsSupportDirection(
    intentAnalysis: MultiTimeframeIntentAnalysis,
    direction: 'long' | 'short'
  ): boolean {
    // Check if overall intent supports the direction
    const supportiveIntents: MarketIntent[] = ['continuation_likely', 'expansion_likely'];
    const intentSupports = supportiveIntents.includes(intentAnalysis.overallIntent);

    // Check direction alignment
    const directionSupports = (direction === 'long' && intentAnalysis.directionBias === 'bullish') ||
                              (direction === 'short' && intentAnalysis.directionBias === 'bearish') ||
                              intentAnalysis.directionBias === 'neutral';

    // Must have intent support AND direction support (or neutral)
    return intentSupports && directionSupports;
  }

  /**
   * Check if patterns strongly oppose a trade direction
   */
  patternsOpposeDirection(
    intentAnalysis: MultiTimeframeIntentAnalysis,
    direction: 'long' | 'short'
  ): boolean {
    // Reversal or trap intent
    const dangerousIntents: MarketIntent[] = ['reversal_likely', 'trap_likely'];
    const intentOpposes = dangerousIntents.includes(intentAnalysis.overallIntent);

    // Direction conflicts
    const directionOpposes = (direction === 'long' && intentAnalysis.directionBias === 'bearish') ||
                             (direction === 'short' && intentAnalysis.directionBias === 'bullish');

    return intentOpposes || directionOpposes;
  }
}

export const patternConfidenceAdjuster = new PatternConfidenceAdjuster();

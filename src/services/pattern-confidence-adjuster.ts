/**
 * PATTERN CONFIDENCE ADJUSTER — SSOT FOR PATTERN OBSERVATION LABELS
 *
 * CCIP-2026-0330-PATTERN-SOVEREIGNTY:
 * This module is a PURE OBSERVATION LAYER. It detects pattern conditions and
 * returns structured observation labels for Alpha to reason about directly.
 *
 * GOVERNANCE LAW:
 * - NO arithmetic confidence adjustments are applied (no boosts, no penalties)
 * - ALL pattern observations are passed as labeled context strings
 * - Alpha reads pattern observations and self-weights conviction
 * - The coordinator attaches these labels to the briefing — they are inputs, not deductions
 *
 * Prior behaviour (REMOVED):
 * +5% HTF alignment boost, +5% break→retest boost, +3% LTF clean timing boost
 * −7% HTF conflict penalty, −5% MTF opposing penalty, −5% LTF trap penalty, −10% chop penalty
 * These were suppressing genuine 55% reads to 45% — directly causing the 24hr NO_TRADE failure mode.
 * All numeric amounts are now 0. The boosts and penalties arrays remain structurally intact
 * for downstream consumers (coordinator-alpha, omega-alpha-logger) that read the labels as
 * governance audit strings. The amounts are always 0 — they produce zero arithmetic effect.
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
  liquidityIntentConfirms?: boolean;
}

class PatternConfidenceAdjuster {

  /**
   * CCIP-2026-0330-PATTERN-SOVEREIGNTY:
   * Produces structured pattern observation labels only.
   * totalAdjustment is always 0. adjustedConfidence === baseConfidence.
   * All boosts and penalties carry amount: 0 — they are audit labels, not arithmetic.
   */
  calculateAdjustment(input: PatternConfidenceInput): ConfidenceAdjustment {
    logger.info('[Pattern Confidence] Collecting pattern observations (labels-only, zero arithmetic)', {
      base: input.baseConfidence,
      direction: input.tradeDirection,
      htfIntent: input.intentAnalysis.htf.intent,
      mtfIntent: input.intentAnalysis.mtf.intent,
      ltfIntent: input.intentAnalysis.ltf.intent,
    });

    const boosts: Array<{ reason: string; amount: number }> = [];
    const penalties: Array<{ reason: string; amount: number }> = [];

    this.collectSupportingObservations(input, boosts);
    this.collectConflictingObservations(input, penalties);

    logger.info('[Pattern Confidence] Observations collected', {
      supportCount: boosts.length,
      conflictCount: penalties.length,
      arithmeticEffect: 0,
    });

    return {
      baseConfidence: input.baseConfidence,
      adjustedConfidence: input.baseConfidence,
      totalAdjustment: 0,
      boosts,
      penalties,
      capApplied: false,
      capReason: undefined,
      finalConfidence: input.baseConfidence,
    };
  }

  /**
   * Collect supporting pattern observations as labels (amount always 0)
   */
  private collectSupportingObservations(
    input: PatternConfidenceInput,
    boosts: Array<{ reason: string; amount: number }>
  ): void {
    const { intentAnalysis, htfScan, mtfScan, ltfScan, tradeDirection } = input;

    const htfAligns = this.intentAlignsWithDirection(intentAnalysis.htf.intent, tradeDirection);
    const mtfLoading = this.isMTFShowingLoading(intentAnalysis.mtf.intent);
    if (htfAligns && mtfLoading) {
      boosts.push({
        reason: 'SUPPORTS: HTF intent aligns with direction AND MTF shows loading',
        amount: 0,
      });
    }

    const mtfBreakRetest = this.hasBreakRetestPattern(mtfScan, tradeDirection);
    if (mtfBreakRetest) {
      boosts.push({
        reason: 'SUPPORTS: MTF break→retest confirmation in trade direction',
        amount: 0,
      });
    }

    const ltfCleanTiming = this.hasCleanTimingPattern(ltfScan, tradeDirection);
    if (ltfCleanTiming) {
      boosts.push({
        reason: 'SUPPORTS: LTF shows clean timing pattern',
        amount: 0,
      });
    }
  }

  /**
   * Collect conflicting pattern observations as labels (amount always 0)
   */
  private collectConflictingObservations(
    input: PatternConfidenceInput,
    penalties: Array<{ reason: string; amount: number }>
  ): void {
    const { intentAnalysis, mtfScan, ltfScan, tradeDirection } = input;

    const htfConflicts = this.intentConflictsWithDirection(intentAnalysis.htf.intent, tradeDirection);
    if (htfConflicts) {
      penalties.push({
        reason: 'CONFLICTS: HTF intent conflicts with trade direction',
        amount: 0,
      });
    }

    const mtfOpposing = this.hasMTFOpposingAccumulation(mtfScan, tradeDirection);
    if (mtfOpposing) {
      penalties.push({
        reason: 'CONFLICTS: MTF shows distribution/accumulation opposing trade direction',
        amount: 0,
      });
    }

    const ltfTrap = this.hasLTFTrapSignature(ltfScan, tradeDirection);
    if (ltfTrap) {
      penalties.push({
        reason: 'CONFLICTS: LTF shows trap signature against entry direction',
        amount: 0,
      });
    }

    const chopCount = this.countChopTimeframes(intentAnalysis);
    if (chopCount >= 2) {
      penalties.push({
        reason: `CONFLICTS: Chop detected across ${chopCount} timeframes — Alpha weighs conviction directly`,
        amount: 0,
      });
    }
  }

  private intentAlignsWithDirection(intent: MarketIntent, direction: 'long' | 'short'): boolean {
    return intent === 'continuation_likely' || intent === 'expansion_likely';
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
    const cleanPatterns = ['pre_break_compression', 'break_retest', 'stop_hunt_expansion'];
    const isCleanPattern = cleanPatterns.includes(scan.primaryPattern.patternType);
    if (!isCleanPattern) return false;
    if (scan.primaryPattern.direction === 'neutral') return true;
    return (direction === 'long' && scan.primaryPattern.direction === 'bullish') ||
           (direction === 'short' && scan.primaryPattern.direction === 'bearish');
  }

  private intentConflictsWithDirection(intent: MarketIntent, direction: 'long' | 'short'): boolean {
    return intent === 'reversal_likely' || intent === 'trap_likely';
  }

  private hasMTFOpposingAccumulation(scan: TimeframePatternScan, direction: 'long' | 'short'): boolean {
    if (!scan.primaryPattern) return false;
    const distributionPatterns = ['head_shoulders', 'exhaustion_wedge', 'range_liquidity_box'];
    if (!distributionPatterns.includes(scan.primaryPattern.patternType)) return false;
    return (direction === 'long' && scan.primaryPattern.direction === 'bearish') ||
           (direction === 'short' && scan.primaryPattern.direction === 'bullish');
  }

  private hasLTFTrapSignature(scan: TimeframePatternScan, direction: 'long' | 'short'): boolean {
    if (!scan.primaryPattern) return false;
    const trapPatterns = ['equal_highs_lows', 'sfp_sweep'];
    return trapPatterns.includes(scan.primaryPattern.patternType);
  }

  private countChopTimeframes(analysis: MultiTimeframeIntentAnalysis): number {
    let count = 0;
    if (analysis.htf.intent === 'chop_likely') count++;
    if (analysis.mtf.intent === 'chop_likely') count++;
    if (analysis.ltf.intent === 'chop_likely') count++;
    return count;
  }

  patternsSupportDirection(
    intentAnalysis: MultiTimeframeIntentAnalysis,
    direction: 'long' | 'short'
  ): boolean {
    const supportiveIntents: MarketIntent[] = ['continuation_likely', 'expansion_likely'];
    const intentSupports = supportiveIntents.includes(intentAnalysis.overallIntent);
    const directionSupports = (direction === 'long' && intentAnalysis.directionBias === 'bullish') ||
                              (direction === 'short' && intentAnalysis.directionBias === 'bearish') ||
                              intentAnalysis.directionBias === 'neutral';
    return intentSupports && directionSupports;
  }

  patternsOpposeDirection(
    intentAnalysis: MultiTimeframeIntentAnalysis,
    direction: 'long' | 'short'
  ): boolean {
    // CCIP-2026-0330-RC3: Opposition requires an active INTENT signal (reversal or trap).
    // Direction bias conflict alone (e.g. bearish bias in a neutral market) is NOT
    // sufficient to flag opposition — in neutral/chop regimes one of the two directions
    // will always have a conflicting bias, causing universal "Opposes Trade: YES" verdicts
    // that bias Alpha toward NO_TRADE on every scan.
    // A genuine opposing signal requires the pattern intent system to have classified
    // the market as actively setting up against the proposed direction.
    const dangerousIntents: MarketIntent[] = ['reversal_likely', 'trap_likely'];
    return dangerousIntents.includes(intentAnalysis.overallIntent);
  }
}

export const patternConfidenceAdjuster = new PatternConfidenceAdjuster();

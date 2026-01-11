/**
 * PATTERN INTENT CLASSIFIER - SSOT FOR PATTERN INTERPRETATION
 *
 * Maps detected patterns to 5 market intent labels:
 * - continuation_likely: Trend reload patterns
 * - expansion_likely: Compression before breakout
 * - reversal_likely: Exhaustion and trap patterns
 * - trap_likely: Failed breakouts and sweeps
 * - chop_likely: Range-bound, no clear direction
 *
 * CRITICAL: This is the authoritative interpreter of pattern meaning
 * All confidence adjustments and targeting logic flows from these intent labels
 */

import type { PatternDetection, TimeframePatternScan } from './pattern-detection-service';
import { logger } from '../lib/logger';

export type MarketIntent =
  | 'continuation_likely'
  | 'expansion_likely'
  | 'reversal_likely'
  | 'trap_likely'
  | 'chop_likely';

export interface IntentClassification {
  intent: MarketIntent;
  confidence: number; // 0-100
  reasoning: string;
  supportingPatterns: string[];
  conflictingPatterns: string[];
}

export interface MultiTimeframeIntentAnalysis {
  htf: IntentClassification;
  mtf: IntentClassification;
  ltf: IntentClassification;

  alignmentScore: number; // 0-3: how many timeframes agree
  overallIntent: MarketIntent;
  overallConfidence: number;

  directionBias: 'bullish' | 'bearish' | 'neutral';
  directionAlignment: boolean; // Do timeframes agree on direction?

  conflictWarnings: string[];
  reasoning: string;
}

class PatternIntentClassifier {
  /**
   * Classify market intent from multi-timeframe pattern scans
   */
  classifyMultiTimeframeIntent(
    htfScan: TimeframePatternScan,
    mtfScan: TimeframePatternScan,
    ltfScan: TimeframePatternScan
  ): MultiTimeframeIntentAnalysis {
    logger.info('[Pattern Intent] Classifying multi-timeframe intent');

    // Classify each timeframe
    const htf = this.classifySingleTimeframe(htfScan, 'HTF');
    const mtf = this.classifySingleTimeframe(mtfScan, 'MTF');
    const ltf = this.classifySingleTimeframe(ltfScan, 'LTF');

    // Calculate alignment
    const intents = [htf.intent, mtf.intent, ltf.intent];
    const alignmentScore = this.calculateAlignmentScore(intents);
    const overallIntent = this.determineOverallIntent(htf, mtf, ltf, alignmentScore);
    const overallConfidence = this.calculateOverallConfidence(htf, mtf, ltf, alignmentScore);

    // Direction analysis
    const directions = [
      this.getPrimaryDirection(htfScan),
      this.getPrimaryDirection(mtfScan),
      this.getPrimaryDirection(ltfScan),
    ];
    const directionBias = this.determinePrimaryDirection(directions);
    const directionAlignment = this.checkDirectionAlignment(directions);

    // Conflict detection
    const conflictWarnings = this.detectConflicts(htf, mtf, ltf, directionAlignment);

    // Overall reasoning
    const reasoning = this.buildOverallReasoning(htf, mtf, ltf, alignmentScore, directionAlignment);

    return {
      htf,
      mtf,
      ltf,
      alignmentScore,
      overallIntent,
      overallConfidence,
      directionBias,
      directionAlignment,
      conflictWarnings,
      reasoning,
    };
  }

  /**
   * Classify intent for a single timeframe
   */
  private classifySingleTimeframe(scan: TimeframePatternScan, layer: string): IntentClassification {
    if (!scan.primaryPattern || scan.patterns.length === 0) {
      return {
        intent: 'chop_likely',
        confidence: 50,
        reasoning: `${layer}: No clear patterns detected`,
        supportingPatterns: [],
        conflictingPatterns: [],
      };
    }

    const primary = scan.primaryPattern;
    const intent = this.mapPatternToIntent(primary);
    const supportingPatterns = scan.patterns
      .filter(p => this.mapPatternToIntent(p) === intent)
      .map(p => p.patternType);
    const conflictingPatterns = scan.patterns
      .filter(p => this.mapPatternToIntent(p) !== intent && this.mapPatternToIntent(p) !== 'chop_likely')
      .map(p => p.patternType);

    const confidence = this.calculateIntentConfidence(
      primary,
      supportingPatterns.length,
      conflictingPatterns.length
    );

    const reasoning = this.buildIntentReasoning(layer, primary, supportingPatterns, conflictingPatterns);

    return {
      intent,
      confidence,
      reasoning,
      supportingPatterns,
      conflictingPatterns,
    };
  }

  /**
   * Map individual pattern to market intent (SSOT for pattern meaning)
   */
  private mapPatternToIntent(pattern: PatternDetection): MarketIntent {
    switch (pattern.patternType) {
      // CONTINUATION patterns
      case 'flag':
      case 'pennant':
      case 'channel_continuation':
        return 'continuation_likely';

      case 'break_retest':
        return pattern.strength === 'strong' ? 'continuation_likely' : 'expansion_likely';

      // EXPANSION patterns
      case 'pre_break_compression':
        return 'expansion_likely';

      // REVERSAL patterns
      case 'sfp_sweep':
      case 'quasimodo':
      case 'head_shoulders':
      case 'exhaustion_wedge':
        return 'reversal_likely';

      // LIQUIDITY patterns (context-dependent)
      case 'range_liquidity_box':
        return 'chop_likely';

      case 'equal_highs_lows':
        return 'trap_likely'; // Equal levels are sweep targets

      case 'liquidity_vacuum':
        return 'expansion_likely'; // Thin zones = fast travel

      case 'stop_hunt_expansion':
        return pattern.strength === 'strong' ? 'continuation_likely' : 'expansion_likely';

      default:
        return 'chop_likely';
    }
  }

  /**
   * Calculate confidence for intent classification
   */
  private calculateIntentConfidence(
    primaryPattern: PatternDetection,
    supportingCount: number,
    conflictingCount: number
  ): number {
    let confidence = primaryPattern.confidence;

    // Boost for supporting patterns
    confidence += supportingCount * 5;

    // Penalty for conflicting patterns
    confidence -= conflictingCount * 10;

    // Strength modifier
    if (primaryPattern.strength === 'strong') {
      confidence += 10;
    } else if (primaryPattern.strength === 'weak') {
      confidence -= 10;
    }

    return Math.max(30, Math.min(95, confidence));
  }

  /**
   * Build reasoning string for single timeframe
   */
  private buildIntentReasoning(
    layer: string,
    primary: PatternDetection,
    supporting: string[],
    conflicting: string[]
  ): string {
    let reasoning = `${layer}: ${primary.patternType} (${primary.strength}, ${primary.confidence}%)`;

    if (supporting.length > 0) {
      reasoning += ` + ${supporting.length} supporting`;
    }

    if (conflicting.length > 0) {
      reasoning += ` ⚠️ ${conflicting.length} conflicting`;
    }

    return reasoning;
  }

  /**
   * Calculate alignment score (0-3) based on matching intents
   */
  private calculateAlignmentScore(intents: MarketIntent[]): number {
    const continuationCount = intents.filter(i => i === 'continuation_likely').length;
    const expansionCount = intents.filter(i => i === 'expansion_likely').length;
    const reversalCount = intents.filter(i => i === 'reversal_likely').length;
    const trapCount = intents.filter(i => i === 'trap_likely').length;

    // Perfect alignment
    if (continuationCount === 3 || expansionCount === 3 || reversalCount === 3) {
      return 3;
    }

    // Good alignment (2/3 agree)
    if (continuationCount === 2 || expansionCount === 2 || reversalCount === 2) {
      return 2;
    }

    // Partial alignment (continuation + expansion is compatible)
    if (continuationCount >= 1 && expansionCount >= 1) {
      return 1;
    }

    // No alignment
    return 0;
  }

  /**
   * Determine overall intent based on multi-timeframe analysis
   */
  private determineOverallIntent(
    htf: IntentClassification,
    mtf: IntentClassification,
    ltf: IntentClassification,
    alignmentScore: number
  ): MarketIntent {
    // If alignment is good, use HTF intent (higher timeframe authority)
    if (alignmentScore >= 2) {
      return htf.intent;
    }

    // If HTF and MTF agree, use that
    if (htf.intent === mtf.intent) {
      return htf.intent;
    }

    // If no agreement, check for dangerous conditions
    if (htf.intent === 'reversal_likely' || mtf.intent === 'reversal_likely') {
      return 'reversal_likely'; // Safety first
    }

    if (htf.intent === 'trap_likely' || mtf.intent === 'trap_likely') {
      return 'trap_likely'; // Caution
    }

    // Default to chop if no clear consensus
    return 'chop_likely';
  }

  /**
   * Calculate overall confidence considering all timeframes
   */
  private calculateOverallConfidence(
    htf: IntentClassification,
    mtf: IntentClassification,
    ltf: IntentClassification,
    alignmentScore: number
  ): number {
    // Weighted average: HTF 50%, MTF 30%, LTF 20%
    const weightedAvg = (htf.confidence * 0.5) + (mtf.confidence * 0.3) + (ltf.confidence * 0.2);

    // Alignment bonus
    const alignmentBonus = alignmentScore * 5;

    const total = weightedAvg + alignmentBonus;

    return Math.max(30, Math.min(95, total));
  }

  /**
   * Get primary direction from pattern scan
   */
  private getPrimaryDirection(scan: TimeframePatternScan): 'bullish' | 'bearish' | 'neutral' {
    if (!scan.primaryPattern) return 'neutral';

    return scan.primaryPattern.direction;
  }

  /**
   * Determine overall direction bias
   */
  private determinePrimaryDirection(
    directions: Array<'bullish' | 'bearish' | 'neutral'>
  ): 'bullish' | 'bearish' | 'neutral' {
    const bullishCount = directions.filter(d => d === 'bullish').length;
    const bearishCount = directions.filter(d => d === 'bearish').length;

    if (bullishCount >= 2) return 'bullish';
    if (bearishCount >= 2) return 'bearish';
    return 'neutral';
  }

  /**
   * Check if directions align across timeframes
   */
  private checkDirectionAlignment(
    directions: Array<'bullish' | 'bearish' | 'neutral'>
  ): boolean {
    const nonNeutral = directions.filter(d => d !== 'neutral');
    if (nonNeutral.length < 2) return false;

    return nonNeutral.every(d => d === nonNeutral[0]);
  }

  /**
   * Detect conflicts between timeframes
   */
  private detectConflicts(
    htf: IntentClassification,
    mtf: IntentClassification,
    ltf: IntentClassification,
    directionAlignment: boolean
  ): string[] {
    const warnings: string[] = [];

    // Intent conflicts
    if (htf.intent === 'continuation_likely' && mtf.intent === 'reversal_likely') {
      warnings.push('HTF continuation conflicts with MTF reversal');
    }

    if (mtf.intent === 'trap_likely' && ltf.intent === 'continuation_likely') {
      warnings.push('MTF trap signal conflicts with LTF continuation');
    }

    // Direction conflicts
    if (!directionAlignment) {
      warnings.push('Directional conflict across timeframes');
    }

    // Chop warnings
    const chopCount = [htf.intent, mtf.intent, ltf.intent].filter(i => i === 'chop_likely').length;
    if (chopCount >= 2) {
      warnings.push('Multiple timeframes showing chop - low conviction');
    }

    // Conflicting pattern warnings
    if (htf.conflictingPatterns.length >= 2) {
      warnings.push('HTF has significant conflicting patterns');
    }

    return warnings;
  }

  /**
   * Build comprehensive reasoning for overall analysis
   */
  private buildOverallReasoning(
    htf: IntentClassification,
    mtf: IntentClassification,
    ltf: IntentClassification,
    alignmentScore: number,
    directionAlignment: boolean
  ): string {
    const parts: string[] = [];

    // Alignment summary
    if (alignmentScore === 3) {
      parts.push('Perfect alignment across all timeframes');
    } else if (alignmentScore === 2) {
      parts.push('Strong alignment (2/3 timeframes agree)');
    } else if (alignmentScore === 1) {
      parts.push('Partial alignment with compatible signals');
    } else {
      parts.push('⚠️ No clear alignment across timeframes');
    }

    // Direction summary
    if (directionAlignment) {
      parts.push('Directional alignment confirmed');
    } else {
      parts.push('⚠️ Directional conflict detected');
    }

    // Key patterns
    const keyPatterns: string[] = [];
    if (htf.supportingPatterns.length > 0) {
      keyPatterns.push(`HTF: ${htf.intent}`);
    }
    if (mtf.supportingPatterns.length > 0) {
      keyPatterns.push(`MTF: ${mtf.intent}`);
    }
    if (ltf.supportingPatterns.length > 0) {
      keyPatterns.push(`LTF: ${ltf.intent}`);
    }

    if (keyPatterns.length > 0) {
      parts.push(`Key signals: ${keyPatterns.join(', ')}`);
    }

    return parts.join('. ');
  }

  /**
   * Get liquidity targets from pattern analysis
   */
  getLiquidityTargets(
    htfScan: TimeframePatternScan,
    mtfScan: TimeframePatternScan,
    ltfScan: TimeframePatternScan
  ): number[] {
    const targets = new Set<number>();

    // Collect targets from all timeframes (prioritize HTF/MTF)
    if (htfScan.primaryPattern) {
      htfScan.primaryPattern.liquidityTargets.forEach(t => targets.add(t));
    }

    if (mtfScan.primaryPattern) {
      mtfScan.primaryPattern.liquidityTargets.forEach(t => targets.add(t));
    }

    if (ltfScan.primaryPattern && targets.size < 3) {
      ltfScan.primaryPattern.liquidityTargets.forEach(t => targets.add(t));
    }

    return Array.from(targets).sort((a, b) => a - b);
  }

  /**
   * Get pattern invalidation point
   */
  getInvalidationPoint(
    analysis: MultiTimeframeIntentAnalysis,
    ltfScan: TimeframePatternScan
  ): { price: number; reasoning: string } | null {
    // Use LTF invalidation for execution timing
    if (ltfScan.primaryPattern) {
      return {
        price: ltfScan.primaryPattern.invalidationPrice,
        reasoning: ltfScan.primaryPattern.invalidationReasoning,
      };
    }

    return null;
  }
}

export const patternIntentClassifier = new PatternIntentClassifier();

/**
 * MULTI-TIMEFRAME PATTERN INTELLIGENCE ORCHESTRATOR
 *
 * Central coordinator for pattern-based market intelligence.
 * Orchestrates pattern detection, intent classification, and confidence adjustments.
 *
 * This is the primary interface Alpha uses for pattern intelligence.
 */

import { patternDetectionService, type TimeframePatternScan } from './pattern-detection-service';
import { patternIntentClassifier, type MultiTimeframeIntentAnalysis } from './pattern-intent-classifier';
import { patternConfidenceAdjuster, type ConfidenceAdjustment, type PatternConfidenceInput } from './pattern-confidence-adjuster';
import { fetchPreAggregatedCandles, type CandleData } from './candle-data-service';
import { logger } from '../lib/logger';
import type { RiskMode } from '../config/timeframe-hierarchy';
import { getMTFConfig } from '../config/timeframe-hierarchy';

export interface PatternIntelligenceInput {
  symbol: string;
  riskMode: RiskMode;
  baseConfidence: number;
  tradeDirection: 'long' | 'short';
  liquidityIntentConfirms?: boolean;
}

export interface PatternIntelligenceResult {
  // Pattern scans
  htfScan: TimeframePatternScan;
  mtfScan: TimeframePatternScan;
  ltfScan: TimeframePatternScan;

  // Intent analysis
  intentAnalysis: MultiTimeframeIntentAnalysis;

  // Confidence adjustment
  confidenceAdjustment: ConfidenceAdjustment;

  // Advisory pattern adjustment delta (not authoritative - SSOT is confidence-calculation-engine)
  finalConfidence: number;
  patternsSupportTrade: boolean;
  patternsOpposeTrade: boolean;
  liquidityTargets: number[];
  invalidationPoint: { price: number; reasoning: string } | null;

  // Metadata
  timestamp: number;
  cacheHit: boolean;
}

interface PatternCache {
  result: PatternIntelligenceResult;
  timestamp: number;
}

class MultiTimeframePatternIntelligence {
  private cache = new Map<string, PatternCache>();
  private readonly CACHE_TTL_MS = 60000; // 1 minute

  /**
   * Analyze multi-timeframe patterns and provide complete intelligence package
   */
  async analyzePatterns(input: PatternIntelligenceInput): Promise<PatternIntelligenceResult> {
    const cacheKey = this.getCacheKey(input);
    const cached = this.getFromCache(cacheKey);

    if (cached) {
      logger.info('[MTF Pattern Intelligence] Using cached analysis');
      return { ...cached, cacheHit: true };
    }

    logger.info('[MTF Pattern Intelligence] Starting fresh analysis', {
      symbol: input.symbol,
      riskMode: input.riskMode,
      direction: input.tradeDirection,
    });

    // Get timeframes for risk mode
    const config = getMTFConfig(input.riskMode);

    // Fetch candles for all three layers
    const [htfCandles, mtfCandles, ltfCandles] = await Promise.all([
      this.fetchTimeframeCandles(input.symbol, config.contextTimeframe, 'HTF'),
      this.fetchTimeframeCandles(input.symbol, config.trendTimeframe, 'MTF'),
      this.fetchTimeframeCandles(input.symbol, config.entryTimeframe, 'LTF'),
    ]);

    // Scan for patterns at each layer
    const htfScan = patternDetectionService.scanForPatterns(htfCandles, config.contextTimeframe, 'HTF');
    const mtfScan = patternDetectionService.scanForPatterns(mtfCandles, config.trendTimeframe, 'MTF');
    const ltfScan = patternDetectionService.scanForPatterns(ltfCandles, config.entryTimeframe, 'LTF');

    logger.info('[MTF Pattern Intelligence] Pattern scans complete', {
      htfPatterns: htfScan.patterns.length,
      mtfPatterns: mtfScan.patterns.length,
      ltfPatterns: ltfScan.patterns.length,
    });

    // Classify intent across timeframes
    const intentAnalysis = patternIntentClassifier.classifyMultiTimeframeIntent(
      htfScan,
      mtfScan,
      ltfScan
    );

    logger.info('[MTF Pattern Intelligence] Intent classification complete', {
      htfIntent: intentAnalysis.htf.intent,
      mtfIntent: intentAnalysis.mtf.intent,
      ltfIntent: intentAnalysis.ltf.intent,
      alignment: intentAnalysis.alignmentScore,
      overallIntent: intentAnalysis.overallIntent,
    });

    // Calculate confidence adjustments
    const confidenceInput: PatternConfidenceInput = {
      baseConfidence: input.baseConfidence,
      tradeDirection: input.tradeDirection,
      intentAnalysis,
      htfScan,
      mtfScan,
      ltfScan,
      liquidityIntentConfirms: input.liquidityIntentConfirms,
    };

    const confidenceAdjustment = patternConfidenceAdjuster.calculateAdjustment(confidenceInput);

    // Extract actionable outputs
    const liquidityTargets = patternIntentClassifier.getLiquidityTargets(htfScan, mtfScan, ltfScan);
    const invalidationPoint = patternIntentClassifier.getInvalidationPoint(intentAnalysis, ltfScan);

    const patternsSupportTrade = patternConfidenceAdjuster.patternsSupportDirection(
      intentAnalysis,
      input.tradeDirection
    );

    const patternsOpposeTrade = patternConfidenceAdjuster.patternsOpposeDirection(
      intentAnalysis,
      input.tradeDirection
    );

    const result: PatternIntelligenceResult = {
      htfScan,
      mtfScan,
      ltfScan,
      intentAnalysis,
      confidenceAdjustment,
      finalConfidence: confidenceAdjustment.totalAdjustment,
      patternsSupportTrade,
      patternsOpposeTrade,
      liquidityTargets,
      invalidationPoint,
      timestamp: Date.now(),
      cacheHit: false,
    };

    // Cache result
    this.cache.set(cacheKey, {
      result,
      timestamp: Date.now(),
    });

    logger.info('[MTF Pattern Intelligence] Analysis complete', {
      finalConfidence: result.finalConfidence,
      supportsTrade: patternsSupportTrade,
      opposesTrade: patternsOpposeTrade,
      liquidityTargets: liquidityTargets.length,
    });

    return result;
  }

  /**
   * Format pattern intelligence for Alpha's LLM prompt
   */
  formatForAlphaPrompt(result: PatternIntelligenceResult): string {
    const lines: string[] = [];

    lines.push('=== MULTI-TIMEFRAME PATTERN INTELLIGENCE ===');
    lines.push('');

    // HTF Analysis
    lines.push(`HTF (${result.htfScan.timeframe}) - Campaign Intent:`);
    if (result.htfScan.primaryPattern) {
      lines.push(`  Pattern: ${result.htfScan.primaryPattern.patternType} (${result.htfScan.primaryPattern.strength})`);
      lines.push(`  Direction: ${result.htfScan.primaryPattern.direction}`);
      lines.push(`  Intent: ${result.intentAnalysis.htf.intent} (${result.intentAnalysis.htf.confidence}%)`);
    } else {
      lines.push(`  No clear pattern - ${result.intentAnalysis.htf.intent}`);
    }
    lines.push('');

    // MTF Analysis
    lines.push(`MTF (${result.mtfScan.timeframe}) - Expansion Preparation:`);
    if (result.mtfScan.primaryPattern) {
      lines.push(`  Pattern: ${result.mtfScan.primaryPattern.patternType} (${result.mtfScan.primaryPattern.strength})`);
      lines.push(`  Direction: ${result.mtfScan.primaryPattern.direction}`);
      lines.push(`  Intent: ${result.intentAnalysis.mtf.intent} (${result.intentAnalysis.mtf.confidence}%)`);
    } else {
      lines.push(`  No clear pattern - ${result.intentAnalysis.mtf.intent}`);
    }
    lines.push('');

    // LTF Analysis
    lines.push(`LTF (${result.ltfScan.timeframe}) - Execution Timing:`);
    if (result.ltfScan.primaryPattern) {
      lines.push(`  Pattern: ${result.ltfScan.primaryPattern.patternType} (${result.ltfScan.primaryPattern.strength})`);
      lines.push(`  Direction: ${result.ltfScan.primaryPattern.direction}`);
      lines.push(`  Intent: ${result.intentAnalysis.ltf.intent} (${result.intentAnalysis.ltf.confidence}%)`);
    } else {
      lines.push(`  No clear pattern - ${result.intentAnalysis.ltf.intent}`);
    }
    lines.push('');

    // Overall Analysis
    lines.push('PATTERN ALIGNMENT:');
    lines.push(`  Score: ${result.intentAnalysis.alignmentScore}/3`);
    lines.push(`  Overall Intent: ${result.intentAnalysis.overallIntent}`);
    lines.push(`  Direction Bias: ${result.intentAnalysis.directionBias}`);
    lines.push(`  Direction Aligned: ${result.intentAnalysis.directionAlignment ? 'YES' : 'NO'}`);
    lines.push('');

    // Confidence Impact
    lines.push('CONFIDENCE ADJUSTMENTS:');
    if (result.confidenceAdjustment.boosts.length > 0) {
      lines.push('  Boosts:');
      result.confidenceAdjustment.boosts.forEach(b => {
        lines.push(`    +${b.amount}% - ${b.reason}`);
      });
    }
    if (result.confidenceAdjustment.penalties.length > 0) {
      lines.push('  Penalties:');
      result.confidenceAdjustment.penalties.forEach(p => {
        lines.push(`    -${p.amount}% - ${p.reason}`);
      });
    }
    lines.push(`  Total Adjustment: ${result.confidenceAdjustment.totalAdjustment > 0 ? '+' : ''}${result.confidenceAdjustment.totalAdjustment}%`);
    if (result.confidenceAdjustment.capApplied) {
      lines.push(`  ⚠️ ${result.confidenceAdjustment.capReason}`);
    }
    lines.push('');

    // Liquidity Targets
    if (result.liquidityTargets.length > 0) {
      lines.push('PATTERN LIQUIDITY TARGETS:');
      result.liquidityTargets.forEach((target, i) => {
        lines.push(`  Target ${i + 1}: ${target.toFixed(5)}`);
      });
      lines.push('');
    }

    // Invalidation
    if (result.invalidationPoint) {
      lines.push('PATTERN INVALIDATION:');
      lines.push(`  Price: ${result.invalidationPoint.price.toFixed(5)}`);
      lines.push(`  Reason: ${result.invalidationPoint.reasoning}`);
      lines.push('');
    }

    // Warnings
    if (result.intentAnalysis.conflictWarnings.length > 0) {
      lines.push('⚠️ PATTERN WARNINGS:');
      result.intentAnalysis.conflictWarnings.forEach(warning => {
        lines.push(`  - ${warning}`);
      });
      lines.push('');
    }

    // Summary
    lines.push('PATTERN VERDICT:');
    lines.push(`  Supports Trade: ${result.patternsSupportTrade ? 'YES ✓' : 'NO ✗'}`);
    lines.push(`  Opposes Trade: ${result.patternsOpposeTrade ? 'YES ⚠️' : 'NO ✓'}`);
    lines.push(`  Overall Reasoning: ${result.intentAnalysis.reasoning}`);

    return lines.join('\n');
  }

  /**
   * Format pattern intelligence as structured JSON for Alpha
   */
  formatForAlphaJSON(result: PatternIntelligenceResult): object {
    return {
      pattern_intelligence: {
        htf: {
          timeframe: result.htfScan.timeframe,
          primary_pattern: result.htfScan.primaryPattern?.patternType || null,
          pattern_strength: result.htfScan.primaryPattern?.strength || null,
          intent: result.intentAnalysis.htf.intent,
          intent_confidence: result.intentAnalysis.htf.confidence,
          direction: result.htfScan.primaryPattern?.direction || 'neutral',
        },
        mtf: {
          timeframe: result.mtfScan.timeframe,
          primary_pattern: result.mtfScan.primaryPattern?.patternType || null,
          pattern_strength: result.mtfScan.primaryPattern?.strength || null,
          intent: result.intentAnalysis.mtf.intent,
          intent_confidence: result.intentAnalysis.mtf.confidence,
          direction: result.mtfScan.primaryPattern?.direction || 'neutral',
        },
        ltf: {
          timeframe: result.ltfScan.timeframe,
          primary_pattern: result.ltfScan.primaryPattern?.patternType || null,
          pattern_strength: result.ltfScan.primaryPattern?.strength || null,
          intent: result.intentAnalysis.ltf.intent,
          intent_confidence: result.intentAnalysis.ltf.confidence,
          direction: result.ltfScan.primaryPattern?.direction || 'neutral',
        },
        alignment: {
          score: result.intentAnalysis.alignmentScore,
          overall_intent: result.intentAnalysis.overallIntent,
          direction_bias: result.intentAnalysis.directionBias,
          direction_aligned: result.intentAnalysis.directionAlignment,
        },
        confidence_impact: {
          boosts: result.confidenceAdjustment.boosts,
          penalties: result.confidenceAdjustment.penalties,
          total_adjustment: result.confidenceAdjustment.totalAdjustment,
          cap_applied: result.confidenceAdjustment.capApplied,
          cap_reason: result.confidenceAdjustment.capReason,
        },
        actionable: {
          supports_trade: result.patternsSupportTrade,
          opposes_trade: result.patternsOpposeTrade,
          liquidity_targets: result.liquidityTargets,
          invalidation_point: result.invalidationPoint,
        },
        warnings: result.intentAnalysis.conflictWarnings,
        reasoning: result.intentAnalysis.reasoning,
      },
    };
  }

  /**
   * Clear pattern cache (useful for testing or forced refresh)
   */
  clearCache(symbol?: string): void {
    if (symbol) {
      for (const key of this.cache.keys()) {
        if (key.startsWith(symbol)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private async fetchTimeframeCandles(
    symbol: string,
    timeframe: string,
    layer: string
  ): Promise<CandleData[]> {
    try {
      const limit = layer === 'HTF' ? 100 : layer === 'MTF' ? 80 : 60;
      const candles = await fetchPreAggregatedCandles(symbol, timeframe, limit);

      logger.info(`[MTF Pattern Intelligence] Fetched ${layer} candles`, {
        symbol,
        timeframe,
        count: candles.length,
      });

      return candles;
    } catch (error) {
      logger.error(`[MTF Pattern Intelligence] Failed to fetch ${layer} candles`, {
        symbol,
        timeframe,
        error,
      });
      return [];
    }
  }

  private getCacheKey(input: PatternIntelligenceInput): string {
    return `${input.symbol}_${input.riskMode}_${input.tradeDirection}_${input.baseConfidence}`;
  }

  private getFromCache(key: string): PatternIntelligenceResult | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > this.CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }

    return cached.result;
  }
}

export const multiTimeframePatternIntelligence = new MultiTimeframePatternIntelligence();

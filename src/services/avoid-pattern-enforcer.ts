import { supabase } from '../lib/supabase';
import { MarketSnapshot } from './trigger-detection-rules';

export interface AvoidPatternEnforcementResult {
  is_blocked: boolean;
  block_reason: string | null;
  matched_patterns: Array<{
    pattern_id: string;
    pattern_title: string;
    pattern_description: string;
    confidence: number;
    similarity_score: number;
    avoid_conditions: any;
  }>;
  similarity_threshold_used: number;
  enforcement_level: 'strict' | 'moderate' | 'lenient';
  allow_override: boolean;
  override_reason?: string;
  logs: string[];
}

class AvoidPatternEnforcer {
  private readonly STRICT_SIMILARITY_THRESHOLD = 70;
  private readonly MODERATE_SIMILARITY_THRESHOLD = 75;
  private readonly LENIENT_SIMILARITY_THRESHOLD = 80;
  private readonly MIN_PATTERN_CONFIDENCE = 60;

  constructor() {
    console.log('[Avoid Pattern Enforcer] 🚫 HARD GATE initialized');
    console.log(`  Strict threshold: ${this.STRICT_SIMILARITY_THRESHOLD}%`);
    console.log(`  Moderate threshold: ${this.MODERATE_SIMILARITY_THRESHOLD}%`);
    console.log(`  Lenient threshold: ${this.LENIENT_SIMILARITY_THRESHOLD}%`);
  }

  async enforceAvoidPatterns(
    userId: string,
    snapshot: MarketSnapshot,
    triggerType: string,
    enforcementLevel: 'strict' | 'moderate' | 'lenient' = 'moderate'
  ): Promise<AvoidPatternEnforcementResult> {
    console.log(`\n[HARD GATE - Avoid Pattern Enforcer] 🚫 Checking ${snapshot.symbol} for losing patterns`);
    console.log(`  Enforcement Level: ${enforcementLevel}`);

    const startTime = Date.now();
    const logs: string[] = [];

    try {
      const losingPatterns = await this.getHighConfidenceLosingPatterns(userId, snapshot.symbol);
      logs.push(`Retrieved ${losingPatterns.length} losing patterns for ${snapshot.symbol}`);

      if (losingPatterns.length === 0) {
        logs.push('✅ No losing patterns on record - ALLOW');
        console.log('[HARD GATE] ✅ No patterns found - ALLOW');
        return {
          is_blocked: false,
          block_reason: null,
          matched_patterns: [],
          similarity_threshold_used: this.getSimilarityThreshold(enforcementLevel),
          enforcement_level: enforcementLevel,
          allow_override: false,
          logs
        };
      }

      const matchedPatterns = [];
      for (const pattern of losingPatterns) {
        const similarity = this.calculateSimilarity(snapshot, triggerType, pattern);
        logs.push(`Pattern "${pattern.insight_title}": ${similarity.toFixed(1)}% similarity`);

        const threshold = this.getSimilarityThreshold(enforcementLevel);
        if (similarity >= threshold) {
          matchedPatterns.push({
            pattern_id: pattern.id,
            pattern_title: pattern.insight_title,
            pattern_description: pattern.insight_description,
            confidence: pattern.confidence_score,
            similarity_score: similarity,
            avoid_conditions: pattern.avoid_when_conditions
          });
        }
      }

      if (matchedPatterns.length > 0) {
        const highestMatch = matchedPatterns.reduce((max, p) => p.similarity_score > max.similarity_score ? p : max);
        const blockReason = `BLOCKED: Setup matches losing pattern "${highestMatch.pattern_title}" (${highestMatch.similarity_score.toFixed(1)}% similarity, ${highestMatch.confidence}% confidence). ${highestMatch.pattern_description}`;

        logs.push(`🚫 BLOCKING TRADE - ${matchedPatterns.length} pattern(s) matched`);
        logs.push(`Highest match: "${highestMatch.pattern_title}" at ${highestMatch.similarity_score.toFixed(1)}%`);

        console.log(`[HARD GATE] 🚫 BLOCKED - Matched ${matchedPatterns.length} pattern(s)`);
        console.log(`  Primary match: "${highestMatch.pattern_title}" (${highestMatch.similarity_score.toFixed(1)}%)`);

        await this.logEnforcementEvent(userId, snapshot.symbol, triggerType, true, blockReason, matchedPatterns);

        return {
          is_blocked: true,
          block_reason: blockReason,
          matched_patterns: matchedPatterns,
          similarity_threshold_used: this.getSimilarityThreshold(enforcementLevel),
          enforcement_level: enforcementLevel,
          allow_override: enforcementLevel === 'lenient',
          override_reason: enforcementLevel === 'lenient' ? 'Manual override allowed in lenient mode' : undefined,
          logs
        };
      }

      logs.push('✅ No patterns matched threshold - ALLOW');
      console.log('[HARD GATE] ✅ No matches above threshold - ALLOW');

      await this.logEnforcementEvent(userId, snapshot.symbol, triggerType, false, 'No patterns matched', []);

      return {
        is_blocked: false,
        block_reason: null,
        matched_patterns: [],
        similarity_threshold_used: this.getSimilarityThreshold(enforcementLevel),
        enforcement_level: enforcementLevel,
        allow_override: false,
        logs
      };

    } catch (error) {
      console.error('[HARD GATE] Error during enforcement:', error);
      logs.push(`ERROR: ${error}`);

      return {
        is_blocked: false,
        block_reason: null,
        matched_patterns: [],
        similarity_threshold_used: this.getSimilarityThreshold(enforcementLevel),
        enforcement_level: enforcementLevel,
        allow_override: true,
        override_reason: 'Error during pattern checking - defaulting to ALLOW',
        logs
      };
    }
  }

  private async getHighConfidenceLosingPatterns(userId: string, symbol: string): Promise<any[]> {
    try {
      const { data: patterns, error } = await supabase
        .from('daily_learning_insights')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .eq('insight_type', 'losing_pattern')
        .gte('confidence_score', this.MIN_PATTERN_CONFIDENCE)
        .order('confidence_score', { ascending: false });

      if (error) {
        console.error('[HARD GATE] Error fetching patterns:', error);
        return [];
      }

      return patterns || [];
    } catch (error) {
      console.error('[HARD GATE] Exception fetching patterns:', error);
      return [];
    }
  }

  private calculateSimilarity(
    snapshot: MarketSnapshot,
    triggerType: string,
    pattern: any
  ): number {
    let similarityScore = 0;
    let totalChecks = 0;

    const currentCandle = snapshot.ohlc[snapshot.ohlc.length - 1];
    const patternFeatures = pattern.pattern_features || {};
    const avoidConditions = pattern.avoid_when_conditions || {};

    if (patternFeatures.trigger_type) {
      totalChecks++;
      if (patternFeatures.trigger_type === triggerType) {
        similarityScore += 25;
      }
    }

    if (patternFeatures.trend) {
      totalChecks++;
      if (patternFeatures.trend === snapshot.priceAction.trend) {
        similarityScore += 20;
      }
    }

    if (patternFeatures.volatility) {
      totalChecks++;
      if (patternFeatures.volatility === snapshot.priceAction.volatility) {
        similarityScore += 15;
      }
    }

    if (patternFeatures.price_vs_vwap) {
      totalChecks++;
      const currentPriceVsVwap = currentCandle.close > snapshot.indicators.vwap ? 'above' : 'below';
      if (patternFeatures.price_vs_vwap === currentPriceVsVwap) {
        similarityScore += 20;
      }
    }

    if (patternFeatures.ema_alignment) {
      totalChecks++;
      const currentEmaAlignment = snapshot.indicators.ema20 > snapshot.indicators.ema50 ? 'bullish' : 'bearish';
      if (patternFeatures.ema_alignment === currentEmaAlignment) {
        similarityScore += 20;
      }
    }

    if (avoidConditions.when && typeof avoidConditions.when === 'string') {
      totalChecks++;
      const conditionText = avoidConditions.when.toLowerCase();

      if (conditionText.includes(snapshot.priceAction.trend.toLowerCase())) {
        similarityScore += 15;
      }
      if (conditionText.includes(snapshot.priceAction.volatility.toLowerCase())) {
        similarityScore += 10;
      }
      if (conditionText.includes(triggerType.toLowerCase())) {
        similarityScore += 15;
      }
    }

    if (totalChecks === 0) {
      return 0;
    }

    return similarityScore;
  }

  private getSimilarityThreshold(level: 'strict' | 'moderate' | 'lenient'): number {
    switch (level) {
      case 'strict':
        return this.STRICT_SIMILARITY_THRESHOLD;
      case 'moderate':
        return this.MODERATE_SIMILARITY_THRESHOLD;
      case 'lenient':
        return this.LENIENT_SIMILARITY_THRESHOLD;
      default:
        return this.MODERATE_SIMILARITY_THRESHOLD;
    }
  }

  private async logEnforcementEvent(
    userId: string,
    symbol: string,
    triggerType: string,
    wasBlocked: boolean,
    reason: string,
    matchedPatterns: any[]
  ): Promise<void> {
    try {
      await supabase.from('avoid_pattern_enforcement_log').insert({
        user_id: userId,
        symbol: symbol,
        trigger_type: triggerType,
        was_blocked: wasBlocked,
        block_reason: reason,
        matched_patterns_count: matchedPatterns.length,
        matched_pattern_ids: matchedPatterns.map(p => p.pattern_id),
        highest_similarity_score: matchedPatterns.length > 0
          ? Math.max(...matchedPatterns.map(p => p.similarity_score))
          : 0,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[HARD GATE] Error logging enforcement event:', error);
    }
  }

  async getEnforcementStats(userId: string): Promise<{
    total_checks: number;
    total_blocks: number;
    block_rate: number;
    recent_blocks: any[];
  }> {
    try {
      const { data: logs } = await supabase
        .from('avoid_pattern_enforcement_log')
        .select('*')
        .eq('user_id', userId)
        .order('timestamp', { ascending: false })
        .limit(100);

      if (!logs || logs.length === 0) {
        return {
          total_checks: 0,
          total_blocks: 0,
          block_rate: 0,
          recent_blocks: []
        };
      }

      const blocks = logs.filter(l => l.was_blocked);
      const blockRate = (blocks.length / logs.length) * 100;

      return {
        total_checks: logs.length,
        total_blocks: blocks.length,
        block_rate: blockRate,
        recent_blocks: blocks.slice(0, 10)
      };
    } catch (error) {
      console.error('[HARD GATE] Error fetching stats:', error);
      return {
        total_checks: 0,
        total_blocks: 0,
        block_rate: 0,
        recent_blocks: []
      };
    }
  }
}

export const avoidPatternEnforcer = new AvoidPatternEnforcer();

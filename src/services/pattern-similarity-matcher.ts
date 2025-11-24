/**
 * Pattern Similarity Matcher
 *
 * Checks if current setup matches a known pattern to skip LLM calls.
 * Uses simple similarity scoring (could be upgraded to vector embeddings).
 */

import { LLM_OPTIMIZATION_CONFIG } from '../config/llm-optimization-config';
import { supabase } from '../lib/supabase';

export interface PatternMatch {
  matched: boolean;
  similarity: number;
  cachedDecision?: any;
  patternId?: string;
  age_hours?: number;
}

class PatternSimilarityMatcher {
  /**
   * Check if current setup matches a known pattern
   */
  async findSimilarPattern(
    userId: string,
    snapshot: {
      symbol: string;
      trend: string;
      volatility: string;
      trigger: string;
      setupQuality: number;
    }
  ): Promise<PatternMatch> {
    if (!LLM_OPTIMIZATION_CONFIG.patternMatching.enabled) {
      return { matched: false, similarity: 0 };
    }

    try {
      const maxAge = new Date();
      maxAge.setHours(maxAge.getHours() - LLM_OPTIMIZATION_CONFIG.patternMatching.maxPatternAge_hours);

      // Find similar patterns from recent successful trades
      const { data: patterns } = await supabase
        .from('llm_pattern_cache')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', snapshot.symbol)
        .gte('created_at', maxAge.toISOString())
        .order('created_at', { ascending: false })
        .limit(10);

      if (!patterns || patterns.length === 0) {
        return { matched: false, similarity: 0 };
      }

      // Calculate similarity for each pattern
      let bestMatch: any = null;
      let bestSimilarity = 0;

      for (const pattern of patterns) {
        const similarity = this.calculateSimilarity(snapshot, pattern);

        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestMatch = pattern;
        }
      }

      // Check if similarity exceeds threshold
      const threshold = LLM_OPTIMIZATION_CONFIG.patternMatching.similarityThreshold;

      if (bestSimilarity >= threshold && bestMatch) {
        const ageHours = (Date.now() - new Date(bestMatch.created_at).getTime()) / (1000 * 60 * 60);

        console.log(`[Pattern Matcher] ✅ MATCH found: ${bestSimilarity.toFixed(1)}% similar (age: ${ageHours.toFixed(1)}h)`);

        return {
          matched: true,
          similarity: bestSimilarity,
          cachedDecision: bestMatch.decision_context,
          patternId: bestMatch.id,
          age_hours: ageHours,
        };
      }

      return { matched: false, similarity: bestSimilarity };
    } catch (error) {
      console.warn('[Pattern Matcher] Error finding pattern:', error);
      return { matched: false, similarity: 0 };
    }
  }

  /**
   * Calculate similarity between current snapshot and stored pattern
   */
  private calculateSimilarity(
    current: {
      symbol: string;
      trend: string;
      volatility: string;
      trigger: string;
      setupQuality: number;
    },
    pattern: any
  ): number {
    let score = 0;
    let maxScore = 0;

    // Symbol match (weight: 20)
    maxScore += 20;
    if (current.symbol === pattern.symbol) {
      score += 20;
    }

    // Trend match (weight: 30)
    maxScore += 30;
    if (current.trend === pattern.trend) {
      score += 30;
    }

    // Volatility match (weight: 20)
    maxScore += 20;
    if (current.volatility === pattern.volatility) {
      score += 20;
    }

    // Trigger match (weight: 20)
    maxScore += 20;
    if (current.trigger === pattern.trigger_type) {
      score += 20;
    }

    // Setup quality similarity (weight: 10)
    maxScore += 10;
    const qualityDiff = Math.abs(current.setupQuality - (pattern.setup_quality || 0));
    if (qualityDiff <= 10) {
      score += 10 - qualityDiff;
    }

    return (score / maxScore) * 100;
  }

  /**
   * Store a successful pattern for future reuse
   */
  async storePattern(
    userId: string,
    snapshot: {
      symbol: string;
      trend: string;
      volatility: string;
      trigger: string;
      setupQuality: number;
    },
    decision: any,
    outcome: 'win' | 'loss' | 'breakeven'
  ): Promise<void> {
    if (!LLM_OPTIMIZATION_CONFIG.patternMatching.enabled) {
      return;
    }

    // Only store winning patterns
    if (outcome !== 'win') {
      return;
    }

    try {
      await supabase.from('llm_pattern_cache').insert({
        user_id: userId,
        symbol: snapshot.symbol,
        trend: snapshot.trend,
        volatility: snapshot.volatility,
        trigger_type: snapshot.trigger,
        setup_quality: snapshot.setupQuality,
        decision_context: decision,
        outcome: outcome,
        created_at: new Date().toISOString(),
      });

      console.log('[Pattern Matcher] 💾 Stored winning pattern');
    } catch (error) {
      console.warn('[Pattern Matcher] Failed to store pattern:', error);
    }
  }

  /**
   * Clean old patterns
   */
  async cleanOldPatterns(userId: string): Promise<void> {
    try {
      const maxAge = new Date();
      maxAge.setHours(maxAge.getHours() - LLM_OPTIMIZATION_CONFIG.patternMatching.maxPatternAge_hours);

      await supabase
        .from('llm_pattern_cache')
        .delete()
        .eq('user_id', userId)
        .lt('created_at', maxAge.toISOString());

      console.log('[Pattern Matcher] 🧹 Cleaned old patterns');
    } catch (error) {
      console.warn('[Pattern Matcher] Failed to clean patterns:', error);
    }
  }
}

export const patternSimilarityMatcher = new PatternSimilarityMatcher();

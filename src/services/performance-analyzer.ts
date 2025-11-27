/**
 * Performance Analyzer - Post-Trade Learning System
 *
 * Analyzes trade performance and generates insights.
 * Stores learnings in database for future strategy improvement.
 */

import { supabase } from '../lib/supabase';
import { openAIClient } from './openai-client';
import type { TradeContext, RewardResult } from './reward-engine';

export interface TradeAnalysis {
  why_won?: string;
  why_lost?: string;
  what_to_repeat?: string;
  what_to_avoid?: string;
  timing_quality: 'excellent' | 'good' | 'fair' | 'poor';
  execution_quality: 'perfect' | 'good' | 'acceptable' | 'poor';
  lesson_learned: string;
}

class PerformanceAnalyzer {
  /**
   * Analyze trade performance using LLM
   */
  async analyzeTradePerformance(
    userId: string,
    trade: TradeContext,
    scoreImpact: RewardResult,
    tradeId?: string
  ): Promise<TradeAnalysis> {
    // Ultra-compressed analysis prompt (< 300 tokens)
    const prompt = `Trade Review:

${trade.direction.toUpperCase()} ${trade.symbol}
Entry: ${trade.entry_price}
Exit: ${trade.exit_price}
PnL: $${trade.pnl.toFixed(2)}
Duration: ${trade.duration_minutes}min
Outcome: ${trade.outcome}

Score: ${scoreImpact.oldScore} → ${scoreImpact.newScore} (${scoreImpact.scoreChange})
Factors: ${scoreImpact.factors.join(', ')}

Analyze briefly:
{
  "why": "reason for outcome",
  "repeat": "what worked",
  "avoid": "what failed",
  "timing": "excellent|good|fair|poor",
  "quality": "perfect|good|acceptable|poor",
  "lesson": "key takeaway"
}

Max 150 tokens.`;

    console.log('[Performance Analyzer] 📊 Analyzing trade...');

    try {
      const response = await openAIClient.chat(
        [
          {
            role: 'system',
            content: 'Pipnosis Alpha learning system. JSON only. Concise.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        {
          model: 'gpt-4o-mini',
          temperature: 0.3,
          max_tokens: 200,
          requestType: 'trade_analysis',
          endpoint: 'performance-analyzer'
        }
      );

      const content = response.choices[0]?.message?.content || '{}';
      const analysis = this.parseAnalysisResponse(content, trade);

      // Store in database
      await this.storeAnalysis(userId, trade, scoreImpact, analysis, tradeId);

      console.log(`[Performance Analyzer] ✅ Analysis complete`);
      console.log(`[Performance Analyzer] Lesson: ${analysis.lesson_learned}`);

      return analysis;
    } catch (error) {
      console.error('[Performance Analyzer] Analysis failed:', error);

      // Fallback analysis
      const fallbackAnalysis = this.generateFallbackAnalysis(trade);
      await this.storeAnalysis(userId, trade, scoreImpact, fallbackAnalysis, tradeId);

      return fallbackAnalysis;
    }
  }

  /**
   * Parse LLM analysis response
   */
  private parseAnalysisResponse(response: string, trade: TradeContext): TradeAnalysis {
    try {
      const cleaned = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleaned);

      return {
        why_won: trade.outcome === 'win' ? parsed.why : undefined,
        why_lost: trade.outcome === 'loss' ? parsed.why : undefined,
        what_to_repeat: parsed.repeat || '',
        what_to_avoid: parsed.avoid || '',
        timing_quality: parsed.timing || 'fair',
        execution_quality: parsed.quality || 'acceptable',
        lesson_learned: parsed.lesson || 'Continue monitoring patterns'
      };
    } catch (error) {
      return this.generateFallbackAnalysis(trade);
    }
  }

  /**
   * Generate fallback analysis if LLM fails
   */
  private generateFallbackAnalysis(trade: TradeContext): TradeAnalysis {
    if (trade.outcome === 'win') {
      return {
        why_won: `Profitable ${trade.direction} trade on ${trade.symbol}`,
        what_to_repeat: 'Strategy execution successful',
        what_to_avoid: 'N/A',
        timing_quality: trade.duration_minutes < 60 ? 'good' : 'fair',
        execution_quality: 'acceptable',
        lesson_learned: 'Winning strategy - repeat similar setups'
      };
    } else {
      return {
        why_lost: `Loss on ${trade.direction} trade, ${trade.symbol}`,
        what_to_repeat: 'N/A',
        what_to_avoid: 'Review entry timing and conditions',
        timing_quality: trade.duration_minutes < 10 ? 'poor' : 'fair',
        execution_quality: 'acceptable',
        lesson_learned: 'Analyze setup for improvement'
      };
    }
  }

  /**
   * Store analysis in database
   */
  private async storeAnalysis(
    userId: string,
    trade: TradeContext,
    scoreImpact: RewardResult,
    analysis: TradeAnalysis,
    tradeId?: string
  ): Promise<void> {
    const { error } = await supabase
      .from('ai_trade_analysis')
      .insert({
        user_id: userId,
        trade_id: tradeId,
        symbol: trade.symbol,
        direction: trade.direction,
        entry_price: trade.entry_price,
        exit_price: trade.exit_price,
        pnl: trade.pnl,
        outcome: trade.outcome,
        duration_minutes: trade.duration_minutes,
        score_before: scoreImpact.oldScore,
        score_after: scoreImpact.newScore,
        score_change: scoreImpact.scoreChange,
        reward_factors: scoreImpact.factors,
        why_won: analysis.why_won,
        why_lost: analysis.why_lost,
        what_to_repeat: analysis.what_to_repeat,
        what_to_avoid: analysis.what_to_avoid,
        timing_quality: analysis.timing_quality,
        execution_quality: analysis.execution_quality,
        lesson_learned: analysis.lesson_learned,
        max_drawdown: trade.max_drawdown
      });

    if (error) {
      console.error('[Performance Analyzer] Failed to store analysis:', error);
    }
  }

  /**
   * Get recent learnings for user
   */
  async getRecentLearnings(userId: string, limit: number = 10): Promise<any[]> {
    const { data, error } = await supabase
      .from('ai_trade_analysis')
      .select('*')
      .eq('user_id', userId)
      .order('analyzed_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  /**
   * Get strategy effectiveness summary
   */
  async getStrategyEffectiveness(userId: string, strategyMode: string): Promise<any> {
    const { data, error } = await supabase
      .from('ai_strategy_memory')
      .select('*')
      .eq('user_id', userId)
      .eq('strategy_mode', strategyMode)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /**
   * Get top learnings (most impactful)
   */
  async getTopLearnings(userId: string, limit: number = 5): Promise<string[]> {
    const { data, error } = await supabase
      .from('ai_trade_analysis')
      .select('lesson_learned, pnl')
      .eq('user_id', userId)
      .order('pnl', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return (data || [])
      .map(d => d.lesson_learned)
      .filter(l => l && l.length > 0);
  }
}

export const performanceAnalyzer = new PerformanceAnalyzer();

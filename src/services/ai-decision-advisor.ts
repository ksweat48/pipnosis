import { supabase } from '../lib/supabase';
import { aiLearningEngine } from './ai-learning-engine';

interface TradeSignal {
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  setupType: string;
  marketConditions?: any;
}

interface AIDecisionAdvice {
  shouldTake: boolean;
  adjustedConfidence: number;
  reasoning: string;
  riskLevel: 'low' | 'medium' | 'high';
  historicalSuccessRate: number;
  keyInsights: string[];
  warnings: string[];
  recommendations: string[];
}

/**
 * AI Decision Advisor - Uses learned patterns to improve trade decisions
 *
 * This service queries historical learning data and provides real-time
 * advice on whether to take a trade, with adjusted confidence based on
 * what the AI has learned from past trades.
 */
class AIDecisionAdvisor {
  /**
   * Main decision function: Should we take this trade?
   */
  async evaluateTradeSignal(
    userId: string,
    signal: TradeSignal
  ): Promise<AIDecisionAdvice> {
    console.log(`\n[AI Decision Advisor] 🤔 Evaluating ${signal.symbol} ${signal.direction} signal...`);

    try {
      // 1. Get relevant learning insights
      const insights = await this.getRelevantInsights(userId, signal);

      // 2. Check market scenario performance
      const scenarioPerformance = await this.getScenarioPerformance(userId, signal);

      // 3. Query similar historical trades
      const similarTrades = await this.getSimilarHistoricalTrades(userId, signal);

      // 4. Calculate adjusted confidence
      const adjustedConfidence = this.calculateAdjustedConfidence(
        signal,
        insights,
        scenarioPerformance,
        similarTrades
      );

      // 5. Determine if we should take the trade
      const decision = this.makeDecision(signal, adjustedConfidence, insights, scenarioPerformance);

      // 6. Log the decision for future learning
      await this.logDecision(userId, signal, decision);

      console.log(`[AI Decision Advisor] ${decision.shouldTake ? '✅ TAKE' : '❌ SKIP'} (confidence: ${decision.adjustedConfidence}%)`);

      return decision;
    } catch (error) {
      console.error('[AI Decision Advisor] Error evaluating signal:', error);

      // Fallback to original signal if AI fails
      return {
        shouldTake: signal.confidence >= 75,
        adjustedConfidence: signal.confidence,
        reasoning: 'Using original signal (AI evaluation unavailable)',
        riskLevel: 'medium',
        historicalSuccessRate: 0,
        keyInsights: [],
        warnings: ['AI learning system unavailable'],
        recommendations: []
      };
    }
  }

  /**
   * Get relevant learning insights for this signal
   */
  private async getRelevantInsights(
    userId: string,
    signal: TradeSignal
  ): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('ai_learning_insights')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', signal.symbol)
        .gte('confidence_score', 60)
        .order('confidence_score', { ascending: false })
        .limit(5);

      if (error) {
        console.error('[AI Decision Advisor] Error fetching insights:', error);
        return [];
      }

      console.log(`[AI Decision Advisor] Found ${data?.length || 0} relevant insights`);
      return data || [];
    } catch (error) {
      console.error('[AI Decision Advisor] Error in getRelevantInsights:', error);
      return [];
    }
  }

  /**
   * Get performance in similar market scenarios
   */
  private async getScenarioPerformance(
    userId: string,
    signal: TradeSignal
  ): Promise<any> {
    try {
      const { data, error } = await supabase
        .from('ai_market_scenario_performance')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', signal.symbol)
        .order('win_rate', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[AI Decision Advisor] Error fetching scenario performance:', error);
        return null;
      }

      if (data) {
        console.log(`[AI Decision Advisor] Scenario performance: ${data.win_rate.toFixed(1)}% win rate over ${data.trades_taken} trades`);
      }

      return data;
    } catch (error) {
      console.error('[AI Decision Advisor] Error in getScenarioPerformance:', error);
      return null;
    }
  }

  /**
   * Query similar historical trades
   */
  private async getSimilarHistoricalTrades(
    userId: string,
    signal: TradeSignal
  ): Promise<any[]> {
    try {
      // Query both synthetic and real backtest trades
      const { data: syntheticTrades } = await supabase
        .from('synthetic_backtest_trades')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', signal.symbol)
        .eq('direction', signal.direction)
        .gte('flow_v2_confidence', signal.confidence - 10)
        .lte('flow_v2_confidence', signal.confidence + 10)
        .order('entry_time', { ascending: false })
        .limit(20);

      const { data: backtestTrades } = await supabase
        .from('backtest_trades')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', signal.symbol)
        .eq('direction', signal.direction)
        .gte('flow_v2_confidence', signal.confidence - 10)
        .lte('flow_v2_confidence', signal.confidence + 10)
        .order('entry_time', { ascending: false })
        .limit(20);

      const allTrades = [...(syntheticTrades || []), ...(backtestTrades || [])];

      console.log(`[AI Decision Advisor] Found ${allTrades.length} similar historical trades`);

      return allTrades;
    } catch (error) {
      console.error('[AI Decision Advisor] Error querying similar trades:', error);
      return [];
    }
  }

  /**
   * Calculate adjusted confidence based on AI learning
   */
  private calculateAdjustedConfidence(
    signal: TradeSignal,
    insights: any[],
    scenarioPerformance: any,
    similarTrades: any[]
  ): number {
    let adjustedConfidence = signal.confidence;

    // Factor 1: Winning pattern insights (boost confidence)
    const winningPatterns = insights.filter(i => i.insight_type === 'winning_pattern');
    if (winningPatterns.length > 0) {
      const avgWinningConfidence = winningPatterns.reduce((sum, p) => sum + p.confidence_score, 0) / winningPatterns.length;
      if (avgWinningConfidence >= 70) {
        adjustedConfidence += 5;
        console.log('[AI Decision Advisor] ⬆️ +5% from winning patterns');
      }
    }

    // Factor 2: Losing pattern insights (reduce confidence)
    const losingPatterns = insights.filter(i => i.insight_type === 'losing_pattern');
    if (losingPatterns.length > 0) {
      adjustedConfidence -= 10;
      console.log('[AI Decision Advisor] ⬇️ -10% from losing patterns detected');
    }

    // Factor 3: Market scenario performance
    if (scenarioPerformance) {
      if (scenarioPerformance.win_rate >= 65 && scenarioPerformance.trades_taken >= 10) {
        adjustedConfidence += 10;
        console.log(`[AI Decision Advisor] ⬆️ +10% from strong scenario performance (${scenarioPerformance.win_rate.toFixed(1)}%)`);
      } else if (scenarioPerformance.win_rate < 50 && scenarioPerformance.trades_taken >= 10) {
        adjustedConfidence -= 15;
        console.log(`[AI Decision Advisor] ⬇️ -15% from weak scenario performance (${scenarioPerformance.win_rate.toFixed(1)}%)`);
      }
    }

    // Factor 4: Similar historical trades
    if (similarTrades.length >= 5) {
      const wins = similarTrades.filter(t => t.outcome === 'win').length;
      const historicalWinRate = (wins / similarTrades.length) * 100;

      if (historicalWinRate >= 70) {
        adjustedConfidence += 8;
        console.log(`[AI Decision Advisor] ⬆️ +8% from strong historical performance (${historicalWinRate.toFixed(1)}%)`);
      } else if (historicalWinRate < 45) {
        adjustedConfidence -= 12;
        console.log(`[AI Decision Advisor] ⬇️ -12% from poor historical performance (${historicalWinRate.toFixed(1)}%)`);
      }
    }

    // Factor 5: Confidence level validation
    if (signal.confidence < 70) {
      adjustedConfidence -= 5;
      console.log('[AI Decision Advisor] ⬇️ -5% from low initial confidence');
    } else if (signal.confidence >= 85) {
      adjustedConfidence += 3;
      console.log('[AI Decision Advisor] ⬆️ +3% from high initial confidence');
    }

    // Clamp between 0-100
    adjustedConfidence = Math.max(0, Math.min(100, adjustedConfidence));

    return Math.round(adjustedConfidence);
  }

  /**
   * Make final decision based on all factors
   */
  private makeDecision(
    signal: TradeSignal,
    adjustedConfidence: number,
    insights: any[],
    scenarioPerformance: any
  ): AIDecisionAdvice {
    const keyInsights: string[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    // Extract key insights
    insights.forEach(insight => {
      if (insight.insight_type === 'winning_pattern') {
        keyInsights.push(`✅ ${insight.insight_title}`);
      } else if (insight.insight_type === 'losing_pattern') {
        warnings.push(`⚠️ ${insight.insight_title}`);
      }
    });

    // Historical success rate
    let historicalSuccessRate = 0;
    if (scenarioPerformance && scenarioPerformance.trades_taken >= 5) {
      historicalSuccessRate = scenarioPerformance.win_rate;
    }

    // Risk level assessment
    let riskLevel: 'low' | 'medium' | 'high' = 'medium';
    if (adjustedConfidence >= 80) {
      riskLevel = 'low';
    } else if (adjustedConfidence < 65) {
      riskLevel = 'high';
    }

    // Generate reasoning
    let reasoning = `Signal confidence adjusted from ${signal.confidence}% to ${adjustedConfidence}%. `;

    if (adjustedConfidence > signal.confidence) {
      reasoning += 'AI learning data supports taking this trade. ';
    } else if (adjustedConfidence < signal.confidence) {
      reasoning += 'AI learning data suggests caution on this setup. ';
    }

    if (historicalSuccessRate > 0) {
      reasoning += `Historical win rate: ${historicalSuccessRate.toFixed(1)}%. `;
    }

    // Decision threshold
    const CONFIDENCE_THRESHOLD = 70;
    const shouldTake = adjustedConfidence >= CONFIDENCE_THRESHOLD;

    if (!shouldTake) {
      warnings.push(`Confidence (${adjustedConfidence}%) below threshold (${CONFIDENCE_THRESHOLD}%)`);
      recommendations.push('Skip this trade or wait for better setup');
    } else {
      recommendations.push('Trade setup validated by AI learning system');
      if (adjustedConfidence >= 85) {
        recommendations.push('Consider slightly larger position size (within risk limits)');
      }
    }

    return {
      shouldTake,
      adjustedConfidence,
      reasoning,
      riskLevel,
      historicalSuccessRate,
      keyInsights,
      warnings,
      recommendations
    };
  }

  /**
   * Log decision for future learning
   */
  private async logDecision(
    userId: string,
    signal: TradeSignal,
    decision: AIDecisionAdvice
  ): Promise<void> {
    try {
      await supabase.from('ai_decision_feedback').insert({
        user_id: userId,
        decision_time: new Date().toISOString(),
        decision_type: decision.shouldTake ? 'take_trade' : 'skip_trade',
        symbol: signal.symbol,
        direction: signal.direction,
        signal_strength: signal.confidence,
        ai_confidence: decision.adjustedConfidence,
        ai_reasoning: decision.reasoning,
        key_factors: {
          insights_count: decision.keyInsights.length,
          warnings_count: decision.warnings.length,
          risk_level: decision.riskLevel,
          historical_success_rate: decision.historicalSuccessRate
        },
        historical_success_rate: decision.historicalSuccessRate,
        decision_made: decision.shouldTake,
        decision_rationale: decision.reasoning,
        matched_patterns: decision.keyInsights
      });

      console.log('[AI Decision Advisor] Decision logged for future learning');
    } catch (error) {
      console.error('[AI Decision Advisor] Error logging decision:', error);
    }
  }

  /**
   * Update decision feedback with actual trade outcome
   */
  async updateDecisionOutcome(
    userId: string,
    symbol: string,
    decisionTime: Date,
    actualOutcome: 'win' | 'loss' | 'breakeven',
    pnl: number
  ): Promise<void> {
    try {
      // Find the decision record
      const { data: decisions } = await supabase
        .from('ai_decision_feedback')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .gte('decision_time', new Date(decisionTime.getTime() - 60000).toISOString())
        .lte('decision_time', new Date(decisionTime.getTime() + 60000).toISOString())
        .limit(1);

      if (!decisions || decisions.length === 0) {
        return;
      }

      const decision = decisions[0];
      const wasCorrect = (decision.decision_made && actualOutcome === 'win') ||
                         (!decision.decision_made && actualOutcome === 'loss');

      // Calculate decision quality score
      const qualityScore = wasCorrect ?
        Math.min(100, decision.ai_confidence + 10) :
        Math.max(0, 100 - decision.ai_confidence);

      await supabase
        .from('ai_decision_feedback')
        .update({
          actual_outcome: actualOutcome,
          was_decision_correct: wasCorrect,
          pnl_if_taken: pnl,
          decision_quality_score: qualityScore,
          should_repeat_in_future: wasCorrect
        })
        .eq('id', decision.id);

      console.log(`[AI Decision Advisor] Updated decision outcome: ${wasCorrect ? 'CORRECT' : 'INCORRECT'} decision`);
    } catch (error) {
      console.error('[AI Decision Advisor] Error updating decision outcome:', error);
    }
  }

  /**
   * Get AI performance summary
   */
  async getPerformanceSummary(userId: string, symbol?: string): Promise<any> {
    try {
      let query = supabase
        .from('ai_decision_feedback')
        .select('*')
        .eq('user_id', userId)
        .not('was_decision_correct', 'is', null);

      if (symbol) {
        query = query.eq('symbol', symbol);
      }

      const { data: decisions } = await query.order('decision_time', { ascending: false }).limit(100);

      if (!decisions || decisions.length === 0) {
        return {
          totalDecisions: 0,
          correctDecisions: 0,
          accuracy: 0,
          message: 'No decisions tracked yet'
        };
      }

      const correctDecisions = decisions.filter(d => d.was_decision_correct).length;
      const accuracy = (correctDecisions / decisions.length) * 100;

      return {
        totalDecisions: decisions.length,
        correctDecisions,
        incorrectDecisions: decisions.length - correctDecisions,
        accuracy: accuracy.toFixed(1),
        avgConfidence: (decisions.reduce((sum, d) => sum + d.ai_confidence, 0) / decisions.length).toFixed(1),
        avgQualityScore: (decisions.reduce((sum, d) => sum + (d.decision_quality_score || 0), 0) / decisions.length).toFixed(1)
      };
    } catch (error) {
      console.error('[AI Decision Advisor] Error getting performance summary:', error);
      return null;
    }
  }
}

export const aiDecisionAdvisor = new AIDecisionAdvisor();
export type { TradeSignal, AIDecisionAdvice };

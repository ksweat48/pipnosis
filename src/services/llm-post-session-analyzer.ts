import { supabase } from '../lib/supabase';

interface TradeForAnalysis {
  symbol: string;
  direction: 'buy' | 'sell';
  outcome: 'win' | 'loss' | 'breakeven';
  pnl: number;
  entryTime: Date;
  exitTime: Date;
  entryPrice: number;
  exitPrice?: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  marketConditions?: any;
  setupType: string;
}

interface LLMPatternInsight {
  patternName: string;
  description: string;
  confidence: number;
  winRate: number;
  profitFactor: number;
  applicableConditions: any;
  whyItWorks: string;
  whenToApply: string;
  whenToAvoid: string;
  improvementSuggestions: string[];
}

interface SessionAnalysisResult {
  overallAssessment: string;
  strengthsIdentified: string[];
  weaknessesIdentified: string[];
  hiddenPatterns: LLMPatternInsight[];
  strategicRecommendations: string[];
  confidenceCalibrationAdvice: string;
  nextSessionFocus: string[];
  estimatedImprovementPotential: string;
}

class LLMPostSessionAnalyzer {
  private apiKey: string;
  private model: string = 'gpt-4o';
  private endpoint: string = 'https://api.openai.com/v1/chat/completions';
  private enabled: boolean = false;
  private callCount: number = 0;
  private lastCallTime: Date | null = null;

  constructor() {
    this.apiKey = typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_OPENAI_API_KEY || ''
      : process.env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';

    this.enabled = !!this.apiKey;

    if (this.enabled) {
      console.log('[LLM Post-Session Analyzer] Initialized with GPT-4o');
    } else {
      console.warn('[LLM Post-Session Analyzer] No API key found, analyzer disabled');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async analyzeSession(
    userId: string,
    sessionId: string,
    trades: TradeForAnalysis[],
    sessionType: 'synthetic' | 'real'
  ): Promise<SessionAnalysisResult | null> {
    if (!this.enabled) {
      console.log('[LLM Post-Session Analyzer] Disabled, skipping analysis');
      return null;
    }

    if (trades.length === 0) {
      console.log('[LLM Post-Session Analyzer] No trades to analyze');
      return null;
    }

    console.log(`\n[LLM Post-Session Analyzer] 🤖 Analyzing ${trades.length} trades from ${sessionType} session`);
    const startTime = Date.now();

    try {
      const prompt = this.buildAnalysisPrompt(trades);
      const result = await this.callGPT4o(prompt);
      const analysis = this.parseAnalysisResult(result);

      await this.saveAnalysisToDatabase(userId, sessionId, analysis, sessionType, trades);

      this.callCount++;
      this.lastCallTime = new Date();

      const duration = Date.now() - startTime;
      console.log(`[LLM Post-Session Analyzer] ✅ Analysis complete in ${duration}ms`);
      console.log(`  Patterns Found: ${analysis.hiddenPatterns.length}`);
      console.log(`  Recommendations: ${analysis.strategicRecommendations.length}`);

      return analysis;
    } catch (error) {
      console.error('[LLM Post-Session Analyzer] Error:', error);
      return null;
    }
  }

  private buildAnalysisPrompt(trades: TradeForAnalysis[]): string {
    const wins = trades.filter(t => t.outcome === 'win');
    const losses = trades.filter(t => t.outcome === 'loss');
    const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;

    const totalWins = wins.reduce((sum, t) => sum + t.pnl, 0);
    const totalLosses = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 0;

    const avgWinDuration = wins.length > 0
      ? wins.reduce((sum, t) => sum + (t.exitTime.getTime() - t.entryTime.getTime()), 0) / wins.length / 60000
      : 0;
    const avgLossDuration = losses.length > 0
      ? losses.reduce((sum, t) => sum + (t.exitTime.getTime() - t.entryTime.getTime()), 0) / losses.length / 60000
      : 0;

    const symbolGroups = this.groupBySymbol(trades);
    const setupGroups = this.groupBySetup(trades);

    let prompt = `You are an elite trading analyst with deep expertise in pattern recognition and strategic improvement. Analyze this trading session and provide actionable insights.

SESSION OVERVIEW:
- Total Trades: ${trades.length}
- Wins: ${wins.length} (${winRate.toFixed(1)}%)
- Losses: ${losses.length}
- Profit Factor: ${profitFactor.toFixed(2)}
- Avg Win Duration: ${avgWinDuration.toFixed(0)} minutes
- Avg Loss Duration: ${avgLossDuration.toFixed(0)} minutes

SYMBOL PERFORMANCE:`;

    for (const [symbol, symbolTrades] of Object.entries(symbolGroups)) {
      const symbolWins = symbolTrades.filter(t => t.outcome === 'win').length;
      const symbolWinRate = (symbolWins / symbolTrades.length) * 100;
      prompt += `\n  ${symbol}: ${symbolTrades.length} trades, ${symbolWinRate.toFixed(1)}% WR`;
    }

    prompt += `\n\nSETUP TYPE PERFORMANCE:`;
    for (const [setup, setupTrades] of Object.entries(setupGroups)) {
      const setupWins = setupTrades.filter(t => t.outcome === 'win').length;
      const setupWinRate = (setupWins / setupTrades.length) * 100;
      prompt += `\n  ${setup}: ${setupTrades.length} trades, ${setupWinRate.toFixed(1)}% WR`;
    }

    prompt += `\n\nCONFIDENCE ANALYSIS:`;
    const highConfTrades = trades.filter(t => t.confidence >= 80);
    const highConfWins = highConfTrades.filter(t => t.outcome === 'win').length;
    const highConfWinRate = highConfTrades.length > 0 ? (highConfWins / highConfTrades.length) * 100 : 0;
    prompt += `\n  High Confidence (80+): ${highConfTrades.length} trades, ${highConfWinRate.toFixed(1)}% WR`;

    const medConfTrades = trades.filter(t => t.confidence >= 70 && t.confidence < 80);
    const medConfWins = medConfTrades.filter(t => t.outcome === 'win').length;
    const medConfWinRate = medConfTrades.length > 0 ? (medConfWins / medConfTrades.length) * 100 : 0;
    prompt += `\n  Medium Confidence (70-79): ${medConfTrades.length} trades, ${medConfWinRate.toFixed(1)}% WR`;

    const lowConfTrades = trades.filter(t => t.confidence < 70);
    const lowConfWins = lowConfTrades.filter(t => t.outcome === 'win').length;
    const lowConfWinRate = lowConfTrades.length > 0 ? (lowConfWins / lowConfTrades.length) * 100 : 0;
    prompt += `\n  Low Confidence (<70): ${lowConfTrades.length} trades, ${lowConfWinRate.toFixed(1)}% WR`;

    prompt += `\n\nYour task is to:
1. Identify hidden patterns that rule-based systems might miss
2. Discover non-obvious correlations between wins/losses
3. Provide strategic recommendations for improvement
4. Calibrate confidence thresholds based on actual performance
5. Suggest specific focus areas for next session

Respond in this EXACT JSON format (no markdown):
{
  "overallAssessment": "<2-3 sentence summary of session performance>",
  "strengthsIdentified": ["<strength1>", "<strength2>", "<strength3>"],
  "weaknessesIdentified": ["<weakness1>", "<weakness2>", "<weakness3>"],
  "hiddenPatterns": [
    {
      "patternName": "<descriptive name>",
      "description": "<what the pattern is>",
      "confidence": <0-100>,
      "winRate": <actual win rate for this pattern>,
      "profitFactor": <estimated profit factor>,
      "applicableConditions": {"<key>": "<value>"},
      "whyItWorks": "<explanation>",
      "whenToApply": "<specific conditions>",
      "whenToAvoid": "<specific conditions>",
      "improvementSuggestions": ["<suggestion1>", "<suggestion2>"]
    }
  ],
  "strategicRecommendations": ["<actionable recommendation 1>", "<recommendation 2>", "<recommendation 3>"],
  "confidenceCalibrationAdvice": "<advice on adjusting confidence thresholds>",
  "nextSessionFocus": ["<focus area 1>", "<focus area 2>", "<focus area 3>"],
  "estimatedImprovementPotential": "<realistic estimate of potential win rate improvement>"
}

Be creative and insightful. Look for patterns that are NOT obvious from basic statistics. Focus on actionable intelligence.`;

    return prompt;
  }

  private async callGPT4o(prompt: string): Promise<string> {
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: 'You are an elite trading analyst specializing in pattern discovery and performance optimization. Provide deep, actionable insights that go beyond surface-level analysis.'
            },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 2000
        })
      });

      if (!response.ok) {
        throw new Error(`GPT-4o API error: ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('No content in GPT-4o response');
      }

      return content;
    } catch (error) {
      console.error('[LLM Post-Session Analyzer] API call failed:', error);
      throw error;
    }
  }

  private parseAnalysisResult(content: string): SessionAnalysisResult {
    const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleanContent);

    return {
      overallAssessment: parsed.overallAssessment || '',
      strengthsIdentified: parsed.strengthsIdentified || [],
      weaknessesIdentified: parsed.weaknessesIdentified || [],
      hiddenPatterns: parsed.hiddenPatterns || [],
      strategicRecommendations: parsed.strategicRecommendations || [],
      confidenceCalibrationAdvice: parsed.confidenceCalibrationAdvice || '',
      nextSessionFocus: parsed.nextSessionFocus || [],
      estimatedImprovementPotential: parsed.estimatedImprovementPotential || ''
    };
  }

  private async saveAnalysisToDatabase(
    userId: string,
    sessionId: string,
    analysis: SessionAnalysisResult,
    sessionType: 'synthetic' | 'real',
    trades: TradeForAnalysis[]
  ): Promise<void> {
    try {
      for (const pattern of analysis.hiddenPatterns) {
        const { error } = await supabase.from('ai_learning_insights').insert({
          user_id: userId,
          [sessionType === 'synthetic' ? 'synthetic_session_id' : 'backtest_session_id']: sessionId,
          is_from_live_trading: false,
          llm_generated: true,
          llm_model_used: this.model,
          insight_type: 'winning_pattern',
          symbol: pattern.applicableConditions?.symbol || 'EURUSD',
          timeframe: 'H1',
          market_scenario: 'llm_discovered',
          volatility_level: 'medium',
          trend_direction: 'mixed',
          insight_title: pattern.patternName,
          insight_description: pattern.description,
          pattern_features: pattern.applicableConditions,
          sample_size: trades.length,
          win_rate: pattern.winRate,
          avg_profit_factor: pattern.profitFactor,
          confidence_score: pattern.confidence,
          recommended_action: 'follow_pattern',
          apply_when_conditions: { when: pattern.whenToApply },
          avoid_when_conditions: { when: pattern.whenToAvoid },
          llm_reasoning: pattern.whyItWorks,
          llm_improvement_suggestions: pattern.improvementSuggestions
        });

        if (error) {
          console.error('[LLM Post-Session Analyzer] Error saving pattern:', error);
        }
      }

      const { error: summaryError } = await supabase.from('llm_session_analysis').insert({
        user_id: userId,
        [sessionType === 'synthetic' ? 'synthetic_session_id' : 'backtest_session_id']: sessionId,
        llm_model_used: this.model,
        overall_assessment: analysis.overallAssessment,
        strengths_identified: analysis.strengthsIdentified,
        weaknesses_identified: analysis.weaknessesIdentified,
        patterns_discovered_count: analysis.hiddenPatterns.length,
        strategic_recommendations: analysis.strategicRecommendations,
        confidence_calibration_advice: analysis.confidenceCalibrationAdvice,
        next_session_focus: analysis.nextSessionFocus,
        estimated_improvement_potential: analysis.estimatedImprovementPotential,
        analysis_quality_score: 85,
        processing_time_ms: 0
      });

      if (summaryError) {
        console.error('[LLM Post-Session Analyzer] Error saving summary:', summaryError);
      }

      console.log('[LLM Post-Session Analyzer] ✓ Saved analysis to database');
    } catch (error) {
      console.error('[LLM Post-Session Analyzer] Error saving to database:', error);
    }
  }

  private groupBySymbol(trades: TradeForAnalysis[]): Record<string, TradeForAnalysis[]> {
    return trades.reduce((groups, trade) => {
      if (!groups[trade.symbol]) {
        groups[trade.symbol] = [];
      }
      groups[trade.symbol].push(trade);
      return groups;
    }, {} as Record<string, TradeForAnalysis[]>);
  }

  private groupBySetup(trades: TradeForAnalysis[]): Record<string, TradeForAnalysis[]> {
    return trades.reduce((groups, trade) => {
      const setup = trade.setupType || 'Unknown';
      if (!groups[setup]) {
        groups[setup] = [];
      }
      groups[setup].push(trade);
      return groups;
    }, {} as Record<string, TradeForAnalysis[]>);
  }

  getUsageStats(): { calls: number; lastCall: Date | null } {
    return {
      calls: this.callCount,
      lastCall: this.lastCallTime
    };
  }
}

export const llmPostSessionAnalyzer = new LLMPostSessionAnalyzer();
export type { SessionAnalysisResult, LLMPatternInsight };

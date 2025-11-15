import { supabase } from '../lib/supabase';

/**
 * Meta-Learning Strategist (GPT-4o)
 *
 * High-level intelligence layer that analyzes summarized backtest results
 * and AI learning data to provide strategic recommendations.
 *
 * CRITICAL DESIGN PRINCIPLES:
 * - NEVER accesses raw candle data
 * - NEVER performs calculations or simulations
 * - Operates ONLY on summaries from rule-based engine
 * - Provides strategic oversight, not tactical execution
 * - System continues working if disabled or fails
 */

interface BacktestSummary {
  sessionId: string;
  sessionName: string;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  expectancy: number;
  avgRR: number;
  maxDrawdown: number;
  compositeSuccessScore: number;
  winningPatterns: any[];
  losingPatterns: any[];
  symbolPerformance: Record<string, any>;
  confidenceThresholdPerformance: any;
  marketConditionPerformance: any[];
  keyLearnings: string[];
}

interface MetaLearningInsight {
  highLevelInterpretation: string;
  strategicRecommendations: {
    category: string;
    recommendation: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
    expectedImpact: string;
  }[];
  patternsToEmphasize: string[];
  patternsToDeweight: string[];
  patternsToIgnore: string[];
  newRuleIdeas: {
    ruleName: string;
    description: string;
    rationale: string;
    testPriority: 'high' | 'medium' | 'low';
  }[];
  riskManagementAdjustments: {
    area: string;
    currentState: string;
    recommendedChange: string;
    reasoning: string;
  }[];
  regimeChangesDetected: {
    market: string;
    symbol: string;
    changeDetected: string;
    actionRequired: string;
  }[];
  tomorrowPriorities: string[];
}

class MetaLearningStrategist {
  private readonly MODEL = 'gpt-4o';
  private readonly MAX_TOKENS = 2500; // Reduced from 4000 for cost optimization
  private enabled: boolean = true;
  private dailyTokenLimit: number = 50000; // 50k tokens per day limit
  private dailyTokenUsage: Map<string, { date: string; tokens: number }> = new Map();

  /**
   * Analyze backtest results and generate strategic insights
   */
  async analyzeBacktestResults(
    userId: string,
    summary: BacktestSummary
  ): Promise<MetaLearningInsight | null> {
    if (!this.enabled) {
      console.log('[Meta-Learning Strategist] Disabled - skipping analysis');
      return null;
    }

    // Check daily token budget
    if (!this.checkDailyTokenBudget(userId)) {
      console.warn('[Meta-Learning Strategist] Daily token budget exceeded, skipping analysis');
      return null;
    }

    // Only analyze sessions with meaningful data
    if (summary.totalTrades < 10) {
      console.log('[Meta-Learning Strategist] Skipping analysis - insufficient trades (<10)');
      return null;
    }

    console.log(`\n[Meta-Learning Strategist] 🧠 Analyzing ${summary.sessionName}...`);
    const startTime = Date.now();

    try {
      // Build the prompt for GPT-4o
      const prompt = this.buildBacktestAnalysisPrompt(summary);

      // Call GPT-4o
      const gpt4oResponse = await this.callGPT4o(prompt, userId);

      if (!gpt4oResponse) {
        console.error('[Meta-Learning Strategist] GPT-4o call failed');
        return null;
      }

      // Parse response
      const insight = this.parseGPT4oResponse(gpt4oResponse.content);

      // Save to database
      await this.saveMetaLearningInsight(userId, summary.sessionId, 'post_backtest', summary, insight, gpt4oResponse.tokensUsed);

      const duration = Date.now() - startTime;
      console.log(`[Meta-Learning Strategist] ✅ Analysis complete in ${duration}ms`);
      console.log(`[Meta-Learning Strategist] 📊 Generated ${insight.strategicRecommendations.length} recommendations`);

      return insight;
    } catch (error) {
      console.error('[Meta-Learning Strategist] Error:', error);
      return null;
    }
  }

  /**
   * Analyze daily learning data and generate insights
   */
  async analyzeDailyLearning(
    userId: string,
    dailySummary: any
  ): Promise<MetaLearningInsight | null> {
    if (!this.enabled) {
      return null;
    }

    console.log('[Meta-Learning Strategist] 🧠 Analyzing daily learning...');
    const startTime = Date.now();

    try {
      const prompt = this.buildDailyReviewPrompt(dailySummary);
      const gpt4oResponse = await this.callGPT4o(prompt, userId);

      if (!gpt4oResponse) {
        return null;
      }

      const insight = this.parseGPT4oResponse(gpt4oResponse.content);
      await this.saveMetaLearningInsight(userId, null, 'daily_review', dailySummary, insight, gpt4oResponse.tokensUsed);

      const duration = Date.now() - startTime;
      console.log(`[Meta-Learning Strategist] ✅ Daily review complete in ${duration}ms`);

      return insight;
    } catch (error) {
      console.error('[Meta-Learning Strategist] Error in daily analysis:', error);
      return null;
    }
  }

  /**
   * Build prompt for backtest analysis
   */
  private buildBacktestAnalysisPrompt(summary: BacktestSummary): string {
    return `You are an elite trading strategist analyzing AI trading system performance. Your role is to provide high-level strategic insights, NOT to perform calculations or simulations.

**BACKTEST RESULTS SUMMARY:**

Session: ${summary.sessionName}
Total Trades: ${summary.totalTrades}
Win Rate: ${summary.winRate.toFixed(2)}%
Profit Factor: ${summary.profitFactor.toFixed(2)}
Sharpe Ratio: ${summary.sharpeRatio.toFixed(2)}
Expectancy: $${summary.expectancy.toFixed(2)}
Avg R:R: ${summary.avgRR.toFixed(2)}
Max Drawdown: ${summary.maxDrawdown.toFixed(2)}%
Composite Success Score: ${summary.compositeSuccessScore.toFixed(2)}

**WINNING PATTERNS (${summary.winningPatterns.length}):**
${JSON.stringify(summary.winningPatterns, null, 2)}

**LOSING PATTERNS (${summary.losingPatterns.length}):**
${JSON.stringify(summary.losingPatterns, null, 2)}

**SYMBOL PERFORMANCE:**
${JSON.stringify(summary.symbolPerformance, null, 2)}

**CONFIDENCE THRESHOLD PERFORMANCE:**
${JSON.stringify(summary.confidenceThresholdPerformance, null, 2)}

**MARKET CONDITION PERFORMANCE:**
${JSON.stringify(summary.marketConditionPerformance, null, 2)}

**KEY LEARNINGS FROM RULE-BASED ANALYSIS:**
${summary.keyLearnings.map((l, i) => `${i + 1}. ${l}`).join('\n')}

---

**YOUR TASK:**

As a strategic advisor, analyze these results and provide:

1. **High-Level Interpretation**: What's the big picture? Is the AI learning effectively? What are the strengths and blind spots?

2. **Strategic Recommendations**: 3-5 actionable recommendations for improving the AI's performance. Focus on:
   - Decision logic improvements
   - Confidence threshold adjustments
   - Risk management refinements
   - Pattern weighting changes

3. **Pattern Management**:
   - Which patterns should be EMPHASIZED (trusted more)?
   - Which patterns should be DE-WEIGHTED (trusted less)?
   - Which patterns should be IGNORED (filtered out)?

4. **New Rule Ideas**: Suggest 2-3 NEW rules the system should test in future backtests. Be specific and testable.

5. **Risk Management**: Are there any risk management adjustments needed based on the drawdown, R:R, or volatility exposure?

6. **Regime Detection**: Do you detect any market regime changes or structural shifts that require the AI to adapt?

7. **Tomorrow's Priorities**: What should be the AI's top 3 learning priorities going forward?

**RESPOND IN VALID JSON FORMAT:**

{
  "highLevelInterpretation": "string",
  "strategicRecommendations": [
    {
      "category": "string",
      "recommendation": "string",
      "priority": "critical|high|medium|low",
      "expectedImpact": "string"
    }
  ],
  "patternsToEmphasize": ["string"],
  "patternsToDeweight": ["string"],
  "patternsToIgnore": ["string"],
  "newRuleIdeas": [
    {
      "ruleName": "string",
      "description": "string",
      "rationale": "string",
      "testPriority": "high|medium|low"
    }
  ],
  "riskManagementAdjustments": [
    {
      "area": "string",
      "currentState": "string",
      "recommendedChange": "string",
      "reasoning": "string"
    }
  ],
  "regimeChangesDetected": [
    {
      "market": "string",
      "symbol": "string",
      "changeDetected": "string",
      "actionRequired": "string"
    }
  ],
  "tomorrowPriorities": ["string", "string", "string"]
}

**IMPORTANT**: Be specific, actionable, and strategic. Focus on improving the AI's decision-making, not on data collection or infrastructure.`;
  }

  /**
   * Build prompt for daily learning review
   */
  private buildDailyReviewPrompt(dailySummary: any): string {
    return `You are an elite trading strategist conducting a daily review of an AI trading system's learning progress.

**DAILY LEARNING SUMMARY:**
${JSON.stringify(dailySummary, null, 2)}

Provide strategic insights in the same JSON format as backtest analysis, but focus on:
1. Daily progress assessment
2. Short-term tactical adjustments
3. Quick wins for tomorrow
4. Any urgent issues to address

Respond in the same JSON format as the backtest analysis.`;
  }

  /**
   * Call GPT-4o API with improved error handling
   */
  private async callGPT4o(
    prompt: string,
    userId: string,
    retryCount: number = 0
  ): Promise<{ content: string; tokensUsed: number } | null> {
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY || import.meta.env.OPENAI_API_KEY;

    if (!apiKey) {
      console.error('[Meta-Learning Strategist] OpenAI API key not found');
      return null;
    }

    const startTime = Date.now();

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.MODEL,
          messages: [
            {
              role: 'system',
              content: 'You are an expert trading strategist and AI system optimizer. You analyze trading performance data and provide strategic recommendations to improve AI trading systems.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: this.MAX_TOKENS,
          temperature: 0.7,
          response_format: { type: 'json_object' }
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: { message: errorText } };
        }

        // Handle quota exceeded error
        if (response.status === 429 || errorData.error?.code === 'insufficient_quota') {
          console.error('[Meta-Learning Strategist] ❌ OpenAI quota exceeded. Please add credits.');
          console.error('[Meta-Learning Strategist] Visit: https://platform.openai.com/account/billing');

          await this.trackUsage(
            userId,
            'meta_learning_strategist',
            'analyzeBacktestResults',
            0,
            0,
            0,
            Date.now() - startTime,
            false,
            'QUOTA_EXCEEDED: OpenAI API quota limit reached'
          );

          this.enabled = false;
          console.warn('[Meta-Learning Strategist] Service automatically disabled due to quota limits');
          return null;
        }

        // Handle rate limit with exponential backoff
        if (response.status === 429 && retryCount < 2) {
          const waitTime = Math.pow(2, retryCount) * 1000;
          console.warn(`[Meta-Learning Strategist] Rate limited. Retrying in ${waitTime}ms...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          return this.callGPT4o(prompt, userId, retryCount + 1);
        }

        console.error('[Meta-Learning Strategist] API error:', errorData);
        return null;
      }

      const data = await response.json();
      const responseTime = Date.now() - startTime;

      // Track usage
      await this.trackUsage(
        userId,
        'meta_learning_strategist',
        'analyzeBacktestResults',
        data.usage.prompt_tokens,
        data.usage.completion_tokens,
        data.usage.total_tokens,
        responseTime,
        true,
        null
      );

      // Update daily token usage
      this.updateDailyTokenUsage(userId, data.usage.total_tokens);

      return {
        content: data.choices[0].message.content,
        tokensUsed: data.usage.total_tokens
      };
    } catch (error) {
      console.error('[Meta-Learning Strategist] API call failed:', error);

      // Track failed call
      await this.trackUsage(
        userId,
        'meta_learning_strategist',
        'analyzeBacktestResults',
        0,
        0,
        0,
        Date.now() - startTime,
        false,
        error instanceof Error ? error.message : 'Unknown error'
      );

      return null;
    }
  }

  /**
   * Parse GPT-4o JSON response
   */
  private parseGPT4oResponse(content: string): MetaLearningInsight {
    try {
      return JSON.parse(content);
    } catch (error) {
      console.error('[Meta-Learning Strategist] Failed to parse response:', error);
      // Return empty structure
      return {
        highLevelInterpretation: 'Error parsing GPT-4o response',
        strategicRecommendations: [],
        patternsToEmphasize: [],
        patternsToDeweight: [],
        patternsToIgnore: [],
        newRuleIdeas: [],
        riskManagementAdjustments: [],
        regimeChangesDetected: [],
        tomorrowPriorities: []
      };
    }
  }

  /**
   * Save meta-learning insight to database
   */
  private async saveMetaLearningInsight(
    userId: string,
    sessionId: string | null,
    analysisType: string,
    inputSummary: any,
    insight: MetaLearningInsight,
    tokensUsed: number
  ): Promise<void> {
    try {
      const { data, error } = await supabase.from('ai_meta_learning_insights').insert({
        user_id: userId,
        backtest_session_id: sessionId,
        analysis_type: analysisType,
        input_summary: inputSummary,
        high_level_interpretation: insight.highLevelInterpretation,
        strategic_recommendations: insight.strategicRecommendations,
        patterns_to_emphasize: insight.patternsToEmphasize,
        patterns_to_deweight: insight.patternsToDeweight,
        patterns_to_ignore: insight.patternsToIgnore,
        new_rule_ideas: insight.newRuleIdeas,
        risk_management_adjustments: insight.riskManagementAdjustments,
        regime_changes_detected: insight.regimeChangesDetected,
        tomorrow_priorities: insight.tomorrowPriorities,
        gpt4o_model: this.MODEL,
        tokens_used: tokensUsed,
        confidence_score: 85
      }).select().single();

      if (error) {
        console.error('[Meta-Learning Strategist] Error saving insight:', error);
      } else {
        console.log('[Meta-Learning Strategist] ✓ Insight saved to database');

        // Track recommendations with the recommendation tracker
        if (data && insight.strategicRecommendations.length > 0) {
          const { recommendationTracker } = await import('./recommendation-tracker');
          await recommendationTracker.trackRecommendationsFromInsight(
            userId,
            data.id,
            insight.strategicRecommendations
          );
        }
      }
    } catch (error) {
      console.error('[Meta-Learning Strategist] Exception saving insight:', error);
    }
  }

  /**
   * Track GPT-4o usage
   */
  private async trackUsage(
    userId: string,
    serviceType: string,
    functionCalled: string,
    promptTokens: number,
    completionTokens: number,
    totalTokens: number,
    responseTimeMs: number,
    success: boolean,
    errorMessage: string | null
  ): Promise<void> {
    try {
      // Approximate cost: $5 per 1M tokens for GPT-4o
      const estimatedCost = (totalTokens / 1000000) * 5;

      await supabase.from('gpt4o_usage_tracking').insert({
        user_id: userId,
        service_type: serviceType,
        function_called: functionCalled,
        model_used: this.MODEL,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        estimated_cost_usd: estimatedCost,
        response_time_ms: responseTimeMs,
        success,
        error_message: errorMessage
      });
    } catch (error) {
      console.error('[Meta-Learning Strategist] Error tracking usage:', error);
    }
  }

  /**
   * Get recent insights for a user
   */
  async getRecentInsights(userId: string, limit: number = 5): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('ai_meta_learning_insights')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[Meta-Learning Strategist] Error fetching insights:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[Meta-Learning Strategist] Exception fetching insights:', error);
      return [];
    }
  }

  /**
   * Enable/disable the strategist
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    console.log(`[Meta-Learning Strategist] ${enabled ? 'Enabled' : 'Disabled'}`);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Check if daily token budget has been exceeded
   */
  private checkDailyTokenBudget(userId: string): boolean {
    const today = new Date().toISOString().split('T')[0];
    const usage = this.dailyTokenUsage.get(userId);

    if (!usage || usage.date !== today) {
      return true; // New day or first use
    }

    return usage.tokens < this.dailyTokenLimit;
  }

  /**
   * Update daily token usage
   */
  private updateDailyTokenUsage(userId: string, tokens: number): void {
    const today = new Date().toISOString().split('T')[0];
    const usage = this.dailyTokenUsage.get(userId);

    if (!usage || usage.date !== today) {
      this.dailyTokenUsage.set(userId, { date: today, tokens });
    } else {
      usage.tokens += tokens;
    }

    console.log(`[Meta-Learning Strategist] Daily usage: ${usage?.tokens || tokens}/${this.dailyTokenLimit} tokens`);
  }

  /**
   * Get current daily token usage for a user
   */
  getDailyTokenUsage(userId: string): number {
    const today = new Date().toISOString().split('T')[0];
    const usage = this.dailyTokenUsage.get(userId);

    if (!usage || usage.date !== today) {
      return 0;
    }

    return usage.tokens;
  }
}

export const metaLearningStrategist = new MetaLearningStrategist();
export type { BacktestSummary, MetaLearningInsight };

import { supabase } from '../lib/supabase';

/**
 * Pattern Interpreter (GPT-4o)
 *
 * Translates discovered trading patterns into human-readable explanations
 * and actionable trading guidance.
 *
 * CRITICAL DESIGN PRINCIPLES:
 * - Interprets patterns already discovered by rule-based engine
 * - Does NOT access raw candle data
 * - Does NOT perform simulations or calculations
 * - Provides meaning, context, and psychology behind patterns
 * - Makes AI learning transparent and understandable
 */

interface DiscoveredPattern {
  patternId: string;
  patternName: string;
  symbol: string;
  timeframe: string;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  avgRR: number;
  sampleSize: number;
  volatilityRegime: string;
  trendDirection: string;
  conditions: any;
  features: any;
}

interface PatternInterpretation {
  plainEnglishExplanation: string;
  whyItWorks: string;
  marketPsychologyNotes: string;
  optimalConditions: string;
  conditionsToAvoid: string;
  riskWarnings: string[];
  confidenceLevel: 'high' | 'medium' | 'low';
  howToUseInTrading: string;
  positionSizingGuidance: string;
  entryTimingGuidance: string;
  exitTimingGuidance: string;
  synergiesWithPatterns: string[];
  conflictsWithPatterns: string[];
  degradationSigns: string[];
  patternStrengthAssessment: string;
}

class PatternInterpreter {
  private readonly MODEL = 'gpt-4o';
  private readonly MAX_TOKENS = 2000;
  private enabled: boolean = true;

  /**
   * Interpret a discovered pattern and generate human-readable explanation
   */
  async interpretPattern(
    userId: string,
    pattern: DiscoveredPattern
  ): Promise<PatternInterpretation | null> {
    if (!this.enabled) {
      console.log('[Pattern Interpreter] Disabled - skipping interpretation');
      return null;
    }

    console.log(`\n[Pattern Interpreter] 📖 Interpreting "${pattern.patternName}" on ${pattern.symbol}...`);
    const startTime = Date.now();

    try {
      // Build prompt
      const prompt = this.buildPatternInterpretationPrompt(pattern);

      // Call GPT-4o
      const gpt4oResponse = await this.callGPT4o(prompt, userId);

      if (!gpt4oResponse) {
        console.error('[Pattern Interpreter] GPT-4o call failed');
        return null;
      }

      // Parse response
      const interpretation = this.parseGPT4oResponse(gpt4oResponse.content);

      // Save to database
      await this.savePatternInterpretation(userId, pattern, interpretation, gpt4oResponse.tokensUsed);

      const duration = Date.now() - startTime;
      console.log(`[Pattern Interpreter] ✅ Interpretation complete in ${duration}ms`);

      return interpretation;
    } catch (error) {
      console.error('[Pattern Interpreter] Error:', error);
      return null;
    }
  }

  /**
   * Interpret multiple patterns in batch
   */
  async interpretPatternsBatch(
    userId: string,
    patterns: DiscoveredPattern[]
  ): Promise<Map<string, PatternInterpretation>> {
    console.log(`[Pattern Interpreter] 📚 Interpreting ${patterns.length} patterns...`);
    const interpretations = new Map<string, PatternInterpretation>();

    for (const pattern of patterns) {
      const interpretation = await this.interpretPattern(userId, pattern);
      if (interpretation) {
        interpretations.set(pattern.patternId, interpretation);
      }

      // Rate limiting: wait 1 second between calls
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`[Pattern Interpreter] ✅ Interpreted ${interpretations.size}/${patterns.length} patterns`);
    return interpretations;
  }

  /**
   * Build prompt for pattern interpretation
   */
  private buildPatternInterpretationPrompt(pattern: DiscoveredPattern): string {
    return `You are an expert forex trader and market psychologist. Your role is to interpret trading patterns discovered by an AI system and explain them in clear, actionable terms.

**PATTERN DISCOVERED BY AI:**

Pattern Name: ${pattern.patternName}
Symbol: ${pattern.symbol}
Timeframe: ${pattern.timeframe}

**PERFORMANCE METRICS:**
- Win Rate: ${pattern.winRate.toFixed(2)}%
- Profit Factor: ${pattern.profitFactor.toFixed(2)}
- Expectancy: $${pattern.expectancy.toFixed(2)}
- Avg Risk:Reward: ${pattern.avgRR.toFixed(2)}:1
- Sample Size: ${pattern.sampleSize} occurrences

**MARKET CONDITIONS:**
- Volatility Regime: ${pattern.volatilityRegime}
- Trend Direction: ${pattern.trendDirection}

**PATTERN CONDITIONS:**
${JSON.stringify(pattern.conditions, null, 2)}

**PATTERN FEATURES:**
${JSON.stringify(pattern.features, null, 2)}

---

**YOUR TASK:**

As an expert trader, interpret this pattern and provide:

1. **Plain English Explanation**: Describe this pattern in simple terms a novice trader could understand. What is actually happening in the market?

2. **Why It Works**: Explain the underlying market dynamics or trader psychology that makes this pattern profitable. What creates the edge?

3. **Market Psychology**: What are traders thinking/doing when this pattern forms? What emotions or biases are at play?

4. **Optimal Conditions**: Under what specific market conditions does this pattern work best? Be precise.

5. **Conditions to Avoid**: When should you NOT trade this pattern? What market states invalidate it?

6. **Risk Warnings**: What are the key dangers or traps with this pattern? What can go wrong?

7. **Confidence Level**: Based on the sample size and win rate, how confident should traders be in this pattern? (high/medium/low)

8. **How to Use in Trading**: Step-by-step guidance on how to identify and trade this pattern in real-time.

9. **Position Sizing Guidance**: How should position size be adjusted for this pattern based on its characteristics?

10. **Entry Timing**: When exactly should you enter? Any specific signals to wait for?

11. **Exit Timing**: When should you take profits or cut losses? Any specific exit signals?

12. **Pattern Synergies**: What other patterns or indicators work well WITH this pattern? (list 2-3)

13. **Pattern Conflicts**: What patterns or conditions CONFLICT with this pattern? (list 2-3)

14. **Degradation Signs**: What early warning signs indicate this pattern is losing effectiveness?

15. **Pattern Strength Assessment**: Overall, how strong and reliable is this pattern? Rate its quality.

**RESPOND IN VALID JSON FORMAT:**

{
  "plainEnglishExplanation": "string",
  "whyItWorks": "string",
  "marketPsychologyNotes": "string",
  "optimalConditions": "string",
  "conditionsToAvoid": "string",
  "riskWarnings": ["string", "string"],
  "confidenceLevel": "high|medium|low",
  "howToUseInTrading": "string",
  "positionSizingGuidance": "string",
  "entryTimingGuidance": "string",
  "exitTimingGuidance": "string",
  "synergiesWithPatterns": ["string", "string"],
  "conflictsWithPatterns": ["string", "string"],
  "degradationSigns": ["string", "string"],
  "patternStrengthAssessment": "string"
}

**IMPORTANT**: Be practical, specific, and trading-focused. This interpretation will be used by the AI to make better trading decisions.`;
  }

  /**
   * Call GPT-4o API
   */
  private async callGPT4o(
    prompt: string,
    userId: string
  ): Promise<{ content: string; tokensUsed: number } | null> {
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY || import.meta.env.OPENAI_API_KEY;

    if (!apiKey) {
      console.error('[Pattern Interpreter] OpenAI API key not found');
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
              content: 'You are an expert forex trader and trading pattern analyst. You explain trading patterns in clear, practical terms and provide actionable guidance.'
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
        console.error('[Pattern Interpreter] API error:', errorText);
        return null;
      }

      const data = await response.json();
      const responseTime = Date.now() - startTime;

      // Track usage
      await this.trackUsage(
        userId,
        'pattern_interpreter',
        'interpretPattern',
        data.usage.prompt_tokens,
        data.usage.completion_tokens,
        data.usage.total_tokens,
        responseTime,
        true,
        null,
        pattern.patternId
      );

      return {
        content: data.choices[0].message.content,
        tokensUsed: data.usage.total_tokens
      };
    } catch (error) {
      console.error('[Pattern Interpreter] API call failed:', error);

      // Track failed call
      await this.trackUsage(
        userId,
        'pattern_interpreter',
        'interpretPattern',
        0,
        0,
        0,
        Date.now() - startTime,
        false,
        error instanceof Error ? error.message : 'Unknown error',
        pattern.patternId
      );

      return null;
    }
  }

  /**
   * Parse GPT-4o JSON response
   */
  private parseGPT4oResponse(content: string): PatternInterpretation {
    try {
      return JSON.parse(content);
    } catch (error) {
      console.error('[Pattern Interpreter] Failed to parse response:', error);
      // Return empty structure
      return {
        plainEnglishExplanation: 'Error parsing GPT-4o response',
        whyItWorks: 'Unable to interpret',
        marketPsychologyNotes: 'N/A',
        optimalConditions: 'Unknown',
        conditionsToAvoid: 'Unknown',
        riskWarnings: ['Failed to generate warnings'],
        confidenceLevel: 'low',
        howToUseInTrading: 'Interpretation unavailable',
        positionSizingGuidance: 'Use standard sizing',
        entryTimingGuidance: 'Wait for standard signals',
        exitTimingGuidance: 'Use standard exits',
        synergiesWithPatterns: [],
        conflictsWithPatterns: [],
        degradationSigns: [],
        patternStrengthAssessment: 'Unable to assess'
      };
    }
  }

  /**
   * Save pattern interpretation to database
   */
  private async savePatternInterpretation(
    userId: string,
    pattern: DiscoveredPattern,
    interpretation: PatternInterpretation,
    tokensUsed: number
  ): Promise<void> {
    try {
      const { error } = await supabase.from('ai_pattern_interpretations').insert({
        user_id: userId,
        pattern_id: pattern.patternId,
        pattern_name: pattern.patternName,
        symbol: pattern.symbol,
        timeframe: pattern.timeframe,
        pattern_summary: {
          winRate: pattern.winRate,
          profitFactor: pattern.profitFactor,
          expectancy: pattern.expectancy,
          avgRR: pattern.avgRR,
          sampleSize: pattern.sampleSize,
          volatilityRegime: pattern.volatilityRegime,
          trendDirection: pattern.trendDirection
        },
        plain_english_explanation: interpretation.plainEnglishExplanation,
        why_it_works: interpretation.whyItWorks,
        market_psychology_notes: interpretation.marketPsychologyNotes,
        optimal_conditions: interpretation.optimalConditions,
        conditions_to_avoid: interpretation.conditionsToAvoid,
        risk_warnings: interpretation.riskWarnings,
        confidence_level: interpretation.confidenceLevel,
        how_to_use_in_trading: interpretation.howToUseInTrading,
        position_sizing_guidance: interpretation.positionSizingGuidance,
        entry_timing_guidance: interpretation.entryTimingGuidance,
        exit_timing_guidance: interpretation.exitTimingGuidance,
        synergies_with_patterns: interpretation.synergiesWithPatterns,
        conflicts_with_patterns: interpretation.conflictsWithPatterns,
        degradation_signs: interpretation.degradationSigns,
        pattern_strength_assessment: interpretation.patternStrengthAssessment,
        gpt4o_model: this.MODEL,
        tokens_used: tokensUsed,
        interpretation_quality_score: 85
      });

      if (error) {
        console.error('[Pattern Interpreter] Error saving interpretation:', error);
      } else {
        console.log('[Pattern Interpreter] ✓ Interpretation saved to database');
      }
    } catch (error) {
      console.error('[Pattern Interpreter] Exception saving interpretation:', error);
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
    errorMessage: string | null,
    relatedPatternId?: string
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
        error_message: errorMessage,
        related_pattern_id: relatedPatternId
      });
    } catch (error) {
      console.error('[Pattern Interpreter] Error tracking usage:', error);
    }
  }

  /**
   * Get pattern interpretation from database
   */
  async getPatternInterpretation(
    userId: string,
    patternId: string
  ): Promise<any | null> {
    try {
      const { data, error } = await supabase
        .from('ai_pattern_interpretations')
        .select('*')
        .eq('user_id', userId)
        .eq('pattern_id', patternId)
        .maybeSingle();

      if (error) {
        console.error('[Pattern Interpreter] Error fetching interpretation:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('[Pattern Interpreter] Exception fetching interpretation:', error);
      return null;
    }
  }

  /**
   * Get all interpretations for a symbol
   */
  async getInterpretationsForSymbol(
    userId: string,
    symbol: string
  ): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('ai_pattern_interpretations')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[Pattern Interpreter] Error fetching interpretations:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[Pattern Interpreter] Exception fetching interpretations:', error);
      return [];
    }
  }

  /**
   * Enable/disable the interpreter
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    console.log(`[Pattern Interpreter] ${enabled ? 'Enabled' : 'Disabled'}`);
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

export const patternInterpreter = new PatternInterpreter();
export type { DiscoveredPattern, PatternInterpretation };

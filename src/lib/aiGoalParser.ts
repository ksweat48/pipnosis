/**
 * AI GOAL PARSER
 *
 * ARCHITECTURE PRINCIPLE: Risk and Style are INDEPENDENT dimensions
 *
 * This parser extracts TWO separate concepts from user goals:
 *
 * 1. RISK MODE (money exposure):
 *    - Keywords: "conservative exposure", "aggressive exposure", "low risk", "high risk"
 *    - Controls: How much capital to risk per trade (0.3-3%)
 *
 * 2. TRADE STYLE (time preference - INTRADAY-ONLY):
 *    - Keywords: "scalp", "quick", "micro", "patient", "fast"
 *    - Controls: Preference for entry/exit speed (20min to 10hrs, intraday-only)
 *
 * CRITICAL: These are NOT coupled. Users can request:
 * - "Conservative scalp" = Low $ risk + Fast style
 * - "Aggressive intraday" = High $ risk + Patient style
 *
 * The parser communicates both dimensions to Alpha, which makes final decisions
 * based on market conditions.
 */

import { GoalSessionConfig } from '@/services/goal-session-manager';
import { getDefaultWatchlist } from '../config/watchlist';
import { getRiskPercentage, getRiskModeDescription } from '../config/risk-levels';
import { goalIntelligenceClassifier, GoalClassification } from '@/services/goal-intelligence-classifier';
import { generateTimeframe, type Timeframe } from '../config/timeframe-hierarchy';

interface AIGoalParsing {
  config: GoalSessionConfig;
  interpretation: string;
  suggestedWatchlist: string[];
  estimatedTrades: number;
  timeline: string;
  goalClassification?: GoalClassification;
}

class AIGoalParser {
  private apiKey: string;
  private cache: Map<string, AIGoalParsing> = new Map();

  constructor() {
    this.apiKey = import.meta.env.VITE_OPENAI_API_KEY || '';
  }

  private async parseWithAI(prompt: string, currentBalance: number): Promise<AIGoalParsing | null> {
    if (!this.apiKey) {
      console.warn('[AI Goal Parser] OpenAI API key not configured, using rule-based parsing');
      return null;
    }

    const cacheKey = `${prompt}_${currentBalance}`;
    if (this.cache.has(cacheKey)) {
      console.log('[AI Goal Parser] Using cached goal interpretation');
      return this.cache.get(cacheKey)!;
    }

    try {
      const systemPrompt = `You are an expert trading goal interpreter. Parse user trading goals into structured configuration.

SIMPLIFIED RISK SYSTEM:
- All trades use standard 1-3% risk per trade
- Risk is controlled by dollar amounts (user picks specific $ to risk)
- Maximum 10% total account exposure across all open positions

TRADE STYLES (Time Preference - INTRADAY-ONLY):
- "scalp": Fast trades, 20min-2hr duration
- "micro_intraday": Medium trades, 1hr-6hr duration
- "intraday": Longer trades, 2hr-10hr duration

For backward compatibility, map old risk modes:
- "low" -> standard (same risk policy)
- "medium" -> standard (same risk policy)
- "high" -> standard (same risk policy)

Focus on extracting the trade style preference from user goals.`;

      const userPrompt = `Parse this trading goal into structured format:
Goal: "${prompt}"
Current Balance: $${currentBalance}

Respond with ONLY valid JSON in this format:
{
  "goalType": "profit_target|percentage_gain|account_growth",
  "targetValue": <number>,
  "timeframe": "<X hours|days|weeks|months>",
  "riskMode": "low|medium|high",
  "interpretation": "<friendly 1-sentence summary>",
  "suggestedWatchlist": ["SYMBOL1", "SYMBOL2", "SYMBOL3"],
  "estimatedTrades": <number>,
  "timeline": "<realistic time expectation>"
}`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3,
          max_tokens: 400
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('No content in OpenAI response');
      }

      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleanContent);

      const result: AIGoalParsing = {
        config: {
          goalType: parsed.goalType,
          targetValue: parsed.targetValue,
          timeframe: parsed.timeframe,
          riskMode: parsed.riskMode,
          watchlist: parsed.suggestedWatchlist
        },
        interpretation: parsed.interpretation,
        suggestedWatchlist: parsed.suggestedWatchlist,
        estimatedTrades: parsed.estimatedTrades,
        timeline: parsed.timeline
      };

      this.cache.set(cacheKey, result);
      console.log('[AI Goal Parser] Goal parsed with GPT-4');

      return result;

    } catch (error) {
      console.error('[AI Goal Parser] Failed to parse with AI:', error);
      return null;
    }
  }

  private parseWithRules(prompt: string, currentBalance: number): AIGoalParsing {
    const lowerPrompt = prompt.toLowerCase();

    const profitMatch = lowerPrompt.match(/\$?\s*(\d+(?:\.\d+)?)/);
    const percentMatch = lowerPrompt.match(/(\d+(?:\.\d+)?)\s*%/);

    let targetValue = 0;
    let goalType: 'profit_target' | 'percentage_gain' | 'account_growth' = 'profit_target';

    if (percentMatch) {
      targetValue = parseFloat(percentMatch[1]);
      goalType = 'percentage_gain';
    } else if (profitMatch) {
      targetValue = parseFloat(profitMatch[1]);
      goalType = 'profit_target';
    } else {
      targetValue = 100;
      goalType = 'profit_target';
    }

    const timeframePatterns = [
      { regex: /today|this\s+day/i, timeframe: 'D1' },
      { regex: /this\s+week|weekly/i, timeframe: 'D1' },
      { regex: /this\s+month|monthly/i, timeframe: 'D1' },
      { regex: /(\d+)\s+hour/i, extract: true, unit: 'h' },
      { regex: /(\d+)\s+day/i, extract: true, unit: 'd' },
      { regex: /(\d+)\s+week/i, extract: true, unit: 'd' },
    ];

    let timeframeInput = 'D1';
    for (const pattern of timeframePatterns) {
      const match = lowerPrompt.match(pattern.regex);
      if (match) {
        if (pattern.extract) {
          const value = parseInt(match[1]);
          // Map user input to valid timeframes (M1, M5, M15, M30, H1, H4, D1 only)
          if (pattern.unit === 'h') {
            timeframeInput = value <= 4 ? 'H1' : 'H4';
          } else if (pattern.unit === 'd') {
            timeframeInput = 'D1';
          }
        } else {
          timeframeInput = pattern.timeframe;
        }
        break;
      }
    }

    // CCIP: Use centralized generation authority to ensure valid timeframe
    const timeframe = generateTimeframe(timeframeInput)

    // CRITICAL: Separate risk (money exposure) from style (time preference)
    const exposureKeywords = {
      conservative: /safe|careful|conservative|low\s+risk|conservative\s+exposure|low\s+exposure/i,
      aggressive: /aggressive\s+exposure|high\s+risk|high\s+exposure|risky/i
    };

    const styleKeywords = {
      scalp: /scalp|quick|fast\s+entry|fast\s+exit|quick\s+move/i,
      micro: /micro|short\s+intraday/i,
      intraday: /intraday|full\s+day|patient/i
    };

    let riskMode: 'low' | 'medium' | 'high' = 'medium';
    if (exposureKeywords.conservative.test(lowerPrompt)) riskMode = 'low';
    if (exposureKeywords.aggressive.test(lowerPrompt)) riskMode = 'high';

    // Note: Style detection kept for future use, but NOT coupled to risk mode
    // Alpha will independently choose style based on market conditions

    const riskMultipliers = { low: 0.5, medium: 1, high: 2 };
    const baseTradesPerDay = 3;
    const timeframeDays = timeframe.includes('week') ? 7 : timeframe.includes('month') ? 30 : 1;
    const estimatedTrades = Math.ceil(baseTradesPerDay * timeframeDays * riskMultipliers[riskMode]);

    const watchlist = getDefaultWatchlist();

    const riskPercent = getRiskPercentage(riskMode);
    const riskDescription = getRiskModeDescription(riskMode);

    // Detect if user specified a style preference (intraday-only)
    let styleNote = '';
    if (styleKeywords.scalp.test(lowerPrompt)) {
      styleNote = ' Alpha will prioritize fast scalp-style setups (20min-2hrs).';
    } else if (styleKeywords.micro.test(lowerPrompt)) {
      styleNote = ' Alpha will prioritize micro intraday setups (1-6hrs).';
    } else if (styleKeywords.intraday.test(lowerPrompt)) {
      styleNote = ' Alpha will prioritize full intraday setups (2-10hrs).';
    } else {
      styleNote = ' Alpha will choose the optimal style based on market conditions.';
    }

    return {
      config: {
        goalType,
        targetValue,
        timeframe: timeframe as Timeframe,
        riskMode,
        watchlist
      },
      interpretation: `I'll help you ${goalType === 'profit_target' ? `earn $${targetValue}` : `grow your account by ${targetValue}%`} with ${riskDescription} money exposure (max ${riskPercent}% per trade).${styleNote}`,
      suggestedWatchlist: watchlist,
      estimatedTrades,
      timeline: timeframe
    };
  }

  async parseGoal(prompt: string, currentBalance: number): Promise<AIGoalParsing> {
    const aiResult = await this.parseWithAI(prompt, currentBalance);
    const result = aiResult || this.parseWithRules(prompt, currentBalance);

    if (!aiResult) {
      console.log('[AI Goal Parser] Using fallback rule-based parsing');
    }

    // Add goal intelligence classification
    const targetAmount = result.config.goalType === 'percentage_gain'
      ? (currentBalance * result.config.targetValue) / 100
      : result.config.targetValue;

    const goalClassification = goalIntelligenceClassifier.classify({
      goalAmount: targetAmount,
      accountBalance: currentBalance,
      timeframe: result.config.timeframe
    });

    result.goalClassification = goalClassification;

    // Update interpretation with goal mode information
    result.interpretation = `${goalClassification.userMessage}\n\nMode: ${goalClassification.mode.toUpperCase()} - ${goalClassification.executionPsychology} execution`;

    console.log(
      `[AI Goal Parser] Goal classified as ${goalClassification.mode.toUpperCase()} (${goalClassification.goalRatioPercent.toFixed(1)}% of balance)`
    );

    return result;
  }

  async validateGoal(config: GoalSessionConfig, currentBalance: number): Promise<{
    isRealistic: boolean;
    warnings: string[];
    suggestions: string[];
  }> {
    const warnings: string[] = [];
    const suggestions: string[] = [];

    const targetAmount = config.goalType === 'percentage_gain'
      ? (currentBalance * config.targetValue) / 100
      : config.targetValue;

    // Use Goal Intelligence Classification
    const goalClassification = goalIntelligenceClassifier.classify({
      goalAmount: targetAmount,
      accountBalance: currentBalance,
      timeframe: config.timeframe
    });

    // Add mode-specific warnings and suggestions
    if (goalClassification.mode === 'growth') {
      warnings.push(
        `Goal is ${goalClassification.goalRatioPercent.toFixed(1)}% of balance - exceeds safe execution limits`
      );
      suggestions.push(goalClassification.reasoning);

      if (goalClassification.alternativeApproach) {
        suggestions.push(
          `Suggested approach: ${goalClassification.alternativeApproach.reasoning}`
        );
      }
    } else if (goalClassification.mode === 'campaign') {
      warnings.push(
        `Goal is ${goalClassification.goalRatioPercent.toFixed(1)}% of balance - requires multi-session campaign`
      );
      suggestions.push(
        `This goal needs patience and consistency. Expect ${goalClassification.expectedTradeCount}+ trades over multiple sessions.`
      );
    } else if (goalClassification.mode === 'execution') {
      // Execution mode is realistic but needs discipline
      suggestions.push(
        `${goalClassification.executionPsychology} execution required. Expected: ${goalClassification.expectedTradeCount} quality trades.`
      );
    } else if (goalClassification.mode === 'precision') {
      // Precision mode is most realistic
      suggestions.push(
        `Precision mode: One surgical trade should achieve this goal efficiently.`
      );
    }

    return {
      isRealistic: goalClassification.isFeasible,
      warnings,
      suggestions
    };
  }

  private parseTimeframeToHours(timeframe: string): number {
    const normalized = timeframe.toLowerCase();
    const match = normalized.match(/(\d+)\s*(hour|day|week|month)/);

    if (!match) return 24;

    const value = parseInt(match[1]);
    const unit = match[2];

    const multipliers: Record<string, number> = {
      hour: 1,
      day: 24,
      week: 168,
      month: 720
    };

    return value * (multipliers[unit] || 24);
  }

  clearCache(): void {
    this.cache.clear();
    console.log('[AI Goal Parser] Cache cleared');
  }
}

export const aiGoalParser = new AIGoalParser();

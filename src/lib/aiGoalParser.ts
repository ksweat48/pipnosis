import { GoalSessionConfig } from '@/services/goal-session-manager';
import { getDefaultWatchlist } from '../config/watchlist';

interface AIGoalParsing {
  config: GoalSessionConfig;
  interpretation: string;
  suggestedWatchlist: string[];
  estimatedTrades: number;
  timeline: string;
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
      const systemPrompt = `You are an expert trading goal interpreter. Parse user trading goals into structured configuration. Consider their account balance and provide realistic assessments.`;

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
      { regex: /today|this\s+day/i, timeframe: '1 day' },
      { regex: /this\s+week|weekly/i, timeframe: '1 week' },
      { regex: /this\s+month|monthly/i, timeframe: '1 month' },
      { regex: /(\d+)\s+hour/i, extract: true, unit: 'hour' },
      { regex: /(\d+)\s+day/i, extract: true, unit: 'day' },
      { regex: /(\d+)\s+week/i, extract: true, unit: 'week' },
    ];

    let timeframe = '1 day';
    for (const pattern of timeframePatterns) {
      const match = lowerPrompt.match(pattern.regex);
      if (match) {
        if (pattern.extract) {
          timeframe = `${match[1]} ${pattern.unit}${parseInt(match[1]) > 1 ? 's' : ''}`;
        } else {
          timeframe = pattern.timeframe;
        }
        break;
      }
    }

    const exposureKeywords = {
      conservative: /safe|careful|conservative|low\s+risk|conservative\s+exposure/i,
      aggressive: /aggressive|fast|risky|high\s+risk|aggressive\s+exposure/i
    };

    let riskMode: 'low' | 'medium' | 'high' = 'medium';
    if (exposureKeywords.conservative.test(lowerPrompt)) riskMode = 'low';
    if (exposureKeywords.aggressive.test(lowerPrompt)) riskMode = 'high';

    // Note: 'riskMode' field name kept for backward compatibility
    // But semantics changed: now means "exposure_level" (max capital at risk)
    // NOT behavioral constraints on LLM confidence/psychology

    const riskMultipliers = { low: 0.5, medium: 1, high: 2 };
    const baseTradesPerDay = 3;
    const timeframeDays = timeframe.includes('week') ? 7 : timeframe.includes('month') ? 30 : 1;
    const estimatedTrades = Math.ceil(baseTradesPerDay * timeframeDays * riskMultipliers[riskMode]);

    const watchlist = getDefaultWatchlist();

    return {
      config: {
        goalType,
        targetValue,
        timeframe,
        riskMode,
        watchlist
      },
      interpretation: `I'll help you ${goalType === 'profit_target' ? `earn $${targetValue}` : `grow your account by ${targetValue}%`} over ${timeframe} with ${riskMode === 'low' ? 'conservative' : riskMode === 'high' ? 'aggressive' : 'moderate'} capital exposure (max ${riskMode === 'low' ? '1%' : riskMode === 'high' ? '5%' : '2%'} per trade). AI trades autonomously based on market conditions.`,
      suggestedWatchlist: watchlist,
      estimatedTrades,
      timeline: timeframe
    };
  }

  async parseGoal(prompt: string, currentBalance: number): Promise<AIGoalParsing> {
    const aiResult = await this.parseWithAI(prompt, currentBalance);
    if (aiResult) {
      return aiResult;
    }

    console.log('[AI Goal Parser] Using fallback rule-based parsing');
    return this.parseWithRules(prompt, currentBalance);
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

    const percentOfBalance = (targetAmount / currentBalance) * 100;

    if (percentOfBalance > 50) {
      warnings.push(`Target is ${percentOfBalance.toFixed(0)}% of your balance - very aggressive`);
      suggestions.push(`Consider targeting 5-10% for sustainable growth`);
    }

    const timeframeHours = this.parseTimeframeToHours(config.timeframe);
    const requiredReturnPerHour = (targetAmount / currentBalance) * 100 / timeframeHours;

    if (requiredReturnPerHour > 1) {
      warnings.push(`Requires ${requiredReturnPerHour.toFixed(1)}% return per hour - unrealistic`);
      suggestions.push(`Extend timeframe or reduce target for better success probability`);
    }

    if (config.riskMode === 'high' && percentOfBalance > 20) {
      warnings.push(`High risk mode with large target may lead to significant drawdown`);
      suggestions.push(`Consider medium risk mode for better capital preservation`);
    }

    return {
      isRealistic: warnings.length === 0,
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

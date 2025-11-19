/**
 * LLM Strategy Brain
 *
 * Multi-provider LLM integration for trade decision-making.
 * Primary: GPT-4, with infrastructure for future providers (Claude, Gemini).
 * All decisions are constrained by Pipnosis core rules.
 */

import { PIPNOSIS_CORE_RULES, PipnosisCoreRules } from '../lib/pipnosis-core-rules';
import { llmContextEnricher, type EnrichedContext } from './llm-context-enricher';

export interface MarketSnapshot {
  symbol: string;
  timeframes: {
    [key: string]: {
      currentPrice: number;
      ema9: number;
      ema21: number;
      ema50: number;
      rsi: number;
      atr: number;
      vwap: number;
      trend: 'bullish' | 'bearish' | 'sideways';
      volatility: 'low' | 'medium' | 'high';
    };
  };
  recentPriceAction: string;
  openPositions: number;
  accountExposure: number;
}

export interface GoalContext {
  targetAmount: number;
  currentProfit: number;
  progressPercent: number;
  remainingAmount: number;
  tradesCompleted: number;
  avgProfitPerTrade: number;
  sessionDuration: string;
}

export interface RelevantHistory {
  recentWinRate: number;
  recentProfitFactor: number;
  bestSetupType: string;
  worstSetupType: string;
  avgTradeDuration: number;
  keyLessons: string[];
}

export interface LLMTradeDecision {
  action: 'enter_long' | 'enter_short' | 'no_trade' | 'hold' | 'close';
  confidence: number;
  entryZone?: {
    min: number;
    max: number;
    ideal: number;
  };
  stopLoss?: number;
  takeProfit?: number;
  positionSizePercent?: number;
  expectedDurationMinutes?: number;
  reasoning: string;
  riskAssessment: string;
  setupType: string;
  keyFactors: string[];
  alternativeScenarios?: string[];
}

export interface LLMProviderConfig {
  name: string;
  apiKey: string;
  model: string;
  endpoint: string;
  maxTokens: number;
  temperature: number;
}

abstract class LLMProvider {
  protected config: LLMProviderConfig;
  protected callCount: number = 0;
  protected lastCallTime: Date | null = null;

  constructor(config: LLMProviderConfig) {
    this.config = config;
  }

  abstract makeDecision(
    snapshot: MarketSnapshot,
    goalContext?: GoalContext,
    history?: RelevantHistory
  ): Promise<LLMTradeDecision>;

  protected buildSystemPrompt(): string {
    return PipnosisCoreRules.getSystemIdentityPrompt();
  }

  getUsageStats(): { calls: number; lastCall: Date | null } {
    return {
      calls: this.callCount,
      lastCall: this.lastCallTime
    };
  }
}

class GPT4Provider extends LLMProvider {
  async makeDecision(
    snapshot: MarketSnapshot,
    goalContext?: GoalContext,
    history?: RelevantHistory,
    userId?: string
  ): Promise<LLMTradeDecision> {
    const systemPrompt = this.buildSystemPrompt();

    let enrichedContext: EnrichedContext | null = null;
    if (userId) {
      enrichedContext = await llmContextEnricher.enrichDecisionContext(
        userId,
        snapshot.symbol,
        75,
        snapshot.timeframes
      );
    }

    const userPrompt = this.buildUserPrompt(snapshot, goalContext, history, enrichedContext);

    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens
        })
      });

      if (!response.ok) {
        throw new Error(`GPT-4 API error: ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('No content in GPT-4 response');
      }

      this.callCount++;
      this.lastCallTime = new Date();

      const decision = this.parseResponse(content);
      return this.validateAndEnforceRules(decision, snapshot);

    } catch (error) {
      console.error('[GPT-4 Provider] Error:', error);
      throw error;
    }
  }

  private buildUserPrompt(
    snapshot: MarketSnapshot,
    goalContext?: GoalContext,
    history?: RelevantHistory,
    enrichedContext?: EnrichedContext | null
  ): string {
    const primaryTF = 'M15';
    const tfData = snapshot.timeframes[primaryTF];

    let prompt = `Analyze this short-term trading opportunity:

MARKET SNAPSHOT (${snapshot.symbol}):
Primary Timeframe: ${primaryTF}
- Current Price: ${tfData.currentPrice.toFixed(5)}
- EMA9: ${tfData.ema9.toFixed(5)} | EMA21: ${tfData.ema21.toFixed(5)} | EMA50: ${tfData.ema50.toFixed(5)}
- RSI: ${tfData.rsi.toFixed(2)}
- ATR: ${tfData.atr.toFixed(5)}
- VWAP: ${tfData.vwap.toFixed(5)}
- Trend: ${tfData.trend}
- Volatility: ${tfData.volatility}
- Recent Price Action: ${snapshot.recentPriceAction}

MULTI-TIMEFRAME CONTEXT:`;

    for (const [tf, data] of Object.entries(snapshot.timeframes)) {
      if (tf !== primaryTF) {
        prompt += `\n${tf}: Trend=${data.trend}, RSI=${data.rsi.toFixed(1)}, Price vs VWAP=${((data.currentPrice - data.vwap) / data.vwap * 100).toFixed(2)}%`;
      }
    }

    prompt += `\n\nCURRENT EXPOSURE:
- Open Positions: ${snapshot.openPositions}
- Account Exposure: ${snapshot.accountExposure.toFixed(1)}%`;

    if (goalContext) {
      prompt += `\n\nGOAL CONTEXT:
- Target: $${goalContext.targetAmount.toFixed(2)}
- Current Profit: $${goalContext.currentProfit.toFixed(2)} (${goalContext.progressPercent.toFixed(1)}%)
- Remaining: $${goalContext.remainingAmount.toFixed(2)}
- Trades Completed: ${goalContext.tradesCompleted}
- Avg Profit/Trade: $${goalContext.avgProfitPerTrade.toFixed(2)}
- Session Duration: ${goalContext.sessionDuration}`;
    }

    if (history) {
      prompt += `\n\nRECENT PERFORMANCE:
- Win Rate: ${history.recentWinRate.toFixed(1)}%
- Profit Factor: ${history.recentProfitFactor.toFixed(2)}
- Best Setup: ${history.bestSetupType}
- Avg Duration: ${history.avgTradeDuration.toFixed(0)} minutes
- Key Lessons: ${history.keyLessons.join(', ')}`;
    }

    if (enrichedContext) {
      prompt += `\n\nSELF-AWARE AI CONTEXT:
Historical Performance (${enrichedContext.historicalPerformance.symbol}):
- Recent Win Rate: ${enrichedContext.historicalPerformance.recentWinRate.toFixed(1)}%
- Recent Profit Factor: ${enrichedContext.historicalPerformance.recentProfitFactor.toFixed(2)}
- Trades Analyzed: ${enrichedContext.historicalPerformance.tradesAnalyzed}
- Best Setup Type: ${enrichedContext.historicalPerformance.bestSetupType}

LLM-Discovered Insights:`;
      if (enrichedContext.llmInsights.length > 0) {
        enrichedContext.llmInsights.slice(0, 3).forEach((insight, i) => {
          prompt += `\n  ${i + 1}. ${insight.title} (${insight.confidence.toFixed(0)}% confidence)
     - ${insight.description}
     - Apply when: ${insight.whenToApply}
     - Avoid when: ${insight.whenToAvoid}`;
        });
      } else {
        prompt += `\n  No LLM insights available yet - learning in progress`;
      }

      prompt += `\n\nConfidence Calibration:
- Recommended Threshold: ${enrichedContext.confidenceCalibration.recommendedThreshold}%
- Reasoning: ${enrichedContext.confidenceCalibration.reasoning}
- Recent Accuracy: ${enrichedContext.confidenceCalibration.recentAccuracy.toFixed(1)}%

Strategic Guidance:`;
      enrichedContext.strategicGuidance.forEach(guidance => {
        prompt += `\n- ${guidance}`;
      });
    }

    prompt += `\n\nProvide your decision in this EXACT JSON format (no markdown):
{
  "action": "enter_long|enter_short|no_trade|hold|close",
  "confidence": <0-100>,
  "entryZone": {
    "min": <price>,
    "max": <price>,
    "ideal": <price>
  },
  "stopLoss": <price>,
  "takeProfit": <price>,
  "positionSizePercent": <1-5>,
  "expectedDurationMinutes": <10-${PIPNOSIS_CORE_RULES.TRADE_DURATION_MAX_MINUTES}>,
  "reasoning": "<concise 2-3 sentence explanation>",
  "riskAssessment": "<1-2 sentence risk analysis>",
  "setupType": "<descriptive name>",
  "keyFactors": ["<factor1>", "<factor2>", "<factor3>"],
  "alternativeScenarios": ["<scenario1>", "<scenario2>"]
}

CRITICAL REMINDERS:
- Maximum trade duration: ${PIPNOSIS_CORE_RULES.TRADE_DURATION_MAX_HOURS} hours (${PIPNOSIS_CORE_RULES.TRADE_DURATION_MAX_MINUTES} minutes)
- Preferred duration: under ${PIPNOSIS_CORE_RULES.TRADE_DURATION_PREFERRED_MAX_HOURS} hours
- Only suggest trades you expect to close within hours, not days
- If no short-term opportunity exists, recommend "no_trade"`;

    return prompt;
  }

  private parseResponse(content: string): LLMTradeDecision {
    const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleanContent);

    return {
      action: parsed.action || 'no_trade',
      confidence: parsed.confidence || 0,
      entryZone: parsed.entryZone,
      stopLoss: parsed.stopLoss,
      takeProfit: parsed.takeProfit,
      positionSizePercent: parsed.positionSizePercent || 2,
      expectedDurationMinutes: parsed.expectedDurationMinutes || 120,
      reasoning: parsed.reasoning || '',
      riskAssessment: parsed.riskAssessment || '',
      setupType: parsed.setupType || 'Unknown',
      keyFactors: parsed.keyFactors || [],
      alternativeScenarios: parsed.alternativeScenarios || []
    };
  }

  private validateAndEnforceRules(
    decision: LLMTradeDecision,
    snapshot: MarketSnapshot
  ): LLMTradeDecision {
    const durationValidation = PipnosisCoreRules.validateTradeDuration(
      decision.expectedDurationMinutes || 120
    );

    if (!durationValidation.isValid) {
      PipnosisCoreRules.enforcementLog(
        durationValidation.violations.join(', '),
        `Adjusted duration from ${decision.expectedDurationMinutes} to ${PIPNOSIS_CORE_RULES.TRADE_DURATION_PREFERRED_MAX_HOURS * 60} minutes`
      );
      decision.expectedDurationMinutes = PIPNOSIS_CORE_RULES.TRADE_DURATION_PREFERRED_MAX_HOURS * 60;
    }

    if (decision.positionSizePercent && decision.positionSizePercent > 5) {
      PipnosisCoreRules.enforcementLog(
        `Position size ${decision.positionSizePercent}% exceeds safe limit`,
        'Reduced to 5%'
      );
      decision.positionSizePercent = 5;
    }

    return decision;
  }
}

class LLMStrategyBrain {
  private providers: Map<string, LLMProvider> = new Map();
  private primaryProvider: string = 'gpt4';
  private fallbackEnabled: boolean = true;

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    const apiKey = typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_OPENAI_API_KEY || ''
      : process.env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';

    if (apiKey) {
      const gpt4Config: LLMProviderConfig = {
        name: 'GPT-4',
        apiKey,
        model: 'gpt-4o',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        maxTokens: 1000,
        temperature: 0.3
      };

      this.providers.set('gpt4', new GPT4Provider(gpt4Config));
      console.log('[LLM Strategy Brain] GPT-4 provider initialized');
    } else {
      console.warn('[LLM Strategy Brain] No API key found, LLM features disabled');
    }
  }

  async makeDecision(
    snapshot: MarketSnapshot,
    goalContext?: GoalContext,
    history?: RelevantHistory
  ): Promise<LLMTradeDecision> {
    const provider = this.providers.get(this.primaryProvider);

    if (!provider) {
      console.warn('[LLM Strategy Brain] Primary provider not available, using fallback');
      return this.fallbackDecision(snapshot);
    }

    try {
      const decision = await provider.makeDecision(snapshot, goalContext, history);
      console.log(`[LLM Strategy Brain] Decision: ${decision.action}, Confidence: ${decision.confidence}%`);
      return decision;
    } catch (error) {
      console.error('[LLM Strategy Brain] Provider error:', error);

      if (this.fallbackEnabled) {
        console.log('[LLM Strategy Brain] Falling back to rule-based decision');
        return this.fallbackDecision(snapshot);
      }

      throw error;
    }
  }

  private fallbackDecision(snapshot: MarketSnapshot): LLMTradeDecision {
    const primaryTF = 'M15';
    const tfData = snapshot.timeframes[primaryTF];

    if (!tfData) {
      return {
        action: 'no_trade',
        confidence: 0,
        reasoning: 'Insufficient market data for decision',
        riskAssessment: 'Unable to assess risk without complete data',
        setupType: 'No Setup',
        keyFactors: ['Missing market data'],
        expectedDurationMinutes: 120
      };
    }

    const priceVsVwap = tfData.currentPrice - tfData.vwap;
    const priceVsVwapPercent = (priceVsVwap / tfData.vwap) * 100;
    const emaAligned = tfData.ema9 > tfData.ema21 && tfData.ema21 > tfData.ema50;
    const emaBearish = tfData.ema9 < tfData.ema21 && tfData.ema21 < tfData.ema50;

    if (Math.abs(priceVsVwapPercent) < 0.15 && emaAligned && tfData.rsi > 45 && tfData.rsi < 65) {
      return {
        action: 'enter_long',
        confidence: 70,
        entryZone: {
          min: tfData.currentPrice - tfData.atr * 0.2,
          max: tfData.currentPrice + tfData.atr * 0.2,
          ideal: tfData.currentPrice
        },
        stopLoss: tfData.currentPrice - tfData.atr * 1.5,
        takeProfit: tfData.currentPrice + tfData.atr * 2.5,
        positionSizePercent: 2,
        expectedDurationMinutes: 90,
        reasoning: 'VWAP support with bullish EMA alignment and neutral RSI',
        riskAssessment: 'Moderate risk with defined stop loss at 1.5 ATR',
        setupType: 'VWAP Bounce Long',
        keyFactors: ['VWAP support', 'EMA alignment', 'Neutral momentum']
      };
    }

    if (Math.abs(priceVsVwapPercent) < 0.15 && emaBearish && tfData.rsi > 35 && tfData.rsi < 55) {
      return {
        action: 'enter_short',
        confidence: 70,
        entryZone: {
          min: tfData.currentPrice - tfData.atr * 0.2,
          max: tfData.currentPrice + tfData.atr * 0.2,
          ideal: tfData.currentPrice
        },
        stopLoss: tfData.currentPrice + tfData.atr * 1.5,
        takeProfit: tfData.currentPrice - tfData.atr * 2.5,
        positionSizePercent: 2,
        expectedDurationMinutes: 90,
        reasoning: 'VWAP resistance with bearish EMA alignment and weak RSI',
        riskAssessment: 'Moderate risk with defined stop loss at 1.5 ATR',
        setupType: 'VWAP Rejection Short',
        keyFactors: ['VWAP resistance', 'Bearish EMAs', 'Weak momentum']
      };
    }

    return {
      action: 'no_trade',
      confidence: 50,
      reasoning: 'No high-probability short-term setup detected. Waiting for clearer opportunity.',
      riskAssessment: 'Low confidence prevents trade entry',
      setupType: 'No Setup',
      keyFactors: ['Unclear trend', 'No VWAP alignment', 'Waiting for confirmation'],
      expectedDurationMinutes: 120
    };
  }

  getProviderStats(): Record<string, any> {
    const stats: Record<string, any> = {};
    for (const [name, provider] of this.providers.entries()) {
      stats[name] = provider.getUsageStats();
    }
    return stats;
  }

  setPrimaryProvider(providerName: string): boolean {
    if (this.providers.has(providerName)) {
      this.primaryProvider = providerName;
      console.log(`[LLM Strategy Brain] Primary provider set to: ${providerName}`);
      return true;
    }
    return false;
  }
}

export const llmStrategyBrain = new LLMStrategyBrain();

import { MarketSnapshot } from './trigger-detection-rules';

export interface RegimeValidationResult {
  regime_ok: boolean;
  detected_regime: {
    trend: 'bullish' | 'bearish' | 'sideways';
    volatility: 'low' | 'medium' | 'high';
    momentum: 'strong' | 'moderate' | 'weak';
  };
  expected_regime: {
    trend: string;
    volatility: string;
  };
  validation_details: string;
  confidence_in_regime: number;
  warnings: string[];
  recommendation: 'proceed' | 'abort' | 'reconsider';
  reasoning: string;
}

class LLMRegimeValidator {
  private apiKey: string;
  private model: string = 'gpt-4o';
  private endpoint: string = 'https://api.openai.com/v1/chat/completions';
  private enabled: boolean = false;
  private callCount: number = 0;

  constructor() {
    this.apiKey = typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_OPENAI_API_KEY || ''
      : process.env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';

    this.enabled = !!this.apiKey;

    if (this.enabled) {
      console.log('[LLM Regime Validator] 🔍 Layer 1 initialized');
    } else {
      console.warn('[LLM Regime Validator] No API key, validator disabled');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async validateRegime(
    snapshot: MarketSnapshot,
    triggerType: string,
    triggerConfidence: number,
    skillContext?: any
  ): Promise<RegimeValidationResult> {
    if (!this.enabled) {
      return this.createFallbackValidation(snapshot, 'LLM disabled');
    }

    console.log(`\n[LLM Layer 1 - Regime Validator] 🔍 Validating regime for ${snapshot.symbol}`);
    const startTime = Date.now();

    try {
      const prompt = this.buildValidationPrompt(snapshot, triggerType, triggerConfidence, skillContext);
      const response = await this.callGPT4o(prompt);
      const result = this.parseValidationResult(response);

      this.callCount++;
      const duration = Date.now() - startTime;

      console.log(`[LLM Layer 1] ${result.regime_ok ? '✅' : '❌'} Regime validation: ${result.recommendation} (${duration}ms)`);
      console.log(`  Detected: ${result.detected_regime.trend} / ${result.detected_regime.volatility}`);
      console.log(`  Confidence: ${result.confidence_in_regime}%`);

      return result;
    } catch (error) {
      console.error('[LLM Layer 1] Error:', error);
      return this.createFallbackValidation(snapshot, 'API error');
    }
  }

  private buildValidationPrompt(
    snapshot: MarketSnapshot,
    triggerType: string,
    triggerConfidence: number,
    skillContext?: any
  ): string {
    const currentCandle = snapshot.ohlc[snapshot.ohlc.length - 1];
    const prevCandle = snapshot.ohlc[snapshot.ohlc.length - 2];

    let prompt = `You are the Regime Validation Layer (Layer 1 of 5) in Pipnosis AI Trading System.

Your SOLE responsibility: Validate that the current market regime matches the conditions required for the detected trigger.`;

    if (skillContext) {
      prompt += `

SKILL LEVEL CONTEXT:
Current Level: ${skillContext.currentLevel} → Target: ${skillContext.targetLevel}
Win Rate Gap: ${skillContext.gaps.winRateGap > 0 ? '+' : ''}${skillContext.gaps.winRateGap.toFixed(1)}%
Profit Factor Gap: ${skillContext.gaps.profitFactorGap > 0 ? '+' : ''}${skillContext.gaps.profitFactorGap.toFixed(2)}

REGIME VALIDATION GUIDANCE:
${skillContext.gaps.winRateGap < 0
  ? `Win rate below target - Be MORE conservative accepting regimes. Only accept clear, high-quality regimes.`
  : `Win rate above target - Standard regime acceptance criteria apply.`}
${skillContext.gaps.winRateGap < -10
  ? `CRITICAL: Win rate severely low. Reject choppy, sideways, or unclear regimes. Only accept strong trending regimes.`
  : ''}
${skillContext.gaps.consistencyGap < 0
  ? `Consistency needs improvement - Avoid erratic or unstable regimes.`
  : ''}`;
    }

    prompt += `

CURRENT MARKET STATE:
Symbol: ${snapshot.symbol}
Current Price: ${currentCandle.close.toFixed(5)}
Trend: ${snapshot.priceAction.trend}
Volatility: ${snapshot.priceAction.volatility}
Momentum: ${snapshot.priceAction.momentum.toFixed(2)}

TRIGGER DETECTED:
Type: ${triggerType}
Confidence: ${triggerConfidence}%

TECHNICAL INDICATORS:
VWAP: ${snapshot.indicators.vwap.toFixed(5)}
EMA20: ${snapshot.indicators.ema20.toFixed(5)}
EMA50: ${snapshot.indicators.ema50.toFixed(5)}
ATR: ${snapshot.indicators.atr.toFixed(5)}
Price vs VWAP: ${((currentCandle.close - snapshot.indicators.vwap) / snapshot.indicators.vwap * 100).toFixed(2)}%

RECENT PRICE ACTION:
${snapshot.ohlc.slice(-3).map((c, i) => {
  const direction = c.close > c.open ? '🟢' : '🔴';
  const size = Math.abs(c.close - c.open);
  return `  ${direction} ${c.close.toFixed(5)} (size: ${size.toFixed(5)})`;
}).join('\n')}

Your task:
1. Assess if the detected trend is accurate
2. Validate if volatility level is appropriate for this trigger
3. Check if momentum supports the trigger
4. Identify any regime conflicts or inconsistencies
5. Make ACCEPT/REJECT decision

Respond in this EXACT JSON format (no markdown):
{
  "regime_ok": <true if regime matches trigger requirements>,
  "detected_regime": {
    "trend": "<bullish/bearish/sideways>",
    "volatility": "<low/medium/high>",
    "momentum": "<strong/moderate/weak>"
  },
  "expected_regime": {
    "trend": "<what trend this trigger expects>",
    "volatility": "<what volatility this trigger expects>"
  },
  "validation_details": "<2-3 sentence explanation of regime state>",
  "confidence_in_regime": <0-100, how confident you are in the regime assessment>,
  "warnings": ["<any regime warnings or concerns>"],
  "recommendation": "<proceed/abort/reconsider>",
  "reasoning": "<why you made this decision>"
}

Be critical. If regime doesn't match trigger, REJECT immediately.`;
  }

  private async callGPT4o(prompt: string): Promise<string> {
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
            content: 'You are a regime validation specialist. Be critical and precise. Reject setups when regime is unclear or conflicting.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 400
      })
    });

    if (!response.ok) {
      throw new Error(`GPT-4o API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || '';
  }

  private parseValidationResult(content: string): RegimeValidationResult {
    const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleanContent);

    return {
      regime_ok: parsed.regime_ok ?? false,
      detected_regime: parsed.detected_regime || { trend: 'sideways', volatility: 'medium', momentum: 'weak' },
      expected_regime: parsed.expected_regime || { trend: 'unknown', volatility: 'unknown' },
      validation_details: parsed.validation_details || '',
      confidence_in_regime: parsed.confidence_in_regime || 0,
      warnings: parsed.warnings || [],
      recommendation: parsed.recommendation || 'abort',
      reasoning: parsed.reasoning || ''
    };
  }

  private createFallbackValidation(snapshot: MarketSnapshot, reason: string): RegimeValidationResult {
    const isTrending = snapshot.priceAction.trend !== 'sideways';
    const hasModerateVolatility = snapshot.priceAction.volatility !== 'low';

    return {
      regime_ok: isTrending && hasModerateVolatility,
      detected_regime: {
        trend: snapshot.priceAction.trend,
        volatility: snapshot.priceAction.volatility,
        momentum: Math.abs(snapshot.priceAction.momentum) > 0.5 ? 'moderate' : 'weak'
      },
      expected_regime: {
        trend: 'trending',
        volatility: 'medium_or_high'
      },
      validation_details: `Fallback validation (${reason}). Basic regime check applied.`,
      confidence_in_regime: 50,
      warnings: [`Fallback validation used: ${reason}`],
      recommendation: isTrending && hasModerateVolatility ? 'proceed' : 'abort',
      reasoning: 'Rule-based fallback: checking for trending market with moderate volatility'
    };
  }

  getUsageStats(): { calls: number } {
    return { calls: this.callCount };
  }
}

export const llmRegimeValidator = new LLMRegimeValidator();

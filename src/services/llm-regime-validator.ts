import { MarketSnapshot } from './trigger-detection-rules';
import { openaiProxyClient } from './openai-proxy-client';
import { llmCostOptimizer } from './llm-cost-optimizer';
import { llmResponseCache } from './llm-response-cache';
import { compressSnapshot, compressSkillContext, buildCompressedRegimePrompt } from './llm-prompt-compressor';
import { calculateCost } from '../config/llm-optimization-config';

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
  private enabled: boolean = true;
  private callCount: number = 0;

  constructor() {
    console.log('[LLM Regime Validator] 🔍 Layer 1 initialized (optimized mode)');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async validateRegime(
    snapshot: MarketSnapshot,
    triggerType: string,
    triggerConfidence: number,
    skillContext?: any,
    userId?: string,
    sessionId?: string,
    isBacktest?: boolean
  ): Promise<RegimeValidationResult> {
    if (!this.enabled) {
      return this.createFallbackValidation(snapshot, 'LLM disabled');
    }

    console.log(`\n[LLM Layer 1 - Regime Validator] 🔍 Validating regime for ${snapshot.symbol}`);
    const startTime = Date.now();

    try {
      // Check cache first
      const cacheContext = {
        symbol: snapshot.symbol,
        trend: snapshot.priceAction?.trend,
        volatility: snapshot.priceAction?.volatility,
        trigger: triggerType,
        confidence: Math.floor(triggerConfidence / 10) * 10, // Bucket by 10s
      };

      const cached = llmResponseCache.get<RegimeValidationResult>('layer1_regime', cacheContext);
      if (cached) {
        console.log('[LLM Layer 1] 💾 Cache hit - skipping API call');
        return cached;
      }

      // Select optimal model
      const model = llmCostOptimizer.selectModel('layer1_regime', { isBacktest });

      // Check rate limits
      const canProceed = await llmCostOptimizer.canMakeRequest(model);
      if (!canProceed) {
        console.warn('[LLM Layer 1] Rate limit reached, using fallback');
        return this.createFallbackValidation(snapshot, 'Rate limit');
      }

      // Build compressed prompt
      const compactSnap = compressSnapshot(snapshot);
      compactSnap.trig = triggerType;
      compactSnap.trig_c = triggerConfidence;
      const compactSkill = compressSkillContext(skillContext);

      const prompt = buildCompressedRegimePrompt(compactSnap, compactSkill);

      // Call LLM
      const response = await this.callLLM(prompt, model);
      const result = this.parseValidationResult(response.content);

      // Track usage
      llmCostOptimizer.trackRequest(model);
      this.callCount++;

      // Calculate and log cost
      const cost = calculateCost(model, response.usage.prompt_tokens, response.usage.completion_tokens);
      console.log(`[LLM Layer 1] Model: ${model}, Tokens: ${response.usage.total_tokens}, Cost: $${cost.toFixed(4)}`);

      if (userId && sessionId) {
        await llmCostOptimizer.logCost(
          userId,
          sessionId,
          'layer1_regime',
          model,
          response.usage.prompt_tokens,
          response.usage.completion_tokens,
          cost,
          { triggerType, symbol: snapshot.symbol }
        );
      }

      // Cache result
      llmResponseCache.set('layer1_regime', cacheContext, result);

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
Current Price: ${currentCandle?.close?.toFixed(5) || 'N/A'}
Trend: ${snapshot.priceAction?.trend || 'unknown'}
Volatility: ${snapshot.priceAction?.volatility || 'unknown'}
Momentum: ${typeof snapshot.priceAction?.momentum === 'number' ? snapshot.priceAction.momentum.toFixed(2) : snapshot.priceAction?.momentum || 'N/A'}

TRIGGER DETECTED:
Type: ${triggerType}
Confidence: ${triggerConfidence}%

TECHNICAL INDICATORS:
VWAP: ${snapshot.indicators?.vwap?.toFixed(5) || 'N/A'}
EMA20: ${snapshot.indicators?.ema20?.toFixed(5) || 'N/A'}
EMA50: ${snapshot.indicators?.ema50?.toFixed(5) || 'N/A'}
ATR: ${snapshot.indicators?.atr?.toFixed(5) || 'N/A'}
Price vs VWAP: ${(snapshot.indicators?.vwap && currentCandle?.close) ? ((currentCandle.close - snapshot.indicators.vwap) / snapshot.indicators.vwap * 100).toFixed(2) : 'N/A'}%

RECENT PRICE ACTION:
${snapshot.ohlc?.slice(-3).map((c, i) => {
  const direction = c?.close > c?.open ? '🟢' : '🔴';
  const size = Math.abs((c?.close || 0) - (c?.open || 0));
  return `  ${direction} ${c?.close?.toFixed(5) || 'N/A'} (size: ${size.toFixed(5)})`;
}).join('\n') || 'No recent candles'}

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

    return prompt;
  }

  private async callLLM(prompt: string, model: 'gpt-4o' | 'gpt-4o-mini'): Promise<{ content: string; usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }> {
    const response = await openaiProxyClient.chat({
      messages: [
        {
          role: 'system',
          content: 'Regime validator. Critical, precise. Reject if unclear.'
        },
        { role: 'user', content: prompt }
      ],
      model: model,
      temperature: 0.2,
      max_tokens: 200,
      requestType: 'layer-1-regime-validation',
      endpoint: 'llm-regime-validator'
    });

    return {
      content: response.choices[0]?.message?.content || '',
      usage: response.usage
    };
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

    // FIXED: Fallback validation should be PERMISSIVE to allow learning from all conditions
    // The subsequent layers (2-5) will filter out bad setups
    // Blocking at Layer 1 prevents the AI from learning what works in different regimes
    const shouldProceed = true; // Always proceed in fallback mode (LLM disabled)

    console.log(`[LLM Regime Validator] FALLBACK MODE - Allowing all regimes for AI learning`);
    console.log(`  Detected: ${snapshot.priceAction.trend} / ${snapshot.priceAction.volatility}`);
    console.log(`  Reasoning: LLM disabled - deferring regime filtering to subsequent layers`);

    return {
      regime_ok: shouldProceed,
      detected_regime: {
        trend: snapshot.priceAction.trend,
        volatility: snapshot.priceAction.volatility,
        momentum: Math.abs(snapshot.priceAction.momentum) > 0.5 ? 'moderate' : 'weak'
      },
      expected_regime: {
        trend: 'any', // Changed from 'trending' to 'any'
        volatility: 'any' // Changed from 'medium_or_high' to 'any'
      },
      validation_details: `Fallback validation (${reason}). Permissive mode - allowing all regimes for AI learning.`,
      confidence_in_regime: 60, // Slightly higher than before since we're being permissive
      warnings: [`Fallback validation used: ${reason}. Layer 1 bypassed - subsequent layers will filter.`],
      recommendation: 'proceed', // Always proceed in fallback mode
      reasoning: 'Rule-based fallback: LLM disabled, allowing all market regimes. Layers 2-5 will filter quality.'
    };
  }

  getUsageStats(): { calls: number } {
    return { calls: this.callCount };
  }
}

export const llmRegimeValidator = new LLMRegimeValidator();

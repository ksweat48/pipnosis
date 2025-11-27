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
    const recentCandles = snapshot.ohlc.slice(-3);

    const skillNote = skillContext?.gaps.winRateGap < -10
      ? ' CRITICAL: Low win rate - only accept strong trending regimes.'
      : skillContext?.gaps.winRateGap < 0
      ? ' Conservative mode - favor clear regimes.'
      : '';

    const candleStr = recentCandles.map(c =>
      `${c.close > c.open ? 'Bull' : 'Bear'} ${c.close.toFixed(5)}`
    ).join(', ');

    const prompt = `Regime validator. Validate ${triggerType} trigger (${triggerConfidence}% conf) matches market regime.${skillNote}

Market: ${snapshot.symbol} @ ${currentCandle?.close?.toFixed(5)}
Trend: ${snapshot.priceAction?.trend}, Vol: ${snapshot.priceAction?.volatility}, Mom: ${snapshot.priceAction?.momentum}
VWAP: ${snapshot.indicators?.vwap?.toFixed(5)}, EMA20: ${snapshot.indicators?.ema20?.toFixed(5)}
Last 3: ${candleStr}

Return JSON:
{
  "ok": <bool>,
  "trend": "<bullish/bearish/sideways>",
  "vol": "<low/med/high>",
  "mom": "<strong/mod/weak>",
  "conf": <0-100>,
  "rec": "<proceed/abort>",
  "why": "<brief reason>"
}`;

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
      max_tokens: 100,
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

    // Handle BOTH compressed format and full format
    // Compressed: {ok, trend, vol, mom, conf, rec, why}
    // Full: {regime_ok, detected_regime, confidence_in_regime, recommendation, reasoning}

    const isCompressed = 'ok' in parsed && !('regime_ok' in parsed);

    if (isCompressed) {
      // Parse compressed format
      return {
        regime_ok: parsed.ok ?? false,
        detected_regime: {
          trend: parsed.trend || 'sideways',
          volatility: parsed.vol || 'medium',
          momentum: parsed.mom || 'weak'
        },
        expected_regime: {
          trend: 'any',
          volatility: 'any'
        },
        validation_details: parsed.why || '',
        confidence_in_regime: parsed.conf ?? 0,
        warnings: [],
        recommendation: parsed.rec || 'abort',
        reasoning: parsed.why || ''
      };
    }

    // Parse full format (legacy)
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

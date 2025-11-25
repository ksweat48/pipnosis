import { MarketSnapshot } from './trigger-detection-rules';
import { RegimeValidationResult } from './llm-regime-validator';
import { openaiProxyClient } from './openai-proxy-client';
import { llmCostOptimizer } from './llm-cost-optimizer';
import { compressSnapshot, compressSkillContext, buildCompressedSetupPrompt } from './llm-prompt-compressor';
import { calculateCost } from '../config/llm-optimization-config';

export interface SetupQualityResult {
  quality_score: number;
  meets_threshold: boolean;
  threshold_used: number;
  setup_strengths: string[];
  setup_weaknesses: string[];
  risk_reward_potential: number;
  entry_quality: number;
  timing_quality: number;
  context_quality: number;
  overall_assessment: string;
  recommendation: 'excellent' | 'good' | 'acceptable' | 'poor' | 'reject';
  reasoning: string;
}

class LLMSetupQuality {
  private enabled: boolean = true;
  private callCount: number = 0;
  private readonly DEFAULT_THRESHOLD = 65;

  constructor() {
    console.log('[LLM Setup Quality] 📊 Layer 2 initialized (optimized mode)');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async scoreSetup(
    snapshot: MarketSnapshot,
    triggerType: string,
    triggerConfidence: number,
    regimeValidation: RegimeValidationResult,
    customThreshold?: number,
    skillContext?: any,
    userId?: string,
    sessionId?: string,
    isBacktest?: boolean
  ): Promise<SetupQualityResult> {
    if (!this.enabled) {
      return this.createFallbackScore(snapshot, triggerConfidence, customThreshold);
    }

    const threshold = this.calculateDynamicThreshold(customThreshold, skillContext);

    console.log(`\n[LLM Layer 2 - Setup Quality] 📊 Scoring setup for ${snapshot.symbol}`);
    const startTime = Date.now();

    try {
      // NO CACHE for Layer 2 - needs candle accuracy

      // Select optimal model
      const model = llmCostOptimizer.selectModel('layer2_setup', { isBacktest });

      // Check rate limits
      const canProceed = await llmCostOptimizer.canMakeRequest(model);
      if (!canProceed) {
        console.warn('[LLM Layer 2] Rate limit reached, using fallback');
        return this.createFallbackScore(snapshot, triggerConfidence, threshold);
      }

      // Build compressed prompt
      const compactSnap = compressSnapshot(snapshot);
      compactSnap.trig = triggerType;
      compactSnap.trig_c = triggerConfidence;
      const compactSkill = compressSkillContext(skillContext);

      const prompt = buildCompressedSetupPrompt(
        compactSnap,
        regimeValidation.confidence_in_regime,
        threshold,
        compactSkill
      );

      // Call LLM
      const response = await this.callLLM(prompt, model);
      const result = this.parseScoringResult(response.content, threshold);

      // Track usage
      llmCostOptimizer.trackRequest(model);
      this.callCount++;

      // Calculate and log cost
      const cost = calculateCost(model, response.usage.prompt_tokens, response.usage.completion_tokens);
      console.log(`[LLM Layer 2] Model: ${model}, Tokens: ${response.usage.total_tokens}, Cost: $${cost.toFixed(4)}`);

      if (userId && sessionId) {
        await llmCostOptimizer.logCost(
          userId,
          sessionId,
          'layer2_setup',
          model,
          response.usage.prompt_tokens,
          response.usage.completion_tokens,
          cost,
          { triggerType, symbol: snapshot.symbol, quality: result.quality_score }
        );
      }

      const duration = Date.now() - startTime;
      console.log(`[LLM Layer 2] ${result.meets_threshold ? '✅' : '❌'} Quality score: ${result.quality_score}/100 (${duration}ms)`);
      console.log(`  Recommendation: ${result.recommendation}`);

      return result;
    } catch (error) {
      console.error('[LLM Layer 2] Error:', error);
      return this.createFallbackScore(snapshot, triggerConfidence, threshold);
    }
  }

  private buildScoringPrompt(
    snapshot: MarketSnapshot,
    triggerType: string,
    triggerConfidence: number,
    regimeValidation: RegimeValidationResult,
    threshold: number,
    skillContext?: any
  ): string {
    const currentCandle = snapshot.ohlc[snapshot.ohlc.length - 1];
    const recentCandles = snapshot.ohlc.slice(-5);

    let prompt = `You are the Setup Quality Scorer (Layer 2 of 5) in Pipnosis AI Trading System.

Your responsibility: Evaluate the quality of this trading setup on a 0-100 scale.`;

    if (skillContext) {
      prompt += `

SKILL LEVEL CONTEXT & QUALITY THRESHOLD:
Current Level: ${skillContext.currentLevel} → Target: ${skillContext.targetLevel}
Win Rate Gap: ${skillContext.gaps.winRateGap > 0 ? '+' : ''}${skillContext.gaps.winRateGap.toFixed(1)}%
Dynamic Quality Threshold: ${threshold}/100 (${skillContext.gaps.winRateGap < 0 ? 'RAISED due to low win rate' : 'Standard'})

QUALITY SCORING GUIDANCE:
${skillContext.gaps.winRateGap < -10
  ? `CRITICAL: Win rate severely below target. Only score 75+ for truly exceptional setups. Be extremely critical.`
  : skillContext.gaps.winRateGap < -5
  ? `Win rate below target. Raise quality standards - minimum 70+ for acceptable setups.`
  : skillContext.gaps.winRateGap < 0
  ? `Win rate slightly below target. Maintain stricter quality assessment.`
  : `Win rate on target or above. Standard quality criteria apply.`}
${skillContext.gaps.profitFactorGap < 0
  ? `Profit factor needs improvement - favor setups with strong R:R potential (2.5:1+).`
  : ''}`;
    }

    prompt += `

REGIME VALIDATION (Layer 1 passed):
✅ Regime: ${regimeValidation.detected_regime.trend} / ${regimeValidation.detected_regime.volatility}
✅ Confidence: ${regimeValidation.confidence_in_regime}%
Details: ${regimeValidation.validation_details}

TRIGGER DETECTED:
Type: ${triggerType}
Confidence: ${triggerConfidence}%

MARKET SNAPSHOT:
Symbol: ${snapshot.symbol}
Price: ${currentCandle?.close?.toFixed(5) || 'N/A'}
VWAP: ${snapshot.indicators?.vwap?.toFixed(5) || 'N/A'}
EMA20: ${snapshot.indicators?.ema20?.toFixed(5) || 'N/A'}
EMA50: ${snapshot.indicators?.ema50?.toFixed(5) || 'N/A'}
ATR: ${snapshot.indicators?.atr?.toFixed(5) || 'N/A'}

PRICE ACTION (last 5 candles):
${recentCandles.map((c, i) => {
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  const bodyPercent = range > 0 ? (body / range * 100).toFixed(0) : '0';
  return `  ${i + 1}. ${c.close > c.open ? '🟢' : '🔴'} O:${c.open.toFixed(5)} H:${c.high.toFixed(5)} L:${c.low.toFixed(5)} C:${c.close.toFixed(5)} (body: ${bodyPercent}%)`;
}).join('\n')}

SUPPORT/RESISTANCE:
Support: ${snapshot.support ? snapshot.support.toFixed(5) : 'N/A'}
Resistance: ${snapshot.resistance ? snapshot.resistance.toFixed(5) : 'N/A'}

Your task:
1. Evaluate entry quality (0-100): How clean is this entry point?
2. Evaluate timing quality (0-100): Is this the right time to enter?
3. Evaluate context quality (0-100): Do surrounding conditions support this trade?
4. Estimate risk:reward potential (1.0 to 5.0)
5. List specific strengths and weaknesses
6. Calculate overall quality score (0-100)
7. Make ACCEPT/REJECT recommendation (threshold: ${threshold})

Respond in this EXACT JSON format (no markdown):
{
  "quality_score": <0-100>,
  "entry_quality": <0-100>,
  "timing_quality": <0-100>,
  "context_quality": <0-100>,
  "risk_reward_potential": <1.0-5.0>,
  "setup_strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "setup_weaknesses": ["<weakness 1>", "<weakness 2>"],
  "overall_assessment": "<2-3 sentence summary of setup quality>",
  "recommendation": "<excellent/good/acceptable/poor/reject>",
  "reasoning": "<why this score, what makes it strong or weak>"
}

Be honest and critical. Score below ${threshold} = REJECT.`;

    return prompt;
  }

  private async callLLM(prompt: string, model: 'gpt-4o' | 'gpt-4o-mini'): Promise<{ content: string; usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }> {
    const response = await openaiProxyClient.chat({
      messages: [
        {
          role: 'system',
          content: 'Setup quality analyst. Critical, honest.'
        },
        { role: 'user', content: prompt }
      ],
      model: model,
      temperature: 0.3,
      max_tokens: 250,
      requestType: 'layer-2-setup-quality',
      endpoint: 'llm-setup-quality'
    });

    return {
      content: response.choices[0]?.message?.content || '',
      usage: response.usage
    };
  }

  private parseScoringResult(content: string, threshold: number): SetupQualityResult {
    const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleanContent);

    // Handle BOTH compressed format and full format
    // Compressed: {score, entry, timing, ctx, rr, rec, why}
    // Full: {quality_score, entry_quality, timing_quality, context_quality, risk_reward_potential, recommendation, reasoning}

    const isCompressed = 'score' in parsed || 'ctx' in parsed;

    let qualityScore: number;
    let entryQuality: number;
    let timingQuality: number;
    let contextQuality: number;
    let riskReward: number;
    let recommendation: string;
    let reasoning: string;

    if (isCompressed) {
      qualityScore = parsed.score || 0;
      entryQuality = parsed.entry || 0;
      timingQuality = parsed.timing || 0;
      contextQuality = parsed.ctx || 0;
      riskReward = parsed.rr || 1.0;
      recommendation = parsed.rec || 'reject';
      reasoning = parsed.why || '';
    } else {
      qualityScore = parsed.quality_score || 0;
      entryQuality = parsed.entry_quality || 0;
      timingQuality = parsed.timing_quality || 0;
      contextQuality = parsed.context_quality || 0;
      riskReward = parsed.risk_reward_potential || 1.0;
      recommendation = parsed.recommendation || 'reject';
      reasoning = parsed.reasoning || '';
    }

    return {
      quality_score: qualityScore,
      meets_threshold: qualityScore >= threshold,
      threshold_used: threshold,
      setup_strengths: parsed.setup_strengths || parsed.strengths || [],
      setup_weaknesses: parsed.setup_weaknesses || parsed.weaknesses || [],
      risk_reward_potential: riskReward,
      entry_quality: entryQuality,
      timing_quality: timingQuality,
      context_quality: contextQuality,
      overall_assessment: parsed.overall_assessment || parsed.assessment || '',
      recommendation: recommendation,
      reasoning: reasoning
    };
  }

  private calculateDynamicThreshold(customThreshold?: number, skillContext?: any): number {
    if (customThreshold) return customThreshold;
    if (!skillContext) return this.DEFAULT_THRESHOLD;

    const winRateGap = skillContext.gaps.winRateGap;

    if (winRateGap < -10) {
      console.log('[Setup Quality] 🔴 Dynamic threshold: 75 (CRITICAL - Win rate severely low)');
      return 75;
    } else if (winRateGap < -5) {
      console.log('[Setup Quality] 🟡 Dynamic threshold: 70 (Win rate below target)');
      return 70;
    } else if (winRateGap < 0) {
      console.log('[Setup Quality] 🟠 Dynamic threshold: 67 (Win rate slightly below)');
      return 67;
    } else {
      console.log('[Setup Quality] 🟢 Dynamic threshold: 65 (Standard - Win rate on track)');
      return this.DEFAULT_THRESHOLD;
    }
  }

  private createFallbackScore(
    snapshot: MarketSnapshot,
    triggerConfidence: number,
    customThreshold?: number
  ): SetupQualityResult {
    const threshold = customThreshold || this.DEFAULT_THRESHOLD;
    const score = triggerConfidence;

    return {
      quality_score: score,
      meets_threshold: score >= threshold,
      threshold_used: threshold,
      setup_strengths: ['Fallback scoring - trigger detected'],
      setup_weaknesses: ['LLM unavailable - limited quality assessment'],
      risk_reward_potential: 1.5,
      entry_quality: score,
      timing_quality: score,
      context_quality: score,
      overall_assessment: 'Fallback quality assessment based on trigger confidence.',
      recommendation: score >= threshold ? 'acceptable' : 'reject',
      reasoning: 'Rule-based fallback: using trigger confidence as quality proxy'
    };
  }

  getUsageStats(): { calls: number } {
    return { calls: this.callCount };
  }
}

export const llmSetupQuality = new LLMSetupQuality();

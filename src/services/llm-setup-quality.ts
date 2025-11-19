import { MarketSnapshot } from './trigger-detection-rules';
import { RegimeValidationResult } from './llm-regime-validator';

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
  private apiKey: string;
  private model: string = 'gpt-4o';
  private endpoint: string = 'https://api.openai.com/v1/chat/completions';
  private enabled: boolean = false;
  private callCount: number = 0;
  private readonly DEFAULT_THRESHOLD = 65;

  constructor() {
    this.apiKey = typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_OPENAI_API_KEY || ''
      : process.env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';

    this.enabled = !!this.apiKey;

    if (this.enabled) {
      console.log('[LLM Setup Quality] 📊 Layer 2 initialized');
    } else {
      console.warn('[LLM Setup Quality] No API key, scorer disabled');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async scoreSetup(
    snapshot: MarketSnapshot,
    triggerType: string,
    triggerConfidence: number,
    regimeValidation: RegimeValidationResult,
    customThreshold?: number
  ): Promise<SetupQualityResult> {
    if (!this.enabled) {
      return this.createFallbackScore(snapshot, triggerConfidence, customThreshold);
    }

    const threshold = customThreshold || this.DEFAULT_THRESHOLD;

    console.log(`\n[LLM Layer 2 - Setup Quality] 📊 Scoring setup for ${snapshot.symbol}`);
    const startTime = Date.now();

    try {
      const prompt = this.buildScoringPrompt(snapshot, triggerType, triggerConfidence, regimeValidation, threshold);
      const response = await this.callGPT4o(prompt);
      const result = this.parseScoringResult(response, threshold);

      this.callCount++;
      const duration = Date.now() - startTime;

      console.log(`[LLM Layer 2] ${result.meets_threshold ? '✅' : '❌'} Quality score: ${result.quality_score}/100 (${duration}ms)`);
      console.log(`  Recommendation: ${result.recommendation}`);
      console.log(`  Strengths: ${result.setup_strengths.length} | Weaknesses: ${result.setup_weaknesses.length}`);

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
    threshold: number
  ): string {
    const currentCandle = snapshot.ohlc[snapshot.ohlc.length - 1];
    const recentCandles = snapshot.ohlc.slice(-5);

    return `You are the Setup Quality Scorer (Layer 2 of 5) in Pipnosis AI Trading System.

Your responsibility: Evaluate the quality of this trading setup on a 0-100 scale.

REGIME VALIDATION (Layer 1 passed):
✅ Regime: ${regimeValidation.detected_regime.trend} / ${regimeValidation.detected_regime.volatility}
✅ Confidence: ${regimeValidation.confidence_in_regime}%
Details: ${regimeValidation.validation_details}

TRIGGER DETECTED:
Type: ${triggerType}
Confidence: ${triggerConfidence}%

MARKET SNAPSHOT:
Symbol: ${snapshot.symbol}
Price: ${currentCandle.close.toFixed(5)}
VWAP: ${snapshot.indicators.vwap.toFixed(5)}
EMA20: ${snapshot.indicators.ema20.toFixed(5)}
EMA50: ${snapshot.indicators.ema50.toFixed(5)}
ATR: ${snapshot.indicators.atr.toFixed(5)}

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
            content: 'You are a setup quality analyst. Be honest and critical. Only approve high-quality setups.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      throw new Error(`GPT-4o API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || '';
  }

  private parseScoringResult(content: string, threshold: number): SetupQualityResult {
    const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleanContent);

    const qualityScore = parsed.quality_score || 0;

    return {
      quality_score: qualityScore,
      meets_threshold: qualityScore >= threshold,
      threshold_used: threshold,
      setup_strengths: parsed.setup_strengths || [],
      setup_weaknesses: parsed.setup_weaknesses || [],
      risk_reward_potential: parsed.risk_reward_potential || 1.0,
      entry_quality: parsed.entry_quality || 0,
      timing_quality: parsed.timing_quality || 0,
      context_quality: parsed.context_quality || 0,
      overall_assessment: parsed.overall_assessment || '',
      recommendation: parsed.recommendation || 'reject',
      reasoning: parsed.reasoning || ''
    };
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

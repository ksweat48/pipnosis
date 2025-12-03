/**
 * Omega-7: Market Sentiment Brain
 *
 * LLM-powered sentiment analyzer that processes market headlines and social signals
 * to determine RISK-ON/RISK-OFF sentiment, USD strength, and volatility expectations.
 *
 * Uses GPT-4o-mini with compressed prompts (<250 tokens) for cost efficiency.
 */

import { openAIClient } from '@/services/openai-client';

export interface SentimentInput {
  googleNews: string[];
  fxStreetNews: string[];
  twitterSignals: string[];
  redditSignals: string[];
}

export interface SentimentOutput {
  sentiment: 'risk_on' | 'risk_off' | 'mixed';
  usd_strength: 'strong' | 'weak' | 'neutral';
  volatility: 'high' | 'medium' | 'low';
  bias: 'bullish' | 'bearish' | 'neutral';
  warnings: string[];
  confidence: number; // 1-100
  summary: string;
}

class OmegaSentimentBrain {
  private readonly MODEL = 'gpt-4o-mini';
  private readonly MAX_TOKENS = 250;

  /**
   * Evaluate market sentiment from aggregated news and social signals
   */
  async evaluateSentiment(input: SentimentInput): Promise<SentimentOutput> {
    try {
      const prompt = this.buildCompressedPrompt(input);

      console.log('[Omega-7] Analyzing market sentiment...');

      const response = await openAIClient.chat.completions.create({
        model: this.MODEL,
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt()
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: this.MAX_TOKENS,
        temperature: 0.3, // Low temperature for consistent analysis
        response_format: { type: 'json_object' }
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from Omega-7');
      }

      const result = JSON.parse(content) as SentimentOutput;

      console.log('[Omega-7] Sentiment analysis complete:', {
        sentiment: result.sentiment,
        usd_strength: result.usd_strength,
        volatility: result.volatility,
        confidence: result.confidence
      });

      return result;

    } catch (error) {
      console.error('[Omega-7] Sentiment evaluation failed:', error);

      // Return neutral fallback
      return {
        sentiment: 'mixed',
        usd_strength: 'neutral',
        volatility: 'medium',
        bias: 'neutral',
        warnings: ['analysis_failed'],
        confidence: 0,
        summary: 'Sentiment analysis unavailable'
      };
    }
  }

  /**
   * Build ultra-compressed prompt (<250 tokens)
   */
  private buildCompressedPrompt(input: SentimentInput): string {
    const sections: string[] = [];

    // Google News (most important)
    if (input.googleNews.length > 0) {
      sections.push(`GN: ${input.googleNews.slice(0, 5).join(' | ')}`);
    }

    // FXStreet (professional forex news)
    if (input.fxStreetNews.length > 0) {
      sections.push(`FX: ${input.fxStreetNews.slice(0, 4).join(' | ')}`);
    }

    // Twitter signals (social buzz)
    if (input.twitterSignals.length > 0) {
      sections.push(`TW: ${input.twitterSignals.slice(0, 3).join(' | ')}`);
    }

    // Reddit signals (retail sentiment)
    if (input.redditSignals.length > 0) {
      sections.push(`RD: ${input.redditSignals.slice(0, 3).join(' | ')}`);
    }

    return sections.join('\n\n');
  }

  /**
   * Compressed system prompt for Omega-7 identity
   */
  private getSystemPrompt(): string {
    return `You are Omega-7: Market Sentiment Brain.
Job: Analyze headlines/signals → detect market sentiment.

Detect:
- RISK-ON vs RISK-OFF (investor fear/greed)
- USD strength/weakness
- Volatility spikes
- Upcoming catalysts
- Market bias

Sources: GN=Google, FX=FXStreet, TW=Twitter, RD=Reddit

Return JSON only:
{
  "sentiment": "risk_on|risk_off|mixed",
  "usd_strength": "strong|weak|neutral",
  "volatility": "high|medium|low",
  "bias": "bullish|bearish|neutral",
  "warnings": ["event","fear_spike","rumor",...],
  "confidence": 1-100,
  "summary": "1-sentence reason"
}

Rules:
- Risk-ON: optimism, buying, risk appetite
- Risk-OFF: fear, selling, safety seeking
- USD strong: DXY up, safe haven demand
- USD weak: risk-on, commodities up
- High vol: panic, uncertainty, news
- Warnings: flag catalysts, rumors, spikes

Compressed output only.`;
  }

  /**
   * Quick sentiment check without full analysis (for cooldown checks)
   */
  needsUpdate(lastCheck: Date, cooldownMinutes: number = 10): boolean {
    const elapsed = Date.now() - lastCheck.getTime();
    const cooldownMs = cooldownMinutes * 60 * 1000;
    return elapsed >= cooldownMs;
  }
}

export const omegaSentimentBrain = new OmegaSentimentBrain();

/**
 * Omega-7: Market Sentiment Brain
 *
 * LLM-powered sentiment analyzer that processes market headlines and social signals
 * to determine RISK-ON/RISK-OFF sentiment, USD strength, and volatility expectations.
 *
 * Uses GPT-4o-mini with compressed prompts (<250 tokens) for cost efficiency.
 */

import { openAIClient } from '@/services/openai-client';
import { llmTokenTracker } from '@/services/llm-token-tracker';

export interface SentimentInput {
  finnhubNews: string[];
  fmpNews: string[];
  redditSignals: string[];
  fearGreedSignals: string[];
  coinGeckoTrending: string[];
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

      const response = await openAIClient.chat(
        [
          {
            role: 'system',
            content: this.getSystemPrompt()
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        {
          model: this.MODEL,
          max_tokens: this.MAX_TOKENS,
          temperature: 0.3, // Low temperature for consistent analysis
          requestType: 'omega_sentiment_analysis',
          endpoint: 'omega-sentiment'
        }
      );

      // Log token usage
      await llmTokenTracker.logUsage({
        brainName: 'Omega-7',
        model: this.MODEL,
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
        contextType: 'sentiment',
        userId: undefined,
        sessionId: undefined
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

    // Finnhub News (30% weight - professional financial news)
    if (input.finnhubNews.length > 0) {
      sections.push(`FH: ${input.finnhubNews.slice(0, 6).join(' | ')}`);
    }

    // FMP News (30% weight - financial market headlines)
    if (input.fmpNews.length > 0) {
      sections.push(`FMP: ${input.fmpNews.slice(0, 6).join(' | ')}`);
    }

    // Reddit signals (20% weight - retail sentiment)
    if (input.redditSignals.length > 0) {
      sections.push(`RD: ${input.redditSignals.slice(0, 4).join(' | ')}`);
    }

    // Fear & Greed Index (15% weight - market sentiment gauge)
    if (input.fearGreedSignals.length > 0) {
      sections.push(`FG: ${input.fearGreedSignals.join(' | ')}`);
    }

    // CoinGecko Trending (5% weight - risk appetite indicator)
    if (input.coinGeckoTrending.length > 0) {
      sections.push(`CG: ${input.coinGeckoTrending.slice(0, 3).join(' | ')}`);
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

Sources: FH=Finnhub (30%), FMP=Financial Modeling Prep (30%), RD=Reddit (20%), FG=Fear&Greed Index (15%), CG=CoinGecko (5%)

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
- Fear&Greed >75=extreme greed, <25=extreme fear

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

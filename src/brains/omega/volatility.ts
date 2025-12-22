/**
 * Omega Volatility - ATR & Liquidity Specialist
 *
 * Specializes in:
 * - ATR spikes and compression
 * - Volatility regime changes
 * - Liquidity pockets
 * - Price action smoothness
 * - Erratic movement detection
 */

import { openAIClient } from '../../services/openai-client';
import { llmTokenTracker } from '../../services/llm-token-tracker';
import type { OmegaVote } from './trend';

export interface VolatilitySnapshot {
  atr: number;      // current atr
  atr_avg: number;  // average atr (20 periods)
  vol: string;      // volatility state
  c: number[][];    // last 5 candles [o,h,l,c]
  wick_ratio: number; // avg wick/body ratio
}

class OmegaVolatilityBrain {
  /**
   * Evaluate volatility conditions for trading
   */
  async evaluate(snapshot: VolatilitySnapshot): Promise<OmegaVote> {
    const prompt = `Volatility Analysis:
${JSON.stringify(snapshot)}

Evaluate volatility and price action quality.
Focus: ATR vs average, candle smoothness, erratic behavior.
Vote: BUY (clean volatility), SELL (clean volatility), NO_TRADE (erratic/too volatile).

Return JSON only:
{
  "vote": "BUY|SELL|NO_TRADE",
  "confidence": 0-100,
  "reasoning": "brief 1-line explanation"
}`;

    try {
      const response = await openAIClient.chat(
        [
          {
            role: 'system',
            content: 'You are OmegaVolatility, a volatility specialist. Return JSON only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        {
          model: 'gpt-4o-mini',
          temperature: 0.3,
          max_tokens: 100,
          requestType: 'omega_volatility_vote',
          endpoint: 'omega-volatility'
        }
      );

      // Track token usage
      await llmTokenTracker.logUsage({
        brainName: 'Omega-5',
        model: 'gpt-4o-mini',
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
        contextType: 'omega_volatility_vote',
        userId: undefined,
        sessionId: undefined
      });

      const content = response.choices[0]?.message?.content || '{}';
      const vote = this.parseVote(content);

      // Log vote for transparency
      console.log(`[Omega-5 Volatility] Vote: ${vote.vote} | Confidence: ${vote.confidence}% | Reasoning: ${vote.reasoning}`);

      return vote;
    } catch (error) {
      console.error('[Omega-5 Volatility] LLM call failed:', error);
      return {
        vote: 'NO_TRADE',
        confidence: 0,
        reasoning: 'Analysis failed'
      };
    }
  }

  private parseVote(response: string): OmegaVote {
    try {
      const cleaned = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleaned);

      return {
        vote: parsed.vote || 'NO_TRADE',
        confidence: Math.min(100, Math.max(0, parsed.confidence || 0)),
        reasoning: parsed.reasoning || 'No reasoning provided'
      };
    } catch (error) {
      console.error('[Omega-5 Volatility] ❌ Parse error:', error);
      console.error('[Omega-5 Volatility] Raw response:', response.substring(0, 200));
      return {
        vote: 'NO_TRADE',
        confidence: 0,
        reasoning: 'Parse failed'
      };
    }
  }
}

export const omegaVolatility = new OmegaVolatilityBrain();

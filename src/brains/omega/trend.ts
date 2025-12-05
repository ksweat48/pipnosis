/**
 * Omega Trend - Trend Analysis Specialist
 *
 * Specializes in:
 * - Trend identification and strength
 * - EMA alignment and crossovers
 * - Momentum analysis
 * - Trend continuation vs reversal
 *
 * Uses ultra-compressed prompts for cost efficiency
 */

import { openAIClient } from '../../services/openai-client';

export interface TrendSnapshot {
  p: number;      // price
  e20: number;    // ema20
  e50: number;    // ema50
  e200: number;   // ema200
  mom: number;    // momentum -100 to 100
  tr: string;     // trend: bull/bear/side
  vol: string;    // volatility: low/med/high
}

export interface OmegaVote {
  vote: 'BUY' | 'SELL' | 'NO_TRADE';
  confidence: number; // 0-100
  reasoning: string;
}

class OmegaTrendBrain {
  /**
   * Evaluate trend for trading decision
   */
  async evaluate(snapshot: TrendSnapshot): Promise<OmegaVote> {
    const prompt = `Trend Analysis:
${JSON.stringify(snapshot)}

Evaluate trend strength and direction.
Vote: BUY (trend up strong), SELL (trend down strong), NO_TRADE (weak/unclear).

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
            content: 'You are OmegaTrend, a trend analysis specialist. Return JSON only.'
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
          requestType: 'omega_trend_vote',
          endpoint: 'omega-trend'
        }
      );

      const content = response.choices[0]?.message?.content || '{}';
      const vote = this.parseVote(content);

      // Log vote for transparency
      console.log(`[Omega-1 Trend] Vote: ${vote.vote} | Confidence: ${vote.confidence}% | Reasoning: ${vote.reasoning}`);

      return vote;
    } catch (error) {
      console.error('[Omega-1 Trend] LLM call failed:', error);
      return {
        vote: 'NO_TRADE',
        confidence: 0,
        reasoning: 'Analysis failed'
      };
    }
  }

  /**
   * Parse LLM response into vote
   */
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
      console.error('[Omega-1 Trend] ❌ Parse error:', error);
      console.error('[Omega-1 Trend] Raw response:', response.substring(0, 200));
      return {
        vote: 'NO_TRADE',
        confidence: 0,
        reasoning: 'Parse failed'
      };
    }
  }
}

export const omegaTrend = new OmegaTrendBrain();

/**
 * Omega Scalper - Quick Entry Specialist
 *
 * Specializes in:
 * - Immediate price action
 * - VWAP positioning
 * - Short-term volatility
 * - Quick entry/exit opportunities
 * - Wick analysis
 */

import { openAIClient } from '../../services/openai-client';
import type { OmegaVote } from './trend';

export interface ScalperSnapshot {
  p: number;       // price
  vw: number;      // vwap
  atr: number;     // atr
  rsi: number;     // rsi
  vol: string;     // volatility
  c: number[][];   // last 3 candles [o,h,l,c]
}

class OmegaScalperBrain {
  /**
   * Evaluate immediate price action for scalping
   */
  async evaluate(snapshot: ScalperSnapshot): Promise<OmegaVote> {
    const prompt = `Scalper Analysis:
${JSON.stringify(snapshot)}

Evaluate immediate entry quality.
Focus: VWAP position, recent candle structure, RSI extremes.
Vote: BUY (clean bullish setup), SELL (clean bearish setup), NO_TRADE (choppy/unclear).

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
            content: 'You are OmegaScalper, a quick-entry specialist. Return JSON only.'
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
          requestType: 'omega_scalper_vote',
          endpoint: 'omega-scalper'
        }
      );

      const content = response.choices[0]?.message?.content || '{}';
      const vote = this.parseVote(content);

      // Log vote for transparency
      console.log(`[Omega-2 Scalper] Vote: ${vote.vote} | Confidence: ${vote.confidence}% | Reasoning: ${vote.reasoning}`);

      return vote;
    } catch (error) {
      console.error('[Omega-2 Scalper] LLM call failed:', error);
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
      console.error('[Omega-2 Scalper] ❌ Parse error:', error);
      console.error('[Omega-2 Scalper] Raw response:', response.substring(0, 200));
      return {
        vote: 'NO_TRADE',
        confidence: 0,
        reasoning: 'Parse failed'
      };
    }
  }
}

export const omegaScalper = new OmegaScalperBrain();

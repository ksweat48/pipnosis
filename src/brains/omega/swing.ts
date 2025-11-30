/**
 * Omega Swing - Structural Setup Specialist
 *
 * Specializes in:
 * - Higher highs / lower lows
 * - Support and resistance levels
 * - Multi-candle patterns
 * - Swing points and pivots
 * - Market structure
 */

import { openAIClient } from '../../services/openai-client';
import type { OmegaVote } from './trend';

export interface SwingSnapshot {
  p: number;       // price
  sup: number[];   // support levels
  res: number[];   // resistance levels
  sw: { h: number; l: number }; // swing high/low
  str: string;     // structure: hh/hl/ll/lh
  tr: string;      // trend
}

class OmegaSwingBrain {
  /**
   * Evaluate structural setup for swing trading
   */
  async evaluate(snapshot: SwingSnapshot): Promise<OmegaVote> {
    const prompt = `Swing Structure Analysis:
${JSON.stringify(snapshot)}

Evaluate market structure and key levels.
Focus: Price vs support/resistance, structure pattern, swing points.
Vote: BUY (bullish structure), SELL (bearish structure), NO_TRADE (unclear/range).

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
            content: 'You are OmegaSwing, a market structure specialist. Return JSON only.'
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
          requestType: 'omega_swing_vote',
          endpoint: 'omega-swing'
        }
      );

      const content = response.choices[0]?.message?.content || '{}';
      return this.parseVote(content);
    } catch (error) {
      console.error('[Omega Swing] Error:', error);
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
      return {
        vote: 'NO_TRADE',
        confidence: 0,
        reasoning: 'Parse failed'
      };
    }
  }
}

export const omegaSwing = new OmegaSwingBrain();

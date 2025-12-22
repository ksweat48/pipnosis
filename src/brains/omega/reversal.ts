/**
 * Omega Reversal - Divergence & Reversal Specialist
 *
 * Specializes in:
 * - RSI divergences
 * - Momentum shifts
 * - Reversal patterns
 * - Exhaustion signals
 * - Pivot flips
 */

import { openAIClient } from '../../services/openai-client';
import { llmTokenTracker } from '../../services/llm-token-tracker';
import type { OmegaVote } from './trend';

export interface ReversalSnapshot {
  p: number;       // price
  rsi: number;     // rsi
  st: number;      // stoch rsi
  mom: number;     // momentum
  e20: number;     // ema20
  e50: number;     // ema50
  tr: string;      // current trend
  vol: string;     // volatility
}

class OmegaReversalBrain {
  /**
   * Evaluate reversal potential
   */
  async evaluate(snapshot: ReversalSnapshot): Promise<OmegaVote> {
    const prompt = `Reversal Analysis:
${JSON.stringify(snapshot)}

Evaluate reversal signals and divergences.
Focus: RSI extremes, momentum shifts, trend exhaustion.
Vote: BUY (bullish reversal), SELL (bearish reversal), NO_TRADE (no reversal signal).

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
            content: 'You are OmegaReversal, a reversal pattern specialist. Return JSON only.'
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
          requestType: 'omega_reversal_vote',
          endpoint: 'omega-reversal'
        }
      );

      // Track token usage
      await llmTokenTracker.logUsage({
        brainName: 'Omega-4',
        model: 'gpt-4o-mini',
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
        contextType: 'omega_reversal_vote',
        userId: undefined,
        sessionId: undefined
      });

      const content = response.choices[0]?.message?.content || '{}';
      const vote = this.parseVote(content);

      // Log vote for transparency
      console.log(`[Omega-4 Reversal] Vote: ${vote.vote} | Confidence: ${vote.confidence}% | Reasoning: ${vote.reasoning}`);

      return vote;
    } catch (error) {
      console.error('[Omega-4 Reversal] LLM call failed:', error);
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
      console.error('[Omega-4 Reversal] ❌ Parse error:', error);
      console.error('[Omega-4 Reversal] Raw response:', response.substring(0, 200));
      return {
        vote: 'NO_TRADE',
        confidence: 0,
        reasoning: 'Parse failed'
      };
    }
  }
}

export const omegaReversal = new OmegaReversalBrain();

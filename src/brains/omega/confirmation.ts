/**
 * Omega Confirmation - Intraday Setup Confirmation Specialist
 *
 * Specializes in:
 * - Multi-timeframe alignment for intraday trades
 * - Entry confirmation signals
 * - Support and resistance confluences
 * - Pullback structure validation
 * - Trade setup confirmation for 20min-2hr durations
 */

import { openAIClient } from '../../services/openai-client';
import { llmTokenTracker } from '../../services/llm-token-tracker';
import type { OmegaVote } from './trend';

export interface ConfirmationSnapshot {
  p: number;       // price
  sup: number[];   // support levels
  res: number[];   // resistance levels
  sw: { h: number; l: number }; // swing high/low
  str: string;     // structure: hh/hl/ll/lh
  tr: string;      // trend
  mtf?: string;    // multi-timeframe alignment
  pullback?: boolean; // is this a pullback entry
}

class OmegaConfirmationBrain {
  /**
   * Evaluate intraday trade setup confirmation
   *
   * FOCUS: Confirming that a trade setup has proper structure for INTRADAY execution
   * - Does price have clear support/resistance for quick moves?
   * - Is structure aligned for fast price action?
   * - Are we confirming trend continuation or reversal?
   */
  async evaluate(snapshot: ConfirmationSnapshot): Promise<OmegaVote> {
    const prompt = `Intraday Confirmation Analysis:
${JSON.stringify(snapshot)}

You are confirming INTRADAY setups (target duration: 20min-2hr).

Evaluate:
1. Does price have clear support/resistance for quick reaction?
2. Is structure aligned for immediate directional move?
3. Is this a confirmed pullback or breakout for intraday execution?
4. Multi-timeframe alignment (if provided)?

Vote: BUY (strong intraday bullish confirmation), SELL (strong intraday bearish confirmation), NO_TRADE (unclear/needs more confirmation).

IMPORTANT: We're looking for CONFIRMATION of immediate moves, not swing setups.

Return JSON only:
{
  "vote": "BUY|SELL|NO_TRADE",
  "confidence": 0-100,
  "reasoning": "brief 1-line explanation focused on INTRADAY confirmation"
}`;

    try {
      const response = await openAIClient.chat(
        [
          {
            role: 'system',
            content: 'You are OmegaConfirmation, an intraday trade confirmation specialist. You validate that setups have proper structure for quick 20min-2hr moves. Return JSON only.'
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
          requestType: 'omega_confirmation_vote',
          endpoint: 'omega-confirmation'
        }
      );

      // Track token usage
      await llmTokenTracker.logUsage({
        brainName: 'Omega-3',
        model: 'gpt-4o-mini',
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
        contextType: 'omega_confirmation_vote',
        userId: undefined,
        sessionId: undefined
      });

      const content = response.choices[0]?.message?.content || '{}';
      const vote = this.parseVote(content);

      // Log vote for transparency
      console.log(`[Omega-3 Confirmation] Vote: ${vote.vote} | Confidence: ${vote.confidence}% | Reasoning: ${vote.reasoning}`);

      return vote;
    } catch (error) {
      console.error('[Omega-3 Confirmation] LLM call failed:', error);
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
      console.error('[Omega-3 Confirmation] ❌ Parse error:', error);
      console.error('[Omega-3 Confirmation] Raw response:', response.substring(0, 200));
      return {
        vote: 'NO_TRADE',
        confidence: 0,
        reasoning: 'Parse failed'
      };
    }
  }
}

export const omegaConfirmation = new OmegaConfirmationBrain();

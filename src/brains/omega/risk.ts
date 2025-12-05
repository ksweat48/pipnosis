/**
 * Omega Risk - Risk Assessment Specialist
 *
 * Specializes in:
 * - SL placement quality
 * - R/R ratio validation
 * - Entry timing risk
 * - Market conditions for risk
 * - Position exposure
 *
 * This Omega ONLY evaluates risk - doesn't care about trend or setup
 */

import { openAIClient } from '../../services/openai-client';
import type { OmegaVote } from './trend';

export interface RiskSnapshot {
  p: number;        // price
  proposed_sl: number;  // proposed stop loss
  proposed_tp: number;  // proposed take profit
  atr: number;      // atr
  sup: number[];    // nearby support
  res: number[];    // nearby resistance
  vol: string;      // volatility
  risk_pct: number; // % of account
}

class OmegaRiskBrain {
  /**
   * Evaluate risk quality of proposed trade
   */
  async evaluate(snapshot: RiskSnapshot): Promise<OmegaVote> {
    const prompt = `Risk Assessment:
${JSON.stringify(snapshot)}

Evaluate ONLY the risk quality - ignore trend/setup.
Focus: SL placement near support/resistance, R/R ratio, ATR alignment.
Vote: BUY/SELL (risk acceptable), NO_TRADE (poor SL placement or bad R/R).

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
            content: 'You are OmegaRisk, a risk management specialist. Evaluate ONLY risk quality. Return JSON only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        {
          model: 'gpt-4o-mini',
          temperature: 0.2, // Lower temp for risk - be consistent
          max_tokens: 100,
          requestType: 'omega_risk_vote',
          endpoint: 'omega-risk'
        }
      );

      const content = response.choices[0]?.message?.content || '{}';
      const vote = this.parseVote(content);

      // Log vote for transparency
      console.log(`[Omega-6 Risk] Vote: ${vote.vote} | Confidence: ${vote.confidence}% | Reasoning: ${vote.reasoning}`);

      return vote;
    } catch (error) {
      console.error('[Omega-6 Risk] LLM call failed:', error);
      return {
        vote: 'NO_TRADE',
        confidence: 100, // High confidence NO when risk eval fails
        reasoning: 'Risk analysis failed - reject trade'
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
      console.error('[Omega-6 Risk] ❌ Parse error:', error);
      console.error('[Omega-6 Risk] Raw response:', response.substring(0, 200));
      return {
        vote: 'NO_TRADE',
        confidence: 100,
        reasoning: 'Parse failed - reject for safety'
      };
    }
  }
}

export const omegaRisk = new OmegaRiskBrain();

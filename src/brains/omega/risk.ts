/**
 * Omega Risk - Risk Assessment Specialist (ADVISORY ROLE)
 *
 * Specializes in:
 * - SL placement quality
 * - R/R ratio validation
 * - Entry timing risk
 * - Market conditions for risk
 * - Position exposure
 *
 * IMPORTANT: This Omega is ADVISORY ONLY
 * - It provides risk warnings and quality scores
 * - It does NOT vote NO_TRADE (that would veto the council)
 * - Alpha uses its risk_score to adjust confidence
 * - Only CATASTROPHIC violations (R:R < 0.5:1) trigger a block
 */

import { openAIClient } from '../../services/openai-client';
import { llmTokenTracker } from '../../services/llm-token-tracker';
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
  direction?: 'BUY' | 'SELL'; // The direction other Omegas are voting
}

export interface RiskVote extends OmegaVote {
  risk_score: number;  // 0-100 (100 = excellent risk profile)
  warnings: string[];  // Specific risk warnings
  is_catastrophic: boolean; // Only true for R:R < 0.5:1 or insane SL
}

class OmegaRiskBrain {
  /**
   * Evaluate risk quality of proposed trade
   * ADVISORY ROLE: Returns risk assessment, not a blocking vote
   */
  async evaluate(snapshot: RiskSnapshot): Promise<RiskVote> {
    const prompt = `Risk Assessment (ADVISORY):
${JSON.stringify(snapshot)}

Evaluate the risk quality. You are ADVISORY - do not veto, just assess.
Focus: SL placement quality, R/R ratio, ATR alignment.

Rate risk_score 0-100:
- 80-100: Excellent risk profile
- 60-79: Acceptable risk
- 40-59: Elevated risk (warnings needed)
- 20-39: High risk (strong warnings)
- 0-19: Catastrophic risk (R:R < 0.5:1 or SL in liquidity zone)

If direction is provided, vote WITH that direction but adjust confidence based on risk.
Only flag is_catastrophic=true for truly dangerous setups (R:R < 0.5:1).

Return JSON only:
{
  "vote": "BUY|SELL",
  "confidence": 0-100,
  "risk_score": 0-100,
  "warnings": ["warning1", "warning2"],
  "is_catastrophic": false,
  "reasoning": "brief risk assessment"
}`;

    try {
      const response = await openAIClient.chat(
        [
          {
            role: 'system',
            content: 'You are OmegaRisk, an ADVISORY risk specialist. You assess risk quality but do NOT veto trades. Only flag catastrophic for R:R < 0.5:1. Return JSON only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        {
          model: 'gpt-4o-mini',
          temperature: 0.2,
          max_tokens: 150,
          requestType: 'omega_risk_vote',
          endpoint: 'omega-risk'
        }
      );

      await llmTokenTracker.logUsage({
        brainName: 'Omega-6',
        model: 'gpt-4o-mini',
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
        contextType: 'omega_risk_vote',
        userId: undefined,
        sessionId: undefined
      });

      const content = response.choices[0]?.message?.content || '{}';
      const vote = this.parseVote(content, snapshot.direction);

      console.log(`[Omega-6 Risk] ADVISORY: ${vote.vote} | Risk Score: ${vote.risk_score}/100 | Confidence: ${vote.confidence}%`);
      if (vote.warnings.length > 0) {
        console.log(`[Omega-6 Risk] Warnings: ${vote.warnings.join(', ')}`);
      }
      if (vote.is_catastrophic) {
        console.log(`[Omega-6 Risk] CATASTROPHIC RISK DETECTED`);
      }

      return vote;
    } catch (error) {
      console.error('[Omega-6 Risk] LLM call failed:', error);
      return {
        vote: snapshot.direction || 'BUY',
        confidence: 30,
        risk_score: 50,
        warnings: ['Risk analysis failed - using fallback'],
        is_catastrophic: false,
        reasoning: 'Risk analysis failed - proceeding with caution'
      };
    }
  }

  private parseVote(response: string, fallbackDirection?: 'BUY' | 'SELL'): RiskVote {
    try {
      const cleaned = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleaned);

      let vote = parsed.vote || fallbackDirection || 'BUY';
      if (vote === 'NO_TRADE') {
        vote = fallbackDirection || 'BUY';
      }

      return {
        vote,
        confidence: Math.min(100, Math.max(0, parsed.confidence || 50)),
        risk_score: Math.min(100, Math.max(0, parsed.risk_score || 50)),
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
        is_catastrophic: parsed.is_catastrophic === true,
        reasoning: parsed.reasoning || 'No reasoning provided'
      };
    } catch (error) {
      console.error('[Omega-6 Risk] Parse error:', error);
      return {
        vote: fallbackDirection || 'BUY',
        confidence: 30,
        risk_score: 50,
        warnings: ['Parse error - using defaults'],
        is_catastrophic: false,
        reasoning: 'Parse failed - using defaults'
      };
    }
  }
}

export const omegaRisk = new OmegaRiskBrain();

/**
 * Omega-9: Hallucination Defense Specialist
 *
 * Final safety validator that prevents catastrophic LLM mistakes.
 *
 * Validates:
 * - Mathematical correctness (SL/TP positioning)
 * - Direction logic consistency
 * - Internal Omega vote conflicts
 * - Risk parameter sanity
 * - Impossible scenarios
 *
 * Can repair fixable issues or block unfixable hallucinations.
 */

import { openAIClient } from '../services/openai-client';
import type { Omega9ValidationResult, Omega9Corrections, OmegaVote } from '../types/omega';
import type { AlphaDecision } from './coordinator-alpha';
import { llmTokenTracker } from '../services/llm-token-tracker';

export interface Omega9Input {
  alphaDecision: AlphaDecision;
  omegaVotes: {
    trend: OmegaVote | null;
    scalper: OmegaVote | null;
    swing: OmegaVote | null;
    reversal: OmegaVote | null;
    volatility: OmegaVote | null;
    risk: OmegaVote | null;
    omega8?: any;
  };
  marketContext: {
    price: number;
    atr: number;
    symbol: string;
  };
  safetyRules: {
    maxRiskPct: number;
    minRR: number;
    maxExposure: number;
  };
}

class Omega9HallucinationBrain {
  /**
   * Validate Alpha decision and all Omega votes for consistency and safety
   */
  async validate(input: Omega9Input): Promise<Omega9ValidationResult> {
    const localValidation = this.performLocalValidation(input);

    if (localValidation.flags.length === 0) {
      console.log('[Omega-9] ✅ Local validation passed');
      return localValidation;
    }

    const fixableIssues = localValidation.flags.filter(f =>
      f.includes('SL_POSITION') ||
      f.includes('TP_POSITION') ||
      f.includes('RISK_TOO_HIGH')
    );

    if (fixableIssues.length > 0 && localValidation.flags.length === fixableIssues.length) {
      console.log('[Omega-9] ⚠️ Fixable issues detected, attempting repair...');
      const repaired = this.attemptRepair(input, localValidation.flags);
      if (repaired.pass) {
        return repaired;
      }
    }

    if (!localValidation.pass) {
      console.log('[Omega-9] ❌ Critical validation failure - blocking trade');
      return localValidation;
    }

    console.log('[Omega-9] 🔍 Requesting LLM validation...');
    return await this.llmValidation(input, localValidation.flags);
  }

  /**
   * Perform local mathematical and logical validation without LLM
   */
  private performLocalValidation(input: Omega9Input): Omega9ValidationResult {
    const flags: string[] = [];
    const { alphaDecision, marketContext, safetyRules, omegaVotes } = input;

    if (alphaDecision.action === 'NO_TRADE') {
      return {
        pass: true,
        flags: [],
        confidence_adjustment: 0,
        corrections: { sl: null, tp: null, risk_pct: null },
        reasoning: 'NO_TRADE requires no validation'
      };
    }

    const isBuy = alphaDecision.action === 'BUY';
    const entry = alphaDecision.entry;
    const sl = alphaDecision.stopLoss;
    const tp = alphaDecision.takeProfit;

    if (isBuy && sl >= entry) {
      flags.push('SL_POSITION_ERROR_BUY');
    }
    if (!isBuy && sl <= entry) {
      flags.push('SL_POSITION_ERROR_SELL');
    }

    if (isBuy && tp <= entry) {
      flags.push('TP_POSITION_ERROR_BUY');
    }
    if (!isBuy && tp >= entry) {
      flags.push('TP_POSITION_ERROR_SELL');
    }

    if (sl === entry || tp === entry) {
      flags.push('ZERO_DISTANCE_ERROR');
    }

    const slDistance = Math.abs(entry - sl);
    const tpDistance = Math.abs(tp - entry);
    const rr = slDistance > 0 ? tpDistance / slDistance : 0;

    if (rr < safetyRules.minRR) {
      flags.push(`RR_TOO_LOW_${rr.toFixed(2)}`);
    }

    if (slDistance > marketContext.atr * 5) {
      flags.push('SL_TOO_WIDE');
    }

    if (slDistance < marketContext.atr * 0.5) {
      flags.push('SL_TOO_TIGHT');
    }

    const voteConflicts = this.detectVoteConflicts(omegaVotes);
    if (voteConflicts.length > 0) {
      flags.push(...voteConflicts);
    }

    const pass = flags.length === 0;

    return {
      pass,
      flags,
      confidence_adjustment: pass ? 0 : -20,
      corrections: { sl: null, tp: null, risk_pct: null },
      reasoning: pass ? 'All validations passed' : `Failed: ${flags.join(', ')}`
    };
  }

  /**
   * Detect conflicts in Omega votes
   */
  private detectVoteConflicts(votes: Omega9Input['omegaVotes']): string[] {
    const flags: string[] = [];

    const activeVotes = Object.entries(votes)
      .filter(([_, vote]) => vote !== null)
      .map(([name, vote]) => ({ name, vote: (vote as OmegaVote).vote }));

    if (activeVotes.length < 3) {
      return flags;
    }

    const buyCount = activeVotes.filter(v => v.vote === 'BUY').length;
    const sellCount = activeVotes.filter(v => v.vote === 'SELL').length;
    const noTradeCount = activeVotes.filter(v => v.vote === 'NO_TRADE').length;

    if (buyCount > 0 && sellCount > 0) {
      if (Math.abs(buyCount - sellCount) <= 1) {
        flags.push(`VOTE_SPLIT_${buyCount}BUY_${sellCount}SELL`);
      }
    }

    if (noTradeCount > activeVotes.length / 2) {
      flags.push('MAJORITY_NO_TRADE');
    }

    return flags;
  }

  /**
   * Attempt to repair fixable issues
   */
  private attemptRepair(input: Omega9Input, flags: string[]): Omega9ValidationResult {
    const { alphaDecision, marketContext } = input;
    const corrections: Omega9Corrections = { sl: null, tp: null, risk_pct: null };
    const repairedFlags: string[] = [];

    const isBuy = alphaDecision.action === 'BUY';
    const entry = alphaDecision.entry;
    let sl = alphaDecision.stopLoss;
    let tp = alphaDecision.takeProfit;

    if (flags.includes('SL_POSITION_ERROR_BUY') && isBuy) {
      sl = entry - marketContext.atr * 1.5;
      corrections.sl = sl;
      console.log(`[Omega-9] 🔧 Corrected BUY SL: ${alphaDecision.stopLoss} → ${sl}`);
    } else if (flags.includes('SL_POSITION_ERROR_SELL') && !isBuy) {
      sl = entry + marketContext.atr * 1.5;
      corrections.sl = sl;
      console.log(`[Omega-9] 🔧 Corrected SELL SL: ${alphaDecision.stopLoss} → ${sl}`);
    }

    if (flags.includes('TP_POSITION_ERROR_BUY') && isBuy) {
      tp = entry + marketContext.atr * 2.5;
      corrections.tp = tp;
      console.log(`[Omega-9] 🔧 Corrected BUY TP: ${alphaDecision.takeProfit} → ${tp}`);
    } else if (flags.includes('TP_POSITION_ERROR_SELL') && !isBuy) {
      tp = entry - marketContext.atr * 2.5;
      corrections.tp = tp;
      console.log(`[Omega-9] 🔧 Corrected SELL TP: ${alphaDecision.takeProfit} → ${tp}`);
    }

    const repairSuccessful = flags.every(flag =>
      flag.includes('SL_POSITION') ||
      flag.includes('TP_POSITION') ||
      flag.includes('RISK_TOO_HIGH')
    );

    if (!repairSuccessful) {
      repairedFlags.push(...flags.filter(f =>
        !f.includes('SL_POSITION') &&
        !f.includes('TP_POSITION')
      ));
    }

    return {
      pass: repairSuccessful,
      flags: repairedFlags,
      confidence_adjustment: -10,
      corrections,
      reasoning: repairSuccessful ?
        'Repaired SL/TP positioning' :
        'Could not repair all issues'
    };
  }

  /**
   * Request LLM validation for complex scenarios
   */
  private async llmValidation(input: Omega9Input, localFlags: string[]): Promise<Omega9ValidationResult> {
    const prompt = `Validation:
Decision: ${input.alphaDecision.action} @ ${input.alphaDecision.entry}
SL: ${input.alphaDecision.stopLoss}, TP: ${input.alphaDecision.takeProfit}
Votes: ${JSON.stringify(input.omegaVotes)}
LocalFlags: ${localFlags.join(', ')}

Check: direction logic, vote conflicts, impossible scenarios.
Can this be repaired or must it be blocked?

Return JSON only:
{
  "pass": true|false,
  "flags": ["flag1", "flag2"],
  "confidence_adjustment": -20 to 0,
  "corrections": {"sl": num|null, "tp": num|null, "risk_pct": num|null},
  "reasoning": "brief explanation"
}`;

    try {
      const response = await openAIClient.chat(
        [
          {
            role: 'system',
            content: 'You are Omega9, hallucination defense. Catch impossible logic. Return JSON only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        {
          model: 'gpt-4o-mini',
          temperature: 0.1,
          max_tokens: 150,
          requestType: 'omega9_validation',
          endpoint: 'omega9-hallucination'
        }
      );

      // Log token usage
      await llmTokenTracker.logUsage({
        brainName: 'Omega-9',
        model: 'gpt-4o-mini',
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
        contextType: 'meta_reasoning',
        userId: undefined,
        sessionId: undefined
      });

      const content = response.choices[0]?.message?.content || '{}';
      return this.parseValidation(content);
    } catch (error) {
      console.error('[Omega-9] LLM validation error:', error);
      return {
        pass: false,
        flags: ['LLM_VALIDATION_FAILED', ...localFlags],
        confidence_adjustment: -30,
        corrections: { sl: null, tp: null, risk_pct: null },
        reasoning: 'LLM validation failed - blocking for safety'
      };
    }
  }

  /**
   * Parse LLM validation response
   */
  private parseValidation(response: string): Omega9ValidationResult {
    try {
      const cleaned = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleaned);

      return {
        pass: parsed.pass === true,
        flags: Array.isArray(parsed.flags) ? parsed.flags : [],
        confidence_adjustment: Math.max(-50, Math.min(0, parsed.confidence_adjustment || -20)),
        corrections: {
          sl: parsed.corrections?.sl || null,
          tp: parsed.corrections?.tp || null,
          risk_pct: parsed.corrections?.risk_pct || null
        },
        reasoning: parsed.reasoning || 'No reasoning provided'
      };
    } catch (error) {
      console.error('[Omega-9] Parse error:', error);
      return {
        pass: false,
        flags: ['PARSE_ERROR'],
        confidence_adjustment: -30,
        corrections: { sl: null, tp: null, risk_pct: null },
        reasoning: 'Parse failed - blocking for safety'
      };
    }
  }
}

export const omega9Hallucination = new Omega9HallucinationBrain();

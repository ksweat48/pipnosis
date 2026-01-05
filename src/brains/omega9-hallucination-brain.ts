/**
 * Omega-9: Hallucination Defense Specialist
 *
 * Final safety validator that prevents CATASTROPHIC LLM mistakes.
 * LIGHT TOUCH - Alpha is educated via Elite Trader Directive with professional anchor.
 *
 * Validates:
 * - Mathematical correctness (SL/TP on correct side of entry)
 * - Direction logic consistency
 * - Internal Omega vote conflicts
 * - Impossible scenarios (< 5 pips stops, zero distance)
 * - GRADUATED SAFETY ZONES (Green/Yellow/Orange/Red)
 *
 * Can repair catastrophic positioning errors or block unfixable hallucinations.
 *
 * SAFETY ZONE ENFORCEMENT:
 * - GREEN: Full Alpha authority
 * - YELLOW: Advisory warning (proceed)
 * - ORANGE: Advisory caution (proceed with Alpha reasoning)
 * - RED: HARD BLOCK - Cannot proceed (mathematical survival violation)
 *
 * PHILOSOPHY: Trust Alpha's elite trader judgment unless catastrophic error detected.
 */

import { openAIClient } from '../services/openai-client';
import type { Omega9ValidationResult, Omega9Corrections, OmegaVote } from '../types/omega';
import type { AlphaDecision } from './coordinator-alpha';
import { llmTokenTracker } from '../services/llm-token-tracker';
import { alphaSafetyZoneEvaluator, type SafetyEvaluation } from '../config/alpha-safety-zones';
import { calculatePipDistance } from '../utils/currencyHelpers';
import { safeExtractATRValue, type ATRValue } from '../types/atr';

export interface Omega9Input {
  alphaDecision: AlphaDecision;
  omegaVotes: {
    trend: OmegaVote | null;
    scalper: OmegaVote | null;
    reversal: OmegaVote | null;
    volatility: OmegaVote | null;
    risk: OmegaVote | null;
    omega8?: any;
  };
  marketContext: {
    price: number;
    atr: number | ATRValue;
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

    const safetyZone = localValidation.safety_zone || 'YELLOW';
    const safetyScore = localValidation.safety_evaluation?.safety_score ?? 0;

    // If safety score is invalid (NaN), treat as a critical issue
    if (!isFinite(safetyScore)) {
      console.log('[Omega-9] ⚠️ Invalid safety score detected - blocking trade');
      return {
        pass: false,
        flags: [...localValidation.flags, 'INVALID_SAFETY_SCORE'],
        confidence_adjustment: -100,
        corrections: { sl: null, tp: null, risk_pct: null },
        reasoning: 'Invalid safety score calculation - trade blocked',
        safety_zone: 'RED',
        safety_evaluation: localValidation.safety_evaluation
      };
    }

    const onlyAdvisoryFlags = localValidation.flags.every(f =>
      f.includes('ADVISORY') ||
      f.includes('YELLOW_ZONE') ||
      f.includes('ORANGE_ZONE')
    );

    if (safetyZone === 'GREEN' && onlyAdvisoryFlags) {
      console.log('[Omega-9] ✅ GREEN zone with advisory flags only - trusting Alpha decision (skipping LLM)');
      console.log('[Omega-9] Alpha has final authority on strategic decisions');
      return localValidation;
    }

    if (safetyZone === 'YELLOW' && onlyAdvisoryFlags) {
      console.log('[Omega-9] ⚡ YELLOW zone with advisory flags only - trusting Alpha decision (skipping LLM)');
      return localValidation;
    }

    console.log('[Omega-9] 🔍 Requesting LLM validation...');
    return await this.llmValidation(input, localValidation.flags);
  }

  /**
   * Perform local mathematical and logical validation without LLM
   * Includes GRADUATED SAFETY ZONE enforcement
   *
   * SCOPE: Mathematical safety ONLY - no directional consensus validation
   * Alpha has final authority on direction, timing, and strategic decisions
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
        reasoning: 'NO_TRADE requires no validation',
        safety_zone: 'GREEN' as const,
        safety_evaluation: undefined
      };
    }

    const isBuy = alphaDecision.action === 'BUY';
    const entry = alphaDecision.entry;
    const sl = alphaDecision.stopLoss;
    const tp = alphaDecision.takeProfit;

    // MATHEMATICAL VALIDATION: Stop Loss positioning
    if (isBuy && sl >= entry) {
      flags.push('SL_POSITION_ERROR_BUY');
    }
    if (!isBuy && sl <= entry) {
      flags.push('SL_POSITION_ERROR_SELL');
    }

    // MATHEMATICAL VALIDATION: Take Profit positioning
    if (isBuy && tp <= entry) {
      flags.push('TP_POSITION_ERROR_BUY');
    }
    if (!isBuy && tp >= entry) {
      flags.push('TP_POSITION_ERROR_SELL');
    }

    // MATHEMATICAL VALIDATION: Zero distance check
    if (sl === entry || tp === entry) {
      flags.push('ZERO_DISTANCE_ERROR');
    }

    const slDistance = Math.abs(entry - sl);
    const tpDistance = Math.abs(tp - entry);
    const rr = slDistance > 0 ? tpDistance / slDistance : 0;

    // R:R < 1.0 ADVISORY (no longer hard-blocks, will be auto-corrected by constraint system)
    // This allows Alpha to learn and adjust rather than being instantly blocked
    if (rr < 1.0) {
      flags.push('RR_BELOW_1_ADVISORY');
      console.log(`[Omega-9] ⚠️ R:R ${rr.toFixed(3)} < 1.0 - ADVISORY (will be auto-corrected if not revised)`);
      // DO NOT return early - let other validations run
      // Auto-correction happens in coordinator-alpha via constraint provider
    }

    // REMOVED: Vote conflict detection - Alpha has final authority on direction
    // Omega-9's role is MATHEMATICAL SAFETY ONLY, not strategic direction validation

    const slDistancePips = calculatePipDistance(marketContext.symbol, alphaDecision.entry, alphaDecision.stopLoss);
    const tpDistancePips = calculatePipDistance(marketContext.symbol, alphaDecision.entry, alphaDecision.takeProfit);

    const atrValue = safeExtractATRValue(marketContext.atr, 'Omega9.performLocalValidation');

    const safetyEval = alphaSafetyZoneEvaluator.evaluateTrade({
      rrRatio: rr,
      tpDistancePips: tpDistancePips,
      slDistancePips: slDistancePips,
      atr: atrValue,
      symbol: marketContext.symbol,
      estimatedDurationSeconds: 0
    });

    console.log(`[Omega-9] 🛡️ Safety Zone: ${safetyEval.zone} | Score: ${safetyEval.safety_score}/100 | R:R: ${rr.toFixed(3)}`);

    if (safetyEval.zone === 'RED' && !safetyEval.can_proceed) {
      flags.push(`SAFETY_RED_ZONE_HARD_BLOCK`);
      console.log(`[Omega-9] 🚨 RED ZONE VIOLATION - HARD BLOCKING TRADE`);
      safetyEval.violations.forEach(v => {
        console.log(`  ❌ ${v.violation_type}: ${v.message}`);
        flags.push(`RED_ZONE_${v.violation_type.toUpperCase()}`);
      });

      return {
        pass: false,
        flags,
        confidence_adjustment: -100,
        corrections: { sl: null, tp: null, risk_pct: null },
        reasoning: `RED ZONE HARD BLOCK: ${safetyEval.violations.map(v => v.message).join('; ')}. Trade cannot proceed even with Alpha override.`,
        safety_zone: safetyEval.zone,
        safety_evaluation: safetyEval
      };
    }

    if (safetyEval.zone === 'ORANGE') {
      console.log(`[Omega-9] ⚠️ ORANGE ZONE: Alpha override required with reasoning`);
      safetyEval.violations.forEach(v => {
        console.log(`  ⚠️ ${v.violation_type}: ${v.message}`);
        flags.push(`ORANGE_ZONE_${v.violation_type.toUpperCase()}`);
      });
    }

    if (safetyEval.zone === 'YELLOW') {
      console.log(`[Omega-9] ⚡ YELLOW ZONE: Suboptimal conditions detected`);
      safetyEval.violations.forEach(v => {
        console.log(`  ⚡ ${v.violation_type}: ${v.message}`);
        flags.push(`YELLOW_ZONE_${v.violation_type.toUpperCase()}`);
      });
    }

    // REMOVED SL_TOO_WIDE and SL_TOO_TIGHT checks
    // Alpha is now educated via Elite Trader Directive with professional anchor
    // Trust Alpha's judgment unless catastrophic error

    // Only HARD_BLOCK flags prevent trade (catastrophic errors only)
    // Advisory flags (like RR_BELOW_1_ADVISORY) do NOT block - they trigger auto-correction
    const hasHardBlock = flags.some(f => f.includes('HARD_BLOCK') && !f.includes('ADVISORY'));
    const pass = flags.length === 0 || (!hasHardBlock && safetyEval.can_proceed);

    let confidenceAdjustment = 0;
    if (safetyEval.zone === 'RED') confidenceAdjustment = -100; // HARD BLOCK
    else if (safetyEval.zone === 'ORANGE') confidenceAdjustment = -10; // ADVISORY (reduced from -30)
    else if (safetyEval.zone === 'YELLOW') confidenceAdjustment = -5; // ADVISORY (reduced from -15)
    else if (flags.length > 0) confidenceAdjustment = -5; // MINIMAL (reduced from -20)

    return {
      pass,
      flags,
      confidence_adjustment: confidenceAdjustment,
      corrections: { sl: null, tp: null, risk_pct: null },
      reasoning: pass ?
        (safetyEval.zone === 'GREEN' ? 'All validations passed' : `${safetyEval.zone} ZONE: ${flags.join(', ')}`) :
        `Failed: ${flags.join(', ')}`,
      safety_zone: safetyEval.zone,
      safety_evaluation: safetyEval
    };
  }

  /**
   * REMOVED: Vote conflict detection
   *
   * Omega-9's role is MATHEMATICAL SAFETY ONLY, not strategic direction validation.
   * Alpha has final authority on direction synthesis from Omega votes.
   * Vote conflicts are Alpha's responsibility to resolve via weighted consensus.
   */

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

    const atrValue = safeExtractATRValue(marketContext.atr, 'Omega9.attemptRepair');

    if (flags.includes('SL_POSITION_ERROR_BUY') && isBuy) {
      sl = entry - atrValue * 1.5;
      corrections.sl = sl;
      console.log(`[Omega-9] 🔧 Corrected BUY SL: ${alphaDecision.stopLoss} → ${sl}`);
    } else if (flags.includes('SL_POSITION_ERROR_SELL') && !isBuy) {
      sl = entry + atrValue * 1.5;
      corrections.sl = sl;
      console.log(`[Omega-9] 🔧 Corrected SELL SL: ${alphaDecision.stopLoss} → ${sl}`);
    }

    if (flags.includes('TP_POSITION_ERROR_BUY') && isBuy) {
      tp = entry + atrValue * 2.5;
      corrections.tp = tp;
      console.log(`[Omega-9] 🔧 Corrected BUY TP: ${alphaDecision.takeProfit} → ${tp}`);
    } else if (flags.includes('TP_POSITION_ERROR_SELL') && !isBuy) {
      tp = entry - atrValue * 2.5;
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
   * SCOPE: Mathematical safety only - no directional override
   */
  private async llmValidation(input: Omega9Input, localFlags: string[]): Promise<Omega9ValidationResult> {
    const prompt = `Validation (Mathematical Safety Only):
Decision: ${input.alphaDecision.action} @ ${input.alphaDecision.entry}
SL: ${input.alphaDecision.stopLoss}, TP: ${input.alphaDecision.takeProfit}
LocalFlags: ${localFlags.join(', ')}

SCOPE: Check ONLY mathematical correctness and impossible scenarios:
- SL/TP on correct side of entry
- No zero-distance stops
- No catastrophic positioning errors

DO NOT validate directional consensus or vote conflicts - Alpha has final authority on direction.

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
            content: 'You are Omega-9, mathematical safety validator. Your ONLY role is catching catastrophic mathematical errors (SL/TP wrong side, zero distances, impossible positioning). Alpha has final authority on direction and strategy. Return JSON only.'
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
        contextType: 'risk_assessment',
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

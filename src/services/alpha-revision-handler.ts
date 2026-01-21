/**
 * Alpha Revision Handler
 *
 * Implements the one-revision-loop for Alpha decision refinement.
 *
 * Flow:
 * 1. Alpha makes initial decision
 * 2. If constraint violations detected → Request revision with specific feedback
 * 3. Alpha adjusts decision (ONE TIME ONLY)
 * 4. Final decision proceeds to catastrophic validation
 *
 * This gives Alpha ONE LEARNING OPPORTUNITY per decision without creating infinite loops.
 */

import { openAIClient } from './openai-client';
import { llmTokenTracker } from './llm-token-tracker';
import type {
  AlphaRevisionRequest,
  AlphaRevisionResponse,
  Omega9Constraints,
  ConstraintViolation
} from '../types/omega9-constraints';
import type { AlphaDecision } from '../brains/coordinator-alpha';

class AlphaRevisionHandler {
  /**
   * Request a revision from Alpha with specific constraint feedback
   *
   * This is called ONLY when Alpha's initial decision violates constraints
   * that could be easily fixed (e.g., R:R 0.98 → 1.02)
   */
  async requestRevision(
    originalDecision: AlphaDecision,
    violations: ConstraintViolation[],
    constraints: Omega9Constraints,
    symbol: string,
    userId?: string
  ): Promise<AlphaRevisionResponse> {
    // Filter for actionable violations (not catastrophic, fixable)
    const actionableViolations = violations.filter(
      v => v.severity !== 'CATASTROPHIC' && v.suggestedFix
    );

    if (actionableViolations.length === 0) {
      // No actionable violations, return original decision
      return {
        revised: false
      };
    }

    // 🚨 INFEASIBILITY CHECK: Detect impossible constraint scenarios
    // This prevents wasting LLM tokens on unsolvable situations
    const infeasibilityCheck = this.detectInfeasibleConstraints(
      constraints,
      violations,
      originalDecision
    );

    if (infeasibilityCheck.isInfeasible) {
      console.log('[Alpha Revision] ⚠️ INFEASIBLE CONSTRAINTS DETECTED');
      console.log(`[Alpha Revision] Reason: ${infeasibilityCheck.reason}`);
      console.log('[Alpha Revision] Skipping LLM call - constraints cannot be satisfied');
      return {
        revised: false
      };
    }

    // Build revision suggestions
    const revisionSuggestions = this.buildRevisionSuggestions(
      originalDecision,
      actionableViolations,
      constraints,
      symbol
    );

    console.log('[Alpha Revision] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[Alpha Revision] Constraint violations detected:');
    actionableViolations.forEach(v => {
      console.log(`  ${v.severity}: ${v.message}`);
      if (v.suggestedFix) {
        console.log(`  Fix: ${v.suggestedFix}`);
      }
    });
    console.log('[Alpha Revision] Requesting revision from Alpha...');

    const prompt = this.buildRevisionPrompt(
      originalDecision,
      actionableViolations,
      constraints,
      revisionSuggestions
    );

    try {
      const response = await openAIClient.chat(
        [
          {
            role: 'system',
            content: 'You are Alpha. You receive constraint feedback and adjust your decision. Return JSON only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        {
          model: 'gpt-4o-mini',
          temperature: 0.2, // Lower temperature for focused revision
          max_tokens: 500, // Increased from 200 to prevent JSON truncation
          requestType: 'alpha_revision',
          endpoint: 'alpha-revision'
        }
      );

      // Log token usage
      await llmTokenTracker.logUsage({
        brainName: 'Alpha',
        model: 'gpt-4o-mini',
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
        contextType: 'alpha_revision',
        userId: userId,
        sessionId: undefined
      });

      const content = response.choices[0]?.message?.content || '{}';
      const parsed = this.parseRevisionResponse(content);

      if (parsed.revised) {
        console.log('[Alpha Revision] ✅ Revision accepted');
        console.log(`[Alpha Revision] Updated SL: ${originalDecision.stopLoss.toFixed(5)} → ${parsed.revisedDecision?.stopLoss.toFixed(5)}`);
        console.log(`[Alpha Revision] Updated TP: ${originalDecision.takeProfit.toFixed(5)} → ${parsed.revisedDecision?.takeProfit.toFixed(5)}`);
        console.log(`[Alpha Revision] Reasoning: ${parsed.revisionReasoning}`);
      } else {
        console.log('[Alpha Revision] ⚠️ No revision made - Alpha standing by original decision');
      }

      console.log('[Alpha Revision] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      return parsed;
    } catch (error) {
      console.error('[Alpha Revision] Error requesting revision:', error);
      return {
        revised: false
      };
    }
  }

  /**
   * Detect if constraints are mathematically impossible to satisfy
   *
   * This prevents wasting LLM tokens on unsolvable scenarios where
   * constraints conflict or create impossible requirements
   */
  private detectInfeasibleConstraints(
    constraints: Omega9Constraints,
    violations: ConstraintViolation[],
    decision: AlphaDecision
  ): { isInfeasible: boolean; reason?: string } {
    // Check 1: TP range validity (min must be <= max)
    if (constraints.minTakeProfitPips > constraints.maxTakeProfitPips) {
      return {
        isInfeasible: true,
        reason: `TP range invalid: min ${constraints.minTakeProfitPips.toFixed(1)} > max ${constraints.maxTakeProfitPips.toFixed(1)} pips`
      };
    }

    // Check 2: SL range validity (min must be <= max)
    if (constraints.minStopLossPips > constraints.maxStopLossPips) {
      return {
        isInfeasible: true,
        reason: `SL range invalid: min ${constraints.minStopLossPips.toFixed(1)} > max ${constraints.maxStopLossPips.toFixed(1)} pips`
      };
    }

    // Check 3: Zero or negative range for TP (impossible to place TP)
    if (constraints.maxTakeProfitPips <= 0) {
      return {
        isInfeasible: true,
        reason: `TP max is ${constraints.maxTakeProfitPips.toFixed(1)} pips - cannot place take profit`
      };
    }

    // Check 4: R:R requirement vs available TP range
    // If minRR = 1.0 and maxSL = 50 pips, then minTP must be >= 50 pips
    // If maxTP < minTP required by R:R, it's infeasible
    const minTPRequiredByRR = constraints.maxStopLossPips * constraints.minRiskReward;
    if (minTPRequiredByRR > constraints.maxTakeProfitPips) {
      return {
        isInfeasible: true,
        reason: `R:R ${constraints.minRiskReward}:1 requires TP >= ${minTPRequiredByRR.toFixed(1)} pips, but max TP is ${constraints.maxTakeProfitPips.toFixed(1)} pips`
      };
    }

    // Check 5: If TP max is very close to TP min (< 1 pip range), it's effectively infeasible
    const tpRange = constraints.maxTakeProfitPips - constraints.minTakeProfitPips;
    if (tpRange < 1.0) {
      return {
        isInfeasible: true,
        reason: `TP range too narrow: ${tpRange.toFixed(1)} pips (${constraints.minTakeProfitPips.toFixed(1)} to ${constraints.maxTakeProfitPips.toFixed(1)})`
      };
    }

    return {
      isInfeasible: false
    };
  }

  /**
   * Build revision suggestions based on constraint violations
   */
  private buildRevisionSuggestions(
    decision: AlphaDecision,
    violations: ConstraintViolation[],
    constraints: Omega9Constraints,
    symbol: string
  ): string[] {
    const suggestions: string[] = [];

    for (const violation of violations) {
      switch (violation.type) {
        case 'MIN_RR':
          suggestions.push(`Increase TP to ${constraints.minTakeProfitPips.toFixed(1)} pips for R:R ≥ 1.0`);
          break;
        case 'MAX_TP':
          suggestions.push(`Reduce TP to ${constraints.maxTakeProfitPips.toFixed(1)} pips (maximum)`);
          break;
        case 'MIN_SL':
          suggestions.push(`Consider widening SL to ${constraints.recommendedStopLossPips.toFixed(1)} pips`);
          break;
        case 'MAX_SL':
          suggestions.push(`Consider tightening SL to ${constraints.recommendedStopLossPips.toFixed(1)} pips`);
          break;
      }
    }

    return suggestions;
  }

  /**
   * Build revision prompt for Alpha
   */
  private buildRevisionPrompt(
    originalDecision: AlphaDecision,
    violations: ConstraintViolation[],
    constraints: Omega9Constraints,
    suggestions: string[]
  ): string {
    const violationSummary = violations
      .map(v => `• ${v.severity}: ${v.message}`)
      .join('\n');

    const suggestionSummary = suggestions
      .map((s, i) => `${i + 1}. ${s}`)
      .join('\n');

    return `CONSTRAINT VIOLATION DETECTED - Revision Opportunity

You proposed a trade that violates professional risk management constraints.
These constraints exist to protect against unprofessional trades and are
calibrated based on ATR, session feasibility, and market volatility.

ORIGINAL DECISION:
Action: ${originalDecision.action}
Entry: ${originalDecision.entry}
Stop-Loss: ${originalDecision.stopLoss}
Take-Profit: ${originalDecision.takeProfit}
Confidence: ${originalDecision.confidence}%
Reasoning: ${originalDecision.reasoning}

PROFESSIONAL CONSTRAINT VIOLATIONS:
${violationSummary}

WHY THESE CONSTRAINTS EXIST:
• Stop Loss ranges ensure survival through normal market noise
• Take Profit ranges are session-feasible (based on time remaining)
• R:R requirements maintain professional edge standards
• Constraints adapt to volatility, ATR, and market conditions

SUGGESTED ADJUSTMENTS (High Success Path):
${suggestionSummary}

CONSTRAINT BOUNDARIES:
• SL Range: ${constraints.minStopLossPips.toFixed(1)} - ${constraints.maxStopLossPips.toFixed(1)} pips (ATR-based, noise floor-aware)
• TP Range: ${constraints.minTakeProfitPips.toFixed(1)} - ${constraints.maxTakeProfitPips.toFixed(1)} pips (session-feasible distance)
• Minimum R:R: ${constraints.minRiskReward}:1 (professional standard)
• Noise Floor: ${constraints.noiseFloorPips.toFixed(1)} pips (${constraints.noiseFloorReasoning})

THIS IS YOUR ONE REVISION OPPORTUNITY:

Option 1 (RECOMMENDED): Accept constraints and adjust SL/TP
- Demonstrates professional discipline
- Trade proceeds with optimized parameters
- Respects market reality (ATR, session time, volatility)

Option 2: Stand firm with strong statistical justification
- Requires compelling evidence why constraints don't apply
- Trade may be blocked if justification insufficient
- Use ONLY when constraints genuinely conflict with edge

CRITICAL: If you revise, ensure geometry is correct:
- BUY: SL < Entry < TP
- SELL: TP < Entry < SL

Return JSON:
{
  "revised": true|false,
  "revisedDecision": {
    "action": "${originalDecision.action}",
    "entry": ${originalDecision.entry},
    "stopLoss": number,
    "takeProfit": number,
    "confidence": 0-100,
    "reasoning": "explain adjustment OR why constraints don't apply to this setup"
  },
  "revisionReasoning": "why you accepted constraints OR why you're declining",
  "acceptedConstraints": ["constraint names you accepted"] or []
}

If you choose NOT to revise (revised: false), the trade will be BLOCKED to prevent
unprofessional risk management. Only decline if constraints are genuinely incompatible
with your statistical edge.`;
  }

  /**
   * Parse Alpha's revision response
   */
  private parseRevisionResponse(response: string): AlphaRevisionResponse {
    try {
      let cleaned = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      // Try to extract JSON if response contains extra text
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleaned = jsonMatch[0];
      }

      // Attempt to fix common JSON issues
      // 1. Unterminated strings - try to close them
      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (firstError) {
        // If parsing fails, try to fix unterminated strings by adding closing quote and braces
        const fixAttempt = cleaned.replace(/("[^"]*?)$/g, '$1"}');
        try {
          parsed = JSON.parse(fixAttempt);
          console.warn('[Alpha Revision] Fixed malformed JSON with string termination');
        } catch (secondError) {
          // Log raw response for debugging
          console.error('[Alpha Revision] Failed to parse even after fix attempt');
          console.error('[Alpha Revision] Raw response (first 500 chars):', response.substring(0, 500));
          throw firstError; // Throw original error
        }
      }

      if (!parsed.revised) {
        return {
          revised: false
        };
      }

      // CRITICAL VALIDATION: Detect invalid revision scenarios
      const revisedDecision = parsed.revisedDecision;

      // Check 1: TP must not equal Entry (R:R 0.0:1 is invalid)
      if (Math.abs(revisedDecision.takeProfit - revisedDecision.entry) < 0.000001) {
        console.error('[Alpha Revision] ❌ INVALID REVISION: TP equals Entry price (R:R 0.0:1)');
        console.error('[Alpha Revision] This indicates infeasible constraints - rejecting revision');
        return {
          revised: false
        };
      }

      // Check 2: SL must not equal Entry (invalid stop placement)
      if (Math.abs(revisedDecision.stopLoss - revisedDecision.entry) < 0.000001) {
        console.error('[Alpha Revision] ❌ INVALID REVISION: SL equals Entry price');
        console.error('[Alpha Revision] This indicates infeasible constraints - rejecting revision');
        return {
          revised: false
        };
      }

      // Check 3: TP and SL must be on opposite sides of Entry
      const isBuy = revisedDecision.action === 'BUY';
      const tpValid = isBuy ? revisedDecision.takeProfit > revisedDecision.entry : revisedDecision.takeProfit < revisedDecision.entry;
      const slValid = isBuy ? revisedDecision.stopLoss < revisedDecision.entry : revisedDecision.stopLoss > revisedDecision.entry;

      if (!tpValid || !slValid) {
        console.error('[Alpha Revision] ❌ INVALID REVISION: TP/SL on wrong side of entry');
        console.error(`[Alpha Revision] Direction: ${revisedDecision.action}, Entry: ${revisedDecision.entry}, TP: ${revisedDecision.takeProfit}, SL: ${revisedDecision.stopLoss}`);
        return {
          revised: false
        };
      }

      // Check 4: Minimum viable distance (at least 0.1 pips for any pair)
      const tpDistance = Math.abs(revisedDecision.takeProfit - revisedDecision.entry);
      const slDistance = Math.abs(revisedDecision.stopLoss - revisedDecision.entry);
      const minDistance = 0.00001; // Minimum 0.1 pips in price terms

      if (tpDistance < minDistance || slDistance < minDistance) {
        console.error('[Alpha Revision] ❌ INVALID REVISION: TP or SL too close to entry (< 0.1 pips)');
        return {
          revised: false
        };
      }

      console.log('[Alpha Revision] ✅ Revision validation passed');

      return {
        revised: true,
        revisedDecision: {
          action: revisedDecision.action,
          entry: revisedDecision.entry,
          stopLoss: revisedDecision.stopLoss,
          takeProfit: revisedDecision.takeProfit,
          confidence: Math.min(100, Math.max(0, revisedDecision.confidence)),
          reasoning: revisedDecision.reasoning || parsed.revisionReasoning || 'Revised based on constraints'
        },
        revisionReasoning: parsed.revisionReasoning,
        acceptedConstraints: Array.isArray(parsed.acceptedConstraints) ? parsed.acceptedConstraints : []
      };
    } catch (error) {
      console.error('[Alpha Revision] Parse error:', error);
      return {
        revised: false
      };
    }
  }

  /**
   * Log revision outcome to database for learning
   */
  async logRevision(
    userId: string,
    originalDecision: AlphaDecision,
    revisedDecision: AlphaDecision | null,
    violations: ConstraintViolation[],
    constraints: Omega9Constraints,
    sessionId?: string
  ): Promise<void> {
    // TODO: Implement database logging in Phase 3
    // This will track:
    // - How often Alpha revises vs stands firm
    // - Which constraint types trigger revisions
    // - Revision success rate (did the revised trade perform better?)
    // - Learning patterns over time

    console.log('[Alpha Revision] Revision logged for future learning analysis');
  }
}

export const alphaRevisionHandler = new AlphaRevisionHandler();

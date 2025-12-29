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
          max_tokens: 200,
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

    return `You made a trading decision that violates professional constraints.

ORIGINAL DECISION:
Action: ${originalDecision.action}
Entry: ${originalDecision.entry}
Stop-Loss: ${originalDecision.stopLoss}
Take-Profit: ${originalDecision.takeProfit}
Confidence: ${originalDecision.confidence}%
Reasoning: ${originalDecision.reasoning}

CONSTRAINT VIOLATIONS:
${violationSummary}

SUGGESTED ADJUSTMENTS:
${suggestionSummary}

CONSTRAINTS YOU MUST WORK WITHIN:
• SL Range: ${constraints.minStopLossPips.toFixed(1)} - ${constraints.maxStopLossPips.toFixed(1)} pips
• TP Range: ${constraints.minTakeProfitPips.toFixed(1)} - ${constraints.maxTakeProfitPips.toFixed(1)} pips (minimum for R:R ≥ 1.0)
• Minimum R:R: ${constraints.minRiskReward}:1 (professional standard)

This is your ONE REVISION OPPORTUNITY. Adjust your SL/TP to meet constraints, or stand by your original decision with strong justification.

Return JSON:
{
  "revised": true|false,
  "revisedDecision": {
    "action": "${originalDecision.action}",
    "entry": number,
    "stopLoss": number,
    "takeProfit": number,
    "confidence": 0-100,
    "reasoning": "explain your adjustment or why you're keeping original"
  },
  "revisionReasoning": "brief explanation",
  "acceptedConstraints": ["which constraints you accepted"]
}

If you choose NOT to revise (revised: false), your original decision will proceed but may be auto-corrected.`;
  }

  /**
   * Parse Alpha's revision response
   */
  private parseRevisionResponse(response: string): AlphaRevisionResponse {
    try {
      const cleaned = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleaned);

      if (!parsed.revised) {
        return {
          revised: false
        };
      }

      return {
        revised: true,
        revisedDecision: {
          action: parsed.revisedDecision.action,
          entry: parsed.revisedDecision.entry,
          stopLoss: parsed.revisedDecision.stopLoss,
          takeProfit: parsed.revisedDecision.takeProfit,
          confidence: Math.min(100, Math.max(0, parsed.revisedDecision.confidence)),
          reasoning: parsed.revisedDecision.reasoning || parsed.revisionReasoning || 'Revised based on constraints'
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

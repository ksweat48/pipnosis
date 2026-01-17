/**
 * Alpha Repair Service
 *
 * Implements: "Engines validate. Alpha decides. Trades degrade intelligently."
 *
 * When Alpha's initial decision violates constraints (but is not a hard block),
 * this service requests an Alpha Repair Pass.
 *
 * Alpha receives:
 * - Clear violation explanations
 * - Constraint boundaries
 * - Degradation options (e.g., $100 goal → $50 feasible)
 * - Market context
 *
 * Alpha decides:
 * - Whether to revise the trade
 * - New SL/TP/risk within constraints
 * - Explicit degradation with user messaging
 * - Or NO_TRADE if truly impossible
 *
 * NO engine may invent SL/TP values. Only Alpha.
 */

import { openAIClient } from './openai-client';
import { llmTokenTracker } from './llm-token-tracker';
import { logger } from '../lib/logger';
import type {
  AlphaRepairRequest,
  AlphaRepairResponse,
  AlphaRepairContext,
  AlphaRepairViolation,
} from '../types/alpha-repair';

interface RepairPromptComponents {
  systemPrompt: string;
  userPrompt: string;
}

class AlphaRepairService {
  private readonly MAX_REPAIR_ATTEMPTS = 2;
  private readonly REPAIR_TIMEOUT_MS = 15000; // 15s for repair

  /**
   * Request Alpha to repair a decision that violates constraints
   */
  async requestRepair(request: AlphaRepairRequest): Promise<AlphaRepairResponse> {
    const startTime = Date.now();

    try {
      logger.info(
        `[Alpha Repair] Requesting repair for ${request.repairContext.originalDecision.symbol} ` +
        `(Attempt ${request.attemptNumber}/${request.maxAttempts})`
      );

      // Log violations
      request.repairContext.violations.forEach(v => {
        logger.warn(`[Alpha Repair] ${v.severity}: ${v.type} - ${v.description}`);
      });

      // Build repair prompt
      const prompt = this.buildRepairPrompt(request.repairContext);

      // Call Alpha with repair request
      const response = await openAIClient.generateStructuredResponse(
        prompt.systemPrompt,
        prompt.userPrompt,
        {
          revised: 'boolean',
          action: 'string',
          entry: 'number',
          stopLoss: 'number',
          takeProfit: 'number',
          risk_pct: 'number',
          confidence: 'number',
          reasoning: 'string',
          degradationApplied: 'boolean',
          degradationOriginal: 'string',
          degradationRevised: 'string',
          degradationUserMessage: 'string',
          blockReason: 'string',
        },
        {
          temperature: 0.3, // Low temperature for constraint adherence
          timeout: this.REPAIR_TIMEOUT_MS,
        }
      );

      const tokensUsed = Date.now() - startTime;

      // Track token usage
      await llmTokenTracker.trackUsage({
        brain_name: 'alpha-repair',
        context_type: 'repair_pass',
        symbol: request.repairContext.originalDecision.symbol,
        input_tokens: response.usage?.prompt_tokens || 0,
        output_tokens: response.usage?.completion_tokens || 0,
        total_tokens: response.usage?.total_tokens || 0,
        latency_ms: tokensUsed,
      });

      // Parse response
      const parsed = this.parseRepairResponse(response.content, request);

      logger.info(
        `[Alpha Repair] ${parsed.revised ? 'REVISED' : 'NOT REVISED'} ` +
        `(${tokensUsed}ms, ${response.usage?.total_tokens || 0} tokens)`
      );

      if (parsed.revised && parsed.revisedDecision) {
        logger.info(
          `[Alpha Repair] New decision: ${parsed.revisedDecision.action} ` +
          `Entry=${parsed.revisedDecision.entry?.toFixed(5)} ` +
          `SL=${parsed.revisedDecision.stopLoss?.toFixed(5)} ` +
          `TP=${parsed.revisedDecision.takeProfit?.toFixed(5)} ` +
          `Risk=${parsed.revisedDecision.risk_pct?.toFixed(2)}%`
        );

        if (parsed.revisedDecision.degradationApplied) {
          logger.info(
            `[Alpha Repair] Degradation: "${parsed.revisedDecision.degradationApplied.original}" → ` +
            `"${parsed.revisedDecision.degradationApplied.revised}"`
          );
        }
      }

      return parsed;

    } catch (error) {
      logger.error('[Alpha Repair] Repair request failed:', error);

      // On error, return non-revised response
      return {
        revised: false,
        blockReason: `Repair request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        repairAttempt: request.attemptNumber,
        tokensUsed: Date.now() - startTime,
      };
    }
  }

  /**
   * Build compressed repair prompt for Alpha
   */
  private buildRepairPrompt(context: AlphaRepairContext): RepairPromptComponents {
    const { originalDecision, violations, constraints, marketContext, guidance } = context;

    const systemPrompt = `You are Alpha, the final decision authority.

Your initial decision violated constraints. You must revise OR declare NO_TRADE.

RULES:
1. You may adjust SL/TP/risk ONLY within provided constraint ranges
2. You may degrade targets intelligently (e.g., $100 goal → $50 feasible)
3. You may choose NO_TRADE if truly impossible
4. You MUST NOT invent R:R ratios or arbitrary values
5. All geometry must be correct (SL below entry for BUY, etc.)

VIOLATIONS:
${violations.map(v => `- [${v.severity}] ${v.type}: ${v.description}`).join('\n')}

CONSTRAINTS:
${this.formatConstraints(constraints)}

MARKET CONTEXT:
- Price: ${marketContext.currentPrice.toFixed(5)}
${marketContext.atr ? `- ATR: ${marketContext.atr.toFixed(5)}` : ''}
${marketContext.volatility ? `- Volatility: ${marketContext.volatility}` : ''}
${marketContext.session ? `- Session: ${marketContext.session}` : ''}

GUIDANCE:
${this.formatGuidance(guidance)}

Respond with JSON:
{
  "revised": true/false,
  "action": "BUY/SELL/WAIT/NO_TRADE",
  "entry": number,
  "stopLoss": number,
  "takeProfit": number,
  "risk_pct": number,
  "confidence": number,
  "reasoning": "why you revised or blocked",
  "degradationApplied": true/false,
  "degradationOriginal": "original target",
  "degradationRevised": "revised target",
  "degradationUserMessage": "message for user",
  "blockReason": "if revised=false, why"
}`;

    const userPrompt = `Original Decision:
Action: ${originalDecision.action}
Symbol: ${originalDecision.symbol}
Direction: ${originalDecision.direction}
Entry: ${originalDecision.entry.toFixed(5)}
SL: ${originalDecision.stopLoss.toFixed(5)}
TP: ${originalDecision.takeProfit.toFixed(5)}
Risk: ${originalDecision.risk_pct.toFixed(2)}%
Confidence: ${originalDecision.confidence}%
Reasoning: ${originalDecision.reasoning}

Revise this decision OR choose NO_TRADE.`;

    return { systemPrompt, userPrompt };
  }

  private formatConstraints(constraints: AlphaRepairContext['constraints']): string {
    const lines: string[] = [];

    if (constraints.minRR !== undefined || constraints.maxRR !== undefined) {
      lines.push(`- R:R: ${constraints.minRR || 'any'}:1 to ${constraints.maxRR || 'any'}:1`);
    }
    if (constraints.minSLPips !== undefined || constraints.maxSLPips !== undefined) {
      lines.push(`- SL: ${constraints.minSLPips || 'any'} to ${constraints.maxSLPips || 'any'} pips`);
    }
    if (constraints.minTPPips !== undefined || constraints.maxTPPips !== undefined) {
      lines.push(`- TP: ${constraints.minTPPips || 'any'} to ${constraints.maxTPPips || 'any'} pips`);
    }
    if (constraints.minRiskPct !== undefined || constraints.maxRiskPct !== undefined) {
      lines.push(`- Risk: ${constraints.minRiskPct || 'any'}% to ${constraints.maxRiskPct || 'any'}%`);
    }
    if (constraints.userGoalDollars !== undefined) {
      lines.push(`- User Goal: $${constraints.userGoalDollars}`);
      if (constraints.maxFeasibleDollars !== undefined) {
        lines.push(`- Max Feasible: $${constraints.maxFeasibleDollars} (market limit)`);
      }
    }

    return lines.length > 0 ? lines.join('\n') : '- None specified';
  }

  private formatGuidance(guidance: AlphaRepairContext['guidance']): string {
    const lines: string[] = [];

    if (guidance.suggestedSLRange) {
      lines.push(
        `- Suggested SL: ${guidance.suggestedSLRange.min.toFixed(5)} to ${guidance.suggestedSLRange.max.toFixed(5)}`
      );
    }
    if (guidance.suggestedTPRange) {
      lines.push(
        `- Suggested TP: ${guidance.suggestedTPRange.min.toFixed(5)} to ${guidance.suggestedTPRange.max.toFixed(5)}`
      );
    }
    if (guidance.degradationOptions && guidance.degradationOptions.length > 0) {
      lines.push('- Degradation Options:');
      guidance.degradationOptions.forEach(opt => lines.push(`  • ${opt}`));
    }

    return lines.length > 0 ? lines.join('\n') : '- Use your best judgment';
  }

  private parseRepairResponse(
    content: string,
    request: AlphaRepairRequest
  ): AlphaRepairResponse {
    try {
      const parsed = JSON.parse(content);

      // Validate required fields
      if (typeof parsed.revised !== 'boolean') {
        throw new Error('Missing or invalid "revised" field');
      }

      if (!parsed.revised) {
        // Alpha chose not to revise
        return {
          revised: false,
          blockReason: parsed.blockReason || 'Alpha declined to revise',
          repairAttempt: request.attemptNumber,
          tokensUsed: 0,
        };
      }

      // Alpha revised - validate new decision
      if (!parsed.action || !['BUY', 'SELL', 'WAIT', 'NO_TRADE'].includes(parsed.action)) {
        throw new Error('Invalid or missing action in revision');
      }

      const revisedDecision: AlphaRepairResponse['revisedDecision'] = {
        action: parsed.action,
        confidence: parsed.confidence || request.repairContext.originalDecision.confidence,
        reasoning: parsed.reasoning || 'Revised based on constraints',
      };

      // Only include trade parameters if action is BUY or SELL
      if (parsed.action === 'BUY' || parsed.action === 'SELL') {
        if (typeof parsed.entry !== 'number' || typeof parsed.stopLoss !== 'number' || typeof parsed.takeProfit !== 'number') {
          throw new Error('Missing trade parameters (entry/SL/TP) for BUY/SELL action');
        }

        revisedDecision.entry = parsed.entry;
        revisedDecision.stopLoss = parsed.stopLoss;
        revisedDecision.takeProfit = parsed.takeProfit;
        revisedDecision.risk_pct = parsed.risk_pct || request.repairContext.originalDecision.risk_pct;

        // Check for degradation
        if (parsed.degradationApplied && parsed.degradationOriginal && parsed.degradationRevised) {
          revisedDecision.degradationApplied = {
            original: parsed.degradationOriginal,
            revised: parsed.degradationRevised,
            userMessage: parsed.degradationUserMessage || 'Target adjusted based on market conditions',
          };
        }
      }

      return {
        revised: true,
        revisedDecision,
        repairAttempt: request.attemptNumber,
        tokensUsed: 0,
      };

    } catch (error) {
      logger.error('[Alpha Repair] Failed to parse repair response:', error);
      logger.error('[Alpha Repair] Raw content:', content);

      return {
        revised: false,
        blockReason: `Failed to parse repair response: ${error instanceof Error ? error.message : 'Unknown error'}`,
        repairAttempt: request.attemptNumber,
        tokensUsed: 0,
      };
    }
  }
}

export const alphaRepairService = new AlphaRepairService();

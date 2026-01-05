import { openAIClient } from './openai-client';
import {
  DownshiftProposal,
  AlphaFeasibilityResponse,
  FeasibilityDecision,
} from '../types/goal-feasibility';
import { logger } from '../lib/logger';
import { llmTokenTracker } from './llm-token-tracker';

export class AlphaDownshiftEvaluator {
  static async evaluateDownshiftProposal(
    proposal: DownshiftProposal,
    userId: string,
    sessionId?: string
  ): Promise<AlphaFeasibilityResponse> {
    logger.info('Alpha evaluating downshift proposal', {
      userId,
      sessionId,
      originalGoal: proposal.originalGoal,
      adjustedGoal: proposal.adjustedGoal,
      retentionPercent: `${(proposal.retentionPercent * 100).toFixed(1)}%`,
    });

    const prompt = this.buildEvaluationPrompt(proposal);

    const startTime = Date.now();

    try {
      const response = await openAIClient.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt(),
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 500,
      });

      const elapsedMs = Date.now() - startTime;

      await llmTokenTracker.trackTokenUsage({
        userId,
        brainName: 'Alpha_Downshift_Evaluator',
        contextType: 'downshift_evaluation',
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
        model: 'gpt-4o-mini',
        latencyMs: elapsedMs,
        sessionId,
      });

      const content = response.choices[0]?.message?.content?.trim() || '';

      logger.debug('Alpha downshift evaluation response', {
        userId,
        content: content.substring(0, 200),
      });

      return this.parseResponse(content, proposal);
    } catch (error) {
      logger.error('Error in Alpha downshift evaluation', { error, userId });

      return {
        decision: 'REJECT',
        reasoning:
          'Unable to evaluate downshift proposal due to system error. Defaulting to rejection for safety.',
      };
    }
  }

  private static getSystemPrompt(): string {
    return `You are Alpha, the final decision authority in the Pipnosis trading system.

Your role: Evaluate whether a DOWNSHIFTED goal is worth trading.

Context:
- User set a goal but market conditions can't safely deliver it
- System calculated what market CAN deliver
- System checked if it's "meaningful" (passes minimum thresholds)
- You must decide: AFFIRM (trade it), WAIT (conditions not optimal), or REJECT (not worth it)

GUIDING PRINCIPLE:
"If the market can offer something MEANINGFUL, adapt and trade.
If it can only offer NOISE, wait — don't churn."

Your authority:
- You can AFFIRM downshifted trades that are meaningful
- You can WAIT if market conditions aren't optimal yet
- You can REJECT if the opportunity doesn't make strategic sense

Respond in this exact format:
DECISION: [AFFIRM/WAIT/REJECT]
REASONING: [Your strategic reasoning in 1-2 sentences]
ADJUSTMENTS: [Optional: any parameter adjustments you recommend, or "None"]`;
  }

  private static buildEvaluationPrompt(proposal: DownshiftProposal): string {
    const {
      originalGoal,
      adjustedGoal,
      retentionPercent,
      adjustedTrade,
      volatilityContext,
      meaningfulnessChecks,
      reasonsForDownshift,
      calculationMetadata,
    } = proposal;

    const checkStatus = (check: boolean) => (check ? '✅' : '❌');

    return `Evaluate this downshifted goal proposal:

ORIGINAL GOAL: $${originalGoal.toFixed(2)}
ADJUSTED GOAL: $${adjustedGoal.toFixed(2)} (${(retentionPercent * 100).toFixed(1)}% retention)

ACCOUNT: $${calculationMetadata.accountBalance.toFixed(2)}
SYMBOL: ${calculationMetadata.symbol}
PROGRESS: $${calculationMetadata.currentProgress.toFixed(2)} / $${calculationMetadata.remainingGoal.toFixed(2)} remaining

ADJUSTED TRADE PARAMETERS:
• Target Profit: $${adjustedTrade.targetProfit.toFixed(2)}
• Stop Loss: ${adjustedTrade.stopLoss.toFixed(5)}
• Risk:Reward: ${adjustedTrade.riskReward.toFixed(2)}:1
• Est. Time to Fill: ${adjustedTrade.timeToFillMinutes} minutes
• Position Size: ${adjustedTrade.positionSize.toFixed(2)} lots
• Spread Cost: $${adjustedTrade.estimatedSpreadCost.toFixed(2)}

MARKET CONDITIONS:
• Current ATR: ${volatilityContext.currentATR.toFixed(5)} (${(volatilityContext.atrMultiplierFromTypical * 100).toFixed(0)}% of typical)
• Daily ATR: ${volatilityContext.dailyATR.toFixed(5)}
• Session Liquidity: ${volatilityContext.sessionLiquidity.toUpperCase()}

MEANINGFULNESS CHECKS:
${checkStatus(meaningfulnessChecks.meetsVolatilityFloor)} Volatility Floor (15% of daily ATR opportunity)
${checkStatus(meaningfulnessChecks.meetsAccountFloor)} Account Floor (0.15% of account)
${checkStatus(meaningfulnessChecks.meetsSpreadFloor)} Spread Floor (3x spread cost)
${checkStatus(meaningfulnessChecks.meetsHistoricalFloor)} Historical Floor (25% of avg win)

RESULT: ${meaningfulnessChecks.anyMet ? '✅ PASSES (at least one threshold met)' : '❌ FAILS (no thresholds met)'}

REASONS FOR DOWNSHIFT:
${reasonsForDownshift.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Based on this data, should we:
1. AFFIRM - Trade the adjusted goal (it's meaningful)
2. WAIT - Market conditions not optimal, wait for better opportunity
3. REJECT - Not strategically worthwhile, even with adjustments

Your decision:`;
  }

  private static parseResponse(
    content: string,
    proposal: DownshiftProposal
  ): AlphaFeasibilityResponse {
    const decisionMatch = content.match(/DECISION:\s*(AFFIRM|WAIT|REJECT)/i);
    const reasoningMatch = content.match(/REASONING:\s*(.+?)(?:\n|$)/is);
    const adjustmentsMatch = content.match(/ADJUSTMENTS:\s*(.+?)(?:\n|$)/is);

    let decision: FeasibilityDecision = 'REJECT';
    if (decisionMatch) {
      const parsedDecision = decisionMatch[1].toUpperCase();
      if (
        parsedDecision === 'AFFIRM' ||
        parsedDecision === 'WAIT' ||
        parsedDecision === 'REJECT'
      ) {
        decision = parsedDecision as FeasibilityDecision;
      }
    }

    const reasoning =
      reasoningMatch?.[1]?.trim() ||
      'No reasoning provided by Alpha evaluator';

    const adjustmentsText = adjustmentsMatch?.[1]?.trim();
    const adjustments =
      adjustmentsText && adjustmentsText.toLowerCase() !== 'none'
        ? { modifiedTargetProfit: proposal.adjustedGoal }
        : undefined;

    return {
      decision,
      reasoning,
      adjustments,
    };
  }

  static formatProposalForDisplay(
    proposal: DownshiftProposal
  ): {
    title: string;
    message: string;
    details: string[];
  } {
    const retentionPercent = (proposal.retentionPercent * 100).toFixed(0);
    const checksPassedCount = [
      proposal.meaningfulnessChecks.meetsVolatilityFloor,
      proposal.meaningfulnessChecks.meetsAccountFloor,
      proposal.meaningfulnessChecks.meetsSpreadFloor,
      proposal.meaningfulnessChecks.meetsHistoricalFloor,
    ].filter(Boolean).length;

    return {
      title: 'Goal Adjusted for Market Conditions',
      message: `Market can deliver ${retentionPercent}% of your goal ($${proposal.adjustedGoal.toFixed(2)} instead of $${proposal.originalGoal.toFixed(2)})`,
      details: [
        `Retention: ${retentionPercent}%`,
        `Meaningful: ${proposal.meaningfulnessChecks.anyMet ? 'Yes' : 'No'} (${checksPassedCount}/4 thresholds)`,
        `Session: ${proposal.volatilityContext.sessionLiquidity} liquidity`,
        `Volatility: ${(proposal.volatilityContext.atrMultiplierFromTypical * 100).toFixed(0)}% of typical`,
        `Time to fill: ~${proposal.adjustedTrade.timeToFillMinutes} min`,
      ],
    };
  }
}

export const alphaDownshiftEvaluator = AlphaDownshiftEvaluator;

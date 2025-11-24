/**
 * Layer 6: LLM Exit Optimization Brain
 *
 * Gives LLM full autonomy to manage trade exits dynamically while enforcing
 * unbreakable safety rules. The LLM can optimize exits based on:
 */
import { openaiProxyClient } from './openai-proxy-client';
/**
 * - Market condition changes
 * - Skill-level progression goals
 * - Risk factor shifts
 * - Regime quality decline
 * - Pattern recognition
 *
 * SAFETY RULES (NON-OVERRIDABLE):
 * ❌ LLM may NOT widen stop loss
 * ❌ LLM may NOT increase position size
 * ❌ LLM may NOT extend trade beyond 6 hours
 * ❌ LLM may NOT remove stop loss
 * ❌ LLM may NOT increase risk in any way
 * ✅ LLM may tighten SL, take profit, close early, activate trailing stops
 */

import { supabase } from '../lib/supabase';
import { MarketSnapshot } from './trigger-detection-rules';
import { SkillLevelContext } from './pipnosis-decision-brain';

export type ExitDecisionType =
  | 'hold'
  | 'close_now'
  | 'partial_close'
  | 'tighten_sl'
  | 'activate_trailing_stop'
  | 'reduce_tp'
  | 'early_tp';

export interface OpenTradeContext {
  tradeId: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  entryTime: Date;
  currentPrice: number;
  positionSize: number;

  stopLoss: number;
  takeProfit: number;

  unrealizedPnL: number;
  unrealizedPnLPercent: number;

  durationMinutes: number;
  maxDurationMinutes: number;

  originalConfidence: number;
  setupType: string;

  accountBalance: number;
  accountExposure: number;
  openPositionsCount: number;
}

export interface ExitOptimizationResult {
  action: ExitDecisionType;

  newStopLoss?: number;
  newTakeProfit?: number;
  partialClosePercent?: number;
  trailingStopDistance?: number;

  reasoning: string;
  riskAssessment: string;

  marketConditionChange: string;
  skillObjectiveAlignment: string;

  confidence: number;
  urgency: 'low' | 'medium' | 'high' | 'critical';

  safetyValidated: boolean;
  safetyViolations: string[];

  preventedLossEstimate?: number;
  expectedImprovement?: number;
}

export interface ExitSafetyCheck {
  passed: boolean;
  violations: string[];
  details: {
    stopLossCheck: { passed: boolean; reason?: string };
    positionSizeCheck: { passed: boolean; reason?: string };
    durationCheck: { passed: boolean; reason?: string };
    stopLossRemovalCheck: { passed: boolean; reason?: string };
    riskIncreaseCheck: { passed: boolean; reason?: string };
  };
}

class LLMExitOptimizer {
  private model: string = 'gpt-4o';
  private enabled: boolean = true;
  private callCount: number = 0;
  private readonly MAX_TOKENS_PER_EXIT = 300;

  constructor() {
    console.log('[LLM Exit Optimizer] 🎯 Layer 6 initialized (using Netlify proxy)');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Main method: Optimize exit for an open trade
   */
  async optimizeExit(
    userId: string,
    trade: OpenTradeContext,
    marketSnapshot: MarketSnapshot,
    skillContext?: SkillLevelContext,
    layer1to5Results?: any
  ): Promise<ExitOptimizationResult> {
    if (!this.enabled) {
      return this.createHoldDecision(trade, 'Exit optimizer disabled');
    }

    console.log(`\n[LLM Layer 6 - Exit Optimizer] 🎯 Evaluating ${trade.symbol} (${trade.durationMinutes}m old, ${trade.unrealizedPnLPercent.toFixed(1)}%)`);
    const startTime = Date.now();

    try {
      const prompt = this.buildExitOptimizationPrompt(
        trade,
        marketSnapshot,
        skillContext,
        layer1to5Results
      );

      const response = await this.callGPT4o(prompt);
      const result = this.parseExitDecision(response, trade);

      // SAFETY VALIDATION - Non-negotiable
      const safetyCheck = this.validateSafety(trade, result);
      result.safetyValidated = safetyCheck.passed;
      result.safetyViolations = safetyCheck.violations;

      if (!safetyCheck.passed) {
        console.log(`[Layer 6] ❌ SAFETY VIOLATION - Exit decision BLOCKED`);
        safetyCheck.violations.forEach(v => console.log(`  • ${v}`));

        // Log blocked decision
        await this.logBlockedDecision(userId, trade, result, safetyCheck);

        // Return safe "hold" decision
        return this.createHoldDecision(trade, `Safety violation: ${safetyCheck.violations.join(', ')}`);
      }

      this.callCount++;
      const duration = Date.now() - startTime;

      console.log(`[Layer 6] ✅ Decision: ${result.action.toUpperCase()} (${duration}ms)`);
      if (result.action !== 'hold') {
        console.log(`  Reasoning: ${result.reasoning}`);
      }

      // Log successful decision
      await this.logExitDecision(userId, trade, result, true);

      return result;

    } catch (error) {
      console.error('[Layer 6] Error optimizing exit:', error);
      return this.createHoldDecision(trade, 'Error during optimization');
    }
  }

  /**
   * Build comprehensive prompt for exit optimization
   */
  private buildExitOptimizationPrompt(
    trade: OpenTradeContext,
    marketSnapshot: MarketSnapshot,
    skillContext?: SkillLevelContext,
    layer1to5Results?: any
  ): string {
    const currentCandle = marketSnapshot.ohlc[marketSnapshot.ohlc.length - 1];
    const pnlDirection = trade.unrealizedPnL >= 0 ? 'profit' : 'loss';
    const pnlColor = trade.unrealizedPnL >= 0 ? '🟢' : '🔴';

    let prompt = `You are the Exit Optimization Brain (Layer 6 of 6) in Pipnosis AI Trading System.

Your critical responsibility: DYNAMICALLY MANAGE OPEN TRADES to protect capital and optimize skill progression.

═══════════════════════════════════════════
EXIT MANAGEMENT AUTHORITY
═══════════════════════════════════════════

You have FULL AUTHORITY to dynamically manage this open trade.

You MAY:
✅ Close the trade early (early TP) if risk increases or profit potential declines
✅ Take partial profits anytime (reduce position size)
✅ Tighten stop loss or add trailing stop for safety
✅ Reduce TP targets if the market weakens
✅ Close positions before reaching TP if conditions change
✅ Modify exits to improve win rate and profit factor
✅ Actively protect capital and optimize profit

You MAY NOT:
❌ Widen the stop loss (can only tighten or maintain)
❌ Increase position size after entry
❌ Extend trade beyond ${trade.maxDurationMinutes} minutes (${(trade.maxDurationMinutes / 60).toFixed(1)}h)
❌ Remove or disable the stop loss
❌ Increase risk in any way

Your EXIT decisions must help progress skill levels:
• Improve win rate
• Improve profit factor
• Improve consistency
• Preserve capital while maximizing profitable outcomes

═══════════════════════════════════════════
CURRENT TRADE STATUS
═══════════════════════════════════════════

Symbol: ${trade.symbol}
Direction: ${trade.direction.toUpperCase()}
Entry: ${trade.entryPrice.toFixed(5)}
Current: ${trade.currentPrice.toFixed(5)}
Position Size: ${trade.positionSize} lots

Stop Loss: ${trade.stopLoss.toFixed(5)} (${this.calculatePipsDistance(trade.currentPrice, trade.stopLoss, trade.direction)} pips away)
Take Profit: ${trade.takeProfit.toFixed(5)} (${this.calculatePipsDistance(trade.currentPrice, trade.takeProfit, trade.direction === 'buy' ? 'sell' : 'buy')} pips away)

${pnlColor} Unrealized P&L: ${trade.unrealizedPnL >= 0 ? '+' : ''}$${trade.unrealizedPnL.toFixed(2)} (${trade.unrealizedPnLPercent >= 0 ? '+' : ''}${trade.unrealizedPnLPercent.toFixed(2)}%)
⏱️ Time in Trade: ${trade.durationMinutes} minutes (max: ${trade.maxDurationMinutes} min)
🎯 Original Confidence: ${trade.originalConfidence}%
📊 Setup Type: ${trade.setupType}

═══════════════════════════════════════════
CURRENT MARKET CONDITIONS
═══════════════════════════════════════════

Price: ${currentCandle.close.toFixed(5)}
Trend: ${marketSnapshot.priceAction.trend.toUpperCase()}
Volatility: ${marketSnapshot.priceAction.volatility.toUpperCase()}
Momentum: ${marketSnapshot.priceAction.momentum > 0 ? '+' : ''}${marketSnapshot.priceAction.momentum.toFixed(2)}

VWAP: ${marketSnapshot.indicators.vwap.toFixed(5)} (${((currentCandle.close / marketSnapshot.indicators.vwap - 1) * 100).toFixed(2)}% ${currentCandle.close > marketSnapshot.indicators.vwap ? 'above' : 'below'})
EMA20: ${marketSnapshot.indicators.ema20.toFixed(5)}
EMA50: ${marketSnapshot.indicators.ema50.toFixed(5)}
ATR: ${marketSnapshot.indicators.atr.toFixed(5)}`;

    if (skillContext) {
      prompt += `

═══════════════════════════════════════════
SKILL-LEVEL CONTEXT & EXIT GUIDANCE
═══════════════════════════════════════════

Current Level: ${skillContext.currentLevel} → Target: ${skillContext.targetLevel}
Win Rate Gap: ${skillContext.gaps.winRateGap > 0 ? '+' : ''}${skillContext.gaps.winRateGap.toFixed(1)}%
Profit Factor Gap: ${skillContext.gaps.profitFactorGap > 0 ? '+' : ''}${skillContext.gaps.profitFactorGap.toFixed(2)}
Consistency Gap: ${skillContext.gaps.consistencyGap > 0 ? '+' : ''}${skillContext.gaps.consistencyGap.toFixed(1)}%

EXIT OPTIMIZATION STRATEGY:
${skillContext.gaps.winRateGap < -5
  ? `🔴 CRITICAL: Win rate is ${Math.abs(skillContext.gaps.winRateGap).toFixed(1)}% below target!
     Priority: PROTECT THIS ${pnlDirection.toUpperCase()} at all costs.
     ${trade.unrealizedPnL > 0
       ? `Consider EARLY TP to lock in win. Every win helps recover win rate.`
       : `If loss is forming, consider EARLY EXIT to minimize damage. Preserve capital for better setups.`
     }`
  : skillContext.gaps.winRateGap < 0
  ? `🟡 Win rate below target by ${Math.abs(skillContext.gaps.winRateGap).toFixed(1)}%.
     ${trade.unrealizedPnL > 0
       ? `Consider early TP if momentum weakens.`
       : `Watch for regime shifts - exit early if risk increases.`
     }`
  : `🟢 Win rate on track.
     ${trade.unrealizedPnL > 0
       ? `Let profit run to maximize PF.`
       : `Standard exit management.`
     }`
}

${skillContext.gaps.profitFactorGap < -0.10
  ? `⚠️ Profit factor needs improvement. ${trade.unrealizedPnL > 0 ? 'Maximize this winner!' : 'Minimize this loss!'}`
  : ''
}

Strategic Guidance:
${skillContext.strategicGuidance.map(g => `• ${g}`).join('\n')}`;
    }

    if (layer1to5Results) {
      prompt += `

═══════════════════════════════════════════
LAYER 1-5 ANALYSIS (AT ENTRY)
═══════════════════════════════════════════

Layer 1 - Regime: ${layer1to5Results.regimeQuality || 'N/A'}/100
Layer 2 - Setup Quality: ${layer1to5Results.setupQuality || 'N/A'}/100
Layer 3 - Risk Level: ${layer1to5Results.riskLevel || 'N/A'}
Layer 4 - Calibrated Confidence: ${layer1to5Results.calibratedConfidence || 'N/A'}%

NOTE: Market conditions may have changed since entry. Re-evaluate current regime.`;
    }

    prompt += `

═══════════════════════════════════════════
YOUR TASK
═══════════════════════════════════════════

Analyze the current trade state and market conditions, then decide:

1. Should this trade be HELD, or should we take action?
2. If action needed, what is the best exit strategy?
3. How does this align with skill progression goals?

Consider:
• Has market regime changed since entry?
• Is momentum weakening or strengthening?
• Are we approaching time limit (${trade.maxDurationMinutes} min)?
• Is profit locked in, or should we secure gains?
• Is loss acceptable, or should we cut it early?
• Does skill context require protective action?

Return your decision in this exact JSON format:

{
  "action": "hold|close_now|partial_close|tighten_sl|activate_trailing_stop|reduce_tp|early_tp",
  "newStopLoss": <number or null>,
  "newTakeProfit": <number or null>,
  "partialClosePercent": <0-100 or null>,
  "trailingStopDistance": <pips or null>,
  "reasoning": "<why this decision>",
  "riskAssessment": "<current risk level>",
  "marketConditionChange": "<how market changed>",
  "skillObjectiveAlignment": "<how this helps skill goals>",
  "confidence": <0-100>,
  "urgency": "low|medium|high|critical",
  "preventedLossEstimate": <dollars or null>,
  "expectedImprovement": <percentage or null>
}

IMPORTANT:
- If action is "hold", set all adjustment fields to null
- If tightening SL, newStopLoss must be CLOSER to current price (never wider)
- If partial close, specify percentage (25, 50, 75)
- If trailing stop, specify distance in pips
- Always explain reasoning clearly
- Align decision with skill progression needs`;

    return prompt;
  }

  /**
   * Parse LLM response into structured exit decision
   */
  private parseExitDecision(response: string, trade: OpenTradeContext): ExitOptimizationResult {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        action: parsed.action || 'hold',
        newStopLoss: parsed.newStopLoss || undefined,
        newTakeProfit: parsed.newTakeProfit || undefined,
        partialClosePercent: parsed.partialClosePercent || undefined,
        trailingStopDistance: parsed.trailingStopDistance || undefined,
        reasoning: parsed.reasoning || 'No reasoning provided',
        riskAssessment: parsed.riskAssessment || 'Unknown',
        marketConditionChange: parsed.marketConditionChange || 'No change noted',
        skillObjectiveAlignment: parsed.skillObjectiveAlignment || 'Not specified',
        confidence: parsed.confidence || 50,
        urgency: parsed.urgency || 'medium',
        safetyValidated: false,
        safetyViolations: [],
        preventedLossEstimate: parsed.preventedLossEstimate || undefined,
        expectedImprovement: parsed.expectedImprovement || undefined
      };
    } catch (error) {
      console.error('[Layer 6] Failed to parse LLM response:', error);
      return this.createHoldDecision(trade, 'Failed to parse LLM response');
    }
  }

  /**
   * SAFETY VALIDATOR - Enforce unbreakable rules
   */
  private validateSafety(trade: OpenTradeContext, decision: ExitOptimizationResult): ExitSafetyCheck {
    const violations: string[] = [];
    const details = {
      stopLossCheck: { passed: true },
      positionSizeCheck: { passed: true },
      durationCheck: { passed: true },
      stopLossRemovalCheck: { passed: true },
      riskIncreaseCheck: { passed: true }
    };

    // Rule 1: Stop loss can only be tightened, never widened
    if (decision.newStopLoss !== undefined && decision.newStopLoss !== null) {
      const isWidening = trade.direction === 'buy'
        ? decision.newStopLoss < trade.stopLoss
        : decision.newStopLoss > trade.stopLoss;

      if (isWidening) {
        violations.push(`Stop loss widening detected: ${trade.stopLoss} → ${decision.newStopLoss}`);
        details.stopLossCheck.passed = false;
        details.stopLossCheck.reason = 'Stop loss cannot be widened';
      }
    }

    // Rule 2: Position size can only decrease, never increase
    if (decision.partialClosePercent !== undefined) {
      if (decision.partialClosePercent < 0 || decision.partialClosePercent > 100) {
        violations.push(`Invalid partial close percentage: ${decision.partialClosePercent}%`);
        details.positionSizeCheck.passed = false;
        details.positionSizeCheck.reason = 'Partial close must be 0-100%';
      }
    }

    // Rule 3: Trade duration must stay within max limit
    if (trade.durationMinutes >= trade.maxDurationMinutes) {
      if (decision.action === 'hold') {
        violations.push(`Trade duration (${trade.durationMinutes}m) exceeds max (${trade.maxDurationMinutes}m)`);
        details.durationCheck.passed = false;
        details.durationCheck.reason = 'Max duration exceeded';
      }
    }

    // Rule 4: Stop loss cannot be removed
    if (decision.action === 'close_now' || decision.action === 'partial_close') {
      // These are OK - closing the trade
    } else if (decision.newStopLoss === null || decision.newStopLoss === 0) {
      violations.push('Stop loss cannot be removed');
      details.stopLossRemovalCheck.passed = false;
      details.stopLossRemovalCheck.reason = 'Stop loss is mandatory';
    }

    // Rule 5: No action can increase maximum potential loss
    if (decision.newStopLoss !== undefined && decision.newStopLoss !== null) {
      const currentMaxLoss = Math.abs(trade.currentPrice - trade.stopLoss) * trade.positionSize * 100000;
      const newMaxLoss = Math.abs(trade.currentPrice - decision.newStopLoss) * trade.positionSize * 100000;

      if (newMaxLoss > currentMaxLoss * 1.01) { // Allow 1% tolerance for rounding
        violations.push(`Risk increase detected: $${currentMaxLoss.toFixed(2)} → $${newMaxLoss.toFixed(2)}`);
        details.riskIncreaseCheck.passed = false;
        details.riskIncreaseCheck.reason = 'Maximum potential loss cannot increase';
      }
    }

    return {
      passed: violations.length === 0,
      violations,
      details
    };
  }

  /**
   * Create safe "hold" decision
   */
  private createHoldDecision(trade: OpenTradeContext, reason: string): ExitOptimizationResult {
    return {
      action: 'hold',
      reasoning: reason,
      riskAssessment: 'Unchanged',
      marketConditionChange: 'N/A',
      skillObjectiveAlignment: 'N/A',
      confidence: 100,
      urgency: 'low',
      safetyValidated: true,
      safetyViolations: []
    };
  }

  /**
   * Calculate pips distance between two prices
   */
  private calculatePipsDistance(price1: number, price2: number, direction: string): number {
    const diff = direction === 'buy' ? price2 - price1 : price1 - price2;
    return Math.round(diff * 10000);
  }

  /**
   * Call GPT-4o API
   */
  private async callGPT4o(prompt: string): Promise<string> {
    const response = await openaiProxyClient.chat({
      messages: [
        {
          role: 'system',
          content: 'You are an expert exit management system for forex trading. Analyze trades and recommend optimal exit strategies.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      model: this.model,
      temperature: 0.3,
      max_tokens: this.MAX_TOKENS_PER_EXIT,
      requestType: 'layer-6-exit-optimization',
      endpoint: 'llm-exit-optimizer'
    });

    return response.choices[0].message.content;
  }

  /**
   * Log exit decision to database
   */
  private async logExitDecision(
    userId: string,
    trade: OpenTradeContext,
    decision: ExitOptimizationResult,
    safetyPassed: boolean
  ): Promise<void> {
    try {
      await supabase.from('llm_exit_decisions_log').insert({
        user_id: userId,
        trade_id: trade.tradeId,
        symbol: trade.symbol,
        trade_duration_minutes: trade.durationMinutes,
        unrealized_pnl: trade.unrealizedPnL,
        unrealized_pnl_percent: trade.unrealizedPnLPercent,
        action_recommended: decision.action,
        new_stop_loss: decision.newStopLoss,
        new_take_profit: decision.newTakeProfit,
        partial_close_percent: decision.partialClosePercent,
        trailing_stop_distance: decision.trailingStopDistance,
        reasoning: decision.reasoning,
        risk_assessment: decision.riskAssessment,
        market_condition_change: decision.marketConditionChange,
        skill_objective_alignment: decision.skillObjectiveAlignment,
        confidence: decision.confidence,
        urgency: decision.urgency,
        safety_validated: safetyPassed,
        safety_violations: decision.safetyViolations,
        prevented_loss_estimate: decision.preventedLossEstimate,
        expected_improvement: decision.expectedImprovement
      });
    } catch (error) {
      console.error('[Layer 6] Failed to log exit decision:', error);
    }
  }

  /**
   * Log blocked decision (safety violation)
   */
  private async logBlockedDecision(
    userId: string,
    trade: OpenTradeContext,
    decision: ExitOptimizationResult,
    safetyCheck: ExitSafetyCheck
  ): Promise<void> {
    try {
      await supabase.from('llm_exit_decisions_log').insert({
        user_id: userId,
        trade_id: trade.tradeId,
        symbol: trade.symbol,
        trade_duration_minutes: trade.durationMinutes,
        unrealized_pnl: trade.unrealizedPnL,
        unrealized_pnl_percent: trade.unrealizedPnLPercent,
        action_recommended: decision.action,
        new_stop_loss: decision.newStopLoss,
        new_take_profit: decision.newTakeProfit,
        reasoning: decision.reasoning,
        safety_validated: false,
        safety_violations: safetyCheck.violations,
        blocked: true
      });
    } catch (error) {
      console.error('[Layer 6] Failed to log blocked decision:', error);
    }
  }

  getUsageStats(): { calls: number } {
    return {
      calls: this.callCount
    };
  }
}

export const llmExitOptimizer = new LLMExitOptimizer();

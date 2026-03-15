/**
 * LLM Mid-Trade Evaluator
 *
 * Calls GPT-4o-mini to evaluate active trades when triggers fire
 * Uses optimized prompts to keep costs low (~$0.006 per evaluation)
 * Returns actionable recommendations: HOLD, MOVE_SL, MOVE_TP, TAKE_PROFIT_EARLY, EXIT_IMMEDIATELY
 */

import { supabase } from '../lib/supabase';
import { openAIClient } from './openai-client';
import type { SimulatedTrade } from '../types';
import type { TriggerDetectionResult, MarketConditions } from './mid-trade-trigger-detector';
import type { PrioritizedLevel } from './critical-level-detector';
import { calculatePipDistance } from '../utils/currencyHelpers'; // TIER 7: SSOT pip calculations

export interface MidTradeEvaluationRequest {
  trade: SimulatedTrade;
  marketConditions: MarketConditions;
  trigger: TriggerDetectionResult;
  criticalLevel?: PrioritizedLevel;
}

export interface MidTradeEvaluationResult {
  recommendation: 'HOLD' | 'MOVE_SL' | 'MOVE_TP' | 'TAKE_PROFIT_EARLY' | 'EXIT_IMMEDIATELY';
  confidence: number;
  reasoning: string;
  suggestedActions?: {
    newStopLoss?: number;
    newTakeProfit?: number;
    exitPrice?: number;
  };
  costUsd: number;
  tokensUsed: number;
  processingTimeMs: number;
}

export interface ValidationResult {
  isValid: boolean;
  violations: string[];
  canApply: boolean;
}

class LLMMidTradeEvaluator {
  /**
   * Evaluate an active trade using LLM
   * Only called when a trigger event fires
   */
  async evaluateTrade(
    request: MidTradeEvaluationRequest,
    userId: string
  ): Promise<MidTradeEvaluationResult> {
    const startTime = Date.now();

    try {
      // Build optimized prompt
      const prompt = this.buildOptimizedPrompt(request);

      // Call GPT-4o-mini
      const response = await openAIClient.chat([
        {
          role: 'system',
          content: 'You are a professional forex trading advisor specializing in intraday risk management. Analyze the trade situation and provide a clear recommendation with confidence level and reasoning. Be concise but thorough.'
        },
        {
          role: 'user',
          content: prompt
        }
      ], {
        model: 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 400,
        symbol: request.trade.symbol
      });

      const processingTimeMs = Date.now() - startTime;

      // Parse response
      const result = this.parseResponse(response.content, request.trade);

      // Calculate cost (GPT-4o-mini pricing: ~$0.00015/1K input, ~$0.0006/1K output)
      const inputTokens = response.usage?.prompt_tokens || 0;
      const outputTokens = response.usage?.completion_tokens || 0;
      const totalTokens = inputTokens + outputTokens;
      const costUsd = (inputTokens * 0.00015 / 1000) + (outputTokens * 0.0006 / 1000);

      // Log evaluation to database
      await this.logEvaluation(
        request,
        result,
        userId,
        costUsd,
        totalTokens,
        processingTimeMs
      );

      return {
        ...result,
        costUsd,
        tokensUsed: totalTokens,
        processingTimeMs
      };

    } catch (error) {
      console.error('[Mid-Trade Evaluator] Error:', error);

      // Return safe default
      return {
        recommendation: 'HOLD',
        confidence: 50,
        reasoning: 'Error during evaluation. Maintaining current position as safest option.',
        costUsd: 0,
        tokensUsed: 0,
        processingTimeMs: Date.now() - startTime
      };
    }
  }

  /**
   * Build optimized prompt (keep under 500 tokens)
   */
  private buildOptimizedPrompt(request: MidTradeEvaluationRequest): string {
    const { trade, marketConditions, trigger, criticalLevel } = request;

    const isLong = trade.direction === 'buy';
    const currentPrice = marketConditions.currentPrice;
    const priceDiff = isLong
      ? (currentPrice - trade.entryPrice)
      : (trade.entryPrice - currentPrice);

    // TIER 7: Use SSOT pip calculation instead of hardcoded 0.0001
    const pips = calculatePipDistance(trade.symbol, currentPrice, trade.entryPrice);
    const pnl = pips * 10 * trade.positionSize;

    const risk = Math.abs(trade.entryPrice - trade.stopLoss);
    const riskRatio = priceDiff / risk;

    const timeInTrade = Math.floor((Date.now() - trade.entryTime.getTime()) / 60000);

    // TIER 7: Use SSOT pip calculation for distances
    const distanceToSL = calculatePipDistance(trade.symbol, currentPrice, trade.stopLoss);
    const distanceToTP = calculatePipDistance(trade.symbol, currentPrice, trade.takeProfit);

    let prompt = `ACTIVE TRADE EVALUATION

TRADE DETAILS:
- Symbol: ${trade.symbol}
- Direction: ${trade.direction.toUpperCase()}
- Entry: ${trade.entryPrice.toFixed(5)}
- Current: ${currentPrice.toFixed(5)}
- SL: ${trade.stopLoss.toFixed(5)} (${distanceToSL.toFixed(1)} pips away)
- TP: ${trade.takeProfit.toFixed(5)} (${distanceToTP.toFixed(1)} pips away)
- P&L: $${pnl.toFixed(2)} (${pips.toFixed(1)} pips, ${(riskRatio * 100).toFixed(0)}% R)
- Time: ${timeInTrade} minutes

TRIGGER EVENT:
- Type: ${trigger.triggerType}
- Reason: ${trigger.triggerReason}
- Confidence: ${trigger.confidence}%

MARKET CONDITIONS:
- Trend: ${marketConditions.priceAction.trend || 'unknown'}
- Volatility: ${marketConditions.priceAction.volatility || 'unknown'}
- Momentum: ${marketConditions.priceAction.momentum || 'unknown'}`;

    if (marketConditions.indicators.vwap) {
      prompt += `\n- VWAP: ${marketConditions.indicators.vwap.toFixed(5)} (price is ${currentPrice > marketConditions.indicators.vwap ? 'above' : 'below'})`;
    }

    if (criticalLevel) {
      const urgencyLevel = criticalLevel.urgency > 80 ? 'CRITICAL' :
                          criticalLevel.urgency > 60 ? 'HIGH' :
                          criticalLevel.urgency > 40 ? 'MODERATE' : 'LOW';

      prompt += `\n\n⚠️ CRITICAL LEVEL DETECTED:
- ${criticalLevel.type.toUpperCase()}: ${criticalLevel.price.toFixed(5)}
- Distance: ${criticalLevel.distance.toFixed(1)} pips
- Strength: ${(criticalLevel.strength * 100).toFixed(0)}%
- Urgency: ${urgencyLevel} (${criticalLevel.urgency.toFixed(0)}/100)
- Analysis: ${criticalLevel.actionable}

**IMPORTANT:** This level has historically blocked price movement. Consider securing profits BEFORE price reaches this level if urgency is HIGH or CRITICAL.`;
    }

    prompt += `\n\nYour task: Recommend ONE action based on current market conditions and trigger event.

OPTIONS:
1. HOLD - Continue with current SL/TP
2. MOVE_SL - Adjust stop loss (specify new level)
3. MOVE_TP - Adjust take profit (specify new level)
4. TAKE_PROFIT_EARLY - Close position now at current price
5. EXIT_IMMEDIATELY - Emergency exit (market turned against us)

HARD RULES (CANNOT BREAK):
- Cannot remove stop loss
- Cannot increase risk
- Cannot hold past 6 hours
- Cannot hold overnight

Format your response:
RECOMMENDATION: [HOLD|MOVE_SL|MOVE_TP|TAKE_PROFIT_EARLY|EXIT_IMMEDIATELY]
CONFIDENCE: [0-100]%
REASONING: [Brief explanation]
NEW_SL: [price if MOVE_SL, else N/A]
NEW_TP: [price if MOVE_TP, else N/A]`;

    return prompt;
  }

  /**
   * Parse LLM response into structured result
   */
  private parseResponse(content: string, trade: SimulatedTrade): Omit<MidTradeEvaluationResult, 'costUsd' | 'tokensUsed' | 'processingTimeMs'> {
    const lines = content.split('\n');

    let recommendation: any = 'HOLD';
    let confidence = 70;
    let reasoning = content;
    let newStopLoss: number | undefined;
    let newTakeProfit: number | undefined;

    // Parse structured response
    for (const line of lines) {
      if (line.includes('RECOMMENDATION:')) {
        const match = line.match(/RECOMMENDATION:\s*(HOLD|MOVE_SL|MOVE_TP|TAKE_PROFIT_EARLY|EXIT_IMMEDIATELY)/i);
        if (match) recommendation = match[1].toUpperCase();
      }
      if (line.includes('CONFIDENCE:')) {
        const match = line.match(/CONFIDENCE:\s*(\d+)/);
        if (match) confidence = parseInt(match[1]);
      }
      if (line.includes('REASONING:')) {
        reasoning = line.split('REASONING:')[1]?.trim() || reasoning;
      }
      if (line.includes('NEW_SL:')) {
        const match = line.match(/NEW_SL:\s*([0-9.]+)/);
        if (match) newStopLoss = parseFloat(match[1]);
      }
      if (line.includes('NEW_TP:')) {
        const match = line.match(/NEW_TP:\s*([0-9.]+)/);
        if (match) newTakeProfit = parseFloat(match[1]);
      }
    }

    // Validate recommendation
    const validRecommendations = ['HOLD', 'MOVE_SL', 'MOVE_TP', 'TAKE_PROFIT_EARLY', 'EXIT_IMMEDIATELY'];
    if (!validRecommendations.includes(recommendation)) {
      recommendation = 'HOLD';
    }

    // Build suggested actions
    const suggestedActions: any = {};
    if (recommendation === 'MOVE_SL' && newStopLoss) {
      suggestedActions.newStopLoss = newStopLoss;
    }
    if (recommendation === 'MOVE_TP' && newTakeProfit) {
      suggestedActions.newTakeProfit = newTakeProfit;
    }
    if (recommendation === 'TAKE_PROFIT_EARLY' || recommendation === 'EXIT_IMMEDIATELY') {
      suggestedActions.exitPrice = trade.entryPrice; // Will be updated with actual exit price
    }

    return {
      recommendation,
      confidence: Math.max(0, Math.min(100, confidence)),
      reasoning,
      suggestedActions: Object.keys(suggestedActions).length > 0 ? suggestedActions : undefined
    };
  }

  /**
   * Validate LLM recommendation against hard rules
   */
  validateRecommendation(
    result: MidTradeEvaluationResult,
    trade: SimulatedTrade
  ): ValidationResult {
    const violations: string[] = [];
    const isLong = trade.direction === 'buy';

    // Check MOVE_SL recommendation
    if (result.recommendation === 'MOVE_SL' && result.suggestedActions?.newStopLoss) {
      const newSL = result.suggestedActions.newStopLoss;

      // Cannot remove stop loss
      if (!newSL) {
        violations.push('Cannot remove stop loss entirely');
      }

      // Cannot move SL further away (increase risk)
      const currentRisk = Math.abs(trade.entryPrice - trade.stopLoss);
      const newRisk = Math.abs(trade.entryPrice - newSL);

      if (newRisk > currentRisk) {
        violations.push(`Cannot increase risk (current: ${currentRisk.toFixed(5)}, new: ${newRisk.toFixed(5)})`);
      }

      // Cannot move SL beyond current price
      if (isLong && newSL > trade.entryPrice) {
        violations.push('Cannot move stop loss above entry for long position');
      }
      if (!isLong && newSL < trade.entryPrice) {
        violations.push('Cannot move stop loss below entry for short position');
      }
    }

    // Check MOVE_TP recommendation
    if (result.recommendation === 'MOVE_TP' && result.suggestedActions?.newTakeProfit) {
      const newTP = result.suggestedActions.newTakeProfit;

      // New TP should be reasonable (not beyond 200 pips)
      // TIER 7: Use SSOT pip calculation
      const tpDistancePips = calculatePipDistance(trade.symbol, newTP, trade.entryPrice);
      if (tpDistancePips > 200) { // 200 pips
        violations.push(`New TP too far from entry (${tpDistancePips.toFixed(0)} pips)`);
      }
    }

    // Check time-based rules
    const timeInTradeHours = (Date.now() - trade.entryTime.getTime()) / 3600000;

    if (timeInTradeHours > 6 && result.recommendation === 'HOLD') {
      violations.push('Cannot hold past 6 hours - must close position');
    }

    return {
      isValid: violations.length === 0,
      violations,
      canApply: violations.length === 0
    };
  }

  /**
   * Log evaluation to database
   */
  private async logEvaluation(
    request: MidTradeEvaluationRequest,
    result: Omit<MidTradeEvaluationResult, 'costUsd' | 'tokensUsed' | 'processingTimeMs'>,
    userId: string,
    costUsd: number,
    tokensUsed: number,
    processingTimeMs: number
  ): Promise<void> {
    const { trade, marketConditions, trigger, criticalLevel } = request;

    try {
      await supabase.from('mid_trade_llm_evaluations').insert({
        trade_id: trade.id,
        goal_session_id: null,
        user_id: userId,
        trigger_event: trigger.triggerType || 'unknown',
        trigger_reason: trigger.triggerReason || 'Unknown trigger',
        trigger_confidence: trigger.confidence,
        market_snapshot: {
          current_price: marketConditions.currentPrice,
          indicators: marketConditions.indicators,
          price_action: marketConditions.priceAction,
          critical_level: criticalLevel ? {
            price: criticalLevel.price,
            type: criticalLevel.type,
            strength: criticalLevel.strength,
            distance_pips: criticalLevel.distance,
            urgency: criticalLevel.urgency,
            reason: criticalLevel.reason,
            actionable: criticalLevel.actionable
          } : null
        },
        trade_context: {
          entry_price: trade.entryPrice,
          current_price: marketConditions.currentPrice,
          stop_loss: trade.stopLoss,
          take_profit: trade.takeProfit,
          direction: trade.direction,
          time_in_trade_minutes: Math.floor((Date.now() - trade.entryTime.getTime()) / 60000)
        },
        llm_recommendation: result.recommendation,
        llm_confidence: result.confidence,
        llm_reasoning: result.reasoning,
        llm_model: 'gpt-4o-mini',
        action_taken: 'pending', // Will be updated after validation and execution
        action_result: result.suggestedActions || null,
        cost_usd: costUsd,
        processing_time_ms: processingTimeMs,
        tokens_used: tokensUsed
      });
    } catch (error) {
      console.error('[Mid-Trade Evaluator] Error logging to database:', error);
    }
  }

  /**
   * Update evaluation record with action taken
   */
  async updateEvaluationStatus(
    evaluationId: string,
    actionTaken: string,
    actionResult: any,
    ruleViolations?: string[]
  ): Promise<void> {
    try {
      await supabase
        .from('mid_trade_llm_evaluations')
        .update({
          action_taken: actionTaken,
          action_result: actionResult,
          rule_violations: ruleViolations || null
        })
        .eq('id', evaluationId);
    } catch (error) {
      console.error('[Mid-Trade Evaluator] Error updating evaluation status:', error);
    }
  }
}

export const llmMidTradeEvaluator = new LLMMidTradeEvaluator();

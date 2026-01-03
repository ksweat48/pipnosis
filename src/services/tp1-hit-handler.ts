/**
 * TP1 Hit Handler - Single Source of Truth
 *
 * Handles all TP1 hit events for trades
 * Responsibilities:
 * - Update database when TP1 is reached
 * - Call Alpha for real-time recommendation (close or continue)
 * - Trigger user notification/dialog
 * - Log event for learning system
 *
 * SSOT: All TP1 hit logic flows through this service
 */

import { supabase } from '../lib/supabase';
import { openAIClient } from './openai-client';
import { logger } from '../lib/logger';
import type { GoalSessionTrade } from '../types/position';
import { globalDialogManager } from './global-dialog-manager';
import { llmTokenTracker } from './llm-token-tracker';

export interface TP1HitEvent {
  tradeId: string;
  userId: string;
  symbol: string;
  direction: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  tp1Price: number;
  tp2Price: number;
  stopLoss: number;
  currentPnL: number;
  sessionId: string;
}

export interface AlphaTP1Recommendation {
  recommendation: 'CLOSE_NOW' | 'CONTINUE_TO_TP2';
  confidence: number;
  reasoning: string;
}

class TP1HitHandler {
  /**
   * Handle TP1 hit event - SSOT for all TP1 logic
   */
  async handleTP1Hit(event: TP1HitEvent): Promise<void> {
    try {
      logger.info('[TP1 Hit Handler] TP1 HIT!', {
        tradeId: event.tradeId,
        symbol: event.symbol,
        currentPnL: event.currentPnL.toFixed(2)
      });

      // Step 1: Mark TP1 as hit in database
      await this.markTP1Hit(event.tradeId);

      // Step 2: Get Alpha's real-time recommendation
      const recommendation = await this.getAlphaRecommendation(event);

      // Step 3: Store Alpha's recommendation in database
      await this.storeAlphaRecommendation(event.tradeId, recommendation);

      // Step 4: Trigger user dialog/notification
      await this.triggerUserDialog(event, recommendation);

      // Step 5: Log for learning system
      await this.logForLearning(event, recommendation);

      logger.info('[TP1 Hit Handler] TP1 event processed successfully');
    } catch (error) {
      logger.error('[TP1 Hit Handler] Error handling TP1 hit:', error);
    }
  }

  /**
   * Mark TP1 as hit in database
   */
  private async markTP1Hit(tradeId: string): Promise<void> {
    const { error } = await supabase
      .from('goal_session_trades')
      .update({
        tp1_hit: true,
        tp1_hit_at: new Date().toISOString()
      })
      .eq('id', tradeId);

    if (error) {
      logger.error('[TP1 Hit Handler] Error marking TP1 hit:', error);
      throw error;
    }

    logger.info('[TP1 Hit Handler] TP1 marked as hit in database');
  }

  /**
   * Get Alpha's real-time recommendation for TP1 hit
   */
  private async getAlphaRecommendation(event: TP1HitEvent): Promise<AlphaTP1Recommendation> {
    try {
      // Fetch recent candle data for Alpha's analysis
      const { data: recentCandles } = await supabase
        .from('candles')
        .select('*')
        .eq('symbol', event.symbol)
        .order('timestamp', { ascending: false })
        .limit(10);

      // Build prompt for Alpha
      const prompt = `URGENT: TP1 Hit - Real-Time Decision Needed

Trade Details:
- Symbol: ${event.symbol}
- Direction: ${event.direction.toUpperCase()}
- Entry: ${event.entryPrice.toFixed(5)}
- Current: ${event.currentPrice.toFixed(5)}
- TP1 (HIT): ${event.tp1Price.toFixed(5)}
- TP2 (Target): ${event.tp2Price.toFixed(5)}
- Stop Loss: ${event.stopLoss.toFixed(5)}
- Current P&L: $${event.currentPnL.toFixed(2)}

Recent Price Action:
${recentCandles?.slice(0, 5).map((c: any, i: number) =>
  `${i + 1}. ${new Date(c.timestamp).toLocaleTimeString()}: O:${c.open.toFixed(5)} H:${c.high.toFixed(5)} L:${c.low.toFixed(5)} C:${c.close.toFixed(5)}`
).join('\n')}

Your Task:
Analyze current momentum, recent candles, and market structure. Should the trader:
- CLOSE_NOW: Secure profit now (momentum weakening, resistance ahead, or consolidation forming)
- CONTINUE_TO_TP2: Keep trade open (momentum strong, clear path to TP2, good follow-through)

Respond in JSON format:
{
  "recommendation": "CLOSE_NOW" or "CONTINUE_TO_TP2",
  "confidence": 0-100,
  "reasoning": "Brief explanation (2-3 sentences max)"
}`;

      const response = await openAIClient.createChatCompletion({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are Pipnosis Alpha. Analyze market conditions and provide real-time TP1 decision. Be concise and decisive.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 200
      });

      // Track token usage
      await llmTokenTracker.trackUsage(
        event.userId,
        'gpt-4o-mini',
        response.usage?.prompt_tokens || 0,
        response.usage?.completion_tokens || 0,
        'tp1_evaluation'
      );

      const parsed = JSON.parse(response.choices[0].message.content);

      return {
        recommendation: parsed.recommendation,
        confidence: parsed.confidence,
        reasoning: parsed.reasoning
      };
    } catch (error) {
      logger.error('[TP1 Hit Handler] Error getting Alpha recommendation:', error);

      // Fallback: default to CONTINUE if uncertain
      return {
        recommendation: 'CONTINUE_TO_TP2',
        confidence: 50,
        reasoning: 'Unable to analyze market conditions. Defaulting to continue to TP2.'
      };
    }
  }

  /**
   * Store Alpha's recommendation in database
   */
  private async storeAlphaRecommendation(
    tradeId: string,
    recommendation: AlphaTP1Recommendation
  ): Promise<void> {
    const { error } = await supabase
      .from('goal_session_trades')
      .update({
        alpha_tp1_recommendation: recommendation.recommendation,
        alpha_tp1_recommendation_reasoning: recommendation.reasoning
      })
      .eq('id', tradeId);

    if (error) {
      logger.error('[TP1 Hit Handler] Error storing Alpha recommendation:', error);
    }
  }

  /**
   * Trigger user dialog showing TP1 hit and Alpha's recommendation
   */
  private async triggerUserDialog(
    event: TP1HitEvent,
    recommendation: AlphaTP1Recommendation
  ): Promise<void> {
    // Create notification/dialog via global dialog manager
    globalDialogManager.showTP1HitDialog({
      tradeId: event.tradeId,
      symbol: event.symbol,
      currentPnL: event.currentPnL,
      tp1Price: event.tp1Price,
      tp2Price: event.tp2Price,
      alphaRecommendation: recommendation.recommendation,
      alphaReasoning: recommendation.reasoning,
      alphaConfidence: recommendation.confidence
    });

    // Also insert into mid_trade_alerts for tracking
    await supabase.from('mid_trade_alerts').insert({
      trade_id: event.tradeId,
      alert_type: 'tp1_hit',
      severity: 'info',
      message: `TP1 Hit! +$${event.currentPnL.toFixed(2)} profit. Alpha recommends: ${recommendation.recommendation}`,
      metadata: {
        tp1_price: event.tp1Price,
        tp2_price: event.tp2Price,
        current_pnl: event.currentPnL,
        alpha_recommendation: recommendation.recommendation,
        alpha_reasoning: recommendation.reasoning
      },
      created_at: new Date().toISOString()
    });
  }

  /**
   * Log TP1 event for learning system
   */
  private async logForLearning(
    event: TP1HitEvent,
    recommendation: AlphaTP1Recommendation
  ): Promise<void> {
    try {
      await supabase.from('tp1_learning_log').insert({
        trade_id: event.tradeId,
        user_id: event.userId,
        symbol: event.symbol,
        tp1_price: event.tp1Price,
        tp2_price: event.tp2Price,
        entry_price: event.entryPrice,
        current_price_at_tp1: event.currentPrice,
        pnl_at_tp1: event.currentPnL,
        alpha_recommendation: recommendation.recommendation,
        alpha_confidence: recommendation.confidence,
        alpha_reasoning: recommendation.reasoning,
        created_at: new Date().toISOString()
      });
    } catch (error) {
      // Non-critical error - don't block TP1 handling
      logger.error('[TP1 Hit Handler] Error logging for learning:', error);
    }
  }

  /**
   * Handle user's decision after TP1 dialog
   */
  async handleUserDecision(
    tradeId: string,
    decision: 'continued' | 'closed_early'
  ): Promise<void> {
    try {
      logger.info('[TP1 Hit Handler] User decision recorded', { tradeId, decision });

      await supabase
        .from('goal_session_trades')
        .update({
          tp1_action_taken: decision
        })
        .eq('id', tradeId);

      // If user chose to close, update learning log
      if (decision === 'closed_early') {
        await supabase
          .from('tp1_learning_log')
          .update({
            user_decision: 'closed_early',
            decision_time: new Date().toISOString()
          })
          .eq('trade_id', tradeId);
      }
    } catch (error) {
      logger.error('[TP1 Hit Handler] Error handling user decision:', error);
    }
  }
}

export const tp1HitHandler = new TP1HitHandler();

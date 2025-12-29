/**
 * Mid-Trade Alert Executor
 *
 * Automatically executes mid-trade recommendations after the timeout period
 * Runs every 5 seconds to check for expired alerts
 * Handles EXIT_IMMEDIATELY and TAKE_PROFIT_EARLY actions
 */

import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

class MidTradeAlertExecutor {
  private intervalId: NodeJS.Timeout | null = null;
  private isExecuting = false;

  /**
   * Start the auto-execution engine
   */
  start(): void {
    if (this.intervalId) {
      logger.warn('[AlertExecutor] Already running');
      return;
    }

    logger.info('[AlertExecutor] Starting auto-execution engine');

    // Run immediately
    this.checkAndExecuteExpiredAlerts();

    // Then every 5 seconds
    this.intervalId = setInterval(() => {
      this.checkAndExecuteExpiredAlerts();
    }, 5000);
  }

  /**
   * Stop the auto-execution engine
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('[AlertExecutor] Stopped auto-execution engine');
    }
  }

  /**
   * Check for expired alerts and execute them
   */
  private async checkAndExecuteExpiredAlerts(): Promise<void> {
    if (this.isExecuting) {
      return; // Prevent concurrent executions
    }

    this.isExecuting = true;

    try {
      // Find alerts that need execution
      const { data: expiredAlerts, error: fetchError } = await supabase
        .from('goal_notifications')
        .select('*')
        .eq('requires_user_alert', true)
        .eq('executed', false)
        .lte('auto_execute_at', new Date().toISOString())
        .order('auto_execute_at', { ascending: true })
        .limit(10);

      if (fetchError) {
        logger.error('[AlertExecutor] Error fetching expired alerts:', fetchError);
        this.isExecuting = false;
        return;
      }

      if (!expiredAlerts || expiredAlerts.length === 0) {
        this.isExecuting = false;
        return;
      }

      logger.info('[AlertExecutor] Found expired alerts:', {
        count: expiredAlerts.length
      });

      // Execute each alert
      for (const alert of expiredAlerts) {
        await this.executeAlert(alert);
      }
    } catch (error) {
      logger.error('[AlertExecutor] Exception in checkAndExecuteExpiredAlerts:', error);
    } finally {
      this.isExecuting = false;
    }
  }

  /**
   * Execute a single alert
   */
  private async executeAlert(alert: any): Promise<void> {
    try {
      logger.info('[AlertExecutor] Executing alert:', {
        notification_id: alert.id,
        recommendation: alert.recommendation_data?.recommendation,
        trade_id: alert.trade_context?.trade_id
      });

      const recommendation = alert.recommendation_data?.recommendation;
      const tradeId = alert.trade_context?.trade_id || alert.data?.trade_id;

      if (!tradeId) {
        logger.error('[AlertExecutor] No trade ID found in alert:', alert);
        await this.markAlertAsFailed(alert.id, 'No trade ID found');
        return;
      }

      // Fetch the trade
      const { data: trade, error: tradeError } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('id', tradeId)
        .maybeSingle();

      if (tradeError || !trade) {
        logger.error('[AlertExecutor] Trade not found:', { trade_id: tradeId, error: tradeError });
        await this.markAlertAsFailed(alert.id, 'Trade not found');
        return;
      }

      // Check if trade is still active
      if (trade.status !== 'active') {
        logger.warn('[AlertExecutor] Trade is not active:', {
          trade_id: tradeId,
          status: trade.status
        });
        await this.markAlertAsExecuted(alert.id, 'Trade already closed');
        return;
      }

      // Execute the recommendation
      if (recommendation === 'EXIT_IMMEDIATELY' || recommendation === 'TAKE_PROFIT_EARLY') {
        await this.executeTradeClosure(alert, trade);
      } else if (recommendation === 'MOVE_SL') {
        await this.executeStopLossMove(alert, trade);
      } else if (recommendation === 'MOVE_TP') {
        await this.executeTakeProfitMove(alert, trade);
      } else {
        logger.warn('[AlertExecutor] Unknown recommendation type:', recommendation);
        await this.markAlertAsFailed(alert.id, `Unknown recommendation: ${recommendation}`);
      }
    } catch (error) {
      logger.error('[AlertExecutor] Exception executing alert:', error);
      await this.markAlertAsFailed(alert.id, `Exception: ${error}`);
    }
  }

  /**
   * Execute trade closure (EXIT_IMMEDIATELY or TAKE_PROFIT_EARLY)
   */
  private async executeTradeClosure(alert: any, trade: any): Promise<void> {
    try {
      const recommendation = alert.recommendation_data?.recommendation;
      const exitReason = recommendation === 'EXIT_IMMEDIATELY'
        ? 'alpha_emergency_exit'
        : 'alpha_early_profit';

      logger.info('[AlertExecutor] Closing trade:', {
        trade_id: trade.id,
        exit_reason: exitReason
      });

      // Close the trade
      const { error: closeError } = await supabase
        .from('goal_session_trades')
        .update({
          status: 'closing',
          exit_reason: exitReason,
          updated_at: new Date().toISOString()
        })
        .eq('id', trade.id);

      if (closeError) {
        logger.error('[AlertExecutor] Error closing trade:', closeError);
        await this.markAlertAsFailed(alert.id, `Failed to close trade: ${closeError.message}`);
        return;
      }

      // Log to AI conversation
      const conversationMessage = recommendation === 'EXIT_IMMEDIATELY'
        ? `❌ Position closed by Alpha (Emergency Exit): ${alert.recommendation_data?.reasoning}`
        : `🎯 Position closed by Alpha (Early Profit): ${alert.recommendation_data?.reasoning}`;

      await supabase
        .from('goal_ai_conversations')
        .insert({
          user_id: alert.user_id,
          goal_session_id: alert.goal_session_id,
          role: 'ai',
          content: conversationMessage,
          created_at: new Date().toISOString()
        });

      // Mark alert as executed
      await this.markAlertAsExecuted(alert.id, 'Trade closed successfully');

      logger.info('[AlertExecutor] Trade closed successfully:', {
        trade_id: trade.id,
        exit_reason: exitReason
      });
    } catch (error) {
      logger.error('[AlertExecutor] Exception in executeTradeClosure:', error);
      await this.markAlertAsFailed(alert.id, `Exception during closure: ${error}`);
    }
  }

  /**
   * Execute stop loss move
   */
  private async executeStopLossMove(alert: any, trade: any): Promise<void> {
    try {
      const newStopLoss = alert.recommendation_data?.suggestedActions?.newStopLoss;

      if (!newStopLoss) {
        await this.markAlertAsFailed(alert.id, 'No new stop loss value provided');
        return;
      }

      logger.info('[AlertExecutor] Moving stop loss:', {
        trade_id: trade.id,
        old_sl: trade.stop_loss,
        new_sl: newStopLoss
      });

      // Update the trade
      const { error: updateError } = await supabase
        .from('goal_session_trades')
        .update({
          stop_loss: newStopLoss,
          updated_at: new Date().toISOString()
        })
        .eq('id', trade.id);

      if (updateError) {
        logger.error('[AlertExecutor] Error updating stop loss:', updateError);
        await this.markAlertAsFailed(alert.id, `Failed to update SL: ${updateError.message}`);
        return;
      }

      // Log to AI conversation
      await supabase
        .from('goal_ai_conversations')
        .insert({
          user_id: alert.user_id,
          goal_session_id: alert.goal_session_id,
          role: 'ai',
          content: `✓ Stop Loss adjusted to ${newStopLoss.toFixed(5)} by Alpha. ${alert.recommendation_data?.reasoning}`,
          created_at: new Date().toISOString()
        });

      // Mark alert as executed
      await this.markAlertAsExecuted(alert.id, 'Stop loss updated successfully');

      logger.info('[AlertExecutor] Stop loss updated successfully');
    } catch (error) {
      logger.error('[AlertExecutor] Exception in executeStopLossMove:', error);
      await this.markAlertAsFailed(alert.id, `Exception during SL move: ${error}`);
    }
  }

  /**
   * Execute take profit move
   */
  private async executeTakeProfitMove(alert: any, trade: any): Promise<void> {
    try {
      const newTakeProfit = alert.recommendation_data?.suggestedActions?.newTakeProfit;

      if (!newTakeProfit) {
        await this.markAlertAsFailed(alert.id, 'No new take profit value provided');
        return;
      }

      logger.info('[AlertExecutor] Moving take profit:', {
        trade_id: trade.id,
        old_tp: trade.take_profit,
        new_tp: newTakeProfit
      });

      // Update the trade
      const { error: updateError } = await supabase
        .from('goal_session_trades')
        .update({
          take_profit: newTakeProfit,
          updated_at: new Date().toISOString()
        })
        .eq('id', trade.id);

      if (updateError) {
        logger.error('[AlertExecutor] Error updating take profit:', updateError);
        await this.markAlertAsFailed(alert.id, `Failed to update TP: ${updateError.message}`);
        return;
      }

      // Log to AI conversation
      await supabase
        .from('goal_ai_conversations')
        .insert({
          user_id: alert.user_id,
          goal_session_id: alert.goal_session_id,
          role: 'ai',
          content: `✓ Take Profit adjusted to ${newTakeProfit.toFixed(5)} by Alpha. ${alert.recommendation_data?.reasoning}`,
          created_at: new Date().toISOString()
        });

      // Mark alert as executed
      await this.markAlertAsExecuted(alert.id, 'Take profit updated successfully');

      logger.info('[AlertExecutor] Take profit updated successfully');
    } catch (error) {
      logger.error('[AlertExecutor] Exception in executeTakeProfitMove:', error);
      await this.markAlertAsFailed(alert.id, `Exception during TP move: ${error}`);
    }
  }

  /**
   * Mark alert as successfully executed
   */
  private async markAlertAsExecuted(notificationId: string, reason: string): Promise<void> {
    await supabase
      .from('goal_notifications')
      .update({
        executed: true,
        executed_at: new Date().toISOString(),
        metadata: {
          execution_result: 'success',
          execution_reason: reason
        }
      })
      .eq('id', notificationId);
  }

  /**
   * Mark alert as failed
   */
  private async markAlertAsFailed(notificationId: string, reason: string): Promise<void> {
    await supabase
      .from('goal_notifications')
      .update({
        executed: true,
        executed_at: new Date().toISOString(),
        metadata: {
          execution_result: 'failed',
          execution_reason: reason
        }
      })
      .eq('id', notificationId);
  }
}

export const midTradeAlertExecutor = new MidTradeAlertExecutor();

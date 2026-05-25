/**
 * Mid-Trade Alert Executor
 *
 * Automatically executes mid-trade recommendations after the timeout period
 * Runs every 5 seconds to check for expired alerts
 * Handles EXIT_IMMEDIATELY and TAKE_PROFIT_EARLY actions
 */

import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { SystemTableRPCWrapper } from './system-table-rpc-wrapper';
import { TIME_MS } from '../config/time-constants';
import { getForexMarketStatus } from '@/utils/marketHours';

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

    if (!getForexMarketStatus().isOpen) {
      return; // No alerts to execute when market is closed
    }

    this.isExecuting = true;

    // CCIP-GOAL-NOTIFICATIONS-BLOAT-2026-04-13:
    // Fail-fast AbortController prevents this query from causing 57014 statement
    // timeouts under DB load. No retry: the next 5s cycle will pick up any alerts
    // that were skipped. See TIME_MS.SERVICE_TIMEOUTS.ALERT_EXECUTOR for governance.
    const abortController = new AbortController();
    const abortTimer = setTimeout(
      () => abortController.abort(),
      TIME_MS.SERVICE_TIMEOUTS.ALERT_EXECUTOR.QUERY_TIMEOUT
    );

    try {
      const { data: expiredAlerts, error: fetchError } = await supabase
        .from('goal_notifications')
        .select('*')
        .eq('requires_user_alert', true)
        .eq('executed', false)
        .lte('auto_execute_at', new Date().toISOString())
        .order('auto_execute_at', { ascending: true })
        .limit(10)
        .abortSignal(abortController.signal);

      clearTimeout(abortTimer);

      if (fetchError) {
        if (fetchError.message && fetchError.message.includes('AbortError')) {
          logger.warn('[AlertExecutor] Query timed out — skipping cycle, will retry next interval');
        } else {
          logger.error('[AlertExecutor] Error fetching expired alerts:', fetchError);
        }
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
      clearTimeout(abortTimer);
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

      // Entry zone reached — execute the deferred entry intent
      if (recommendation === 'EXECUTE_ENTRY' || alert.type === 'entry_zone_reached') {
        await this.executeEntryIntent(alert);
        return;
      }

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

      if (trade.status !== 'open') {
        logger.warn('[AlertExecutor] Trade is not open:', {
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
   * Execute a deferred entry intent when the pullback zone is reached.
   *
   * Sets a manual_trigger flag in the intent's market_context so the
   * autonomous-entry-monitor Netlify function bypasses EQS checks and
   * calls executeIntent() in its next 1-minute cycle.
   */
  private async executeEntryIntent(alert: any): Promise<void> {
    try {
      const intentId = alert.recommendation_data?.intent_id
        || alert.data?.intent_id
        || alert.trade_context?.intent_id;

      if (!intentId) {
        logger.error('[AlertExecutor] No intent_id found in entry_zone_reached alert:', alert);
        await this.markAlertAsFailed(alert.id, 'No intent_id found');
        return;
      }

      logger.info('[AlertExecutor] Triggering entry intent execution:', { intent_id: intentId });

      // Verify the intent is still in monitoring state
      const { data: intent, error: intentError } = await supabase
        .from('entry_intents')
        .select('id, status, symbol, direction, market_context')
        .eq('id', intentId)
        .maybeSingle();

      if (intentError || !intent) {
        logger.error('[AlertExecutor] Intent not found:', { intent_id: intentId, error: intentError });
        await this.markAlertAsFailed(alert.id, 'Intent not found');
        return;
      }

      if (intent.status !== 'monitoring') {
        logger.warn('[AlertExecutor] Intent is no longer monitoring:', {
          intent_id: intentId,
          status: intent.status
        });
        await this.markAlertAsExecuted(alert.id, `Intent already ${intent.status}`);
        return;
      }

      // Merge manual_trigger flag into market_context.
      // The autonomous-entry-monitor checks for this flag and skips EQS/zone checks,
      // calling executeIntent() directly on the next 1-minute cycle.
      const updatedContext = {
        ...(intent.market_context || {}),
        manual_trigger: true,
        manual_trigger_at: new Date().toISOString()
      };

      // entry_intents has no updated_at column — only set market_context.
      const { error: updateError } = await supabase
        .from('entry_intents')
        .update({
          market_context: updatedContext
        })
        .eq('id', intentId)
        .eq('status', 'monitoring');

      if (updateError) {
        logger.error('[AlertExecutor] Failed to set manual_trigger on intent:', updateError);
        await this.markAlertAsFailed(alert.id, `Failed to update intent: ${updateError.message}`);
        return;
      }

      await this.markAlertAsExecuted(alert.id, 'Entry intent manual trigger set — server monitor will execute on next cycle');

      logger.info('[AlertExecutor] Entry intent manual_trigger set:', {
        intent_id: intentId,
        symbol: intent.symbol,
        direction: intent.direction
      });
    } catch (error) {
      logger.error('[AlertExecutor] Exception in executeEntryIntent:', error);
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

      // SSOT: Use RPC wrapper instead of direct INSERT
      await SystemTableRPCWrapper.createGoalAIConversation(
        alert.user_id,
        alert.goal_session_id,
        'ai',
        conversationMessage,
        0, // tokens_used
        'alpha-brain', // model
        {
          alert_type: recommendation,
          trade_id: trade.id,
          symbol: trade.symbol
        }
      );

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
      // SSOT: Use RPC wrapper instead of direct INSERT
      await SystemTableRPCWrapper.createGoalAIConversation(
        alert.user_id,
        alert.goal_session_id,
        'ai',
        `✓ Stop Loss adjusted to ${newStopLoss.toFixed(5)} by Alpha. ${alert.recommendation_data?.reasoning}`,
        0, // tokens_used
        'alpha-brain', // model
        {
          alert_type: 'MOVE_STOP_LOSS',
          trade_id: trade.id,
          symbol: trade.symbol,
          new_stop_loss: newStopLoss
        }
      );

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
      // SSOT: Use RPC wrapper instead of direct INSERT
      await SystemTableRPCWrapper.createGoalAIConversation(
        alert.user_id,
        alert.goal_session_id,
        'ai',
        `✓ Take Profit adjusted to ${newTakeProfit.toFixed(5)} by Alpha. ${alert.recommendation_data?.reasoning}`,
        0, // tokens_used
        'alpha-brain', // model
        {
          alert_type: 'MOVE_TAKE_PROFIT',
          trade_id: trade.id,
          symbol: trade.symbol,
          new_take_profit: newTakeProfit
        }
      );

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

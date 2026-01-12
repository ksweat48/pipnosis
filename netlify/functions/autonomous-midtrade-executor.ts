/**
 * Autonomous Mid-Trade Alert Executor
 *
 * SSOT Authority for Mid-Trade Alert Execution
 *
 * Runs every 10 seconds via Netlify scheduled function.
 * Automatically executes expired mid-trade alerts (EXIT_IMMEDIATELY, TAKE_PROFIT_EARLY).
 * Operates independently of browser.
 *
 * Architecture:
 * 1. Fetch expired alerts from goal_notifications
 * 2. Verify alert is still valid (position still open)
 * 3. Execute closure via trade-closure-coordinator (SSOT)
 * 4. Send push notification to user
 * 5. Mark alert as executed
 *
 * Response Time: Sub-15-second from alert expiration to closure execution
 */

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const MAX_EXECUTION_TIME_MS = 9000;

interface ExpiredAlert {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  metadata: any;
  created_at: string;
  auto_execute_at: string;
}

interface Position {
  id: string;
  status: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entry_price: number;
  current_pnl: number;
}

/**
 * Get current price for closure execution
 */
async function getCurrentPrice(symbol: string): Promise<{ bid: number; ask: number } | null> {
  try {
    const { data, error } = await supabase
      .from('realtime_prices')
      .select('bid, ask')
      .eq('symbol', symbol)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      console.error(`[AutonomousMidTrade] No price for ${symbol}`);
      return null;
    }

    return data;
  } catch (error) {
    console.error(`[AutonomousMidTrade] Error fetching price:`, error);
    return null;
  }
}

/**
 * Execute mid-trade alert action
 */
async function executeAlertAction(
  alert: ExpiredAlert,
  executionId: string
): Promise<{ success: boolean; reason?: string }> {
  try {
    const positionId = alert.metadata?.position_id || alert.metadata?.tradeId;
    if (!positionId) {
      return { success: false, reason: 'No position ID in alert metadata' };
    }

    // Verify position still exists and is open
    const { data: position, error: posError } = await supabase
      .from('goal_session_trades')
      .select('id, status, symbol, direction, entry_price, current_pnl')
      .eq('id', positionId)
      .single();

    if (posError || !position) {
      return { success: false, reason: 'Position not found' };
    }

    if (position.status !== 'open') {
      return { success: false, reason: `Position already ${position.status}` };
    }

    // Get current price
    const price = await getCurrentPrice(position.symbol);
    if (!price) {
      return { success: false, reason: 'No current price available' };
    }

    const closePrice = position.direction === 'buy' ? price.bid : price.ask;

    // Determine close reason from alert type
    const closeReason = alert.type === 'midtrade_exit_immediately'
      ? 'alpha_emergency_exit'
      : alert.type === 'midtrade_take_profit_early'
      ? 'alpha_early_tp'
      : 'alpha_recommendation';

    console.log(`[AutonomousMidTrade:${executionId}] Executing closure for ${position.symbol}: ${closeReason}`);

    // Execute closure via database function (SSOT)
    const { error: closeError } = await supabase.rpc('close_position_at_sltp', {
      p_position_id: positionId,
      p_close_price: closePrice,
      p_close_reason: closeReason
    });

    if (closeError) {
      console.error(`[AutonomousMidTrade:${executionId}] Failed to close position:`, closeError);
      return { success: false, reason: closeError.message };
    }

    console.log(`[AutonomousMidTrade:${executionId}] ✅ Position closed at ${closePrice}`);

    // Send push notification to user
    await sendExecutionNotification(alert.user_id, position, closePrice, closeReason);

    return { success: true };

  } catch (error) {
    console.error(`[AutonomousMidTrade] Exception executing alert:`, error);
    return {
      success: false,
      reason: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Send push notification to user about executed action
 */
async function sendExecutionNotification(
  userId: string,
  position: Position,
  closePrice: number,
  closeReason: string
): Promise<void> {
  try {
    const actionText = closeReason === 'alpha_emergency_exit'
      ? 'emergency exit'
      : closeReason === 'alpha_early_tp'
      ? 'early profit taking'
      : 'mid-trade recommendation';

    await supabase.from('goal_notifications').insert({
      user_id: userId,
      type: 'trade_auto_closed',
      title: `${position.symbol} Auto-Closed`,
      message: `Your ${position.symbol} position was automatically closed due to ${actionText}. Close price: ${closePrice.toFixed(5)}`,
      metadata: {
        symbol: position.symbol,
        close_price: closePrice,
        close_reason: closeReason,
        auto_executed: true,
        executed_at: new Date().toISOString()
      },
      requires_user_alert: true,
      send_push: true,
      created_at: new Date().toISOString()
    });

    console.log(`[AutonomousMidTrade] Push notification queued for user ${userId}`);
  } catch (error) {
    console.error(`[AutonomousMidTrade] Failed to send notification:`, error);
  }
}

/**
 * Mark alert as executed
 */
async function markAlertExecuted(
  alertId: string,
  success: boolean,
  reason?: string
): Promise<void> {
  try {
    await supabase
      .from('goal_notifications')
      .update({
        executed: true,
        metadata: {
          execution_success: success,
          execution_reason: reason,
          executed_at: new Date().toISOString()
        }
      })
      .eq('id', alertId);
  } catch (error) {
    console.error(`[AutonomousMidTrade] Failed to mark alert as executed:`, error);
  }
}

export const handler: Handler = async (event, context) => {
  const executionId = `midtrade_exec_${Date.now()}`;
  const startTime = Date.now();

  console.log(`[AutonomousMidTrade:${executionId}] Starting mid-trade alert execution...`);

  try {
    // Fetch expired alerts that haven't been executed yet
    const { data: expiredAlerts, error: fetchError } = await supabase
      .from('goal_notifications')
      .select('*')
      .eq('requires_user_alert', true)
      .eq('executed', false)
      .lte('auto_execute_at', new Date().toISOString())
      .in('type', ['midtrade_exit_immediately', 'midtrade_take_profit_early'])
      .order('auto_execute_at', { ascending: true })
      .limit(20);

    if (fetchError) {
      console.error(`[AutonomousMidTrade:${executionId}] Failed to fetch alerts:`, fetchError);
      return {
        statusCode: 500,
        body: JSON.stringify({
          success: false,
          error: 'Failed to fetch expired alerts',
          executionId
        })
      };
    }

    if (!expiredAlerts || expiredAlerts.length === 0) {
      console.log(`[AutonomousMidTrade:${executionId}] No expired alerts to execute`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'No expired alerts',
          executionId,
          alertsProcessed: 0,
          alertsExecuted: 0,
          alertsFailed: 0
        })
      };
    }

    console.log(`[AutonomousMidTrade:${executionId}] Processing ${expiredAlerts.length} expired alerts`);

    let alertsExecuted = 0;
    let alertsFailed = 0;

    // Process each expired alert
    for (const alert of expiredAlerts) {
      // Check if approaching timeout
      if (Date.now() - startTime > MAX_EXECUTION_TIME_MS) {
        console.warn(`[AutonomousMidTrade:${executionId}] ⏱️ Approaching timeout, stopping early`);
        break;
      }

      console.log(`[AutonomousMidTrade:${executionId}] Processing alert ${alert.id} (${alert.type})`);

      const result = await executeAlertAction(alert, executionId);

      if (result.success) {
        alertsExecuted++;
        console.log(`[AutonomousMidTrade:${executionId}] ✅ Alert executed successfully`);
      } else {
        alertsFailed++;
        console.warn(`[AutonomousMidTrade:${executionId}] ❌ Alert execution failed: ${result.reason}`);
      }

      // Mark alert as executed (whether successful or not)
      await markAlertExecuted(alert.id, result.success, result.reason);
    }

    const duration = Date.now() - startTime;

    console.log(`[AutonomousMidTrade:${executionId}] ✅ Completed in ${duration}ms`);
    console.log(`[AutonomousMidTrade:${executionId}] Alerts: ${expiredAlerts.length}, Executed: ${alertsExecuted}, Failed: ${alertsFailed}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        executionId,
        alertsProcessed: expiredAlerts.length,
        alertsExecuted,
        alertsFailed,
        durationMs: duration,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error(`[AutonomousMidTrade:${executionId}] ❌ Critical error:`, error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        executionId,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      })
    };
  }
};

import { supabase } from '../lib/supabase';
import type { DialogType, DialogData, DialogPriority } from './global-dialog-manager';
import { pushNotificationDispatcher } from './push-notification-dispatcher';

// SSOT FIX (2026-02-04): Align with database constraint - use 'critical' not 'urgent'
interface NotificationPayload {
  user_id: string;
  goal_session_id: string | null;
  type: string;
  title: string;
  message: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  metadata: any;
  created_at: string;
}

class ModalNotificationBridge {
  async captureDialog(dialogData: DialogData, userId: string, goalSessionId: string | null = null): Promise<void> {
    try {
      const notification = this.mapDialogToNotification(dialogData, userId, goalSessionId);

      const { data: insertedData, error } = await supabase
        .from('goal_notifications')
        .insert(notification)
        .select('id')
        .single();

      if (error) {
        console.error('[Notification Bridge] Failed to persist notification:', error);
        return;
      }

      console.log(`[Notification Bridge] Persisted ${dialogData.type} notification`);

      const notificationId = insertedData?.id;

      await this.triggerPushNotification(dialogData, userId, goalSessionId, notificationId);
    } catch (error) {
      console.error('[Notification Bridge] Error capturing dialog:', error);
    }
  }

  private async triggerPushNotification(
    dialogData: DialogData,
    userId: string,
    goalSessionId: string | null,
    notificationId?: string
  ): Promise<void> {
    try {
      const data = dialogData.data;

      switch (dialogData.type) {
        case 'goal_achieved':
          await pushNotificationDispatcher.sendGoalAchieved({
            userId,
            notificationId,
            goalSessionId: goalSessionId || data.goal_session_id || data.goalSessionId,
            goalAmount: data.goal_amount || data.goalAmount || 0,
            actualAmount: data.actual_profit || data.profit || 0,
            tradesCount: data.trades_count || data.tradesCount || 0
          });
          break;

        case 'trade_closed':
          await pushNotificationDispatcher.sendTradeClosed({
            userId,
            notificationId,
            tradeId: data.trade_id || data.tradeId || '',
            symbol: data.symbol || 'Unknown',
            direction: data.direction || 'buy',
            profit: data.pnl || data.profit || 0,
            closeReason: data.close_reason || data.reason || 'Manual',
            duration: data.duration
          });
          break;

        case 'trade_signal':
          await pushNotificationDispatcher.sendTradeSignal({
            userId,
            notificationId,
            symbol: data.symbol || 'Unknown',
            direction: data.direction || data.type || 'buy',
            setupType: data.setup_type || data.setupType || 'Signal',
            confidence: data.confidence || 0,
            entryPrice: data.entry_price || data.entryPrice || 0,
            stopLoss: data.stop_loss || data.stopLoss || 0,
            takeProfit: data.take_profit || data.takeProfit || 0
          });
          break;

        case 'trade_entry':
          await pushNotificationDispatcher.sendTradeEntry({
            userId,
            notificationId,
            tradeId: data.trade_id || data.tradeId || '',
            symbol: data.symbol || 'Unknown',
            direction: data.direction || data.type || 'buy',
            entryPrice: data.entry_price || data.entryPrice || 0,
            lotSize: data.lot_size || data.lotSize || 0,
            stopLoss: data.stop_loss || data.stopLoss || 0,
            takeProfit: data.take_profit || data.takeProfit || 0
          });
          break;

        default:
          console.log('[Notification Bridge] No push notification for type:', dialogData.type);
      }
    } catch (error) {
      console.error('[Notification Bridge] Error triggering push notification:', error);
    }
  }

  private mapDialogToNotification(
    dialogData: DialogData,
    userId: string,
    goalSessionId: string | null
  ): NotificationPayload {
    // SSOT FIX (2026-02-04): Map 'urgent' to 'critical' for legacy compatibility
    // This ensures any old code using 'urgent' won't cause constraint violations
    let priority = dialogData.priority || 'medium';
    if (priority === 'urgent' as any) {
      priority = 'critical';
    }

    const baseNotification = {
      user_id: userId,
      goal_session_id: goalSessionId,
      priority: priority as 'low' | 'medium' | 'high' | 'critical',
      metadata: dialogData.data,
      created_at: new Date(dialogData.timestamp).toISOString()
    };

    switch (dialogData.type) {
      case 'goal_achieved':
        return {
          ...baseNotification,
          type: 'goal_achieved',
          title: 'Goal Achieved!',
          message: this.formatGoalAchievedMessage(dialogData.data)
        };

      case 'trade_closed':
        return {
          ...baseNotification,
          type: 'trade_closed',
          title: 'Trade Closed',
          message: this.formatTradeClosedMessage(dialogData.data)
        };

      case 'trade_signal':
        return {
          ...baseNotification,
          type: 'trade_signal',
          title: 'Trade Signal',
          message: this.formatTradeSignalMessage(dialogData.data)
        };

      case 'trade_entry':
        return {
          ...baseNotification,
          type: 'trade_entry',
          title: 'Trade Entry',
          message: this.formatTradeEntryMessage(dialogData.data)
        };

      default:
        return {
          ...baseNotification,
          type: 'general',
          title: 'Notification',
          message: 'System notification'
        };
    }
  }

  private formatGoalAchievedMessage(data: any): string {
    const goalAmount = data.goal_amount || data.goalAmount || 0;
    const actualProfit = data.actual_profit || data.profit || 0;
    return `Congratulations! Goal of $${goalAmount.toFixed(2)} achieved with $${actualProfit.toFixed(2)} profit!`;
  }

  private formatTradeClosedMessage(data: any): string {
    const symbol = data.symbol || 'Unknown';
    const pnl = data.pnl || data.profit || 0;
    const pnlText = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
    const reason = data.close_reason || data.reason || 'Manual';
    return `${symbol} closed: ${pnlText} (${reason})`;
  }

  private formatTradeSignalMessage(data: any): string {
    const symbol = data.symbol || 'Unknown';
    const direction = data.direction || data.type || 'Unknown';
    const confidence = data.confidence || 0;
    return `${direction.toUpperCase()} signal on ${symbol} (${confidence}% confidence)`;
  }

  private formatTradeEntryMessage(data: any): string {
    const symbol = data.symbol || 'Unknown';
    const direction = data.direction || data.type || 'Unknown';
    const lotSize = data.lot_size || data.lotSize || 0;
    return `Entered ${direction.toUpperCase()} on ${symbol} with ${lotSize.toFixed(2)} lots`;
  }
}

export const modalNotificationBridge = new ModalNotificationBridge();

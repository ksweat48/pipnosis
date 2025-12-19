import { supabase } from '../lib/supabase';
import type { DialogType, DialogData } from './global-dialog-manager';

interface NotificationPayload {
  user_id: string;
  goal_session_id: string | null;
  type: string;
  title: string;
  message: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  data: any;
  created_at: string;
}

class ModalNotificationBridge {
  async captureDialog(dialogData: DialogData, userId: string, goalSessionId: string | null = null): Promise<void> {
    try {
      const notification = this.mapDialogToNotification(dialogData, userId, goalSessionId);

      const { error } = await supabase
        .from('goal_notifications')
        .insert(notification);

      if (error) {
        console.error('[Notification Bridge] Failed to persist notification:', error);
      } else {
        console.log(`[Notification Bridge] Persisted ${dialogData.type} notification`);
      }
    } catch (error) {
      console.error('[Notification Bridge] Error capturing dialog:', error);
    }
  }

  private mapDialogToNotification(
    dialogData: DialogData,
    userId: string,
    goalSessionId: string | null
  ): NotificationPayload {
    const baseNotification = {
      user_id: userId,
      goal_session_id: goalSessionId,
      priority: dialogData.priority || 'medium',
      data: dialogData.data,
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

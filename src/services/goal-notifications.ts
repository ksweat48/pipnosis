import { supabase } from '../lib/supabase';
import { TradeSignal } from './goal-scanner';

export interface Notification {
  id?: string;
  sessionId: string;
  userId: string;
  type: 'forecast' | 'signal' | 'progress' | 'alert' | 'completion';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  title: string;
  message: string;
  data?: any;
  channels?: string[];
}

class GoalNotificationSystem {
  async sendForecastNotification(
    sessionId: string,
    userId: string,
    forecast: any
  ): Promise<void> {
    const notification: Notification = {
      sessionId,
      userId,
      type: 'forecast',
      priority: forecast.confidence_score > 70 ? 'high' : 'medium',
      title: 'Market Forecast Update',
      message: forecast.reasoning,
      data: { forecast },
      channels: ['in_app'],
    };

    await this.createNotification(notification);
  }

  async sendTradeSignalNotification(
    signal: TradeSignal,
    userId: string
  ): Promise<void> {
    const progressContribution = await this.calculateProgressContribution(signal);

    const notification: Notification = {
      sessionId: signal.sessionId,
      userId,
      type: 'signal',
      priority: 'critical',
      title: `🎯 Trade Signal: ${signal.symbol}`,
      message: this.formatTradeSignalMessage(signal, progressContribution),
      data: { signal, progressContribution },
      channels: ['in_app'],
    };

    await this.createNotification(notification);
  }

  formatTradeSignalMessage(signal: TradeSignal, progressContribution: number): string {
    return `Found ${signal.confidence}% confidence ${signal.direction.toUpperCase()} setup on ${signal.symbol}.

Setup: ${signal.setupType}
Entry: ${signal.entryPrice.toFixed(5)}
Stop Loss: ${signal.stopLoss.toFixed(5)}
Take Profit: ${signal.takeProfit.toFixed(5)}
Risk/Reward: 1:${signal.riskReward.toFixed(2)}

Expected profit: $${signal.expectedProfit.toFixed(2)} (${progressContribution.toFixed(0)}% of goal)

${signal.reasoning}`;
  }

  async calculateProgressContribution(signal: TradeSignal): Promise<number> {
    try {
      const { data: session } = await supabase
        .from('goal_sessions')
        .select('target_value')
        .eq('id', signal.sessionId)
        .single();

      if (!session) return 0;

      return (signal.expectedProfit / session.target_value) * 100;
    } catch (error) {
      console.error('Error calculating progress contribution:', error);
      return 0;
    }
  }

  async sendProgressNotification(
    sessionId: string,
    userId: string,
    currentProgress: number,
    targetValue: number,
    progressPercentage: number,
    trade?: any
  ): Promise<void> {
    let message = '';
    let priority: 'low' | 'medium' | 'high' | 'critical' = 'medium';

    if (trade) {
      const profit = trade.profit_loss || 0;
      const profitSign = profit >= 0 ? '+' : '';
      message = `Trade closed: ${profitSign}$${profit.toFixed(2)} on ${trade.symbol}.\n\nGoal progress: $${currentProgress.toFixed(2)} / $${targetValue} (${progressPercentage.toFixed(1)}%).`;

      if (progressPercentage >= 100) {
        priority = 'critical';
        message = `🎉 Goal achieved! Total profit: $${currentProgress.toFixed(2)}. You've reached your $${targetValue} target!`;
      } else if (progressPercentage >= 75) {
        priority = 'high';
        message += `\n\nYou're ${(100 - progressPercentage).toFixed(0)}% away from your goal. Keep going!`;
      } else if (progressPercentage >= 50) {
        priority = 'medium';
        message += '\n\nHalfway there! Continuing to scan for quality setups.';
      }
    } else {
      message = `Session progress update: $${currentProgress.toFixed(2)} / $${targetValue} (${progressPercentage.toFixed(1)}%). Continuing market analysis...`;
    }

    const notification: Notification = {
      sessionId,
      userId,
      type: 'progress',
      priority,
      title: progressPercentage >= 100 ? '🎯 Goal Achieved!' : '📊 Progress Update',
      message,
      data: { currentProgress, targetValue, progressPercentage, trade },
      channels: ['in_app'],
    };

    await this.createNotification(notification);
  }

  async sendAlertNotification(
    sessionId: string,
    userId: string,
    alertType: string,
    message: string,
    data?: any
  ): Promise<void> {
    const notification: Notification = {
      sessionId,
      userId,
      type: 'alert',
      priority: 'high',
      title: `⚠️ ${alertType}`,
      message,
      data,
      channels: ['in_app'],
    };

    await this.createNotification(notification);
  }

  async sendCompletionNotification(
    sessionId: string,
    userId: string,
    summary: any
  ): Promise<void> {
    const achieved = summary.goal_achieved;
    const emoji = achieved ? '🎉' : '📊';

    let message = achieved
      ? `Congratulations! You've successfully reached your goal with a final profit of $${summary.final_profit.toFixed(2)}.`
      : `Session completed. Final result: $${summary.final_profit.toFixed(2)} (${summary.final_progress_percentage.toFixed(1)}% of goal).`;

    message += `\n\nStats:
• Total trades: ${summary.total_trades}
• Win rate: ${summary.win_rate.toFixed(1)}%
• Best trade: $${summary.best_trade?.profit || 0}
• Strongest pattern: ${summary.strongest_pattern || 'N/A'}`;

    if (summary.recommendations && summary.recommendations.length > 0) {
      message += `\n\nRecommendations:\n${summary.recommendations.slice(0, 2).join('\n')}`;
    }

    const notification: Notification = {
      sessionId,
      userId,
      type: 'completion',
      priority: 'high',
      title: `${emoji} Session Complete`,
      message,
      data: { summary },
      channels: ['in_app'],
    };

    await this.createNotification(notification);
  }

  async createNotification(notification: Notification): Promise<void> {
    try {
      const { error } = await supabase
        .from('goal_notifications')
        .insert({
          goal_session_id: notification.sessionId,
          user_id: notification.userId,
          type: notification.type,
          priority: notification.priority,
          title: notification.title,
          message: notification.message,
          metadata: notification.data || {},
          channels: notification.channels || ['in_app'],
          delivered_at: new Date().toISOString(),
        });

      if (error) {
        console.error('Error creating notification:', error);
      }
    } catch (error) {
      console.error('Error in createNotification:', error);
    }
  }

  async getUnacknowledgedNotifications(userId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('goal_notifications')
        .select('*')
        .eq('user_id', userId)
        .is('acknowledged_at', null)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        console.error('Error fetching notifications:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getUnacknowledgedNotifications:', error);
      return [];
    }
  }

  async acknowledgeNotification(notificationId: string): Promise<void> {
    try {
      await supabase
        .from('goal_notifications')
        .update({ acknowledged_at: new Date().toISOString() })
        .eq('id', notificationId);
    } catch (error) {
      console.error('Error acknowledging notification:', error);
    }
  }

  async getSessionNotifications(sessionId: string, limit: number = 50): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('goal_notifications')
        .select('*')
        .eq('goal_session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error fetching session notifications:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getSessionNotifications:', error);
      return [];
    }
  }

  async clearSessionNotifications(sessionId: string): Promise<void> {
    try {
      await supabase
        .from('goal_notifications')
        .update({ acknowledged_at: new Date().toISOString() })
        .eq('goal_session_id', sessionId)
        .is('acknowledged_at', null);
    } catch (error) {
      console.error('Error clearing session notifications:', error);
    }
  }
}

export const goalNotificationSystem = new GoalNotificationSystem();

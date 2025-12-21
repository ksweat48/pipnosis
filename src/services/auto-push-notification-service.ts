import { supabase } from '@/lib/supabase';
import { pushNotificationDispatcher } from './push-notification-dispatcher';

class AutoPushNotificationService {
  private channel: any = null;
  private isInitialized = false;
  private processedNotifications = new Set<string>();

  async initialize(userId: string): Promise<void> {
    if (this.isInitialized) {
      console.log('[AutoPush] Already initialized');
      return;
    }

    console.log('[AutoPush] Initializing auto-push notification service for user:', userId);

    this.channel = supabase
      .channel('auto-push-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'goal_notifications',
          filter: `user_id=eq.${userId}`
        },
        async (payload) => {
          const notification = payload.new;

          if (this.processedNotifications.has(notification.id)) {
            console.log('[AutoPush] Notification already processed:', notification.id);
            return;
          }

          if (notification.priority === 'high' || notification.priority === 'urgent') {
            console.log('[AutoPush] High/urgent notification detected:', notification.type);
            this.processedNotifications.add(notification.id);
            await this.sendPushForNotification(userId, notification);
          }
        }
      )
      .subscribe();

    this.isInitialized = true;
    console.log('[AutoPush] Service initialized successfully');
  }

  private async sendPushForNotification(userId: string, notification: any): Promise<void> {
    try {
      const metadata = notification.metadata || {};

      switch (notification.type) {
        case 'scanning_timeout':
          await pushNotificationDispatcher.sendScanningTimeout({
            userId,
            notificationId: notification.id,
            goalSessionId: notification.goal_session_id,
            modalId: metadata.modal_id,
            tradesInSession: metadata.trades_count || 0,
            currentProgress: metadata.current_pnl || 0,
            targetAmount: metadata.target || 0
          });
          console.log('[AutoPush] ✅ Sent scanning timeout push notification');
          break;

        case 'goal_achieved':
          await pushNotificationDispatcher.sendGoalAchieved({
            userId,
            notificationId: notification.id,
            goalSessionId: notification.goal_session_id,
            goalAmount: metadata.goal_amount || 0,
            actualAmount: metadata.actual_amount || 0,
            tradesCount: metadata.trades_count || 0
          });
          console.log('[AutoPush] ✅ Sent goal achieved push notification');
          break;

        case 'trade_closed':
          const tradeData = metadata.trade_data || {};
          await pushNotificationDispatcher.sendTradeClosed({
            userId,
            notificationId: notification.id,
            tradeId: metadata.trade_id,
            symbol: tradeData.symbol || 'Unknown',
            direction: tradeData.direction || 'buy',
            profit: tradeData.profit || 0,
            closeReason: tradeData.close_reason || 'Unknown',
            duration: tradeData.duration
          });
          console.log('[AutoPush] ✅ Sent trade closed push notification');
          break;

        case 'mid_trade_trigger':
          await pushNotificationDispatcher.sendMidTradeAlert({
            userId,
            notificationId: notification.id,
            tradeId: metadata.trade_id,
            symbol: metadata.symbol || 'Unknown',
            triggerReason: metadata.trigger_reason || 'Market update',
            llmRecommendation: metadata.llm_recommendation || 'Review trade',
            priority: notification.priority
          });
          console.log('[AutoPush] ✅ Sent mid-trade alert push notification');
          break;

        default:
          console.log('[AutoPush] Notification type not mapped for push:', notification.type);
      }
    } catch (error) {
      console.error('[AutoPush] Error sending push notification:', error);
    }
  }

  shutdown(): void {
    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
      this.isInitialized = false;
      this.processedNotifications.clear();
      console.log('[AutoPush] Service shutdown');
    }
  }

  clearProcessedCache(): void {
    this.processedNotifications.clear();
    console.log('[AutoPush] Processed notification cache cleared');
  }
}

export const autoPushNotificationService = new AutoPushNotificationService();

import { supabase } from '@/lib/supabase';
import { format } from '@/utils/displayFormatters';

export type NotificationType =
  | 'trade-signal'
  | 'trade-entry'
  | 'trade-closed'
  | 'mid-trade-alert'
  | 'goal-achieved'
  | 'goal-progress'
  | 'scanning-timeout'
  | 'session-started'
  | 'session-ended'
  | 'system';

export type NotificationPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: {
    type: NotificationType;
    priority?: NotificationPriority;
    [key: string]: any;
  };
  tag?: string;
  vibrate?: number[];
}

export interface NotificationGroupKey {
  type: NotificationType;
  symbol?: string;
  trade_id?: string;
  goal_session_id?: string;
}

class PushNotificationDispatcher {
  private recentNotifications: Map<string, number> = new Map();
  private rateLimitWindow = 60000;
  private maxNotificationsPerMinute = 10;

  private generateGroupKey(key: NotificationGroupKey): string {
    const parts = [key.type];
    if (key.symbol) parts.push(key.symbol);
    if (key.trade_id) parts.push(key.trade_id);
    if (key.goal_session_id) parts.push(key.goal_session_id);
    return parts.join('-');
  }

  private isRateLimited(userId: string): boolean {
    const now = Date.now();
    const userKey = `user-${userId}`;

    this.cleanupOldEntries(now);

    const userNotifications = Array.from(this.recentNotifications.entries())
      .filter(([key]) => key.startsWith(userKey))
      .filter(([, timestamp]) => now - timestamp < this.rateLimitWindow);

    return userNotifications.length >= this.maxNotificationsPerMinute;
  }

  private cleanupOldEntries(now: number): void {
    for (const [key, timestamp] of this.recentNotifications.entries()) {
      if (now - timestamp > this.rateLimitWindow) {
        this.recentNotifications.delete(key);
      }
    }
  }

  private async shouldSendPush(
    userId: string,
    priority: NotificationPriority
  ): Promise<boolean> {
    if (this.isRateLimited(userId)) {
      console.warn('[Push Dispatcher] Rate limit reached for user:', userId);
      return false;
    }

    if (priority === 'low') {
      return false;
    }

    return true;
  }

  async sendTradeSignal(params: {
    userId: string;
    notificationId?: string;
    symbol: string;
    direction: 'buy' | 'sell';
    setupType: string;
    confidence: number;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
  }): Promise<boolean> {
    try {
      const priority: NotificationPriority = 'urgent';
      const shouldSend = await this.shouldSendPush(params.userId, priority);

      if (!shouldSend) {
        return false;
      }

      const payload: PushNotificationPayload = {
        title: `Trade Signal: ${params.symbol}`,
        body: `${format.direction(params.direction, 'notification')} ${params.setupType} - ${format.percent(params.confidence, 0, 'notification')} confidence`,
        icon: '/Pipnosis icon.png',
        badge: '/notification-badge_3.png',
        data: {
          type: 'trade-signal',
          priority,
          symbol: params.symbol,
          direction: params.direction,
          setupType: params.setupType,
          confidence: params.confidence,
          entryPrice: params.entryPrice,
          stopLoss: params.stopLoss,
          takeProfit: params.takeProfit
        },
        tag: `trade-signals-${params.symbol}`,
        vibrate: [200, 100, 200]
      };

      return await this.dispatch(params.userId, payload, params.notificationId);
    } catch (error) {
      console.error('[Push Dispatcher] Error sending trade signal:', error);
      return false;
    }
  }

  async sendTradeEntry(params: {
    userId: string;
    notificationId?: string;
    tradeId: string;
    symbol: string;
    direction: 'buy' | 'sell';
    entryPrice: number;
    lotSize: number;
    stopLoss: number;
    takeProfit: number;
  }): Promise<boolean> {
    try {
      const priority: NotificationPriority = 'urgent';
      const shouldSend = await this.shouldSendPush(params.userId, priority);

      if (!shouldSend) {
        return false;
      }

      const payload: PushNotificationPayload = {
        title: `Trade Entered: ${params.symbol}`,
        body: `${format.direction(params.direction, 'notification')} at ${format.price(params.entryPrice, params.symbol, 'notification')} - ${format.lots(params.lotSize, 'notification')} lots`,
        icon: '/Pipnosis icon.png',
        badge: '/notification-badge_3.png',
        data: {
          type: 'trade-entry',
          priority,
          trade_id: params.tradeId,
          symbol: params.symbol,
          direction: params.direction,
          entryPrice: params.entryPrice,
          lotSize: params.lotSize,
          stopLoss: params.stopLoss,
          takeProfit: params.takeProfit
        },
        tag: 'trade-entries',
        vibrate: [100, 50, 100, 50, 100]
      };

      return await this.dispatch(params.userId, payload, params.notificationId);
    } catch (error) {
      console.error('[Push Dispatcher] Error sending trade entry:', error);
      return false;
    }
  }

  async sendTradeClosed(params: {
    userId: string;
    notificationId?: string;
    tradeId: string;
    symbol: string;
    direction: 'buy' | 'sell';
    profit: number;
    closeReason: string;
    duration?: string;
  }): Promise<boolean> {
    try {
      const priority: NotificationPriority = 'high';
      const shouldSend = await this.shouldSendPush(params.userId, priority);

      if (!shouldSend) {
        return false;
      }

      const payload: PushNotificationPayload = {
        title: `Trade Closed: ${params.symbol}`,
        body: `${format.pnl(params.profit, 'notification')} - ${format.closeReason(params.closeReason, 'notification')}`,
        icon: '/Pipnosis icon.png',
        badge: '/notification-badge_3.png',
        data: {
          type: 'trade-closed',
          priority,
          trade_id: params.tradeId,
          symbol: params.symbol,
          direction: params.direction,
          profit: params.profit,
          closeReason: params.closeReason,
          duration: params.duration
        },
        tag: 'trade-closures',
        vibrate: params.profit > 0 ? [100, 50, 150, 50, 200] : [200, 50, 150, 50, 100]
      };

      return await this.dispatch(params.userId, payload, params.notificationId);
    } catch (error) {
      console.error('[Push Dispatcher] Error sending trade closed:', error);
      return false;
    }
  }

  async sendMidTradeAlert(params: {
    userId: string;
    notificationId?: string;
    tradeId: string;
    symbol: string;
    triggerReason: string;
    llmRecommendation: string;
    priority?: NotificationPriority;
  }): Promise<boolean> {
    try {
      const priority = params.priority || 'high';
      const shouldSend = await this.shouldSendPush(params.userId, priority);

      if (!shouldSend) {
        return false;
      }

      const payload: PushNotificationPayload = {
        title: `Mid-Trade Alert: ${params.symbol}`,
        body: `${params.triggerReason} - ${params.llmRecommendation}`,
        icon: '/Pipnosis icon.png',
        badge: '/notification-badge_3.png',
        data: {
          type: 'mid-trade-alert',
          priority,
          trade_id: params.tradeId,
          symbol: params.symbol,
          triggerReason: params.triggerReason,
          llmRecommendation: params.llmRecommendation
        },
        tag: `mid-trade-alerts-${params.tradeId}`,
        vibrate: priority === 'urgent' ? [500] : [200, 100, 200]
      };

      return await this.dispatch(params.userId, payload, params.notificationId);
    } catch (error) {
      console.error('[Push Dispatcher] Error sending mid-trade alert:', error);
      return false;
    }
  }

  async sendGoalAchieved(params: {
    userId: string;
    notificationId?: string;
    goalSessionId: string;
    goalAmount: number;
    actualAmount: number;
    tradesCount: number;
  }): Promise<boolean> {
    try {
      const priority: NotificationPriority = 'urgent';
      const shouldSend = await this.shouldSendPush(params.userId, priority);

      if (!shouldSend) {
        return false;
      }

      const payload: PushNotificationPayload = {
        title: 'Goal Achieved!',
        body: `Congratulations! You reached your $${params.goalAmount} target with ${params.tradesCount} trades`,
        icon: '/Pipnosis icon.png',
        badge: '/notification-badge_3.png',
        data: {
          type: 'goal-achieved',
          priority,
          goal_session_id: params.goalSessionId,
          goalAmount: params.goalAmount,
          actualAmount: params.actualAmount,
          tradesCount: params.tradesCount
        },
        tag: 'goal-achievements',
        vibrate: [100, 50, 100, 50, 100, 50, 100, 50, 100]
      };

      return await this.dispatch(params.userId, payload, params.notificationId);
    } catch (error) {
      console.error('[Push Dispatcher] Error sending goal achieved:', error);
      return false;
    }
  }

  async sendGoalProgress(params: {
    userId: string;
    notificationId?: string;
    goalSessionId: string;
    currentProgress: number;
    targetAmount: number;
    progressPercentage: number;
  }): Promise<boolean> {
    try {
      const priority: NotificationPriority = 'medium';
      const shouldSend = await this.shouldSendPush(params.userId, priority);

      if (!shouldSend) {
        return false;
      }

      const payload: PushNotificationPayload = {
        title: 'Goal Progress Update',
        body: `${params.progressPercentage.toFixed(1)}% complete - $${params.currentProgress.toFixed(2)} of $${params.targetAmount}`,
        icon: '/Pipnosis icon.png',
        badge: '/notification-badge_3.png',
        data: {
          type: 'goal-progress',
          priority,
          goal_session_id: params.goalSessionId,
          currentProgress: params.currentProgress,
          targetAmount: params.targetAmount,
          progressPercentage: params.progressPercentage
        },
        tag: 'goal-progress',
        vibrate: [200]
      };

      return await this.dispatch(params.userId, payload, params.notificationId);
    } catch (error) {
      console.error('[Push Dispatcher] Error sending goal progress:', error);
      return false;
    }
  }

  async sendScanningTimeout(params: {
    userId: string;
    notificationId?: string;
    goalSessionId: string;
    modalId: string;
    tradesInSession: number;
    currentProgress: number;
    targetAmount: number;
  }): Promise<boolean> {
    try {
      const priority: NotificationPriority = 'high';
      const shouldSend = await this.shouldSendPush(params.userId, priority);

      if (!shouldSend) {
        return false;
      }

      const payload: PushNotificationPayload = {
        title: 'Scanning Paused',
        body: `No trades found in 15 minutes. Continue scanning or close session?`,
        icon: '/Pipnosis icon.png',
        badge: '/notification-badge_3.png',
        data: {
          type: 'scanning-timeout',
          priority,
          goal_session_id: params.goalSessionId,
          modal_id: params.modalId,
          tradesInSession: params.tradesInSession,
          currentProgress: params.currentProgress,
          targetAmount: params.targetAmount,
          action: 'open_continuation_modal'
        },
        tag: `scanning-timeout-${params.goalSessionId}`,
        vibrate: [200, 100, 200, 100, 200],
        requireInteraction: true
      };

      return await this.dispatch(params.userId, payload, params.notificationId);
    } catch (error) {
      console.error('[Push Dispatcher] Error sending scanning timeout:', error);
      return false;
    }
  }

  async sendSessionStarted(params: {
    userId: string;
    notificationId?: string;
    goalSessionId: string;
    watchlist: string[];
    timeframe: string;
    riskMode: string;
    targetAmount: number;
  }): Promise<boolean> {
    try {
      const priority: NotificationPriority = 'medium';
      const shouldSend = await this.shouldSendPush(params.userId, priority);

      if (!shouldSend) {
        return false;
      }

      const symbolsText = params.watchlist.length > 3
        ? `${params.watchlist.slice(0, 3).join(', ')} +${params.watchlist.length - 3} more`
        : params.watchlist.join(', ');

      const payload: PushNotificationPayload = {
        title: '🚀 Smart Goal Session Started',
        body: `Scanning ${symbolsText} (${params.timeframe}) for ${params.riskMode} risk trades`,
        icon: '/Pipnosis icon.png',
        badge: '/notification-badge_3.png',
        data: {
          type: 'session-started',
          priority,
          goal_session_id: params.goalSessionId,
          watchlist: params.watchlist,
          timeframe: params.timeframe,
          riskMode: params.riskMode,
          targetAmount: params.targetAmount,
          action: 'open_goal_session'
        },
        tag: `session-started-${params.goalSessionId}`,
        vibrate: [100, 50, 100]
      };

      return await this.dispatch(params.userId, payload, params.notificationId);
    } catch (error) {
      console.error('[Push Dispatcher] Error sending session started:', error);
      return false;
    }
  }

  async sendSessionEnded(params: {
    userId: string;
    notificationId?: string;
    goalSessionId: string;
    closeReason: string;
    durationMinutes: number;
    tradesInSession: number;
    currentProgress: number;
    targetValue: number;
  }): Promise<boolean> {
    try {
      const priority: NotificationPriority =
        params.closeReason === 'timeout' || params.closeReason === 'safety_net' ? 'high' : 'medium';

      const shouldSend = await this.shouldSendPush(params.userId, priority);

      if (!shouldSend) {
        return false;
      }

      const icon = params.closeReason === 'timeout' ? '⏰' :
                   params.closeReason === 'safety_net' ? '🛡️' : '✋';

      const reasonText = params.closeReason === 'timeout' ? 'Timed out after no trades' :
                         params.closeReason === 'safety_net' ? 'Safety stop triggered' :
                         params.closeReason === 'user_stopped' ? 'Stopped by you' :
                         'Ended';

      const payload: PushNotificationPayload = {
        title: `${icon} Session ${reasonText}`,
        body: `${params.tradesInSession} trade${params.tradesInSession !== 1 ? 's' : ''} • $${params.currentProgress.toFixed(2)} of $${params.targetValue.toFixed(2)} • ${Math.round(params.durationMinutes)}min`,
        icon: '/Pipnosis icon.png',
        badge: '/notification-badge_3.png',
        data: {
          type: 'session-ended',
          priority,
          goal_session_id: params.goalSessionId,
          closeReason: params.closeReason,
          durationMinutes: params.durationMinutes,
          tradesInSession: params.tradesInSession,
          currentProgress: params.currentProgress,
          targetValue: params.targetValue,
          action: 'view_session_summary'
        },
        tag: `session-ended-${params.goalSessionId}`,
        vibrate: [200, 100, 200]
      };

      return await this.dispatch(params.userId, payload, params.notificationId);
    } catch (error) {
      console.error('[Push Dispatcher] Error sending session ended:', error);
      return false;
    }
  }

  private async dispatch(
    userId: string,
    payload: PushNotificationPayload,
    notificationId?: string
  ): Promise<boolean> {
    try {
      const siteUrl = import.meta.env.VITE_NETLIFY_SITE_URL || 'https://pipnosis.com';
      const edgeFunctionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-push-notification`;

      console.log('[Push Dispatcher] Sending to:', userId);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.error('[Push Dispatcher] No session found');
        return false;
      }

      const response = await fetch(edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
        },
        body: JSON.stringify({
          user_id: userId,
          notification_id: notificationId,
          payload
        })
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[Push Dispatcher] Edge function error:', error);
        return false;
      }

      const result = await response.json();
      console.log('[Push Dispatcher] Result:', result);

      const userKey = `user-${userId}-${Date.now()}`;
      this.recentNotifications.set(userKey, Date.now());

      return result.success && result.delivered > 0;
    } catch (error) {
      console.error('[Push Dispatcher] Error dispatching:', error);
      return false;
    }
  }

  clearRateLimits(): void {
    this.recentNotifications.clear();
  }
}

export const pushNotificationDispatcher = new PushNotificationDispatcher();

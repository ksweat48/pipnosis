/**
 * NOTIFICATION COORDINATOR - Single Source of Truth
 *
 * ALL notifications MUST go through this coordinator.
 * DO NOT insert into goal_notifications directly elsewhere in the codebase.
 *
 * This provides:
 * - Deduplication within configurable time windows
 * - Consistent notification formatting
 * - Priority-based delivery
 * - Rate limiting per user
 */

import { supabase } from '../../lib/supabase';
import { TIME_CONSTANTS } from '../../config/time-constants';
import SystemTableRPCWrapper from '../system-table-rpc-wrapper';

export type NotificationType =
  | 'goal_achieved'
  | 'goal_progress'
  | 'trade_opened'
  | 'trade_closed'
  | 'stop_loss_hit'
  | 'take_profit_hit'
  | 'session_timeout'
  | 'session_paused'
  | 'session_ended'
  | 'wellness_check'
  | 'mid_trade_alert'
  | 'continuation_required'
  | 'system_alert'
  | 'balance_update'
  | 'entry_monitoring_started';

export type NotificationPriority = 'low' | 'medium' | 'high' | 'critical';

export interface NotificationRequest {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  priority?: NotificationPriority;
  tradeId?: string;
  sessionId?: string;
  dedupeWindowMs?: number;
}

export interface NotificationResult {
  success: boolean;
  notificationId?: string;
  deduplicated?: boolean;
  error?: string;
}

interface DedupeKey {
  userId: string;
  type: NotificationType;
  tradeId?: string;
}

class NotificationCoordinator {
  private recentNotifications = new Map<string, number>();
  private userRateLimits = new Map<string, number[]>();

  private readonly DEFAULT_DEDUPE_WINDOW_MS = TIME_CONSTANTS.SECONDS.NOTIFICATION_DEDUPE_WINDOW * 1000;
  private readonly MAX_NOTIFICATIONS_PER_MINUTE = 10;
  private readonly RATE_LIMIT_WINDOW_MS = 60000;

  async send(request: NotificationRequest): Promise<NotificationResult> {
    const dedupeKey = this.createDedupeKey(request);
    const dedupeWindowMs = request.dedupeWindowMs ?? this.DEFAULT_DEDUPE_WINDOW_MS;

    if (this.isDuplicate(dedupeKey, dedupeWindowMs)) {
      console.log(`[NotificationCoordinator] Deduplicated notification: ${request.type} for user ${request.userId}`);
      return {
        success: true,
        deduplicated: true,
      };
    }

    if (this.isRateLimited(request.userId)) {
      console.warn(`[NotificationCoordinator] Rate limited: user ${request.userId}`);
      return {
        success: false,
        error: 'Rate limit exceeded',
      };
    }

    try {
      const metadata = {
        ...(request.metadata || {}),
        tradeId: request.tradeId || null,
        sessionId: request.sessionId || null,
      };

      const result = await SystemTableRPCWrapper.createGoalNotification(
        request.userId,
        request.type,
        request.title,
        request.message,
        metadata,
        request.priority || 'medium'
      );

      if (result.error) {
        console.error(`[NotificationCoordinator] Failed to create notification:`, result.error);
        return {
          success: false,
          error: result.error,
        };
      }

      this.recentNotifications.set(dedupeKey, Date.now());
      this.recordForRateLimit(request.userId);

      if (request.priority === 'high' || request.priority === 'critical') {
        await this.sendPushNotification(request);
      }

      console.log(`[NotificationCoordinator] Sent notification: ${request.type} to user ${request.userId}`);

      return {
        success: true,
        notificationId: result.id,
      };
    } catch (error) {
      console.error(`[NotificationCoordinator] Error sending notification:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async sendSystemNotification(request: NotificationRequest): Promise<NotificationResult> {
    const systemTypes: NotificationType[] = ['system_alert', 'wellness_check', 'mid_trade_alert', 'balance_update'];

    if (!systemTypes.includes(request.type)) {
      console.error(`[NotificationCoordinator] Invalid system notification type: ${request.type}`);
      return {
        success: false,
        error: `Only system notification types allowed: ${systemTypes.join(', ')}`,
      };
    }

    const dedupeKey = this.createDedupeKey(request);
    const dedupeWindowMs = request.dedupeWindowMs ?? this.DEFAULT_DEDUPE_WINDOW_MS;

    if (this.isDuplicate(dedupeKey, dedupeWindowMs)) {
      console.log(`[NotificationCoordinator] Deduplicated system notification: ${request.type} for user ${request.userId}`);
      return {
        success: true,
        deduplicated: true,
      };
    }

    if (this.isRateLimited(request.userId)) {
      console.warn(`[NotificationCoordinator] Rate limited: user ${request.userId}`);
      return {
        success: false,
        error: 'Rate limit exceeded',
      };
    }

    try {
      const { data, error } = await supabase.rpc('create_system_notification', {
        p_user_id: request.userId,
        p_type: request.type,
        p_title: request.title,
        p_message: request.message,
        p_metadata: request.metadata || {},
        p_priority: request.priority || 'medium',
        p_trade_id: request.tradeId || null,
        p_goal_session_id: request.sessionId || null,
      });

      if (error) {
        console.error(`[NotificationCoordinator] Failed to create system notification:`, error);
        return {
          success: false,
          error: error.message,
        };
      }

      this.recentNotifications.set(dedupeKey, Date.now());
      this.recordForRateLimit(request.userId);

      if (request.priority === 'high' || request.priority === 'critical') {
        await this.sendPushNotification(request);
      }

      console.log(`[NotificationCoordinator] Sent system notification: ${request.type} to user ${request.userId}`);

      return {
        success: true,
        notificationId: data as string,
      };
    } catch (error) {
      console.error(`[NotificationCoordinator] Error sending system notification:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async sendBatch(requests: NotificationRequest[]): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];

    for (const request of requests) {
      const result = await this.send(request);
      results.push(result);
    }

    return results;
  }

  private createDedupeKey(request: NotificationRequest): string {
    const parts = [request.userId, request.type];
    if (request.tradeId) parts.push(request.tradeId);
    if (request.sessionId) parts.push(request.sessionId);
    return parts.join('-');
  }

  private isDuplicate(dedupeKey: string, windowMs: number): boolean {
    const lastSent = this.recentNotifications.get(dedupeKey);
    if (!lastSent) return false;

    const isDupe = Date.now() - lastSent < windowMs;

    if (!isDupe) {
      this.recentNotifications.delete(dedupeKey);
    }

    return isDupe;
  }

  private isRateLimited(userId: string): boolean {
    const timestamps = this.userRateLimits.get(userId) || [];
    const now = Date.now();

    const recentTimestamps = timestamps.filter(t => now - t < this.RATE_LIMIT_WINDOW_MS);
    this.userRateLimits.set(userId, recentTimestamps);

    return recentTimestamps.length >= this.MAX_NOTIFICATIONS_PER_MINUTE;
  }

  private recordForRateLimit(userId: string): void {
    const timestamps = this.userRateLimits.get(userId) || [];
    timestamps.push(Date.now());
    this.userRateLimits.set(userId, timestamps);
  }

  // CCIP FIX (2026-02-27): The previous implementation inserted into push_notification_queue
  // but NO edge function, trigger, or worker ever reads from that table — every push
  // notification silently disappeared. This method now calls the send-push-notification
  // edge function directly, matching the same delivery path used by push-notification-dispatcher.
  // SSOT: request.title and request.message are already properly formatted by the caller
  // (e.g. "TP1 Hit: GBPUSD", "Stop Loss Hit: GBPUSD -$4.20"). No reformatting needed here.
  private async sendPushNotification(request: NotificationRequest): Promise<void> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const edgeFunctionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-push-notification`;

      const typeTagMap: Record<string, string> = {
        trade_opened: 'trade-entries',
        trade_closed: 'trade-closures',
        stop_loss_hit: 'trade-closures',
        take_profit_hit: 'trade-closures',
        goal_achieved: 'goal-achievements',
        goal_progress: 'goal-progress',
        session_ended: 'session-events',
        mid_trade_alert: `mid-trade-${request.tradeId || 'alert'}`,
      };

      const vibrateMap: Record<string, number[]> = {
        stop_loss_hit: [300, 100, 300, 100, 300],
        take_profit_hit: [100, 50, 150, 50, 200],
        goal_achieved: [100, 50, 100, 50, 100, 50, 100, 50, 100],
      };

      const payload = {
        title: request.title,
        body: request.message,
        icon: '/Pipnosis icon.png',
        badge: '/notification-badge.png',
        tag: typeTagMap[request.type] || 'pipnosis-alert',
        vibrate: vibrateMap[request.type] || [200, 100, 200],
        data: {
          type: request.type,
          priority: request.priority,
          ...(request.metadata || {}),
          tradeId: request.tradeId || null,
          sessionId: request.sessionId || null,
        },
      };

      await fetch(edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          user_id: request.userId,
          payload,
        }),
      });
    } catch (error) {
      console.error(`[NotificationCoordinator] Failed to send push notification:`, error);
    }
  }

  clearDedupeCache(): void {
    this.recentNotifications.clear();
  }

  clearRateLimits(): void {
    this.userRateLimits.clear();
  }

  async markAsRead(notificationId: string, userId: string): Promise<boolean> {
    const { error } = await supabase
      .from('goal_notifications')
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('id', notificationId)
      .eq('user_id', userId);

    return !error;
  }

  async markAllAsRead(userId: string): Promise<boolean> {
    const { error } = await supabase
      .from('goal_notifications')
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('read', false);

    return !error;
  }

  async getUnreadCount(userId: string): Promise<number> {
    const { count, error } = await supabase
      .from('goal_notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('read', false);

    if (error) return 0;
    return count || 0;
  }
}

export const notificationCoordinator = new NotificationCoordinator();

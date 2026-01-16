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
  | 'balance_update';

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
      const notificationData = {
        user_id: request.userId,
        type: request.type,
        title: request.title,
        message: request.message,
        metadata: request.metadata || {},
        priority: request.priority || 'medium',
        trade_id: request.tradeId || null,
        goal_session_id: request.sessionId || null,
        read: false,
        created_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('goal_notifications')
        .insert(notificationData)
        .select('id')
        .single();

      if (error) {
        console.error(`[NotificationCoordinator] Failed to create notification:`, error);
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

      console.log(`[NotificationCoordinator] Sent notification: ${request.type} to user ${request.userId}`);

      return {
        success: true,
        notificationId: data.id,
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

  private async sendPushNotification(request: NotificationRequest): Promise<void> {
    try {
      const { data: subscription } = await supabase
        .from('push_subscriptions')
        .select('*')
        .eq('user_id', request.userId)
        .eq('is_active', true)
        .maybeSingle();

      if (!subscription) return;

      await supabase.from('push_notification_queue').insert({
        user_id: request.userId,
        subscription_id: subscription.id,
        title: request.title,
        body: request.message,
        data: request.metadata,
        priority: request.priority,
        created_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`[NotificationCoordinator] Failed to queue push notification:`, error);
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

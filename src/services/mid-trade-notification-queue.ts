import TinyEmitter from 'tiny-emitter';
import { supabase } from '@/lib/supabase';

export interface MidTradeNotification {
  id: string;
  user_id: string;
  goal_session_id: string;
  type: 'mid_trade_trigger' | 'mid_trade_evaluation' | 'mid_trade_action';
  message: string;
  viewed: boolean;
  dismissed_at: string | null;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  trade_context: {
    trade_id: string;
    symbol: string;
    direction: 'buy' | 'sell';
    entry_price: number;
    current_price: number;
    stop_loss: number;
    take_profit: number;
    pnl: number;
    pnl_percentage: number;
    r_multiple: number;
    time_in_trade_minutes: number;
  };
  recommendation_data: {
    trigger_type: string;
    trigger_reason: string;
    llm_recommendation: string;
    llm_reasoning: string;
    action_taken: string;
    confidence: number;
  };
  trigger_type: string;
  created_at: string;
}

class MidTradeNotificationQueue extends TinyEmitter {
  private queue: MidTradeNotification[] = [];
  private isDisplaying: boolean = false;
  private currentNotification: MidTradeNotification | null = null;
  private unviewedCount: number = 0;

  constructor() {
    super();
  }

  addNotification(notification: MidTradeNotification) {
    this.queue.push(notification);

    if (!notification.viewed) {
      this.unviewedCount++;
      this.emit('badge-update', this.unviewedCount);
    }

    this.emit('notification-added', notification);

    if (!this.isDisplaying) {
      this.showNext();
    }
  }

  async showNext() {
    if (this.queue.length === 0) {
      this.isDisplaying = false;
      this.currentNotification = null;
      return;
    }

    this.isDisplaying = true;
    this.currentNotification = this.queue[0];

    this.emit('show-notification', {
      notification: this.currentNotification,
      position: 1,
      total: this.queue.length
    });
  }

  async dismissCurrent() {
    if (!this.currentNotification) return;

    const notificationId = this.currentNotification.id;

    await supabase
      .from('goal_notifications')
      .update({
        viewed: true,
        dismissed_at: new Date().toISOString()
      })
      .eq('id', notificationId);

    if (!this.currentNotification.viewed) {
      this.unviewedCount = Math.max(0, this.unviewedCount - 1);
      this.emit('badge-update', this.unviewedCount);
    }

    this.queue.shift();
    this.emit('notification-dismissed', notificationId);

    setTimeout(() => {
      this.showNext();
    }, 300);
  }

  getCurrentNotification(): MidTradeNotification | null {
    return this.currentNotification;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getUnviewedCount(): number {
    return this.unviewedCount;
  }

  async clearSessionNotifications(sessionId: string) {
    this.queue = this.queue.filter(n => n.goal_session_id !== sessionId);

    await supabase
      .from('goal_notifications')
      .delete()
      .eq('goal_session_id', sessionId)
      .in('type', ['mid_trade_trigger', 'mid_trade_evaluation', 'mid_trade_action']);

    this.unviewedCount = 0;
    this.emit('badge-update', 0);
    this.emit('session-cleared', sessionId);

    if (this.currentNotification?.goal_session_id === sessionId) {
      this.currentNotification = null;
      this.isDisplaying = false;
      this.emit('hide-notification');
    }
  }

  async loadUnviewedCount(userId: string) {
    const { data, error } = await supabase
      .from('goal_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('viewed', false)
      .in('type', ['mid_trade_trigger', 'mid_trade_evaluation', 'mid_trade_action']);

    if (!error && data) {
      this.unviewedCount = (data as any).count || 0;
      this.emit('badge-update', this.unviewedCount);
    }
  }

  async markAsViewed(notificationId: string) {
    await supabase
      .from('goal_notifications')
      .update({ viewed: true })
      .eq('id', notificationId);

    this.unviewedCount = Math.max(0, this.unviewedCount - 1);
    this.emit('badge-update', this.unviewedCount);
  }

  reset() {
    this.queue = [];
    this.isDisplaying = false;
    this.currentNotification = null;
    this.unviewedCount = 0;
    this.emit('badge-update', 0);
  }
}

export const midTradeNotificationQueue = new MidTradeNotificationQueue();

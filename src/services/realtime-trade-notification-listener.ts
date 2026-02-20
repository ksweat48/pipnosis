/**
 * Realtime Trade Notification Listener
 *
 * SSOT Authority: Listens for goal_notifications and triggers modal popups
 * Bridges server-side executions to browser UI
 *
 * CCIP Compliant (2026-02-04): Fixed double-modal issue by removing duplicate subscription
 *
 * Responsibilities:
 * - Subscribe to goal_notifications for trade-related events (SSOT)
 * - Trigger globalDialogManager modals for immediate user feedback
 * - Handle reconnection and error recovery
 *
 * SSOT Principle:
 * - goal_notifications is the single source of truth for UI updates
 * - No direct subscription to goal_session_trades to prevent duplicate modals
 * - NotificationCoordinator creates notifications which trigger this listener
 *
 * Principles:
 * - Realtime subscription provides immediate feedback
 * - Graceful degradation if realtime unavailable
 * - Non-blocking failures (logs but continues)
 * - Prevents duplicate modals via deduplication
 */

import { supabase } from '../lib/supabase';
import { globalDialogManager } from './global-dialog-manager';
import { RealtimeChannel } from '@supabase/supabase-js';

interface NotificationRecord {
  id: string;
  user_id: string;
  session_id: string;
  type: string;
  title: string;
  message: string;
  metadata: any;
}

class RealtimeTradeNotificationListener {
  private notificationChannel: RealtimeChannel | null = null;
  private recentNotifications = new Set<string>();
  private readonly DEDUPE_WINDOW_MS = 10000; // Increased from 5s to 10s for better safety
  private isInitialized = false;
  private currentUserId: string | null = null;

  /**
   * Initialize realtime listeners
   * Call this once on app mount or after user auth
   */
  async initialize(userId: string): Promise<void> {
    if (this.isInitialized && this.currentUserId === userId) {
      console.debug('[RealtimeTradeListener] Already initialized for user:', userId);
      return;
    }

    // Cleanup existing subscriptions
    await this.cleanup();

    this.currentUserId = userId;

    try {
      // SSOT FIX (2026-02-04): Subscribe ONLY to goal_notifications (not goal_session_trades)
      // This prevents duplicate modals by having a single source of truth
      this.notificationChannel = supabase
        .channel(`notifications_${userId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'goal_notifications',
            filter: `user_id=eq.${userId}`
          },
          (payload) => this.handleNotificationInsert(payload.new as NotificationRecord)
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('[RealtimeTradeListener] ✅ Subscribed to notification events (SSOT)');
          } else if (status === 'CHANNEL_ERROR') {
            console.error('[RealtimeTradeListener] ❌ Channel error');
          }
        });

      this.isInitialized = true;
      console.log('[RealtimeTradeListener] 🎯 Initialized for user:', userId);

    } catch (error) {
      console.error('[RealtimeTradeListener] ❌ Initialization failed:', error);
      // Non-blocking - app continues without realtime modals
    }
  }

  /**
   * Handle notification insertion (SSOT for modal triggers)
   * Triggers appropriate modal based on notification type
   *
   * SSOT FIX (2026-02-04): This is now the ONLY path for triggering trade modals
   * No direct trade subscription exists, preventing duplicate modals
   */
  private async handleNotificationInsert(notification: NotificationRecord): Promise<void> {
    try {
      // Deduplication: Create composite key from notification ID + type
      const dedupeKey = `${notification.id}-${notification.type}`;

      if (this.recentNotifications.has(dedupeKey)) {
        console.debug('[RealtimeTradeListener] Skipping duplicate notification:', dedupeKey);
        return;
      }

      // Add to dedupe set with auto-cleanup
      this.recentNotifications.add(dedupeKey);
      setTimeout(() => this.recentNotifications.delete(dedupeKey), this.DEDUPE_WINDOW_MS);

      console.log('[RealtimeTradeListener] 📢 New notification:', notification.type);

      switch (notification.type) {
        case 'trade_opened':
          // SSOT FIX (2026-02-14): Skip database persist - notification already exists
          // This realtime event IS the notification insert, so skipPersist prevents circular insert
          // The notificationCoordinator already created the goal_notifications record
          if (notification.metadata?.tradeId) {
            globalDialogManager.showTradeEntry({
              tradeId: notification.metadata.tradeId,
              sessionId: notification.metadata.sessionId || notification.session_id,
              symbol: notification.metadata.symbol,
              direction: notification.metadata.action === 'BUY' ? 'buy' : 'sell',
              action: notification.metadata.action,
              lotSize: notification.metadata.lotSize,
              entryPrice: notification.metadata.entryPrice,
              stopLoss: notification.metadata.stopLoss,
              takeProfit: notification.metadata.takeProfit,
              expectedProfit: notification.metadata.expectedProfit,
              reasoning: notification.message,
              confidence: notification.metadata.confidence || undefined,
              setupType: notification.metadata.thesis || undefined,
              tp1: notification.metadata.tp1Price || undefined,
              tp2: notification.metadata.tp2Price || undefined,
              tp1Confidence: notification.metadata.tp1Confidence || undefined,
              autoExecuted: true
            }, 'critical', { skipPersist: true }); // SSOT: Notification record already exists
          }
          break;

        case 'trade_closed':
        case 'stop_loss_hit':
        case 'take_profit_hit':
          globalDialogManager.showTradeClosed({
            tradeId: notification.metadata?.tradeId,
            symbol: notification.metadata?.symbol,
            closeReason: notification.type,
            pnl: notification.metadata?.pnl,
            title: notification.title,
            message: notification.message
          }, { skipPersist: true }); // SSOT: Notification record already exists
          break;

        case 'tp1_hit':
          // Show TP1 milestone notification
          globalDialogManager.showTradeSignal({
            type: 'tp1_milestone',
            symbol: notification.metadata?.symbol,
            title: notification.title,
            message: notification.message,
            tradeId: notification.metadata?.tradeId
          }, 'high', { skipPersist: true }); // SSOT: Notification record already exists
          break;

        // Add more notification types as needed
      }

    } catch (error) {
      console.error('[RealtimeTradeListener] ⚠️ Failed to handle notification insert:', error);
      // Non-blocking
    }
  }

  /**
   * Cleanup subscriptions
   * Call before unmount or user logout
   */
  async cleanup(): Promise<void> {
    try {
      if (this.notificationChannel) {
        await supabase.removeChannel(this.notificationChannel);
        this.notificationChannel = null;
      }

      this.recentNotifications.clear();
      this.isInitialized = false;
      this.currentUserId = null;

      console.log('[RealtimeTradeListener] 🧹 Cleaned up subscriptions');
    } catch (error) {
      console.error('[RealtimeTradeListener] ⚠️ Cleanup error:', error);
    }
  }

  /**
   * Check if listener is active
   */
  isActive(): boolean {
    return this.isInitialized && this.currentUserId !== null;
  }
}

// Singleton instance
export const realtimeTradeNotificationListener = new RealtimeTradeNotificationListener();

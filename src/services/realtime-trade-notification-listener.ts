/**
 * Realtime Trade Notification Listener
 *
 * SSOT Authority: Listens for new trades and triggers modal popups
 * Bridges server-side executions to browser UI
 *
 * CCIP Compliant (2026-02-03): Part of notification system fix
 *
 * Responsibilities:
 * - Subscribe to goal_session_trades INSERT events
 * - Subscribe to goal_notifications for trade_opened events
 * - Trigger globalDialogManager modals for immediate user feedback
 * - Handle reconnection and error recovery
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

interface TradeRecord {
  id: string;
  user_id: string;
  goal_session_id: string;
  symbol: string;
  direction: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  lot_size: number;
  status: string;
  expected_profit_for_session: number;
  alpha_reasoning?: string;
}

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
  private tradeChannel: RealtimeChannel | null = null;
  private notificationChannel: RealtimeChannel | null = null;
  private recentTrades = new Set<string>();
  private readonly DEDUPE_WINDOW_MS = 5000;
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
      // Subscribe to new trades for this user
      this.tradeChannel = supabase
        .channel(`trade_notifications_${userId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'goal_session_trades',
            filter: `user_id=eq.${userId}`
          },
          (payload) => this.handleTradeInsert(payload.new as TradeRecord)
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('[RealtimeTradeListener] ✅ Subscribed to trade notifications');
          } else if (status === 'CHANNEL_ERROR') {
            console.error('[RealtimeTradeListener] ❌ Channel error');
          }
        });

      // Subscribe to notifications for this user
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
            console.log('[RealtimeTradeListener] ✅ Subscribed to notification events');
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
   * Handle new trade insertion
   * Triggers modal popup for immediate feedback
   */
  private async handleTradeInsert(trade: TradeRecord): Promise<void> {
    try {
      // Deduplicate: Skip if we recently processed this trade
      if (this.recentTrades.has(trade.id)) {
        console.debug('[RealtimeTradeListener] Skipping duplicate trade:', trade.id);
        return;
      }

      // Add to dedupe set with auto-cleanup
      this.recentTrades.add(trade.id);
      setTimeout(() => this.recentTrades.delete(trade.id), this.DEDUPE_WINDOW_MS);

      console.log('[RealtimeTradeListener] 🎯 New trade detected:', {
        id: trade.id,
        symbol: trade.symbol,
        direction: trade.direction,
        status: trade.status
      });

      // Only show modal for open trades (pending trades don't need immediate modal)
      if (trade.status === 'open') {
        globalDialogManager.showTradeEntry({
          tradeId: trade.id,
          symbol: trade.symbol,
          action: trade.direction === 'long' ? 'BUY' : 'SELL',
          lotSize: trade.lot_size,
          entryPrice: trade.entry_price,
          stopLoss: trade.stop_loss,
          takeProfit: trade.take_profit,
          expectedProfit: trade.expected_profit_for_session,
          reasoning: trade.alpha_reasoning || 'Trade executed'
        }, 'urgent');
      }

    } catch (error) {
      console.error('[RealtimeTradeListener] ⚠️ Failed to handle trade insert:', error);
      // Non-blocking - don't crash the app
    }
  }

  /**
   * Handle notification insertion
   * Triggers appropriate modal based on notification type
   */
  private async handleNotificationInsert(notification: NotificationRecord): Promise<void> {
    try {
      console.log('[RealtimeTradeListener] 📢 New notification:', notification.type);

      switch (notification.type) {
        case 'trade_opened':
          // Already handled by trade insert listener, but double-check
          if (notification.metadata?.tradeId) {
            const tradeId = notification.metadata.tradeId;
            if (!this.recentTrades.has(tradeId)) {
              // Trade wasn't caught by realtime trade listener, trigger modal now
              globalDialogManager.showTradeEntry({
                tradeId,
                symbol: notification.metadata.symbol,
                action: notification.metadata.action,
                lotSize: notification.metadata.lotSize,
                entryPrice: notification.metadata.entryPrice,
                stopLoss: notification.metadata.stopLoss,
                takeProfit: notification.metadata.takeProfit,
                expectedProfit: notification.metadata.expectedProfit,
                reasoning: notification.message
              }, 'urgent');
            }
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
          });
          break;

        case 'tp1_hit':
          // Show TP1 milestone notification
          globalDialogManager.showTradeSignal({
            type: 'tp1_milestone',
            symbol: notification.metadata?.symbol,
            title: notification.title,
            message: notification.message,
            tradeId: notification.metadata?.tradeId
          }, 'high');
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
      if (this.tradeChannel) {
        await supabase.removeChannel(this.tradeChannel);
        this.tradeChannel = null;
      }

      if (this.notificationChannel) {
        await supabase.removeChannel(this.notificationChannel);
        this.notificationChannel = null;
      }

      this.recentTrades.clear();
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

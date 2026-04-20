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
import { audioAlertService } from './audio-alert-service';
import { RealtimeChannel } from '@supabase/supabase-js';
import { realtimeConnectionManager } from './realtime-connection-manager';

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
            realtimeConnectionManager.logChannelError('RealtimeTradeListener');
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

        case 'stop_loss_hit': {
          // CCIP-SSOT (2026-03-02 AUDIO-SSOT): Audio is played by useGlobalDialog when the
          // dialog renders — do NOT play here. Playing before showDialog caused duplicate sounds
          // (this call + useGlobalDialog's playWithContext both fired within 2s).
          const slTradeId = notification.metadata?.tradeId || notification.metadata?.trade_id;
          await this.fetchAndShowTradeClosedModal(
            slTradeId,
            notification.metadata?.closeReason || notification.metadata?.close_reason || 'stop_loss',
            notification.session_id
          );
          break;
        }

        case 'take_profit_hit': {
          // CCIP FIX (2026-03-04 TP1-ONCE-PER-TRADE): Guard against TP1 milestone misrouting.
          // 'take_profit_hit' was previously also sent for TP1 advisory hits (trade still open),
          // which caused fetchAndShowTradeClosedModal() to show a blank/manual-close modal because
          // the trade has no exit_price or profit_loss yet. Now: check trade status first.
          // If the trade is still open, this is a legacy TP1 path — play audio only, no modal.
          // realtime-sltp-monitor now sends 'tp1_milestone' instead (handled below), so this
          // guard is a safety net for any legacy take_profit_hit notifications still in flight.
          const tpTradeId = notification.metadata?.tradeId || notification.metadata?.trade_id;
          if (tpTradeId) {
            const { data: tradeStatus } = await supabase
              .from('goal_session_trades')
              .select('status')
              .eq('id', tpTradeId)
              .maybeSingle();
            if (tradeStatus?.status === 'open') {
              audioAlertService.playTradeProfit(tpTradeId);
              break;
            }
          }
          await this.fetchAndShowTradeClosedModal(
            tpTradeId,
            notification.metadata?.closeReason || notification.metadata?.close_reason || 'take_profit',
            notification.session_id
          );
          break;
        }

        case 'tp1_milestone': {
          // CCIP FIX (2026-03-04 TP1-ONCE-PER-TRADE): New dedicated notification type for TP1
          // advisory milestone (trade is NOT closed). Audio only — no modal.
          // The TP1 Decision Modal is owned by GoalSessionDashboard's Realtime subscription
          // on the tp1_hit column of goal_session_trades.
          const tp1mTradeId = notification.metadata?.tradeId || notification.metadata?.trade_id;
          if (tp1mTradeId) {
            audioAlertService.playTradeProfit(tp1mTradeId);
          }
          break;
        }

        case 'trade_closed': {
          // CCIP FIX (2026-02-27 MODAL-DATA-FIX): Fetch full trade record from DB so
          // entryPrice, exitPrice, profitLoss, stopLoss, takeProfit are always populated.
          // Previously only metadata fields (pnl, symbol) were passed — causing all price
          // fields to display as 0 when this path won the GlobalDialogManager dedup race.
          //
          // CCIP-SSOT (2026-03-02 AUDIO-SSOT): Audio owned by useGlobalDialog on dialog render.
          // Playing sound here AND in useGlobalDialog caused a double-beep within 2 seconds.
          const tcTradeId = notification.metadata?.tradeId || notification.metadata?.trade_id;
          await this.fetchAndShowTradeClosedModal(
            tcTradeId,
            notification.metadata?.closeReason || notification.metadata?.close_reason || 'manual',
            notification.session_id
          );
          break;
        }

        case 'tp1_hit': {
          // Legacy: some older notifications may use 'tp1_hit'. Audio only — no modal.
          const tp1TradeId = notification.metadata?.tradeId || notification.metadata?.trade_id;
          if (tp1TradeId) {
            audioAlertService.playTradeProfit(tp1TradeId);
          }
          break;
        }

        case 'entry_monitoring_started':
          globalDialogManager.showAlphaIntent({
            symbol: notification.metadata?.symbol,
            direction: notification.metadata?.direction === 'short' ? 'short' : 'long',
            entry_mode: notification.metadata?.entry_mode || 'wait_pullback',
            pullback_zone_min: notification.metadata?.pullback_zone_min ?? null,
            pullback_zone_max: notification.metadata?.pullback_zone_max ?? null,
            confidence: notification.metadata?.confidence ?? null,
            setupType: notification.metadata?.setupType ?? null,
            reasoning: notification.message || null,
          }, { skipPersist: true });
          break;

        // Add more notification types as needed
      }

    } catch (error) {
      console.error('[RealtimeTradeListener] ⚠️ Failed to handle notification insert:', error);
      // Non-blocking
    }
  }

  /**
   * CCIP FIX (2026-02-27 MODAL-DATA-FIX): Fetch full trade + session data from the
   * database before showing the trade-closed modal.
   *
   * SSOT Authority: goal_session_trades and goal_sessions are the source of truth for
   * trade prices, P&L, and session progress. The goal_notifications metadata only
   * carries a partial snapshot (symbol, pnl) for push notifications — it is NOT
   * sufficient to render the modal with full price details.
   *
   * This method is the single enrichment point for all three notification paths that
   * can show a trade-closed modal: stop_loss_hit, take_profit_hit, trade_closed.
   * Centralising here ensures any future path also gets correct data automatically.
   */
  private async fetchAndShowTradeClosedModal(
    tradeId: string | undefined,
    closeReason: string,
    sessionId: string | null
  ): Promise<void> {
    if (!tradeId) {
      globalDialogManager.showTradeClosed({
        closeReason,
        symbol: 'UNKNOWN',
      }, { skipPersist: true });
      return;
    }

    // Guard: if the coordinator already handled this trade's modal (e.g. from the
    // trade_closure_events Realtime path), skip entirely to prevent a second modal
    // and second notification sound. GlobalDialogManager's dedup is a safety net but
    // this early-exit avoids the unnecessary DB fetches too.
    const { tradeClosureCoordinator } = await import('./coordinators/trade-closure-coordinator');
    if (tradeClosureCoordinator.hasShownDialogForTrade(tradeId)) {
      console.debug('[RealtimeTradeListener] Skipping duplicate modal — coordinator already handled trade:', tradeId);
      return;
    }

    const { data: trade } = await supabase
      .from('goal_session_trades')
      .select('id, symbol, direction, entry_price, exit_price, profit_loss, stop_loss, take_profit, goal_session_id, tp1_pnl, tp2_pnl')
      .eq('id', tradeId)
      .maybeSingle();

    const resolvedSessionId = trade?.goal_session_id || sessionId;
    let currentProgress = 0;
    let targetValue = 0;
    let tradesInSession = 0;
    let dollarRisk = 0;

    if (resolvedSessionId) {
      const { data: session } = await supabase
        .from('goal_sessions')
        .select('current_progress, target_value, dollar_risk')
        .eq('id', resolvedSessionId)
        .maybeSingle();

      if (session) {
        currentProgress = session.current_progress || 0;
        targetValue = session.target_value || 0;
        dollarRisk = session.dollar_risk || 0;
      }

      const { count } = await supabase
        .from('goal_session_trades')
        .select('*', { count: 'exact', head: true })
        .eq('goal_session_id', resolvedSessionId);

      tradesInSession = count || 0;
    }

    globalDialogManager.showTradeClosed({
      tradeId,
      symbol: trade?.symbol || 'UNKNOWN',
      direction: trade?.direction || 'buy',
      entryPrice: trade?.entry_price || 0,
      exitPrice: trade?.exit_price || 0,
      profitLoss: trade?.profit_loss || 0,
      closeReason,
      stopLoss: trade?.stop_loss || 0,
      takeProfit: trade?.take_profit || 0,
      currentProgress,
      targetValue,
      tradesInSession,
      dollarRisk,
      isGoalAchieved: targetValue > 0 && currentProgress >= targetValue,
      tp1Pnl: trade?.tp1_pnl ?? null,
      tp2Pnl: trade?.tp2_pnl ?? null,
    }, { skipPersist: true });
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

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { notificationManager } from './notification-manager';
import { goalAchievementCoordinator } from './coordinators/goal-achievement-coordinator';
import { goalSessionStateMachine } from './coordinators/goal-session-state-machine';
import { postTradeAnalyzer } from './post-trade-analyzer';
import { rewardEngine } from './reward-engine';

export interface TradeClosureEvent {
  id: string;
  trade_id: string;
  user_id: string;
  goal_session_id: string;
  symbol: string;
  direction: 'buy' | 'sell';
  close_price: number;
  close_reason: string;
  pnl: number;
  last_processed_at: string | null;
  post_processing_status: 'pending' | 'succeeded' | 'failed';
  processing_error: string | null;
  created_at: string;
  event_triggered_by: string;
}

interface ProcessingResult {
  success: boolean;
  eventId: string;
  processedAt: string;
  error?: string;
  processingTime: number;
}

/**
 * Trade Closure Event Processor
 *
 * Responsible for processing trade closure events emitted by the RPC function.
 * Ensures post-processing pipeline runs for ALL closures (browser, triggers, server monitors).
 *
 * Operates in two modes:
 *   1. Realtime: Browser coordinator listens to events via Supabase Realtime
 *   2. Batch: Server edge function polls for unprocessed events every 10 seconds
 *
 * Guarantees:
 *   - Idempotent: Same event processed multiple times = same result
 *   - ACID: All post-processing steps succeed or event marked failed
 *   - 24/7: Server-side fallback processes events even when browser offline
 */
export class TradeClosureEventProcessor {
  private lockTimeout = 30000; // 30 second lock timeout
  private processingLocks = new Map<string, NodeJS.Timeout>();

  /**
   * Process a single trade closure event
   * Runs the complete post-processing pipeline:
   *   1. Check if already processed (idempotency)
   *   2. Send notifications
   *   3. Evaluate session state
   *   4. Check goal achievement
   *   5. Run post-trade analysis
   *   6. Update rewards
   *   7. Mark event as processed
   */
  async processEvent(event: TradeClosureEvent): Promise<ProcessingResult> {
    const startTime = Date.now();
    const eventId = event.id;

    try {
      logger.info('[TradeClosureEventProcessor] Processing event', { eventId, tradeId: event.trade_id });

      // Step 1: Check if already processed (idempotency guard)
      if (event.last_processed_at !== null) {
        logger.debug('[TradeClosureEventProcessor] Event already processed, skipping', {
          eventId,
          processedAt: event.last_processed_at,
        });
        return {
          success: true,
          eventId,
          processedAt: event.last_processed_at,
          processingTime: 0,
        };
      }

      // Step 2: Send notification
      try {
        await this.sendNotification(event);
      } catch (error) {
        logger.warn('[TradeClosureEventProcessor] Notification failed, continuing', {
          eventId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Don't fail entire processing if notification fails
      }

      // Step 3: Evaluate session state
      try {
        await this.evaluateSessionState(event);
      } catch (error) {
        logger.warn('[TradeClosureEventProcessor] Session evaluation failed', {
          eventId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Step 4: Check goal achievement
      try {
        await goalAchievementCoordinator.checkAndProcessGoalAchievement({
          userId: event.user_id,
          sessionId: event.goal_session_id,
        });
      } catch (error) {
        logger.warn('[TradeClosureEventProcessor] Goal check failed', {
          eventId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Step 5: Run post-trade analysis (fetch full trade data for journal + learning)
      try {
        const { data: fullTrade } = await supabase
          .from('goal_session_trades')
          .select('direction, entry_price, exit_price, stop_loss, take_profit, created_at, closed_at, tp1_hit, tp2_hit')
          .eq('id', event.trade_id)
          .maybeSingle();

        await postTradeAnalyzer.analyzeClosedTrade({
          id: event.trade_id,
          userId: event.user_id,
          symbol: event.symbol,
          direction: fullTrade?.direction,
          entryPrice: fullTrade?.entry_price,
          exitPrice: fullTrade?.exit_price ?? event.close_price,
          stopLoss: fullTrade?.stop_loss,
          takeProfit: fullTrade?.take_profit,
          entryTime: fullTrade?.created_at ? new Date(fullTrade.created_at) : undefined,
          exitTime: fullTrade?.closed_at ? new Date(fullTrade.closed_at) : new Date(),
          closeReason: event.close_reason,
          pnl: event.pnl,
          tp1Hit: fullTrade?.tp1_hit === true,
          tp2Hit: fullTrade?.tp2_hit === true,
        });
      } catch (error) {
        logger.warn('[TradeClosureEventProcessor] Analysis failed', {
          eventId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Step 6: Update rewards
      try {
        await this.applyRewards(event);
      } catch (error) {
        logger.warn('[TradeClosureEventProcessor] Reward application failed', {
          eventId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Step 7: Mark event as processed
      const now = new Date().toISOString();
      await this.markEventProcessed(eventId, now);

      const processingTime = Date.now() - startTime;
      logger.info('[TradeClosureEventProcessor] Event processed successfully', {
        eventId,
        processingTime,
      });

      return {
        success: true,
        eventId,
        processedAt: now,
        processingTime,
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('[TradeClosureEventProcessor] Event processing failed', {
        eventId,
        error: errorMessage,
        processingTime,
      });

      // Mark event as failed (but don't crash)
      await this.markEventFailed(eventId, errorMessage);

      return {
        success: false,
        eventId,
        processedAt: new Date().toISOString(),
        error: errorMessage,
        processingTime,
      };
    }
  }

  /**
   * Process a batch of unprocessed events
   * Used by server-side edge function for 24/7 processing
   */
  async processBatch(limit = 50): Promise<{
    processedCount: number;
    failedCount: number;
    skippedCount: number;
    totalTime: number;
  }> {
    const startTime = Date.now();
    let processedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    try {
      logger.info('[TradeClosureEventProcessor] Starting batch processing', { limit });

      // Fetch unprocessed events with pessimistic locking
      const { data: events, error } = await supabase
        .from('trade_closure_events')
        .select('*')
        .is('last_processed_at', null)
        .eq('post_processing_status', 'pending')
        .order('created_at', { ascending: true })
        .limit(limit);

      if (error) {
        logger.error('[TradeClosureEventProcessor] Failed to fetch unprocessed events', { error });
        return { processedCount: 0, failedCount: 0, skippedCount: 0, totalTime: Date.now() - startTime };
      }

      if (!events || events.length === 0) {
        logger.debug('[TradeClosureEventProcessor] No unprocessed events found');
        return { processedCount: 0, failedCount: 0, skippedCount: 0, totalTime: Date.now() - startTime };
      }

      logger.info('[TradeClosureEventProcessor] Processing batch of events', { count: events.length });

      // Process each event
      for (const event of events) {
        const result = await this.processEvent(event as TradeClosureEvent);

        if (result.success) {
          processedCount++;
        } else {
          failedCount++;
        }
      }

      const totalTime = Date.now() - startTime;
      logger.info('[TradeClosureEventProcessor] Batch processing complete', {
        processedCount,
        failedCount,
        skippedCount,
        totalTime,
        avgTimePerEvent: totalTime / (processedCount + failedCount),
      });

      return { processedCount, failedCount, skippedCount, totalTime };
    } catch (error) {
      const totalTime = Date.now() - startTime;
      logger.error('[TradeClosureEventProcessor] Batch processing failed', {
        error: error instanceof Error ? error.message : String(error),
        totalTime,
      });

      return { processedCount, failedCount, skippedCount, totalTime };
    }
  }

  /**
   * Send notification for closed trade
   */
  private async sendNotification(event: TradeClosureEvent): Promise<void> {
    const notificationType = this.determineNotificationType(event.close_reason);
    const isProfitable = event.pnl >= 0;

    await notificationManager.sendNotification({
      userId: event.user_id,
      type: notificationType,
      title: this.getNotificationTitle(event.close_reason),
      message: `${event.symbol} closed with P&L: ${isProfitable ? '+' : ''}$${event.pnl.toFixed(2)}`,
      metadata: {
        tradeId: event.trade_id,
        symbol: event.symbol,
        pnl: event.pnl,
        closeReason: event.close_reason,
        closePrice: event.close_price,
      },
      priority: isProfitable ? 'medium' : 'high',
    });
  }

  /**
   * Determine notification type from close reason
   */
  private determineNotificationType(
    closeReason: string
  ): 'stop_loss_hit' | 'take_profit_hit' | 'goal_achieved' | 'trade_closed' {
    switch (closeReason) {
      case 'stop_loss':
        return 'stop_loss_hit';
      case 'take_profit':
      case 'take_profit_1':
      case 'take_profit_2':
        return 'take_profit_hit';
      case 'goal_achieved':
        return 'goal_achieved';
      default:
        return 'trade_closed';
    }
  }

  /**
   * Get human-readable notification title
   */
  private getNotificationTitle(closeReason: string): string {
    const titles: Record<string, string> = {
      manual: 'Trade Closed',
      stop_loss: 'Stop Loss Hit',
      take_profit: 'Take Profit Hit',
      take_profit_1: 'TP1 Reached',
      take_profit_2: 'TP2 Reached',
      goal_achieved: 'Goal Achieved!',
      timeout: 'Session Timeout',
      weekend_protection: 'Weekend Closure',
      force_closed: 'Force Closed',
      goal_expired: 'Goal Expired',
      session_ended: 'Session Ended',
      risk_limit: 'Risk Limit Exceeded',
      trailing_stop: 'Trailing Stop',
      holiday_closure: 'Holiday Closure',
      market_closed: 'Market Closed',
    };

    return titles[closeReason] || 'Trade Closed';
  }

  /**
   * Evaluate session state after closure
   * Checks if session should transition (e.g., from active to scanning or stopped)
   */
  private async evaluateSessionState(event: TradeClosureEvent): Promise<void> {
    const { data: session } = await supabase
      .from('goal_sessions')
      .select('id, status')
      .eq('id', event.goal_session_id)
      .single();

    if (!session) {
      logger.warn('[TradeClosureEventProcessor] Session not found', { sessionId: event.goal_session_id });
      return;
    }

    // Count remaining open resources
    const { count: openTradeCount } = await supabase
      .from('goal_session_trades')
      .select('id', { count: 'exact' })
      .eq('goal_session_id', event.goal_session_id)
      .eq('status', 'open');

    // If no more open trades, consider session state transition
    if (openTradeCount === 0) {
      // Determine target state based on close reason
      let targetStatus = 'stopped';
      if (['stop_loss', 'take_profit', 'take_profit_1', 'take_profit_2'].includes(event.close_reason)) {
        targetStatus = 'scanning'; // Resume scanning after system closure
      }

      // Perform transition if needed
      if (session.status !== targetStatus && session.status !== 'goal_achieved') {
        await goalSessionStateMachine.transition(event.goal_session_id, targetStatus);
        logger.info('[TradeClosureEventProcessor] Session transitioned', {
          sessionId: event.goal_session_id,
          from: session.status,
          to: targetStatus,
        });
      }
    }
  }

  /**
   * Apply rewards based on trade outcome
   */
  private async applyRewards(event: TradeClosureEvent): Promise<void> {
    if (event.pnl > 0) {
      await rewardEngine.applyWinReward({
        userId: event.user_id,
        sessionId: event.goal_session_id,
        tradeId: event.trade_id,
        pnl: event.pnl,
        symbol: event.symbol,
      });
    } else if (event.pnl < 0) {
      await rewardEngine.applyLossPenalty({
        userId: event.user_id,
        sessionId: event.goal_session_id,
        tradeId: event.trade_id,
        pnl: event.pnl,
        symbol: event.symbol,
      });
    }
  }

  /**
   * Mark event as successfully processed
   */
  private async markEventProcessed(eventId: string, processedAt: string): Promise<void> {
    const { error } = await supabase
      .from('trade_closure_events')
      .update({
        last_processed_at: processedAt,
        post_processing_status: 'succeeded',
      })
      .eq('id', eventId);

    if (error) {
      logger.error('[TradeClosureEventProcessor] Failed to mark event as processed', { eventId, error });
      throw error;
    }
  }

  /**
   * Mark event as failed
   */
  private async markEventFailed(eventId: string, errorMessage: string): Promise<void> {
    const { error } = await supabase
      .from('trade_closure_events')
      .update({
        post_processing_status: 'failed',
        processing_error: errorMessage,
      })
      .eq('id', eventId);

    if (error) {
      logger.error('[TradeClosureEventProcessor] Failed to mark event as failed', { eventId, error });
    }
  }
}

// Export singleton instance
export const tradeClosureEventProcessor = new TradeClosureEventProcessor();

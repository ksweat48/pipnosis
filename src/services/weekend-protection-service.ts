/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Weekend Protection Service
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Automatically closes all open positions before Friday market close to prevent
 * weekend gap risk exposure.
 *
 * CRITICAL RULES:
 * - Forex market closes Friday 5:00 PM EST
 * - All positions MUST be closed by Friday 3:00 PM EST (2-hour buffer)
 * - Warning notifications start at Friday 12:00 PM EST
 * - No new trades allowed after Friday 2:00 PM EST
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { supabase } from '@/lib/supabase';
import { logger, LogCategory } from '@/lib/logger';
import { globalToastManager } from './global-toast-manager';
import { notificationManager } from './notification-manager';

interface WeekendStatus {
  isWeekend: boolean;
  isFriday: boolean;
  hoursUntilClose: number;
  minutesUntilClose: number;
  shouldClosePositions: boolean;
  shouldPreventNewTrades: boolean;
  shouldWarnUser: boolean;
  marketClosesAt: Date;
  autoCloseAt: Date;
  warningStartsAt: Date;
  tradeBlockStartsAt: Date;
}

interface WeekendClosureEvent {
  userId: string;
  sessionId: string;
  positionId: string;
  symbol: string;
  closePrice: number;
  pnl: number;
  reason: string;
  closedAt: Date;
}

class WeekendProtectionService {
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes
  private readonly MARKET_CLOSE_HOUR_EST = 17; // 5:00 PM
  private readonly AUTO_CLOSE_BUFFER_HOURS = 2; // Close 2 hours before market close
  private readonly WARNING_START_HOURS = 5; // Start warnings 5 hours before auto-close
  private readonly TRADE_BLOCK_HOURS = 3; // Block new trades 3 hours before market close

  private lastWarningTime: Date | null = null;
  private hasClosedPositionsToday = false;
  private warningsSent = new Set<string>();

  start(): void {
    if (this.checkInterval) {
      logger.debug(LogCategory.POSITION_MONITOR, '⚠️ Weekend protection already running');
      return;
    }

    logger.info(LogCategory.POSITION_MONITOR, '🛡️ Starting weekend protection service');

    // Run immediately and then every 5 minutes
    this.checkWeekendProtection();
    this.checkInterval = setInterval(() => {
      this.checkWeekendProtection();
    }, this.CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info(LogCategory.POSITION_MONITOR, '🛡️ Weekend protection service stopped');
    }
  }

  getWeekendStatus(): WeekendStatus {
    const now = new Date();
    const estNow = this.toEST(now);

    const dayOfWeek = estNow.getDay(); // 0 = Sunday, 5 = Friday, 6 = Saturday
    const currentHour = estNow.getHours();
    const currentMinute = estNow.getMinutes();

    // Check if it's currently the weekend
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isFriday = dayOfWeek === 5;

    // Calculate when market closes this week (Friday 5 PM EST)
    const marketClosesAt = new Date(estNow);
    if (dayOfWeek <= 5) {
      // Move to Friday
      marketClosesAt.setDate(estNow.getDate() + (5 - dayOfWeek));
    } else {
      // Already weekend, market closes next Friday
      marketClosesAt.setDate(estNow.getDate() + (5 + 7 - dayOfWeek));
    }
    marketClosesAt.setHours(this.MARKET_CLOSE_HOUR_EST, 0, 0, 0);

    // Calculate auto-close time (2 hours before market close)
    const autoCloseAt = new Date(marketClosesAt);
    autoCloseAt.setHours(autoCloseAt.getHours() - this.AUTO_CLOSE_BUFFER_HOURS);

    // Calculate warning start time (5 hours before auto-close)
    const warningStartsAt = new Date(autoCloseAt);
    warningStartsAt.setHours(warningStartsAt.getHours() - this.WARNING_START_HOURS);

    // Calculate trade block time (3 hours before market close)
    const tradeBlockStartsAt = new Date(marketClosesAt);
    tradeBlockStartsAt.setHours(tradeBlockStartsAt.getHours() - this.TRADE_BLOCK_HOURS);

    // Calculate time until close
    const msUntilClose = marketClosesAt.getTime() - estNow.getTime();
    const hoursUntilClose = msUntilClose / (1000 * 60 * 60);
    const minutesUntilClose = msUntilClose / (1000 * 60);

    // Determine actions needed
    const shouldClosePositions = isFriday && estNow >= autoCloseAt && estNow < marketClosesAt;
    const shouldPreventNewTrades = isFriday && estNow >= tradeBlockStartsAt && estNow < marketClosesAt;
    const shouldWarnUser = isFriday && estNow >= warningStartsAt && estNow < autoCloseAt;

    return {
      isWeekend,
      isFriday,
      hoursUntilClose,
      minutesUntilClose,
      shouldClosePositions,
      shouldPreventNewTrades,
      shouldWarnUser,
      marketClosesAt,
      autoCloseAt,
      warningStartsAt,
      tradeBlockStartsAt
    };
  }

  canOpenNewTrade(): { allowed: boolean; reason?: string } {
    const status = this.getWeekendStatus();

    if (status.isWeekend) {
      return {
        allowed: false,
        reason: 'Market is closed for the weekend. Trading resumes Sunday 5:00 PM EST.'
      };
    }

    if (status.shouldPreventNewTrades) {
      const hoursUntil = Math.floor(status.hoursUntilClose);
      const minutesUntil = Math.floor(status.minutesUntilClose % 60);
      return {
        allowed: false,
        reason: `Too close to weekend market close (${hoursUntil}h ${minutesUntil}m remaining). No new trades allowed to prevent weekend gap risk.`
      };
    }

    return { allowed: true };
  }

  private async checkWeekendProtection(): Promise<void> {
    try {
      const status = this.getWeekendStatus();

      // Reset daily flags at start of new week
      if (!status.isFriday && !status.isWeekend) {
        this.hasClosedPositionsToday = false;
        this.lastWarningTime = null;
        this.warningsSent.clear();
      }

      // Log current status
      if (status.isFriday) {
        logger.debug(
          LogCategory.POSITION_MONITOR,
          `🛡️ Weekend protection active - ${Math.floor(status.hoursUntilClose)}h ${Math.floor(status.minutesUntilClose % 60)}m until market close`
        );
      }

      // Send warnings
      if (status.shouldWarnUser) {
        await this.sendWarnings(status);
      }

      // Auto-close positions
      if (status.shouldClosePositions && !this.hasClosedPositionsToday) {
        await this.closeAllPositions(status);
        this.hasClosedPositionsToday = true;
      }

    } catch (error) {
      logger.error(LogCategory.POSITION_MONITOR, '❌ Error in weekend protection check', error);
    }
  }

  private async sendWarnings(status: WeekendStatus): Promise<void> {
    const hoursUntilAutoClose = (status.autoCloseAt.getTime() - this.toEST(new Date()).getTime()) / (1000 * 60 * 60);

    // Send warning every hour
    const currentHour = Math.floor(hoursUntilAutoClose);
    const warningKey = `hour_${currentHour}`;

    if (this.warningsSent.has(warningKey)) {
      return; // Already sent this warning
    }

    this.warningsSent.add(warningKey);

    const hours = Math.floor(hoursUntilAutoClose);
    const minutes = Math.floor((hoursUntilAutoClose % 1) * 60);

    const message = hours > 0
      ? `⚠️ Weekend approaching: All positions will auto-close in ${hours}h ${minutes}m to prevent gap risk`
      : `⚠️ Weekend approaching: All positions will auto-close in ${minutes} minutes to prevent gap risk`;

    logger.warn(LogCategory.POSITION_MONITOR, message);
    globalToastManager.showToast(message, 'warning');

    // Get all users with open positions
    const { data: sessions } = await supabase
      .from('goal_sessions')
      .select('user_id, id')
      .eq('status', 'active');

    if (sessions) {
      for (const session of sessions) {
        await notificationManager.createNotification(
          session.user_id,
          'weekend_warning',
          'Weekend Protection Active',
          message,
          { sessionId: session.id, hoursUntil: hours, minutesUntil: minutes },
          'high'
        );
      }
    }
  }

  private async closeAllPositions(status: WeekendStatus): Promise<void> {
    logger.warn(
      LogCategory.POSITION_MONITOR,
      '🛡️ WEEKEND PROTECTION: Auto-closing all positions to prevent weekend gap risk'
    );

    try {
      // Get all active sessions with open trades
      const { data: sessions, error: sessionsError } = await supabase
        .from('goal_sessions')
        .select('id, user_id, symbol')
        .eq('status', 'active');

      if (sessionsError) throw sessionsError;
      if (!sessions || sessions.length === 0) {
        logger.info(LogCategory.POSITION_MONITOR, '✅ No active positions to close');
        return;
      }

      logger.info(LogCategory.POSITION_MONITOR, `🛡️ Closing ${sessions.length} active session(s) for weekend`);

      const closureEvents: WeekendClosureEvent[] = [];

      for (const session of sessions) {
        try {
          // Get all open trades for this session
          const { data: trades, error: tradesError } = await supabase
            .from('goal_trades')
            .select('*')
            .eq('goal_session_id', session.id)
            .eq('status', 'open');

          if (tradesError) throw tradesError;
          if (!trades || trades.length === 0) continue;

          for (const trade of trades) {
            // Get current price for the symbol
            const { data: priceData } = await supabase
              .from('realtime_prices')
              .select('bid, ask')
              .eq('symbol', session.symbol)
              .order('timestamp', { ascending: false })
              .limit(1)
              .maybeSingle();

            const closePrice = trade.direction === 'buy'
              ? (priceData?.bid || trade.entry_price)
              : (priceData?.ask || trade.entry_price);

            // Calculate P&L
            const priceDiff = trade.direction === 'buy'
              ? closePrice - trade.entry_price
              : trade.entry_price - closePrice;

            const pnl = priceDiff * trade.lot_size * 100000; // Standard lot conversion

            // Close the trade
            const { error: closeError } = await supabase
              .from('goal_trades')
              .update({
                status: 'closed',
                exit_price: closePrice,
                pnl: pnl,
                close_reason: 'weekend_protection',
                closed_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .eq('id', trade.id);

            if (closeError) throw closeError;

            closureEvents.push({
              userId: session.user_id,
              sessionId: session.id,
              positionId: trade.id,
              symbol: session.symbol,
              closePrice,
              pnl,
              reason: 'weekend_protection',
              closedAt: new Date()
            });

            logger.info(
              LogCategory.POSITION_MONITOR,
              `✅ Closed position ${trade.id} - ${session.symbol} at ${closePrice} (P&L: $${pnl.toFixed(2)})`
            );
          }

          // Mark session as completed
          const { error: sessionUpdateError } = await supabase
            .from('goal_sessions')
            .update({
              status: 'completed',
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', session.id);

          if (sessionUpdateError) throw sessionUpdateError;

          // Send notification to user
          await notificationManager.createNotification(
            session.user_id,
            'weekend_closure',
            'Position Closed - Weekend Protection',
            `Your ${session.symbol} position was automatically closed to prevent weekend gap risk. Market reopens Sunday 5:00 PM EST.`,
            { sessionId: session.id },
            'high'
          );

        } catch (error) {
          logger.error(
            LogCategory.POSITION_MONITOR,
            `❌ Error closing session ${session.id}`,
            error
          );
        }
      }

      // Log all closure events to database
      if (closureEvents.length > 0) {
        await this.logWeekendClosures(closureEvents);
      }

      globalToastManager.showToast(
        `🛡️ Weekend Protection: Closed ${closureEvents.length} position(s) to prevent gap risk`,
        'info'
      );

    } catch (error) {
      logger.error(LogCategory.POSITION_MONITOR, '❌ Error in weekend position closure', error);
      throw error;
    }
  }

  private async logWeekendClosures(events: WeekendClosureEvent[]): Promise<void> {
    try {
      const records = events.map(event => ({
        user_id: event.userId,
        goal_session_id: event.sessionId,
        position_id: event.positionId,
        symbol: event.symbol,
        close_price: event.closePrice,
        pnl: event.pnl,
        reason: event.reason,
        closed_at: event.closedAt.toISOString(),
        created_at: new Date().toISOString()
      }));

      const { error } = await supabase
        .from('weekend_closure_log')
        .insert(records);

      if (error) {
        logger.error(LogCategory.POSITION_MONITOR, '❌ Error logging weekend closures', error);
      } else {
        logger.info(LogCategory.POSITION_MONITOR, `✅ Logged ${records.length} weekend closure(s)`);
      }
    } catch (error) {
      logger.error(LogCategory.POSITION_MONITOR, '❌ Error in logWeekendClosures', error);
    }
  }

  private toEST(date: Date): Date {
    // Convert to EST (UTC-5) or EDT (UTC-4) depending on DST
    const estOffset = this.isDST(date) ? -4 : -5;
    const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
    return new Date(utc + (3600000 * estOffset));
  }

  private isDST(date: Date): boolean {
    // Simplified DST check - in production, use a proper timezone library
    const month = date.getMonth();
    return month >= 2 && month <= 10; // Roughly March through November
  }

  getStatusForDisplay(): {
    isActive: boolean;
    message: string;
    hoursUntilClose?: number;
    minutesUntilClose?: number;
  } {
    const status = this.getWeekendStatus();

    if (status.isWeekend) {
      return {
        isActive: true,
        message: '🛡️ Weekend Protection: Market Closed'
      };
    }

    if (status.isFriday) {
      const hours = Math.floor(status.hoursUntilClose);
      const minutes = Math.floor(status.minutesUntilClose % 60);

      if (status.shouldClosePositions) {
        return {
          isActive: true,
          message: '🛡️ Weekend Protection: Auto-closing positions now',
          hoursUntilClose: hours,
          minutesUntilClose: minutes
        };
      } else if (status.shouldPreventNewTrades) {
        return {
          isActive: true,
          message: `🛡️ Weekend Protection: No new trades (${hours}h ${minutes}m until close)`,
          hoursUntilClose: hours,
          minutesUntilClose: minutes
        };
      } else if (status.shouldWarnUser) {
        return {
          isActive: true,
          message: `⚠️ Market closes in ${hours}h ${minutes}m`,
          hoursUntilClose: hours,
          minutesUntilClose: minutes
        };
      }
    }

    return {
      isActive: false,
      message: 'Weekend Protection: Monitoring'
    };
  }
}

export const weekendProtectionService = new WeekendProtectionService();

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Weekend Protection Service - SIMPLIFIED
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * SIMPLE RULE: At market close, shut everything down completely:
 * - Close all trades
 * - End all sessions
 * - Stop all scanning
 * - Disable all LLM API calls
 *
 * TIMING:
 * - Market closes Friday 5:00 PM EST
 * - Shutdown happens 5 minutes before close (4:55 PM EST)
 * - Warnings at 3h, 1h, 30min, and 5min before close
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { supabase } from '@/lib/supabase';
import { logger, LogCategory } from '@/lib/logger';
import { globalToastManager } from './global-toast-manager';
import { notificationManager } from './notification-manager';
import { is24HourSymbol } from '@/utils/marketHours';
import { marketScheduleService } from './market-schedule-service';

// Global shutdown flags
let SCANNING_DISABLED = false;
let LLM_API_DISABLED = false;

interface WeekendStatus {
  isWeekend: boolean;
  isFriday: boolean;
  hoursUntilClose: number;
  minutesUntilClose: number;
  shouldShutdown: boolean;
  shouldWarnUser: boolean;
  marketClosesAt: Date;
  shutdownAt: Date;
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
  private readonly CHECK_INTERVAL_MS = 60 * 1000; // Check every minute
  private readonly MARKET_CLOSE_HOUR_EST = 17; // 5:00 PM
  private readonly MARKET_CLOSE_MINUTE_EST = 0; // 0 minutes
  private readonly SHUTDOWN_MINUTES_BEFORE = 5; // Shutdown 5 minutes before close

  private hasShutdownToday = false;
  private warningsSent = new Set<string>();

  start(): void {
    if (this.checkInterval) {
      logger.debug(LogCategory.POSITION_MONITOR, '⚠️ Weekend protection already running');
      return;
    }

    logger.info(LogCategory.POSITION_MONITOR, '🛡️ Starting weekend protection service');

    // Run immediately and then every minute
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

  // Check if scanning is disabled
  isScanningDisabled(): boolean {
    return SCANNING_DISABLED;
  }

  // Check if LLM APIs are disabled
  isLLMDisabled(): boolean {
    return LLM_API_DISABLED;
  }

  // Check if a specific symbol can be scanned (crypto always allowed, forex only during market hours)
  canScanSymbol(symbol: string): boolean {
    // Crypto can always be scanned (24/7 markets)
    if (is24HourSymbol(symbol)) {
      return true;
    }

    // Forex/Indices can only be scanned when systems are not disabled
    return !SCANNING_DISABLED && !LLM_API_DISABLED;
  }

  // Check if any symbols are scannable (used to determine if scanning should continue)
  canScanAnySymbol(symbols: string[]): { allowed: boolean; openSymbols: string[]; closedSymbols: string[] } {
    const openSymbols = symbols.filter(s => this.canScanSymbol(s));
    const closedSymbols = symbols.filter(s => !this.canScanSymbol(s));

    return {
      allowed: openSymbols.length > 0,
      openSymbols,
      closedSymbols
    };
  }

  // Enable systems on market reopen
  enableSystems(): void {
    SCANNING_DISABLED = false;
    LLM_API_DISABLED = false;
    logger.info(LogCategory.POSITION_MONITOR, '✅ Systems re-enabled for market open');
  }

  async getWeekendStatus(): Promise<WeekendStatus> {
    const now = new Date();

    // DELEGATE to market schedule service - SINGLE SOURCE OF TRUTH
    const marketStatus = await marketScheduleService.getMarketStatus(now);
    const timeUntilChange = await marketScheduleService.getTimeUntilMarketChange();

    const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const dayOfWeek = estTime.getDay();
    const isFriday = dayOfWeek === 5;
    const isWeekend = !marketStatus.isOpen && (dayOfWeek === 6 || (dayOfWeek === 0 && estTime.getHours() < 17));

    // Calculate shutdown time (5 minutes before market close)
    const shutdownAt = new Date(timeUntilChange.changeTime);
    shutdownAt.setMinutes(shutdownAt.getMinutes() - this.SHUTDOWN_MINUTES_BEFORE);

    const hoursUntilClose = timeUntilChange.hours;
    const minutesUntilClose = timeUntilChange.minutes;

    // Shutdown logic: trigger 5 minutes before market close
    const shouldShutdown = !timeUntilChange.isOpening &&
                          isFriday &&
                          now >= shutdownAt &&
                          now < timeUntilChange.changeTime;

    // Send warnings at specific intervals (3h, 1h, 30min)
    const shouldWarnUser = !timeUntilChange.isOpening &&
                          isFriday &&
                          hoursUntilClose <= 3 &&
                          hoursUntilClose > 0;

    return {
      isWeekend,
      isFriday,
      hoursUntilClose,
      minutesUntilClose,
      shouldShutdown,
      shouldWarnUser,
      marketClosesAt: timeUntilChange.changeTime,
      shutdownAt
    };
  }

  async canOpenNewTrade(symbol?: string): Promise<{ allowed: boolean; reason?: string; holidayName?: string }> {
    if (symbol && is24HourSymbol(symbol)) {
      return { allowed: true };
    }

    const marketStatus = await marketScheduleService.getMarketStatus();

    if (marketStatus.status === 'holiday') {
      const holiday = await marketScheduleService.isHoliday();
      return {
        allowed: false,
        reason: marketStatus.reason || `Market closed for ${holiday?.name || 'holiday'}`,
        holidayName: holiday?.name
      };
    }

    if (marketStatus.status === 'early_close') {
      return {
        allowed: false,
        reason: marketStatus.reason || 'Market closed early for holiday',
        holidayName: (await marketScheduleService.isHoliday())?.name
      };
    }

    const status = await this.getWeekendStatus();

    if (status.isWeekend) {
      return {
        allowed: false,
        reason: 'Market is closed for the weekend. Trading resumes Sunday 5:00 PM EST.'
      };
    }

    if (SCANNING_DISABLED || LLM_API_DISABLED) {
      return {
        allowed: false,
        reason: 'All systems paused for weekend. Market reopens Sunday 5:00 PM EST.'
      };
    }

    return { allowed: true };
  }

  private async checkWeekendProtection(): Promise<void> {
    try {
      const status = await this.getWeekendStatus();

      // Reset flags on market reopen (Sunday evening 5 PM EST)
      const now = new Date();
      const utcHours = now.getUTCHours();
      const utcDay = now.getUTCDay();

      // Convert to EST
      const EST_OFFSET = 5;
      let estHours = utcHours - EST_OFFSET;
      let estDay = utcDay;
      if (estHours < 0) {
        estHours += 24;
        estDay = (utcDay - 1 + 7) % 7;
      }

      // Market reopens Sunday at 5 PM EST (22:00 UTC Sunday)
      if (estDay === 0 && estHours >= 17) {
        // Market reopened - re-enable systems
        if (SCANNING_DISABLED || LLM_API_DISABLED) {
          this.enableSystems();
          this.hasShutdownToday = false;
          this.warningsSent.clear();

          globalToastManager.showToast(
            '✅ Market reopened - All systems active',
            'success'
          );
        }
      }

      // Reset flags on new week
      if (!status.isFriday && !status.isWeekend) {
        this.hasShutdownToday = false;
        this.warningsSent.clear();
      }

      // Log current status on Friday
      if (status.isFriday && !this.hasShutdownToday) {
        const hours = Math.floor(status.hoursUntilClose);
        const minutes = Math.floor(status.minutesUntilClose % 60);
        logger.debug(
          LogCategory.POSITION_MONITOR,
          `🛡️ Weekend protection active - ${hours}h ${minutes}m until market close`
        );
      }

      // Send warnings
      if (status.shouldWarnUser && !this.hasShutdownToday) {
        await this.sendWarnings(status);
      }

      // COMPLETE SHUTDOWN
      if (status.shouldShutdown && !this.hasShutdownToday) {
        await this.executeCompleteShutdown(status);
        this.hasShutdownToday = true;
      }

    } catch (error) {
      logger.error(LogCategory.POSITION_MONITOR, '❌ Error in weekend protection check', error);
    }
  }

  private async sendWarnings(status: WeekendStatus): Promise<void> {
    const hours = Math.floor(status.hoursUntilClose);
    const minutes = Math.floor(status.minutesUntilClose % 60);

    // Send warnings at 3h, 1h, 30min, 5min
    let warningKey = '';
    let message = '';

    if (hours === 3 && minutes <= 5) {
      warningKey = '3h';
      message = `⚠️ Market closes in 3 hours - All trades and sessions will be closed automatically`;
    } else if (hours === 1 && minutes <= 5) {
      warningKey = '1h';
      message = `🚨 ALERT - All trades closing in 1 hour`;
    } else if (hours === 0 && minutes >= 25 && minutes <= 35) {
      warningKey = '30min';
      message = `🚨 FINAL WARNING - Closing all positions in 30 minutes`;
    } else if (hours === 0 && minutes <= 10 && minutes >= 5) {
      warningKey = '5min';
      message = `🚨 Closing all positions NOW`;
    } else {
      return; // Not a warning time
    }

    if (this.warningsSent.has(warningKey)) {
      return; // Already sent
    }

    this.warningsSent.add(warningKey);

    logger.warn(LogCategory.POSITION_MONITOR, message);
    globalToastManager.showToast(message, 'warning');

    // Notify all users with active sessions
    const { data: sessions } = await supabase
      .from('goal_sessions')
      .select('user_id, id')
      .in('status', ['initializing', 'scanning', 'trade_pending', 'in_trade']);

    if (sessions) {
      for (const session of sessions) {
        await notificationManager.createNotification(
          session.user_id,
          'weekend_warning',
          'Weekend Protection',
          message,
          { sessionId: session.id, hoursUntil: hours, minutesUntil: minutes },
          'high'
        );
      }
    }
  }

  /**
   * COMPLETE SHUTDOWN - Close everything
   */
  private async executeCompleteShutdown(status: WeekendStatus): Promise<void> {
    logger.warn(
      LogCategory.POSITION_MONITOR,
      '🛡️ WEEKEND SHUTDOWN: Closing all trades, sessions, and disabling systems'
    );

    try {
      // STEP 1: Close all open trades
      logger.info(LogCategory.POSITION_MONITOR, 'Step 1: Closing all open trades...');
      const closedTrades = await this.closeAllOpenTrades();
      logger.info(LogCategory.POSITION_MONITOR, `✅ Closed ${closedTrades} trade(s)`);

      // STEP 2: End all active sessions
      logger.info(LogCategory.POSITION_MONITOR, 'Step 2: Ending all active sessions...');
      const endedSessions = await this.endAllActiveSessions();
      logger.info(LogCategory.POSITION_MONITOR, `✅ Ended ${endedSessions} session(s)`);

      // STEP 3: Stop all scanning
      logger.info(LogCategory.POSITION_MONITOR, 'Step 3: Stopping all scanning...');
      SCANNING_DISABLED = true;
      logger.info(LogCategory.POSITION_MONITOR, '✅ Scanning disabled');

      // STEP 4: Stop all LLM API calls
      logger.info(LogCategory.POSITION_MONITOR, 'Step 4: Stopping all LLM API calls...');
      LLM_API_DISABLED = true;
      logger.info(LogCategory.POSITION_MONITOR, '✅ LLM APIs disabled');

      // STEP 5: Log shutdown event
      logger.warn(
        LogCategory.POSITION_MONITOR,
        `🛡️ COMPLETE SHUTDOWN - ${closedTrades} trades closed, ${endedSessions} sessions ended, All systems paused`
      );

      // STEP 6: Notify all users
      globalToastManager.showToast(
        `Weekend shutdown complete - All positions closed`,
        'info'
      );

      // Send notification to all affected users
      const { data: users } = await supabase
        .from('user_profiles')
        .select('id');

      if (users) {
        for (const user of users) {
          await notificationManager.createNotification(
            user.id,
            'weekend_shutdown',
            'Weekend Shutdown Complete',
            `All trades and sessions have been closed for the weekend. Systems will resume Sunday at 5:00 PM EST.`,
            { closedTrades, endedSessions },
            'high'
          );
        }
      }

    } catch (error) {
      logger.error(LogCategory.POSITION_MONITOR, '❌ Error in complete shutdown', error);
      throw error;
    }
  }

  /**
   * Close all open trades (excludes crypto - they trade 24/7)
   */
  private async closeAllOpenTrades(): Promise<number> {
    try {
      const { data: trades } = await supabase
        .from('goal_trades')
        .select('*')
        .eq('status', 'open');

      if (!trades || trades.length === 0) {
        return 0;
      }

      const forexTrades = trades.filter(t => !is24HourSymbol(t.symbol));
      const cryptoTrades = trades.filter(t => is24HourSymbol(t.symbol));

      if (cryptoTrades.length > 0) {
        logger.info(
          LogCategory.POSITION_MONITOR,
          `Skipping ${cryptoTrades.length} crypto trade(s) - 24/7 markets stay open`
        );
      }

      if (forexTrades.length === 0) {
        return 0;
      }

      let closedCount = 0;

      for (const trade of forexTrades) {
        try {
          // Get current price
          const { data: priceData } = await supabase
            .from('realtime_prices')
            .select('bid, ask')
            .eq('symbol', trade.symbol)
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

          const pnl = priceDiff * trade.lot_size * 100000;

          // Close the trade
          await supabase
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

          closedCount++;

          logger.info(
            LogCategory.POSITION_MONITOR,
            `✅ Closed trade ${trade.id} - ${trade.symbol} at ${closePrice} (P&L: $${pnl.toFixed(2)})`
          );
        } catch (error) {
          logger.error(LogCategory.POSITION_MONITOR, `❌ Error closing trade ${trade.id}`, error);
        }
      }

      return closedCount;
    } catch (error) {
      logger.error(LogCategory.POSITION_MONITOR, '❌ Error closing all trades', error);
      return 0;
    }
  }

  /**
   * End all active sessions
   */
  private async endAllActiveSessions(): Promise<number> {
    try {
      const { data: sessions } = await supabase
        .from('goal_sessions')
        .select('id, user_id')
        .in('status', ['initializing', 'scanning', 'trade_pending', 'in_trade']);

      if (!sessions || sessions.length === 0) {
        return 0;
      }

      let endedCount = 0;

      for (const session of sessions) {
        try {
          await supabase
            .from('goal_sessions')
            .update({
              status: 'force_closed_weekend',
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', session.id);

          endedCount++;

          logger.info(
            LogCategory.POSITION_MONITOR,
            `✅ Ended session ${session.id}`
          );
        } catch (error) {
          logger.error(LogCategory.POSITION_MONITOR, `❌ Error ending session ${session.id}`, error);
        }
      }

      return endedCount;
    } catch (error) {
      logger.error(LogCategory.POSITION_MONITOR, '❌ Error ending all sessions', error);
      return 0;
    }
  }


  async getStatusForDisplay(): Promise<{
    isActive: boolean;
    message: string;
    hoursUntilClose?: number;
    minutesUntilClose?: number;
    holidayName?: string;
  }> {
    const marketStatus = await marketScheduleService.getMarketStatus();

    if (marketStatus.status === 'holiday') {
      const holiday = await marketScheduleService.isHoliday();
      return {
        isActive: true,
        message: `Forex closed for ${holiday?.name || 'holiday'} (Crypto 24/7)`,
        holidayName: holiday?.name
      };
    }

    if (marketStatus.status === 'early_close') {
      const holiday = await marketScheduleService.isHoliday();
      return {
        isActive: true,
        message: `Forex closed early - ${holiday?.name || 'Holiday'} (Crypto 24/7)`,
        holidayName: holiday?.name
      };
    }

    const status = await this.getWeekendStatus();

    if (status.isWeekend) {
      return {
        isActive: true,
        message: 'Forex closed (Crypto 24/7)'
      };
    }

    if (SCANNING_DISABLED || LLM_API_DISABLED) {
      return {
        isActive: true,
        message: 'Forex shutdown - Reopens Sunday 5pm EST (Crypto active)'
      };
    }

    if (status.isFriday && status.shouldWarnUser) {
      const hours = Math.floor(status.hoursUntilClose);
      const minutes = Math.floor(status.minutesUntilClose % 60);

      return {
        isActive: true,
        message: `Forex market close in ${hours}h ${minutes}m (Crypto unaffected)`,
        hoursUntilClose: hours,
        minutesUntilClose: minutes
      };
    }

    return {
      isActive: false,
      message: 'Weekend Protection: Monitoring'
    };
  }
}

export const weekendProtectionService = new WeekendProtectionService();

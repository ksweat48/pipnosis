import { supabase } from '@/lib/supabase';
import { globalPollingCoordinator } from './global-polling-coordinator';
import { logger, LogCategory, LogLevel } from '@/lib/logger';
import type { GoalSessionTrade } from '@/types/position';
import { calculatePnL } from '@/types/position';
import { prodLogger } from '@/lib/production-logger';
import { midTradeTriggerDetector } from './mid-trade-trigger-detector';
import type { MarketConditions } from './mid-trade-trigger-detector';
import { tradeClosureCoordinator, type CloseReason } from './coordinators/trade-closure-coordinator';
import { goalAchievementCoordinator } from './coordinators/goal-achievement-coordinator';
import { notificationCoordinator } from './coordinators/notification-coordinator';
import { goalSessionStateMachine } from './coordinators/goal-session-state-machine';
import { TIME_MS } from '@/config/time-constants';
import { marketDataService } from './market-data-service';

logger.setCategoryLevel(LogCategory.POSITION_MONITOR, LogLevel.ERROR);

type MonitoredPosition = GoalSessionTrade;

class PositionMonitorService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private criticalPositionIntervalId: NodeJS.Timeout | null = null;
  private normalPositionIntervalId: NodeJS.Timeout | null = null;
  private criticalSymbols: Set<string> = new Set();
  private updateRetryCount: Map<string, number> = new Map();
  private maxRetries = 3;
  private lastMidTradeCheck: Map<string, number> = new Map();
  private midTradeCheckInterval = 60000; // Check every 60 seconds per trade
  private lastStaleWarning: Map<string, number> = new Map(); // Throttle stale price warnings
  private staleWarningThrottle = 300000; // Only warn every 5 minutes

  start() {
    if (this.isRunning) return;

    logger.debug(LogCategory.POSITION_MONITOR, '🚀 Starting position monitor service with high-frequency polling');
    this.isRunning = true;

    this.monitorPositions();
    // CRITICAL: Reduced intervals for immediate SL/TP detection
    // Critical positions (near SL/TP): 250ms polling for sub-second response
    // Normal positions: 1000ms polling (still 3x faster than before)
    this.criticalPositionIntervalId = setInterval(() => this.monitorCriticalPositions(), 250);
    this.normalPositionIntervalId = setInterval(() => this.monitorNormalPositions(), 1000);
    console.log('[PositionMonitor] ⚡ High-frequency monitoring enabled: Critical=250ms, Normal=1000ms');
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.criticalPositionIntervalId) {
      clearInterval(this.criticalPositionIntervalId);
      this.criticalPositionIntervalId = null;
    }
    if (this.normalPositionIntervalId) {
      clearInterval(this.normalPositionIntervalId);
      this.normalPositionIntervalId = null;
    }
    this.isRunning = false;
    this.criticalSymbols.clear();
    this.updateRetryCount.clear();
    this.lastMidTradeCheck.clear();
    logger.debug(LogCategory.POSITION_MONITOR, ' Stopped position monitor service');
  }

  async monitorPositions() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: positions, error } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('user_id', user.id)
        .in('status', ['open', 'pending']);

      if (error) throw error;
      if (!positions || positions.length === 0) {
        this.criticalSymbols.clear();
        return;
      }

      const symbols = Array.from(new Set(positions.map(p => p.symbol)));

      symbols.forEach(symbol => {
        globalPollingCoordinator.setSymbolHasPosition(symbol, true);
      });

      this.updateCriticalSymbols(positions);
    } catch (error) {
      logger.error(LogCategory.POSITION_MONITOR, 'Error monitoring positions:', error);
    }
  }

  private updateCriticalSymbols(positions: MonitoredPosition[]): void {
    const newCriticalSymbols = new Set<string>();

    for (const position of positions) {
      if (position.status !== 'open' || !position.entry_price) continue;

      const currentPrice = position.current_price || position.entry_price;
      const distanceToSL = Math.abs(currentPrice - position.stop_loss);
      const distanceToTP = Math.abs(currentPrice - position.take_profit);
      const priceRange = Math.abs(position.take_profit - position.stop_loss);

      // CRITICAL: Expanded critical zone to 30% (was 15%) for earlier high-frequency monitoring
      // This gives more time for sub-second response when approaching SL/TP
      const isNearSLorTP = (distanceToSL / priceRange < 0.30) || (distanceToTP / priceRange < 0.30);

      if (isNearSLorTP) {
        newCriticalSymbols.add(position.symbol);
        console.log(`[PositionMonitor] ⚠️ ${position.symbol} marked CRITICAL: ${((distanceToSL / priceRange) * 100).toFixed(1)}% from SL`);
      }
    }

    // Log changes in critical symbols
    const added = [...newCriticalSymbols].filter(s => !this.criticalSymbols.has(s));
    const removed = [...this.criticalSymbols].filter(s => !newCriticalSymbols.has(s));

    if (added.length > 0) {
      console.log(`[PositionMonitor] 🔴 NEW CRITICAL: ${added.join(', ')} → 250ms polling`);
    }
    if (removed.length > 0) {
      console.log(`[PositionMonitor] 🟢 NO LONGER CRITICAL: ${removed.join(', ')} → 1000ms polling`);
    }

    this.criticalSymbols = newCriticalSymbols;
  }

  private async updatePositionWithRetry(
    positionId: string,
    currentPrice: number,
    pnl: number,
    userId: string
  ): Promise<boolean> {
    const currentRetries = this.updateRetryCount.get(positionId) || 0;

    // First, get current max_drawdown and max_profit values
    const { data: currentPosition } = await supabase
      .from('goal_session_trades')
      .select('max_drawdown, max_profit')
      .eq('id', positionId)
      .eq('user_id', userId)
      .maybeSingle();

    const currentMaxDrawdown = currentPosition?.max_drawdown || 0;
    const currentMaxProfit = currentPosition?.max_profit || 0;

    // Update max_drawdown if current PnL is more negative
    const newMaxDrawdown = pnl < currentMaxDrawdown ? pnl : currentMaxDrawdown;

    // Update max_profit if current PnL is more positive
    const newMaxProfit = pnl > currentMaxProfit ? pnl : currentMaxProfit;

    // Direct table update with proper columns including max tracking
    const { error: updateError } = await supabase
      .from('goal_session_trades')
      .update({
        current_price: currentPrice,
        current_pnl: pnl,
        max_drawdown: newMaxDrawdown,
        max_profit: newMaxProfit
      })
      .eq('id', positionId)
      .eq('user_id', userId);

    if (!updateError) {
      this.updateRetryCount.delete(positionId);

      // Log when we update max values for visibility
      if (newMaxDrawdown < currentMaxDrawdown) {
        console.log(`[PositionMonitor] 📉 New max drawdown: ${newMaxDrawdown.toFixed(2)} (was ${currentMaxDrawdown.toFixed(2)})`);
      }
      if (newMaxProfit > currentMaxProfit) {
        console.log(`[PositionMonitor] 📈 New peak profit: ${newMaxProfit.toFixed(2)} (was ${currentMaxProfit.toFixed(2)})`);
      }

      return true;
    }

    console.error(`[PositionMonitor] Update failed (attempt ${currentRetries + 1}/${this.maxRetries}):`, {
      positionId,
      error: updateError
    });

    // Increment retry count
    this.updateRetryCount.set(positionId, currentRetries + 1);

    if (currentRetries >= this.maxRetries) {
      console.error(`[PositionMonitor] Max retries exceeded for position ${positionId}`);
      this.updateRetryCount.delete(positionId);
      return false;
    }

    // Exponential backoff
    const backoffMs = 1000 * (currentRetries + 1);
    await new Promise(resolve => setTimeout(resolve, backoffMs));

    return false;
  }

  private async monitorCriticalPositions(): Promise<void> {
    if (this.criticalSymbols.size === 0) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: positions, error } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'open')
        .in('symbol', Array.from(this.criticalSymbols));

      if (error) throw error;
      if (!positions || positions.length === 0) return;

      for (const position of positions) {
        await this.updatePositionWithPriority(position, 'critical');
      }
    } catch (error) {
      console.error('[PositionMonitor] Error monitoring critical positions:', error);
    }
  }

  private async monitorNormalPositions(): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: positions, error } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('user_id', user.id)
        .in('status', ['open', 'pending']);

      if (error) throw error;
      if (!positions || positions.length === 0) return;

      for (const position of positions) {
        if (position.status === 'open' && !this.criticalSymbols.has(position.symbol)) {
          await this.updatePositionWithPriority(position, 'high');
        } else if (position.status === 'pending') {
          await this.checkPendingOrderWithPriority(position, 'normal');
        }
      }
    } catch (error) {
      console.error('[PositionMonitor] Error monitoring normal positions:', error);
    }
  }

  private async updatePositionWithPriority(
    position: MonitoredPosition,
    priority: 'critical' | 'high'
  ): Promise<void> {
    try {
      // CRITICAL: Use multiple price sources with fallbacks
      let currentPrice: number | null = null;
      let bid: number | null = null;
      let ask: number | null = null;
      let priceSource = '';

      // SOURCE 1: realtime_prices table (most recent, preferred source)
      const { data: realtimeData, error: realtimeError } = await supabase
        .from('realtime_prices')
        .select('bid, ask, created_at')
        .eq('symbol', position.symbol)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (realtimeData && !realtimeError) {
        const ageMinutes = (Date.now() - new Date(realtimeData.created_at).getTime()) / 1000 / 60;
        const ageSeconds = ageMinutes * 60;

        // CRITICAL: Reduced freshness threshold to 2 minutes (was 5) for tighter SL/TP monitoring
        // For positions with critical status, we need fresh data
        if (ageMinutes < 2) {
          bid = parseFloat(realtimeData.bid);
          ask = parseFloat(realtimeData.ask);
          currentPrice = position.direction === 'buy' ? bid : ask;
          priceSource = 'realtime_prices';

          // Only log for critical positions or if very fresh
          if (this.criticalSymbols.has(position.symbol) || ageSeconds < 10) {
            console.log(`[PositionMonitor] ${position.symbol}: Using realtime_prices (${ageSeconds.toFixed(1)}s old)`);
          }
        } else {
          // Throttle stale warnings to once every 5 minutes per symbol
          const now = Date.now();
          const lastWarning = this.lastStaleWarning.get(position.symbol) || 0;
          if (now - lastWarning > this.staleWarningThrottle) {
            console.error(`[PositionMonitor] ⚠️ STALE PRICE DATA for ${position.symbol}: ${ageMinutes.toFixed(1)} minutes old (threshold: 2min)`);
            console.error(`[PositionMonitor] This may delay SL/TP closure! Trying fallback sources...`);
            this.lastStaleWarning.set(position.symbol, now);
          }
        }
      } else if (realtimeError) {
        console.error(`[PositionMonitor] ❌ ${position.symbol}: realtime_prices query error:`, realtimeError.message);
      }

      // SOURCE 2: forex_candles table (M5 close price)
      // ✅ SSOT: Uses MarketDataService
      if (!currentPrice) {
        const candleData = await marketDataService.getLastCandle(position.symbol, 'M5');

        if (candleData) {
          currentPrice = parseFloat(candleData.close);
          // Approximate bid/ask from candle high/low
          const high = parseFloat(candleData.high);
          const low = parseFloat(candleData.low);
          const spread = (high - low) * 0.1; // Estimate 10% of range as spread
          bid = currentPrice - spread / 2;
          ask = currentPrice + spread / 2;
          priceSource = 'forex_candles';
          console.log(`[PositionMonitor] ${position.symbol}: Using forex_candles M5 fallback`);
        } else {
          console.warn(`[PositionMonitor] ${position.symbol}: forex_candles fallback unavailable`);
        }
      }

      // SOURCE 3: Position's cached price (absolute fallback - may be stale)
      if (!currentPrice && position.current_price) {
        currentPrice = position.current_price;
        bid = currentPrice;
        ask = currentPrice;
        priceSource = 'position_cache';

        // Throttle cached price warnings to once every 5 minutes per symbol
        const now = Date.now();
        const lastWarning = this.lastStaleWarning.get(`${position.symbol}_cache`) || 0;
        if (now - lastWarning > this.staleWarningThrottle) {
          console.warn(`[PositionMonitor] ${position.symbol}: Using cached price (STALE WARNING - all sources exhausted)`);
          this.lastStaleWarning.set(`${position.symbol}_cache`, now);
        }
      }

      if (!currentPrice || !bid || !ask) {
        console.error(`[PositionMonitor] ❌ CRITICAL: No price data for ${position.symbol} from ANY source!`);
        console.error(`[PositionMonitor] This position cannot be monitored for SL/TP!`);

        await notificationCoordinator.sendSystemNotification({
          userId: position.user_id,
          type: 'system_alert',
          title: 'Price Data Unavailable',
          message: `Cannot monitor ${position.symbol} - no price data available. Position may not close at SL/TP automatically!`,
          tradeId: position.id,
          sessionId: position.goal_session_id,
          priority: 'critical',
          metadata: {
            trade_id: position.id,
            symbol: position.symbol,
            issue: 'no_price_data'
          },
        });

        return;
      }

      await this.updateOpenPosition(position, { bid, ask }, currentPrice, priceSource);
    } catch (error) {
      console.error(`[PositionMonitor] Failed to update position for ${position.symbol}:`, error);
    }
  }

  private async checkPendingOrderWithPriority(
    order: MonitoredPosition,
    priority: 'normal'
  ): Promise<void> {
    try {
      // Use same multi-source price fetching as position monitoring
      let bid: number | null = null;
      let ask: number | null = null;

      // SOURCE 1: realtime_prices
      const { data: realtimeData, error: realtimeError } = await supabase
        .from('realtime_prices')
        .select('bid, ask, created_at')
        .eq('symbol', order.symbol)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (realtimeData && !realtimeError) {
        const ageMinutes = (Date.now() - new Date(realtimeData.created_at).getTime()) / 1000 / 60;
        if (ageMinutes < 5) {
          bid = parseFloat(realtimeData.bid);
          ask = parseFloat(realtimeData.ask);
        }
      }

      // SOURCE 2: forex_candles fallback
      // ✅ SSOT: Uses MarketDataService
      if (!bid || !ask) {
        const candleData = await marketDataService.getLastCandle(order.symbol, 'M5');

        if (candleData) {
          const close = parseFloat(candleData.close);
          const high = parseFloat(candleData.high);
          const low = parseFloat(candleData.low);
          const spread = (high - low) * 0.1;
          bid = close - spread / 2;
          ask = close + spread / 2;
        }
      }

      if (!bid || !ask) {
        console.error(`[PositionMonitor] No price data for pending order ${order.symbol}`);
        return;
      }

      await this.checkPendingOrder(order, { bid, ask });
    } catch (error) {
      console.error(`[PositionMonitor] Failed to check pending order for ${order.symbol}:`, error);
    }
  }

  private async updateOpenPosition(
    position: MonitoredPosition,
    price: { bid: number; ask: number },
    currentPrice?: number,
    priceSource?: string
  ) {
    if (!position.entry_price) return;

    const actualCurrentPrice = currentPrice || (position.direction === 'buy' ? price.bid : price.ask);

    // CRITICAL: Validate lot_size before P&L calculation
    const lotSize = position.lot_size || position.position_size;

    // Safety check: lot_size should be reasonable (0.01 to 100 lots)
    if (!lotSize || lotSize <= 0 || lotSize > 100) {
      console.error(`[PositionMonitor] ❌ INVALID LOT SIZE for position ${position.id}:`, {
        symbol: position.symbol,
        lot_size: position.lot_size,
        position_size: position.position_size,
        used: lotSize
      });
      return;
    }

    const pnl = calculatePnL(
      position.direction,
      position.entry_price,
      actualCurrentPrice,
      lotSize,
      position.symbol
    );

    // Safety check: detect unrealistic P&L values (>$10,000 on a single position)
    if (Math.abs(pnl) > 10000) {
      console.error(`[PositionMonitor] ⚠️ UNREALISTIC P&L DETECTED for ${position.symbol}:`, {
        direction: position.direction,
        entry: position.entry_price,
        current: actualCurrentPrice,
        lotSize: lotSize,
        lot_size_column: position.lot_size,
        position_size_column: position.position_size,
        calculatedPnL: pnl.toFixed(2),
        warning: 'P&L exceeds $10,000 - possible lot_size error'
      });
      // Don't update with unrealistic values
      return;
    }

    console.log(`[PositionMonitor] PnL Calculation for ${position.symbol}:`, {
      direction: position.direction,
      entry: position.entry_price,
      current: actualCurrentPrice,
      lotSize: lotSize,
      lot_size_column: position.lot_size,
      position_size_column: position.position_size,
      calculatedPnL: pnl.toFixed(2)
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.error('[PositionMonitor] No authenticated user - cannot update position');
      return;
    }

    const updateSuccess = await this.updatePositionWithRetry(
      position.id,
      actualCurrentPrice,
      pnl,
      user.id
    );

    if (!updateSuccess) {
      console.error(`[PositionMonitor] All update attempts failed for position ${position.id}`);
      return;
    }

    // Check for periodic wellness (15-minute check-ins)
    await this.checkPeriodicWellness(position, actualCurrentPrice);

    // Check for mid-trade triggers (drawdown alerts, etc.)
    await this.checkMidTradeTriggers(position, actualCurrentPrice, pnl);

    // CRITICAL: Check if goal is reached using COORDINATOR (single authority)
    let shouldCloseForGoal = false;
    if (position.goal_session_id) {
      const { data: goalSession } = await supabase
        .from('goal_sessions')
        .select('target_value, auto_close_on_goal, goal_achieved_at, current_progress')
        .eq('id', position.goal_session_id)
        .maybeSingle();

      if (goalSession && !goalSession.goal_achieved_at) {
        // SAFETY CHECK: Never trigger goal achievement on negative P&L
        if (pnl < 0 && pnl >= goalSession.target_value) {
          console.error(`[PositionMonitor] PREVENTED FALSE GOAL TRIGGER: Negative P&L ${pnl.toFixed(2)}`);
          return;
        }

        // DELEGATE to goalAchievementCoordinator - single authority for goal detection
        const goalResult = await goalAchievementCoordinator.checkAndProcessGoalAchievement(
          {
            sessionId: position.goal_session_id,
            userId: user.id,
            targetAmount: goalSession.target_value,
            currentCumulativePnL: goalSession.current_progress || 0,
          },
          pnl // Pass current unrealized P&L
        );

        if (goalResult.achieved) {
          console.log(`[PositionMonitor] Goal achieved via coordinator. Achievement ID: ${goalResult.achievementId}`);

          // Mark trade with goal achievement info
          await supabase
            .from('goal_session_trades')
            .update({
              goal_met_at: new Date().toISOString(),
              goal_met_price: actualCurrentPrice,
              unrealized_goal_achievement: true
            })
            .eq('id', position.id);

          if (goalSession.auto_close_on_goal !== false) {
            console.log(`[PositionMonitor] Auto-close enabled - closing position at goal`);
            shouldCloseForGoal = true;
          }
        }
      }
    }

    if (shouldCloseForGoal) {
      await this.autoClosePosition(position, actualCurrentPrice, 'goal_met');
      return;
    }

    const shouldCloseAtStopLoss = position.direction === 'buy'
      ? actualCurrentPrice <= position.stop_loss
      : actualCurrentPrice >= position.stop_loss;

    const hasDualTP = (position as any).take_profit_1 && (position as any).take_profit_2;
    const tp1 = (position as any).take_profit_1;
    const tp2 = (position as any).take_profit_2;
    const tp1HitAt = (position as any).tp1_hit_at;

    let shouldCheckTP1 = false;
    let shouldCheckTP2 = false;
    let legacyTPCheck = false;

    if (hasDualTP) {
      shouldCheckTP1 = !tp1HitAt && (position.direction === 'buy'
        ? actualCurrentPrice >= tp1
        : actualCurrentPrice <= tp1);

      shouldCheckTP2 = tp1HitAt && (position.direction === 'buy'
        ? actualCurrentPrice >= tp2
        : actualCurrentPrice <= tp2);
    } else {
      legacyTPCheck = position.direction === 'buy'
        ? actualCurrentPrice >= position.take_profit
        : actualCurrentPrice <= position.take_profit;
    }

    const shouldCloseAtTakeProfit = legacyTPCheck || shouldCheckTP2;

    // CRITICAL: Log SL/TP checks for debugging and transparency
    if (this.criticalSymbols.has(position.symbol) || shouldCloseAtStopLoss || shouldCloseAtTakeProfit || shouldCheckTP1) {
      console.log(`[PositionMonitor] SL/TP Check for ${position.symbol}:`, {
        direction: position.direction,
        currentPrice: actualCurrentPrice.toFixed(5),
        stopLoss: position.stop_loss.toFixed(5),
        takeProfit: position.take_profit.toFixed(5),
        hasDualTP,
        tp1: tp1?.toFixed(5),
        tp2: tp2?.toFixed(5),
        tp1Hit: !!tp1HitAt,
        shouldCloseAtSL: shouldCloseAtStopLoss,
        shouldCloseAtTP: shouldCloseAtTakeProfit,
        shouldCheckTP1,
        shouldCheckTP2,
        priceSource,
        critical: this.criticalSymbols.has(position.symbol)
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // P0-3: RACE CONDITION PROTECTION (CCIP v2.0)
    // ═══════════════════════════════════════════════════════════════════
    // If price gaps through BOTH S/L and T/P simultaneously, STOP LOSS wins.
    // This ensures risk management always takes priority over profit taking.
    // Rationale:
    // - Prevents optimistic accounting (recording profit when loss occurred)
    // - Ensures consistent loss recording for risk metrics
    // - Protects user capital by prioritizing risk limits
    // ═══════════════════════════════════════════════════════════════════
    if (shouldCloseAtStopLoss && (shouldCloseAtTakeProfit || shouldCheckTP1 || shouldCheckTP2)) {
      console.warn(
        `[PositionMonitor] 🚨 RACE CONDITION DETECTED: ${position.symbol}`,
        {
          positionId: position.id.substring(0, 8),
          currentPrice: actualCurrentPrice.toFixed(5),
          stopLoss: position.stop_loss.toFixed(5),
          takeProfit: position.take_profit.toFixed(5),
          direction: position.direction,
          decision: 'Executing S/L (priority)',
          slTriggered: shouldCloseAtStopLoss,
          tpTriggered: shouldCloseAtTakeProfit,
          tp1Triggered: shouldCheckTP1,
          tp2Triggered: shouldCheckTP2
        }
      );
      // Execute S/L only, ignore T/P
      console.log(`[PositionMonitor] 🛑 STOP LOSS TRIGGERED (priority) for ${position.symbol} at ${actualCurrentPrice.toFixed(5)}`);
      await this.autoClosePosition(position, actualCurrentPrice, 'stop_loss');
      return; // Exit early to prevent any T/P execution
    }

    // Normal single trigger handling (no race condition)
    if (shouldCloseAtStopLoss) {
      console.log(`[PositionMonitor] 🛑 STOP LOSS TRIGGERED for ${position.symbol} at ${actualCurrentPrice.toFixed(5)}`);
      await this.autoClosePosition(position, actualCurrentPrice, 'stop_loss');
    } else if (shouldCheckTP1) {
      console.log(`[PositionMonitor] 🎯 TP1 TRIGGERED for ${position.symbol} at ${actualCurrentPrice.toFixed(5)}`);
      await this.handleTP1Hit(position, actualCurrentPrice);
    } else if (shouldCloseAtTakeProfit) {
      console.log(`[PositionMonitor] 🎯 TAKE PROFIT TRIGGERED for ${position.symbol} at ${actualCurrentPrice.toFixed(5)}`);
      await this.autoClosePosition(position, actualCurrentPrice, 'take_profit');
    }
  }

  private async checkPendingOrder(
    order: MonitoredPosition,
    price: { bid: number; ask: number }
  ) {
    if (!order.limit_price) return;

    let shouldFill = false;

    if (order.direction === 'buy') {
      shouldFill = price.ask <= order.limit_price;
    } else {
      shouldFill = price.bid >= order.limit_price;
    }

    if (shouldFill) {
      await this.fillPendingOrder(order, order.limit_price);
    }
  }

  private async fillPendingOrder(order: MonitoredPosition, fillPrice: number) {
    try {
      logger.debug(LogCategory.POSITION_MONITOR, ` Filling pending order ${order.id} at ${fillPrice}`);

      await supabase
        .from('goal_session_trades')
        .update({
          status: 'open',
          entry_price: fillPrice,
          current_price: fillPrice,
          current_pnl: 0,
          opened_at: new Date().toISOString()
        })
        .eq('id', order.id);

      logger.debug(LogCategory.POSITION_MONITOR, ` Order ${order.id} filled successfully`);
    } catch (error) {
      console.error(`[PositionMonitor] Failed to fill order ${order.id}:`, error);
    }
  }

  /**
   * Check for periodic wellness check (every 15 minutes)
   * Provides comprehensive trade intelligence and situational awareness
   */
  private async checkPeriodicWellness(
    position: MonitoredPosition,
    currentPrice: number
  ): Promise<void> {
    try {
      // Build market conditions snapshot (minimal for performance)
      const marketConditions: MarketConditions = {
        currentPrice,
        ohlc: [], // Not needed for periodic check
        indicators: {},
        priceAction: {}
      };

      // Check if periodic wellness should fire
      const triggerResult = midTradeTriggerDetector.checkPeriodicWellness(
        {
          id: position.id,
          symbol: position.symbol,
          direction: position.direction,
          entryPrice: position.entry_price,
          stopLoss: position.stop_loss,
          takeProfit: position.take_profit,
          positionSize: position.lot_size,
          entryTime: new Date(position.opened_at),
          status: 'active'
        } as any,
        marketConditions
      );

      if (!triggerResult.triggered) {
        return; // Not time for periodic check yet
      }

      // CRITICAL: Get comprehensive AI wellness evaluation with full trade context
      const { midTradeMonitor } = await import('../brains/midtrade-monitor');

      // Calculate current P&L
      const lotSize = position.lot_size || position.position_size;
      const currentPnL = calculatePnL(
        position.direction,
        position.entry_price,
        currentPrice,
        lotSize,
        position.symbol
      );

      // Calculate risk metrics
      const risk = Math.abs(position.entry_price - position.stop_loss);
      const priceDiff = position.direction === 'buy'
        ? (currentPrice - position.entry_price)
        : (position.entry_price - currentPrice);
      const riskRatio = priceDiff / risk;

      // Build snapshot for AI evaluation
      const snapshot = {
        p: currentPrice,
        ep: position.entry_price,
        sl: position.stop_loss,
        tp: position.take_profit,
        dir: position.direction,
        dd: Math.abs(riskRatio),
        pnl: currentPnL, // CRITICAL: Include actual calculated P&L
        e20: 0, // Not available in position monitor
        e50: 0,
        rsi: 0,
        atr: risk,
        vw_d: 0,
        tr: 'unknown',
        vol: 'normal',
        t: triggerResult.metadata.minutesInTrade || 0,
        risk_pct: 2,
        sym: position.symbol
      };

      // Get trader score (simplified for now)
      const traderScore = {
        current_score: 75,
        confidence_level: 'Moderate' as const,
        win_streak: 0,
        adaptive_sizing_enabled: false
      };

      // CRITICAL: Pass trade ID so Alpha can retrieve original context
      const decision = await midTradeMonitor.evaluatePeriodicWellness(
        snapshot,
        traderScore,
        position.id // Pass trade ID for context retrieval
      );

      // Create comprehensive wellness message for FloatingMessageCenter
      await supabase.from('goal_ai_conversations').insert({
        goal_session_id: position.goal_session_id,
        user_id: position.user_id,
        role: 'ai',
        content: decision.reasoning, // Full comprehensive message
        conversation_type: 'periodic_wellness',
        trade_id: position.id,
        metadata: {
          trigger_type: 'periodic_wellness',
          ...triggerResult.metadata,
          action: decision.action,
          confidence: decision.confidence,
          current_pnl: currentPnL,
          risk_ratio: riskRatio.toFixed(3),
          minutes_in_trade: snapshot.t,
          // NO silent flag - show these messages!
          show_in_floating_center: true
        }
      });

      console.log(`[PositionMonitor] ✅ Comprehensive wellness check completed: ${position.symbol}`);
      console.log(`[PositionMonitor] Decision: ${decision.action} (${decision.confidence}% confidence)`);
      console.log(`[PositionMonitor] Message: ${decision.reasoning.substring(0, 100)}...`);
    } catch (error) {
      console.error('[PositionMonitor] Error checking periodic wellness:', error);
    }
  }

  /**
   * Check for mid-trade triggers (drawdown alerts, profit milestones)
   * Creates AI conversation messages and notifications when triggered
   */
  private async checkMidTradeTriggers(
    position: MonitoredPosition,
    currentPrice: number,
    currentPnl: number
  ): Promise<void> {
    try {
      const now = Date.now();
      const lastCheck = this.lastMidTradeCheck.get(position.id) || 0;

      if (now - lastCheck < this.midTradeCheckInterval) {
        return;
      }

      this.lastMidTradeCheck.set(position.id, now);

      const risk = Math.abs(position.entry_price - position.stop_loss);
      const isLong = position.direction === 'buy';
      const priceDiff = isLong
        ? (currentPrice - position.entry_price)
        : (position.entry_price - currentPrice);
      const riskRatio = priceDiff / risk;

      const distanceToSL = Math.abs(currentPrice - position.stop_loss);
      const slProximity = distanceToSL / risk;

      let triggerType: string | null = null;
      let alertMessage: string | null = null;
      let priority: 'low' | 'medium' | 'high' | 'critical' = 'medium';

      if (slProximity < 0.15) {
        triggerType = 'near_sl';
        alertMessage = `ALERT: ${position.symbol} is very close to stop loss! Currently ${(slProximity * 100).toFixed(1)}% away. Price: ${currentPrice.toFixed(5)}, SL: ${position.stop_loss.toFixed(5)}. The trade may close soon if price continues in this direction.`;
        priority = 'critical';
      } else if (riskRatio <= -0.70) {
        triggerType = 'drawdown_0.70R';
        alertMessage = `CRITICAL: ${position.symbol} is down 70% of risk (-0.70R). Current P&L: $${currentPnl.toFixed(2)}. Price is at ${currentPrice.toFixed(5)}. This trade is approaching stop loss territory.`;
        priority = 'critical';
      } else if (riskRatio <= -0.50) {
        triggerType = 'drawdown_0.50R';
        alertMessage = `WARNING: ${position.symbol} is down 50% of risk (-0.50R). Current P&L: $${currentPnl.toFixed(2)}. Price is at ${currentPrice.toFixed(5)}. Monitoring this position closely for potential reversal or stop loss hit.`;
        priority = 'high';
      } else if (riskRatio <= -0.30) {
        triggerType = 'drawdown_0.30R';
        alertMessage = `UPDATE: ${position.symbol} is down 30% of risk (-0.30R). Current P&L: $${currentPnl.toFixed(2)}. Price is at ${currentPrice.toFixed(5)}. This is normal market fluctuation, but I'm keeping an eye on it.`;
        priority = 'medium';
      }

      const timeInTrade = position.opened_at
        ? (now - new Date(position.opened_at).getTime()) / 1000 / 60
        : 0;

      if (!triggerType && timeInTrade > 60) {
        const hours = Math.floor(timeInTrade / 60);
        if (hours > 0 && hours % 2 === 0) {
          triggerType = 'time_update';
          alertMessage = `Trade Update: ${position.symbol} has been open for ${hours} hours. Current P&L: $${currentPnl.toFixed(2)}. Price: ${currentPrice.toFixed(5)}. ${currentPnl >= 0 ? 'Trade is currently profitable.' : 'Trade is currently in drawdown but within acceptable risk parameters.'}`;
          priority = 'low';
        }
      }

      if (triggerType && alertMessage) {
        const existingTrigger = await supabase
          .from('goal_ai_conversations')
          .select('id')
          .eq('trade_id', position.id)
          .eq('conversation_type', 'mid_trade_alert')
          .contains('metadata', { trigger_type: triggerType })
          .maybeSingle();

        if (!existingTrigger) {
          await supabase.from('goal_ai_conversations').insert({
            goal_session_id: position.goal_session_id,
            user_id: position.user_id,
            role: 'ai',
            content: alertMessage,
            conversation_type: 'mid_trade_alert',
            trade_id: position.id,
            metadata: {
              trigger_type: triggerType,
              current_price: currentPrice,
              current_pnl: currentPnl,
              risk_ratio: riskRatio.toFixed(3),
              sl_proximity: slProximity.toFixed(3),
              time_in_trade_minutes: Math.floor(timeInTrade)
            }
          });

          await notificationCoordinator.sendSystemNotification({
            userId: position.user_id,
            type: 'mid_trade_alert',
            title: `Trade Alert: ${position.symbol}`,
            message: alertMessage,
            tradeId: position.id,
            sessionId: position.goal_session_id,
            priority: priority,
            metadata: {
              trade_id: position.id,
              symbol: position.symbol,
              trigger_type: triggerType,
              current_pnl: currentPnl
            },
          });

          console.log(`[PositionMonitor] 🔔 Mid-trade trigger fired: ${triggerType} for ${position.symbol}`);
        }
      }
    } catch (error) {
      console.error('[PositionMonitor] Error checking mid-trade triggers:', error);
    }
  }

  private async handleTP1Hit(
    position: MonitoredPosition,
    tp1Price: number
  ): Promise<void> {
    try {
      console.log(`[PositionMonitor] 🎯 TP1 Hit for ${position.symbol} at ${tp1Price.toFixed(5)}`);

      const { error: updateError } = await supabase
        .from('goal_session_trades')
        .update({
          tp1_hit_at: new Date().toISOString(),
          tp1_price: tp1Price,
        })
        .eq('id', position.id)
        .eq('user_id', position.user_id);

      if (updateError) {
        console.error('[PositionMonitor] Failed to mark TP1 hit:', updateError);
        return;
      }

      await notificationCoordinator.send({
        userId: position.user_id,
        type: 'take_profit_hit',
        title: `TP1 Hit: ${position.symbol}`,
        message: `First take profit level reached at ${tp1Price.toFixed(5)}. Trade is now risk-free and running for TP2.`,
        tradeId: position.id,
        sessionId: position.goal_session_id,
        priority: 'medium',
        metadata: {
          symbol: position.symbol,
          tp1_price: tp1Price,
          tp_level: 'tp1',
        },
      });

      await supabase.from('goal_ai_conversations').insert({
        goal_session_id: position.goal_session_id,
        user_id: position.user_id,
        role: 'ai',
        content: `Excellent progress! ${position.symbol} reached TP1 at ${tp1Price.toFixed(5)}. The trade is now protected and running towards TP2 for maximum profit.`,
        conversation_type: 'trade_milestone',
        trade_id: position.id,
        metadata: {
          milestone_type: 'tp1_hit',
          tp1_price: tp1Price,
        }
      });

      console.log(`[PositionMonitor] TP1 hit processed successfully for ${position.symbol}`);
    } catch (error) {
      console.error('[PositionMonitor] Error handling TP1 hit:', error);
    }
  }

  private async autoClosePosition(
    position: MonitoredPosition,
    closePrice: number,
    reason: 'stop_loss' | 'take_profit' | 'goal_met'
  ) {
    try {
      // AUTHORITY: All closures go through tradeClosureCoordinator
      // The coordinator handles: RPC call, P&L calculation, balance update,
      // notification sending, goal checking, and session status updates
      const closeReason: CloseReason = reason === 'goal_met' ? 'goal_achieved' : reason;

      const result = await tradeClosureCoordinator.closeTrade({
        tradeId: position.id,
        currentPrice: closePrice,
        closeReason,
        userId: position.user_id,
        goalSessionId: position.goal_session_id,
        forceClose: false,
      });

      if (result.success && result.pnl !== undefined) {
        const displayReason = reason === 'stop_loss' ? 'SL' : reason === 'take_profit' ? 'TP' : 'GOAL MET';
        prodLogger.position(
          `AUTO-CLOSED (${displayReason})`,
          position.symbol,
          result.pnl
        );

        // Insert AI conversation message for FloatingMessageCenter
        const conversationMessage = reason === 'stop_loss'
          ? `Stop loss was hit on ${position.symbol}. The trade closed at ${closePrice.toFixed(5)} with a loss of $${Math.abs(result.pnl).toFixed(2)}. This is a normal part of trading - we protected our capital by exiting at our predetermined risk level.`
          : reason === 'take_profit'
          ? `Excellent! Take profit was hit on ${position.symbol}. The trade closed at ${closePrice.toFixed(5)} with a profit of $${result.pnl.toFixed(2)}. The market moved as predicted and we successfully captured our target.`
          : `Outstanding! Your goal has been achieved! The ${position.symbol} trade reached your target profit of $${result.pnl.toFixed(2)}. Well done on this successful trade.`;

        await supabase.from('goal_ai_conversations').insert({
          goal_session_id: position.goal_session_id,
          user_id: position.user_id,
          role: 'ai',
          content: conversationMessage,
          conversation_type: 'trade_closure',
          trade_id: position.id,
          metadata: {
            close_reason: reason,
            symbol: position.symbol,
            pnl: result.pnl,
            entry_price: position.entry_price,
            exit_price: closePrice
          }
        });

        console.log(`[PositionMonitor] Created AI conversation message for ${reason} on ${position.symbol}`);

        // Create persistent modal for user
        const { data: closedTrades } = await supabase
          .from('goal_session_trades')
          .select('profit_loss')
          .eq('goal_session_id', position.goal_session_id)
          .eq('status', 'closed');

        const cumulativeProfit = closedTrades?.reduce((sum, t) => sum + (t.profit_loss || 0), 0) || 0;

        const { data: session } = await supabase
          .from('goal_sessions')
          .select('target_value, status')
          .eq('id', position.goal_session_id)
          .maybeSingle();

        const { data: tradesCount } = await supabase
          .from('goal_session_trades')
          .select('id', { count: 'exact' })
          .eq('goal_session_id', position.goal_session_id);

        const { modalQueueManager } = await import('./modal-queue-manager');
        const modalType = reason === 'goal_met' ? 'goal_achieved' : 'trade_closed';

        await modalQueueManager.createPendingModal(
          position.user_id,
          position.goal_session_id,
          modalType,
          {
            symbol: position.symbol,
            direction: position.direction,
            entry_price: position.entry_price,
            exit_price: closePrice,
            profit_loss: result.pnl,
            close_reason: reason,
            current_progress: cumulativeProfit,
            target_value: session?.target_value || 0,
            trades_in_session: tradesCount?.length || 0,
            session_status: session?.status
          }
        );

        console.log(`[PositionMonitor] Created persistent modal for ${reason} on ${position.symbol}`);

        // Goal achievement is already handled by coordinator
        if (result.goalAchieved) {
          console.log(`[PositionMonitor] Goal achievement processed by coordinator`);
        }
      } else if (!result.success) {
        console.error(`[PositionMonitor] Coordinator closure failed: ${result.error}`);
      }

      // Clear mid-trade notifications if no open trades remain
      // (Session status transition is handled by coordinator)
      const { data: otherTrades } = await supabase
        .from('goal_session_trades')
        .select('id')
        .eq('goal_session_id', position.goal_session_id)
        .eq('status', 'open');

      if (!otherTrades || otherTrades.length === 0) {
        const { midTradeNotificationQueue } = await import('./mid-trade-notification-queue');
        await midTradeNotificationQueue.clearSessionNotifications(position.goal_session_id);
      }
    } catch (error) {
      console.error(`[PositionMonitor] Failed to auto-close position ${position.id}:`, error);
    }
  }
}

export const positionMonitorService = new PositionMonitorService();

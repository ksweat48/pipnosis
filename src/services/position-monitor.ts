import { supabase } from '@/lib/supabase';
import SystemTableRPCWrapper from './system-table-rpc-wrapper';
import { globalPollingCoordinator } from './global-polling-coordinator';
import { logger, LogCategory } from '@/lib/logger';
import type { GoalSessionTrade } from '@/types/position';
import { calculatePnL } from '@/types/position';
import { midTradeTriggerDetector } from './mid-trade-trigger-detector';
import type { MarketConditions } from './mid-trade-trigger-detector';
import { tradeClosureCoordinator, type CloseReason } from './coordinators/trade-closure-coordinator';
import { goalAchievementCoordinator } from './coordinators/goal-achievement-coordinator';
import { notificationCoordinator } from './coordinators/notification-coordinator';
import { goalSessionStateMachine } from './coordinators/goal-session-state-machine';
import { TIME_MS } from '@/config/time-constants';
import { marketDataService } from './market-data-service';
import { tradeProcessingLockService } from './trade-processing-lock-service';
import { positionMonitoringAuthority } from './monitoring/position-monitoring-authority';
import type { MonitoredPosition, PriceData } from './monitoring/position-monitoring-authority';

class PositionMonitorService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private criticalPositionIntervalId: NodeJS.Timeout | null = null;
  private normalPositionIntervalId: NodeJS.Timeout | null = null;
  private criticalSymbols: Set<string> = new Set();
  private updateRetryCount: Map<string, number> = new Map();
  private maxRetries = 3;
  private lastMidTradeCheck: Map<string, number> = new Map();
  private midTradeCheckInterval = 60000;
  private lastStaleWarning: Map<string, number> = new Map();
  private staleWarningThrottle = 300000;
  private cachedUser: { id: string; expiresAt: number } | null = null;
  private lastWrittenPrices: Map<string, { price: number; writtenAt: number }> = new Map();
  private priceWriteThrottleMs = 5000;
  private priceChangeThreshold = 0.001;
  private batchPriceCache: Map<string, { bid: number; ask: number; ageMs: number }> = new Map();
  private batchPriceFetchedAt = 0;

  private async getCachedUserId(): Promise<string | null> {
    if (this.cachedUser && Date.now() < this.cachedUser.expiresAt) {
      return this.cachedUser.id;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      this.cachedUser = { id: user.id, expiresAt: Date.now() + 30000 };
    }
    return user?.id || null;
  }

  private shouldWritePrice(positionId: string, currentPrice: number): boolean {
    const last = this.lastWrittenPrices.get(positionId);
    if (!last) return true;
    const timeSinceWrite = Date.now() - last.writtenAt;
    if (timeSinceWrite < this.priceWriteThrottleMs) {
      const pctChange = Math.abs(currentPrice - last.price) / last.price;
      return pctChange >= this.priceChangeThreshold;
    }
    return true;
  }

  private recordPriceWrite(positionId: string, price: number): void {
    this.lastWrittenPrices.set(positionId, { price, writtenAt: Date.now() });
  }

  start() {
    if (this.isRunning) return;

    logger.debug(LogCategory.POSITION_MONITOR, 'Starting position monitor service');
    this.isRunning = true;

    this.monitorPositions();
    this.criticalPositionIntervalId = setInterval(() => this.monitorCriticalPositions(), 500);
    this.normalPositionIntervalId = setInterval(() => this.monitorNormalPositions(), 2000);
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
    this.cachedUser = null;
    this.lastWrittenPrices.clear();
    logger.debug(LogCategory.POSITION_MONITOR, ' Stopped position monitor service');
  }

  async monitorPositions() {
    try {
      const userId = await this.getCachedUserId();
      if (!userId) return;

      const result = await positionMonitoringAuthority.getMonitorablePositions(userId, false);

      if (!result.success) {
        if (result.accessDenied) {
          logger.error(LogCategory.POSITION_MONITOR, 'Access denied:', result.error);
        } else {
          logger.error(LogCategory.POSITION_MONITOR, 'Error fetching positions:', result.error);
        }
        return;
      }

      if (result.positions.length === 0) {
        this.criticalSymbols.clear();
        return;
      }

      const symbols = Array.from(new Set(result.positions.map(p => p.symbol)));

      symbols.forEach(symbol => {
        globalPollingCoordinator.setSymbolHasPosition(symbol, true);
      });

      this.updateCriticalSymbols(result.positions as any[]); // Cast needed for legacy compatibility
    } catch (error) {
      // Suppress AbortError - it's expected when database is initializing
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
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
    if (!this.shouldWritePrice(positionId, currentPrice)) {
      return true;
    }

    const currentRetries = this.updateRetryCount.get(positionId) || 0;

    const { data: currentPosition } = await supabase
      .from('goal_session_trades')
      .select('max_drawdown, max_profit')
      .eq('id', positionId)
      .eq('user_id', userId)
      .maybeSingle();

    const currentMaxDrawdown = currentPosition?.max_drawdown || 0;
    const currentMaxProfit = currentPosition?.max_profit || 0;
    const newMaxDrawdown = pnl < currentMaxDrawdown ? pnl : currentMaxDrawdown;
    const newMaxProfit = pnl > currentMaxProfit ? pnl : currentMaxProfit;

    const { error: updateError } = await supabase
      .from('goal_session_trades')
      .update({
        current_price: currentPrice,
        current_pnl: pnl,
        max_drawdown: newMaxDrawdown,
        max_profit: newMaxProfit
      })
      .eq('id', positionId)
      .eq('user_id', userId)
      .eq('status', 'open');

    if (!updateError) {
      this.updateRetryCount.delete(positionId);
      this.recordPriceWrite(positionId, currentPrice);
      return true;
    }

    this.updateRetryCount.set(positionId, currentRetries + 1);

    if (currentRetries >= this.maxRetries) {
      this.updateRetryCount.delete(positionId);
      return false;
    }

    const backoffMs = 1000 * (currentRetries + 1);
    await new Promise(resolve => setTimeout(resolve, backoffMs));

    return false;
  }

  private async fetchBatchPrices(symbols: string[]): Promise<void> {
    if (symbols.length === 0) return;
    if (Date.now() - this.batchPriceFetchedAt < 400) return;

    try {
      const { data: prices } = await supabase
        .from('realtime_prices')
        .select('symbol, bid, ask, created_at')
        .in('symbol', symbols)
        .order('created_at', { ascending: false });

      if (!prices) return;

      const seen = new Set<string>();
      for (const p of prices) {
        if (seen.has(p.symbol)) continue;
        seen.add(p.symbol);
        const ageMs = Date.now() - new Date(p.created_at).getTime();
        if (ageMs < 120000) {
          this.batchPriceCache.set(p.symbol, {
            bid: parseFloat(p.bid),
            ask: parseFloat(p.ask),
            ageMs
          });
        }
      }
      this.batchPriceFetchedAt = Date.now();
    } catch (error) {
      logger.warn(LogCategory.POSITION_MONITOR, 'Batch price fetch failed:', error);
    }
  }

  getBatchPrice(symbol: string): { bid: number; ask: number } | null {
    const cached = this.batchPriceCache.get(symbol);
    if (!cached) return null;
    if (Date.now() - this.batchPriceFetchedAt > 5000) return null;
    return { bid: cached.bid, ask: cached.ask };
  }

  private async monitorCriticalPositions(): Promise<void> {
    if (this.criticalSymbols.size === 0) return;

    try {
      const userId = await this.getCachedUserId();
      if (!userId) return;

      const { data: positions, error } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'open')
        .in('symbol', Array.from(this.criticalSymbols));

      if (error) throw error;
      if (!positions || positions.length === 0) return;

      const symbols = [...new Set(positions.map(p => p.symbol))];
      await this.fetchBatchPrices(symbols);

      for (const position of positions) {
        await this.updatePositionWithPriority(position, 'critical');
      }
    } catch (error) {
      console.error('[PositionMonitor] Error monitoring critical positions:', error);
    }
  }

  private async monitorNormalPositions(): Promise<void> {
    try {
      const userId = await this.getCachedUserId();
      if (!userId) return;

      const { data: positions, error } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['open', 'pending']);

      if (error) throw error;
      if (!positions || positions.length === 0) return;

      const symbols = [...new Set(positions.map(p => p.symbol))];
      await this.fetchBatchPrices(symbols);

      for (const position of positions) {
        if (position.status === 'open' && !this.criticalSymbols.has(position.symbol)) {
          await this.updatePositionWithPriority(position, 'high');
        } else if (position.status === 'pending') {
          await this.checkPendingOrderWithPriority(position, 'normal');
        }
      }
    } catch (error) {
      // Suppress AbortError - it's expected when database is initializing
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      console.error('[PositionMonitor] Error monitoring normal positions:', error);
    }
  }

  private async updatePositionWithPriority(
    position: MonitoredPosition,
    priority: 'critical' | 'high'
  ): Promise<void> {
    try {
      let currentPrice: number | null = null;
      let bid: number | null = null;
      let ask: number | null = null;
      let priceSource = '';

      const batchPrice = this.getBatchPrice(position.symbol);
      if (batchPrice) {
        bid = batchPrice.bid;
        ask = batchPrice.ask;
        currentPrice = position.direction === 'buy' ? bid : ask;
        priceSource = 'batch_cache';
      }

      if (!currentPrice) {
        const { data: realtimeData, error: realtimeError } = await supabase
          .from('realtime_prices')
          .select('bid, ask, created_at')
          .eq('symbol', position.symbol)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (realtimeData && !realtimeError) {
          const ageMinutes = (Date.now() - new Date(realtimeData.created_at).getTime()) / 1000 / 60;
          if (ageMinutes < 2) {
            bid = parseFloat(realtimeData.bid);
            ask = parseFloat(realtimeData.ask);
            currentPrice = position.direction === 'buy' ? bid : ask;
            priceSource = 'realtime_prices';
          } else {
            const now = Date.now();
            const lastWarning = this.lastStaleWarning.get(position.symbol) || 0;
            if (now - lastWarning > this.staleWarningThrottle) {
              console.error(`[PositionMonitor] STALE PRICE for ${position.symbol}: ${ageMinutes.toFixed(1)}min old`);
              this.lastStaleWarning.set(position.symbol, now);
            }
          }
        }
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

    // ═══════════════════════════════════════════════════════════════════
    // SSOT: Use Position Monitoring Authority for SL/TP decisions
    // ═══════════════════════════════════════════════════════════════════
    // All SL/TP logic is centralized in the authority to ensure:
    // - Single source of truth
    // - Race condition protection (SL always wins)
    // - Consistent TP1/TP2 handling
    // - No duplicate logic across monitors
    // ═══════════════════════════════════════════════════════════════════

    // Convert position to MonitoredPosition format
    const monitoredPosition: MonitoredPosition = {
      id: position.id,
      symbol: position.symbol,
      direction: position.direction,
      entry_price: position.entry_price,
      stop_loss: position.stop_loss,
      take_profit: position.take_profit,
      tp1_price: (position as any).tp1_price || null,
      tp2_price: (position as any).tp2_price || null,
      tp1_hit: (position as any).tp1_hit || false,
      tp2_hit: (position as any).tp2_hit || false,
      position_size: position.position_size,
      lot_size: position.lot_size,
      user_id: position.user_id,
      goal_session_id: position.goal_session_id,
      status: position.status,
      current_price: actualCurrentPrice,
      opened_at: position.opened_at || new Date().toISOString(),
    };

    // Construct price data for authority
    const priceData: PriceData = {
      bid: actualCurrentPrice,
      ask: actualCurrentPrice,
    };

    // SSOT: Delegate SL/TP decision to authority
    const decision = positionMonitoringAuthority.checkSLTP(monitoredPosition, priceData);

    // Log for transparency (critical symbols or any closure decision)
    if (this.criticalSymbols.has(position.symbol) || decision) {
      console.log(`[PositionMonitor] SL/TP Authority Check for ${position.symbol}:`, {
        direction: position.direction,
        currentPrice: actualCurrentPrice.toFixed(5),
        stopLoss: position.stop_loss.toFixed(5),
        takeProfit: position.take_profit.toFixed(5),
        hasDualTP: !!(monitoredPosition.tp1_price && monitoredPosition.tp2_price),
        tp1Price: monitoredPosition.tp1_price?.toFixed(5),
        tp2Price: monitoredPosition.tp2_price?.toFixed(5),
        tp1Hit: monitoredPosition.tp1_hit,
        decision: decision ? ('milestone' in decision ? `TP1 Milestone` : decision.reason) : 'No Action',
        priceSource,
        critical: this.criticalSymbols.has(position.symbol)
      });
    }

    // No closure conditions met
    if (!decision) {
      return;
    }

    // CCIP FIX (2026-03-04 TP1-ONCE-PER-TRADE): TP1 milestone is handled exclusively by
    // realtime-sltp-monitor.ts which uses positionMonitoringAuthority.markTP1Hit() with an
    // optimistic DB lock. position-monitor must NOT fire its own TP1 logic — doing so caused
    // a race condition where both monitors detected TP1 simultaneously and sent duplicate
    // take_profit_hit notifications, producing a blank "manual close" modal alongside the
    // correct TP1 Decision Modal.
    if ('milestone' in decision && decision.milestone === 'tp1') {
      console.log(`[PositionMonitor] TP1 milestone detected for ${position.symbol} — delegated to realtime-sltp-monitor (SSOT)`);
      return;
    }

    // Handle closure decision (SL, TP, TP2)
    if ('shouldClose' in decision && decision.shouldClose) {
      const icon = decision.reason === 'stop_loss' ? '🛑' : '🎯';
      const reasonText = decision.reason === 'stop_loss' ? 'STOP LOSS' :
                         decision.reason === 'take_profit_2' ? 'TP2' : 'TAKE PROFIT';

      console.log(`[PositionMonitor] ${icon} ${reasonText} TRIGGERED for ${position.symbol} at ${decision.price.toFixed(5)}`);
      await this.autoClosePosition(position, decision.price, decision.reason);
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

      // CRITICAL: Pass trade ID and user/session context for comprehensive evaluation
      const decision = await midTradeMonitor.evaluatePeriodicWellness(
        snapshot,
        traderScore,
        position.id, // Trade ID for context retrieval
        position.user_id, // User ID for governance tracking
        position.goal_session_id // Session ID for governance tracking
      );

      // Create comprehensive wellness message for FloatingMessageCenter
      await SystemTableRPCWrapper.createGoalAIConversation(
        position.user_id,
        position.goal_session_id,
        'ai',
        decision.reasoning,
        0,
        'gpt-4',
        {
          conversation_type: 'periodic_wellness',
          trade_id: position.id,
          trigger_type: 'periodic_wellness',
          ...triggerResult.metadata,
          action: decision.action,
          confidence: decision.confidence,
          current_pnl: currentPnL,
          risk_ratio: riskRatio.toFixed(3),
          minutes_in_trade: snapshot.t,
          show_in_floating_center: true
        }
      );

      console.log(`[PositionMonitor] ✅ Comprehensive wellness check completed: ${position.symbol}`);
      console.log(`[PositionMonitor] Decision: ${decision.action} (${decision.confidence}% confidence)`);
      const _reasoningStr = typeof decision.reasoning === 'string' ? decision.reasoning : (decision.reasoning && typeof (decision.reasoning as any).thesis_why === 'string' ? (decision.reasoning as any).thesis_why : JSON.stringify(decision.reasoning) || '');
      console.log(`[PositionMonitor] Message: ${_reasoningStr.substring(0, 100)}...`);
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
          await SystemTableRPCWrapper.createGoalAIConversation(
            position.user_id,
            position.goal_session_id,
            'ai',
            alertMessage,
            0,
            'gpt-4',
            {
              conversation_type: 'mid_trade_alert',
              trade_id: position.id,
              trigger_type: triggerType,
              current_price: currentPrice,
              current_pnl: currentPnl,
              risk_ratio: riskRatio.toFixed(3),
              sl_proximity: slProximity.toFixed(3),
              time_in_trade_minutes: Math.floor(timeInTrade)
            }
          );

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

  // CCIP FIX (2026-03-04 TP1-ONCE-PER-TRADE): handleTP1Hit RETIRED.
  // TP1 detection and processing is owned exclusively by realtime-sltp-monitor.ts.
  // This method previously sent a 'take_profit_hit' notification for an open (non-closed)
  // trade, which the realtime-trade-notification-listener misrouted as a trade closure modal,
  // producing a blank "manual close" dialog alongside the correct TP1 Decision Modal.
  // The TP1 call site above now returns early with a delegation log instead.

  private async autoClosePosition(
    position: MonitoredPosition,
    closePrice: number,
    reason: 'stop_loss' | 'take_profit' | 'goal_met'
  ) {
    // SSOT AUTHORITY: Try to acquire database-backed lock FIRST
    // This prevents multiple monitoring systems from processing the same trade
    const lockAcquired = await tradeProcessingLockService.acquireLock(
      position.id,
      'PositionMonitorService'
    );

    if (!lockAcquired) {
      console.log(`[PositionMonitor] Skipping trade ${position.id} closure - locked by another system`);
      return;
    }

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
        logger.info(LogCategory.POSITION_MONITOR, `AUTO-CLOSED (${displayReason}) ${position.symbol} | P&L: $${result.pnl.toFixed(2)}`);

        // Insert AI conversation message for FloatingMessageCenter
        const conversationMessage = reason === 'stop_loss'
          ? `Stop loss was hit on ${position.symbol}. The trade closed at ${closePrice.toFixed(5)} with a loss of $${Math.abs(result.pnl).toFixed(2)}. This is a normal part of trading - we protected our capital by exiting at our predetermined risk level.`
          : reason === 'take_profit'
          ? `Excellent! Take profit was hit on ${position.symbol}. The trade closed at ${closePrice.toFixed(5)} with a profit of $${result.pnl.toFixed(2)}. The market moved as predicted and we successfully captured our target.`
          : `Outstanding! Your goal has been achieved! The ${position.symbol} trade reached your target profit of $${result.pnl.toFixed(2)}. Well done on this successful trade.`;

        await SystemTableRPCWrapper.createGoalAIConversation(
          position.user_id,
          position.goal_session_id,
          'ai',
          conversationMessage,
          0,
          'gpt-4',
          {
            conversation_type: 'trade_closure',
            trade_id: position.id,
            close_reason: reason,
            symbol: position.symbol,
            pnl: result.pnl,
            entry_price: position.entry_price,
            exit_price: closePrice
          }
        );

        console.log(`[PositionMonitor] Created AI conversation message for ${reason} on ${position.symbol}`);

        // Modal creation is handled exclusively by trade-closure-coordinator.ts via
        // the trade_closure_events Realtime subscription (handleClosureEvent).
        // Creating a modal here was a SSOT violation that produced duplicate modals,
        // wrong modal titles (missing stop_loss/take_profit), and dedup failures.

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
    } finally {
      // SSOT AUTHORITY: Release lock so other systems can process if needed
      await tradeProcessingLockService.releaseLock(position.id);
    }
  }
}

export const positionMonitorService = new PositionMonitorService();

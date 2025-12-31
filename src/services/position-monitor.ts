import { supabase } from '@/lib/supabase';
import { positionService } from './position-service';
import { globalPollingCoordinator } from './global-polling-coordinator';
import { logger, LogCategory, LogLevel } from '@/lib/logger';
import type { GoalSessionTrade } from '@/types/position';
import { calculatePnL } from '@/types/position';
import { prodLogger } from '@/lib/production-logger';
import { midTradeTriggerDetector } from './mid-trade-trigger-detector';
import type { MarketConditions, GoalContext } from './mid-trade-trigger-detector';
import { priceCoordinator } from './coordinators/price-coordinator';
import { tradeClosureCoordinator } from './coordinators/trade-closure-coordinator';
import { goalAchievementCoordinator } from './coordinators/goal-achievement-coordinator';
import { TIME_MS } from '@/config/time-constants';

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

  start() {
    if (this.isRunning) return;

    logger.debug(LogCategory.POSITION_MONITOR, ' Starting position monitor service with adaptive polling');
    this.isRunning = true;

    this.monitorPositions();
    this.criticalPositionIntervalId = setInterval(() => this.monitorCriticalPositions(), 2000);
    this.normalPositionIntervalId = setInterval(() => this.monitorNormalPositions(), 3000);
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

      const isNearSLorTP = (distanceToSL / priceRange < 0.15) || (distanceToTP / priceRange < 0.15);

      if (isNearSLorTP) {
        newCriticalSymbols.add(position.symbol);
      }
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

        // Only use if less than 5 minutes old
        if (ageMinutes < 5) {
          bid = parseFloat(realtimeData.bid);
          ask = parseFloat(realtimeData.ask);
          currentPrice = position.direction === 'buy' ? bid : ask;
          priceSource = 'realtime_prices';
          console.log(`[PositionMonitor] ${position.symbol}: Using realtime_prices (${ageMinutes.toFixed(1)}m old)`);
        } else {
          console.warn(`[PositionMonitor] ${position.symbol}: realtime_prices stale (${ageMinutes.toFixed(1)}m old), trying fallback`);
        }
      } else if (realtimeError) {
        console.warn(`[PositionMonitor] ${position.symbol}: realtime_prices error:`, realtimeError);
      }

      // SOURCE 2: forex_candles table (5m close price)
      if (!currentPrice) {
        const { data: candleData, error: candleError } = await supabase
          .from('forex_candles')
          .select('close, high, low')
          .eq('symbol', position.symbol)
          .eq('timeframe', '5m')
          .order('timestamp', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (candleData && !candleError) {
          currentPrice = parseFloat(candleData.close);
          // Approximate bid/ask from candle high/low
          const high = parseFloat(candleData.high);
          const low = parseFloat(candleData.low);
          const spread = (high - low) * 0.1; // Estimate 10% of range as spread
          bid = currentPrice - spread / 2;
          ask = currentPrice + spread / 2;
          priceSource = 'forex_candles';
          console.log(`[PositionMonitor] ${position.symbol}: Using forex_candles fallback`);
        }
      }

      // SOURCE 3: Position's cached price (absolute fallback - may be stale)
      if (!currentPrice && position.current_price) {
        currentPrice = position.current_price;
        bid = currentPrice;
        ask = currentPrice;
        priceSource = 'position_cache';
        console.warn(`[PositionMonitor] ${position.symbol}: Using cached price (STALE WARNING)`);
      }

      if (!currentPrice || !bid || !ask) {
        console.error(`[PositionMonitor] ❌ CRITICAL: No price data for ${position.symbol} from ANY source!`);
        console.error(`[PositionMonitor] This position cannot be monitored for SL/TP!`);

        // Create alert notification
        await supabase.from('goal_notifications').insert({
          goal_session_id: position.goal_session_id,
          user_id: position.user_id,
          type: 'system_alert',
          priority: 'urgent',
          title: '⚠️ Price Data Unavailable',
          message: `Cannot monitor ${position.symbol} - no price data available. Position may not close at SL/TP automatically!`,
          metadata: {
            trade_id: position.id,
            symbol: position.symbol,
            issue: 'no_price_data'
          },
          channels: ['in_app']
        });

        return;
      }

      await this.updateOpenPosition(position, { bid, ask }, currentPrice);
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
      if (!bid || !ask) {
        const { data: candleData } = await supabase
          .from('forex_candles')
          .select('close, high, low')
          .eq('symbol', order.symbol)
          .eq('timeframe', '5m')
          .order('timestamp', { ascending: false })
          .limit(1)
          .maybeSingle();

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
    currentPrice?: number
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

    // CRITICAL: Check if goal is reached FIRST (before SL/TP check)
    let shouldCloseForGoal = false;
    if (position.goal_session_id) {
      const { data: goalSession } = await supabase
        .from('goal_sessions')
        .select('target_value, auto_close_on_goal, goal_achieved_at')
        .eq('id', position.goal_session_id)
        .maybeSingle();

      if (goalSession && !goalSession.goal_achieved_at && pnl >= goalSession.target_value) {
        // SAFETY CHECK: Never trigger goal achievement on negative P&L
        // This prevents a bug where sign inversion could cause false goal triggers
        if (pnl < 0) {
          console.error(`[PositionMonitor] ⚠️ PREVENTED FALSE GOAL TRIGGER: P&L is ${pnl.toFixed(2)} (NEGATIVE) but checked >= ${goalSession.target_value}. This indicates a bug in P&L calculation!`);
          return;
        }

        console.log(`[PositionMonitor] 🎯 GOAL REACHED! Target: $${goalSession.target_value}, Current P&L: $${pnl.toFixed(2)}`);

        // Mark goal as met (even if auto-close is disabled, we track this)
        await supabase
          .from('goal_session_trades')
          .update({
            goal_met_at: new Date().toISOString(),
            goal_met_price: actualCurrentPrice,
            unrealized_goal_achievement: true
          })
          .eq('id', position.id);

        await supabase
          .from('goal_sessions')
          .update({
            goal_achieved_at: new Date().toISOString(),
            goal_achieved_pnl: pnl
          })
          .eq('id', position.goal_session_id);

        // Create permanent achievement record
        await supabase.from('goal_achievements').insert({
          user_id: user.id,
          goal_session_id: position.goal_session_id,
          achieved_pnl: pnl,
          target_amount: goalSession.target_value,
          trade_id: position.id,
          symbol: position.symbol,
          entry_price: position.entry_price,
          current_price_at_achievement: actualCurrentPrice,
          take_profit: position.take_profit,
          stop_loss_before: position.stop_loss
        });

        if (goalSession.auto_close_on_goal !== false) {
          console.log(`[PositionMonitor] Auto-close enabled - closing position at goal`);
          shouldCloseForGoal = true;
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

    const shouldCloseAtTakeProfit = position.direction === 'buy'
      ? actualCurrentPrice >= position.take_profit
      : actualCurrentPrice <= position.take_profit;

    if (shouldCloseAtStopLoss) {
      await this.autoClosePosition(position, actualCurrentPrice, 'stop_loss');
    } else if (shouldCloseAtTakeProfit) {
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
      let priority: 'low' | 'medium' | 'high' | 'urgent' = 'medium';

      if (slProximity < 0.15) {
        triggerType = 'near_sl';
        alertMessage = `ALERT: ${position.symbol} is very close to stop loss! Currently ${(slProximity * 100).toFixed(1)}% away. Price: ${currentPrice.toFixed(5)}, SL: ${position.stop_loss.toFixed(5)}. The trade may close soon if price continues in this direction.`;
        priority = 'urgent';
      } else if (riskRatio <= -0.70) {
        triggerType = 'drawdown_0.70R';
        alertMessage = `CRITICAL: ${position.symbol} is down 70% of risk (-0.70R). Current P&L: $${currentPnl.toFixed(2)}. Price is at ${currentPrice.toFixed(5)}. This trade is approaching stop loss territory.`;
        priority = 'urgent';
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

          await supabase.from('goal_notifications').insert({
            goal_session_id: position.goal_session_id,
            user_id: position.user_id,
            type: 'mid_trade_alert',
            priority: priority,
            title: `Trade Alert: ${position.symbol}`,
            message: alertMessage,
            metadata: {
              trade_id: position.id,
              symbol: position.symbol,
              trigger_type: triggerType,
              current_pnl: currentPnl
            },
            channels: ['in_app']
          });

          console.log(`[PositionMonitor] 🔔 Mid-trade trigger fired: ${triggerType} for ${position.symbol}`);
        }
      }
    } catch (error) {
      console.error('[PositionMonitor] Error checking mid-trade triggers:', error);
    }
  }

  private async autoClosePosition(
    position: MonitoredPosition,
    closePrice: number,
    reason: 'stop_loss' | 'take_profit' | 'goal_met'
  ) {
    try {
      // Use the secure RPC function to close
      // CRITICAL: Pass userId and goalSessionId so journal entries get created
      const result = await positionService.closePosition(
        position.id,
        closePrice,
        reason,
        position.user_id,
        position.goal_session_id
      );

      if (result.success && result.pnl !== undefined) {
        const displayReason = reason === 'stop_loss' ? 'SL' : reason === 'take_profit' ? 'TP' : 'GOAL MET';
        prodLogger.position(
          `AUTO-CLOSED (${displayReason})`,
          position.symbol,
          result.pnl
        );

        // Send notification for all close types
        const notificationConfig = {
          goal_met: {
            type: 'goal_achieved' as const,
            priority: 'urgent' as const,
            title: '🎯 Goal Achieved!',
            message: `Your goal has been reached! Trade closed at $${result.pnl.toFixed(2)} profit.`
          },
          take_profit: {
            type: 'trade_closed' as const,
            priority: 'high' as const,
            title: '✅ Take Profit Hit!',
            message: `Trade on ${position.symbol} closed at take profit. Profit: $${result.pnl.toFixed(2)}`
          },
          stop_loss: {
            type: 'trade_closed' as const,
            priority: 'urgent' as const,
            title: '⚠️ Stop Loss Hit',
            message: `Trade on ${position.symbol} closed at stop loss. Loss: $${result.pnl.toFixed(2)}`
          }
        };

        const config = notificationConfig[reason];
        if (config) {
          // Insert notification for in-app alerts
          await supabase.from('goal_notifications').insert({
            goal_session_id: position.goal_session_id,
            user_id: position.user_id,
            type: config.type,
            priority: config.priority,
            title: config.title,
            message: config.message,
            metadata: {
              trade_id: position.id,
              symbol: position.symbol,
              direction: position.direction,
              entry_price: position.entry_price,
              exit_price: closePrice,
              profit_loss: result.pnl,
              close_reason: reason
            },
            channels: ['in_app']
          });

          // ALSO insert AI conversation message so it appears in FloatingMessageCenter
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

          console.log(`[PositionMonitor] ✅ Created AI conversation message for ${reason} on ${position.symbol}`);
        }

        // CRITICAL: Create persistent modal that will show even if user is away
        // Calculate cumulative progress for session
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

        // Import and use modal queue manager
        const { modalQueueManager } = await import('./modal-queue-manager');

        const modalType = reason === 'goal_met' ? 'goal_achieved' : 'trade_closed';

        // Create persistent modal
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

        console.log(`[PositionMonitor] ✅ Created persistent modal for ${reason} on ${position.symbol}`);
      }

      // Update goal session status if no more open trades
      const { data: otherTrades } = await supabase
        .from('goal_session_trades')
        .select('id')
        .eq('goal_session_id', position.goal_session_id)
        .eq('status', 'open');

      if (!otherTrades || otherTrades.length === 0) {
        // Database trigger handles soft_closing → expired and in_trade → scanning
        // Only override status here if goal was achieved
        if (reason === 'goal_met') {
          await supabase
            .from('goal_sessions')
            .update({ status: 'goal_achieved' })
            .eq('id', position.goal_session_id);
        }

        // Clear mid-trade notifications when session completes
        const { midTradeNotificationQueue } = await import('./mid-trade-notification-queue');
        await midTradeNotificationQueue.clearSessionNotifications(position.goal_session_id);
      }
    } catch (error) {
      console.error(`[PositionMonitor] Failed to auto-close position ${position.id}:`, error);
    }
  }
}

export const positionMonitorService = new PositionMonitorService();

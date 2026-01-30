import { supabase } from '../lib/supabase';
import { goalSessionManager } from './goal-session-manager';
import { counterfactualEngine } from './counterfactual-engine';
import { CandleData } from './candle-data-service';
import { strategyPlaybookManager } from './strategy-playbook-manager';
import { calculateDollarPerPip, calculatePipDistance } from '../utils/currencyHelpers';
import { calculatePnL } from '../types/position';
import {
  goalAchievementCoordinator,
  goalSessionStateMachine,
  priceCoordinator,
  tradeClosureCoordinator,
} from './coordinators';
import { MarketDataService, marketDataService } from './market-data-service';
import { tradeProcessingLockService } from './trade-processing-lock-service';

export interface PriceUpdate {
  symbol: string;
  bid: number;
  ask: number;
  created_at: Date;
}

class TradeLifecycleManager {
  private monitoringInterval: number | null = null;
  private isMonitoring: boolean = false;
  private abortController: AbortController | null = null;
  private recentlyClosedTrades = new Set<string>();
  private tradesBeingProcessed = new Set<string>();

  /**
   * Calculate cumulative profit for a goal session across all closed trades
   */
  async getCumulativeProfit(goalSessionId: string): Promise<number> {
    try {
      const { data: closedTrades, error } = await supabase
        .from('goal_session_trades')
        .select('profit_loss')
        .eq('goal_session_id', goalSessionId)
        .eq('status', 'closed');

      if (error) {
        console.error('[Trade Lifecycle] Error calculating cumulative profit:', error);
        return 0;
      }

      if (!closedTrades || closedTrades.length === 0) {
        return 0;
      }

      const totalProfit = closedTrades.reduce((sum, trade) => {
        return sum + (trade.profit_loss || 0);
      }, 0);

      return totalProfit;
    } catch (error) {
      console.error('[Trade Lifecycle] Error in getCumulativeProfit:', error);
      return 0;
    }
  }

  /**
   * Update goal session progress after trade closes
   */
  async updateGoalProgress(
    goalSessionId: string,
    cumulativeProfit: number,
    targetValue: number
  ): Promise<void> {
    try {
      const progressPercentage = (cumulativeProfit / targetValue) * 100;

      await supabase
        .from('goal_sessions')
        .update({
          current_progress: cumulativeProfit,
          progress_percentage: progressPercentage,
          updated_at: new Date().toISOString()
        })
        .eq('id', goalSessionId);

      // Create progress snapshot
      await supabase.from('goal_progress_snapshots').insert({
        goal_session_id: goalSessionId,
        progress_amount: cumulativeProfit,
        progress_percentage: progressPercentage,
        snapshot_time: new Date().toISOString()
      });

      console.log(`[Trade Lifecycle] 📊 Progress updated: $${cumulativeProfit.toFixed(2)} / $${targetValue.toFixed(2)} (${progressPercentage.toFixed(1)}%)`);
    } catch (error) {
      console.error('[Trade Lifecycle] Error updating goal progress:', error);
    }
  }

  /**
   * Check if cumulative goal has been achieved across multiple trades
   *
   * AUTHORITY: goalAchievementCoordinator is the SOLE authority for goal achievement.
   * This method delegates to the coordinator to ensure single source of truth.
   */
  async checkCumulativeGoalAchievement(
    goalSessionId: string,
    cumulativeProfit: number,
    targetValue: number,
    userId: string
  ): Promise<boolean> {
    try {
      if (cumulativeProfit < targetValue) {
        return false;
      }

      console.log(`[Trade Lifecycle] Delegating goal achievement check to coordinator`);

      const result = await goalAchievementCoordinator.checkAndProcessGoalAchievement({
        sessionId: goalSessionId,
        userId,
        targetAmount: targetValue,
        currentCumulativePnL: cumulativeProfit,
      });

      if (result.achieved && result.achievementId) {
        const { data: trades } = await supabase
          .from('goal_session_trades')
          .select('id')
          .eq('goal_session_id', goalSessionId)
          .eq('status', 'closed');

        const tradeCount = trades?.length || 0;
        const avgProfit = tradeCount > 0 ? cumulativeProfit / tradeCount : 0;

        await goalSessionManager.addAIMessage(
          goalSessionId,
          userId,
          `Goal achieved! You've reached your $${targetValue} goal with cumulative profit of $${cumulativeProfit.toFixed(2)} across ${tradeCount} trade(s). ` +
          `Average profit per trade: $${avgProfit.toFixed(2)}. Session complete.`,
          {
            cumulativeProfit,
            targetValue,
            tradeCount,
            achievementType: 'cumulative_multi_trade'
          },
          'celebratory'
        );

        return true;
      }

      return result.achieved;
    } catch (error) {
      console.error('[Trade Lifecycle] Error checking cumulative goal achievement:', error);
      return false;
    }
  }

  async startMonitoring(intervalMs: number = 5000): void {
    if (this.isMonitoring) {
      console.log('[Trade Lifecycle] Already monitoring');
      return;
    }

    this.isMonitoring = true;
    console.log('[Trade Lifecycle] Starting trade monitoring...');

    this.monitorOpenTrades();

    this.monitoringInterval = window.setInterval(() => {
      this.monitorOpenTrades();
    }, intervalMs);
  }

  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      this.isMonitoring = false;

      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }

      console.log('[Trade Lifecycle] Stopped monitoring');
    }
  }

  async monitorOpenTrades(): Promise<void> {
    try {
      this.abortController = new AbortController();

      const timestamp = Date.now();

      let query = supabase
        .from('goal_session_trades')
        .select('*, goal_sessions!inner(user_id, auto_execute)')
        .eq('status', 'open')
        .gte('created_at', new Date(0).toISOString());

      if (this.recentlyClosedTrades.size > 0) {
        const excludedIds = Array.from(this.recentlyClosedTrades);
        query = query.not('id', 'in', `(${excludedIds.join(',')})`);
        console.log(`[Trade Lifecycle] Excluding ${excludedIds.length} recently closed trade(s) from query`);
      }

      const { data: openTrades, error } = await query.abortSignal(this.abortController.signal);

      if (error) {
        if (error.message?.includes('AbortError') || error.code === 'ABORTED') {
          return;
        }
        console.error('[Trade Lifecycle] Error fetching open trades:', error);
        return;
      }

      if (!openTrades || openTrades.length === 0) {
        return;
      }

      console.log(`[Trade Lifecycle] Monitoring ${openTrades.length} open trade(s)`);

      for (const trade of openTrades) {
        await this.checkTradeTargets(trade);
      }
    } catch (error) {
      console.error('[Trade Lifecycle] Error monitoring trades:', error);
    }
  }

  async checkTradeTargets(trade: any): Promise<void> {
    // SSOT AUTHORITY: Try to acquire database-backed lock FIRST
    // This prevents multiple monitoring systems from processing the same trade
    const lockAcquired = await tradeProcessingLockService.acquireLock(
      trade.id,
      'TradeLifecycleManager'
    );

    if (!lockAcquired) {
      console.log(`[Trade Lifecycle] Skipping trade ${trade.id} - locked by another system`);
      return;
    }

    try {
      if (this.tradesBeingProcessed.has(trade.id)) {
        await tradeProcessingLockService.releaseLock(trade.id);
        return;
      }

      if (this.recentlyClosedTrades.has(trade.id)) {
        await tradeProcessingLockService.releaseLock(trade.id);
        return;
      }

      this.tradesBeingProcessed.add(trade.id);

      try {
        const { data: freshTrade, error: fetchError } = await supabase
          .from('goal_session_trades')
          .select('status')
          .eq('id', trade.id)
          .maybeSingle();

        if (fetchError || !freshTrade) {
          console.error(`[Trade Lifecycle] Could not verify trade status:`, fetchError);
          this.tradesBeingProcessed.delete(trade.id);
          return;
        }

        if (freshTrade.status !== 'open') {
          this.tradesBeingProcessed.delete(trade.id);
          return;
        }

      const currentPrice = await this.getCurrentPrice(trade.symbol);
      if (!currentPrice) {
        console.warn(`[Trade Lifecycle] No price data for ${trade.symbol}`);
        return;
      }

      const price = trade.direction === 'buy' ? currentPrice.bid : currentPrice.ask;

      let shouldClose = false;
      let closeReason = '';
      let profitLoss = 0;

      // Calculate current P&L using proper dollar per pip calculation
      const pipDistance = calculatePipDistance(trade.symbol, trade.entry_price, price);
      const dollarPerPip = calculateDollarPerPip(trade.symbol, trade.position_size);
      const unrealizedPnL = trade.direction === 'buy'
        ? pipDistance * dollarPerPip
        : -pipDistance * dollarPerPip;

      // CRITICAL: Check goal completion FIRST
      // AUTHORITY: goalAchievementCoordinator is the SOLE authority for goal achievement
      if (trade.goal_session_id) {
        const { data: goalSession } = await supabase
          .from('goal_sessions')
          .select('target_value, starting_balance, goal_achieved_at, user_id, auto_execute, auto_close_on_goal, current_progress')
          .eq('id', trade.goal_session_id)
          .maybeSingle();

        if (goalSession && !goalSession.goal_achieved_at) {
          const cumulativeProfit = goalSession.current_progress || await this.getCumulativeProfit(trade.goal_session_id);
          const totalProgress = cumulativeProfit + unrealizedPnL;

          if (totalProgress >= goalSession.target_value) {
            console.log(`[Trade Lifecycle] Delegating goal achievement to coordinator`);

            const goalResult = await goalAchievementCoordinator.checkAndProcessGoalAchievement({
              sessionId: trade.goal_session_id,
              userId: goalSession.user_id,
              targetAmount: goalSession.target_value,
              currentCumulativePnL: cumulativeProfit,
            }, unrealizedPnL);

            if (goalResult.achieved) {
              await supabase
                .from('goal_session_trades')
                .update({
                  goal_met_at: new Date().toISOString(),
                  goal_met_price: price,
                  unrealized_goal_achievement: true
                })
                .eq('id', trade.id);

              if (goalSession.auto_close_on_goal !== false) {
                console.log(`[Trade Lifecycle] Auto-close enabled - closing position now`);
                shouldClose = true;
                closeReason = 'goal_met';
                profitLoss = unrealizedPnL;
              }
            }
          }
        } else if (goalSession?.goal_achieved_at) {
          await this.checkDefaultAction(trade, goalSession, unrealizedPnL);
        }
      }

      // Check SL/TP only if goal completion didn't trigger close
      if (!shouldClose) {
        if (trade.direction === 'buy') {
          if (price <= trade.stop_loss) {
            shouldClose = true;
            closeReason = 'stop_loss';
            const pipDistanceSL = calculatePipDistance(trade.symbol, trade.entry_price, trade.stop_loss);
            profitLoss = -Math.abs(pipDistanceSL) * dollarPerPip;
          } else if (price >= trade.take_profit) {
            shouldClose = true;
            closeReason = 'take_profit';
            const pipDistanceTP = calculatePipDistance(trade.symbol, trade.entry_price, trade.take_profit);
            profitLoss = Math.abs(pipDistanceTP) * dollarPerPip;
          }
        } else {
          if (price >= trade.stop_loss) {
            shouldClose = true;
            closeReason = 'stop_loss';
            const pipDistanceSL = calculatePipDistance(trade.symbol, trade.entry_price, trade.stop_loss);
            profitLoss = -Math.abs(pipDistanceSL) * dollarPerPip;
          } else if (price <= trade.take_profit) {
            shouldClose = true;
            closeReason = 'take_profit';
            const pipDistanceTP = calculatePipDistance(trade.symbol, trade.entry_price, trade.take_profit);
            profitLoss = Math.abs(pipDistanceTP) * dollarPerPip;
          }
        }
      }

        if (shouldClose) {
          await this.closeTrade(trade, price, profitLoss, closeReason);
        }
      } finally {
        this.tradesBeingProcessed.delete(trade.id);
        // SSOT AUTHORITY: Release lock so other systems can process if needed
        await tradeProcessingLockService.releaseLock(trade.id);
      }
    } catch (error) {
      console.error(`[Trade Lifecycle] Error checking targets for trade ${trade.id}:`, error);
      this.tradesBeingProcessed.delete(trade.id);
      // SSOT AUTHORITY: Release lock on error
      await tradeProcessingLockService.releaseLock(trade.id);
    }
  }

  /**
   * ✅ PHASE 2: Use MarketDataService as SSOT
   */
  async getCurrentPrice(symbol: string): Promise<PriceUpdate | null> {
    try {
      const marketDataService = MarketDataService.getInstance();
      const priceData = await marketDataService.getCurrentPrice(symbol);

      if (!priceData) {
        // Fallback: Try getting latest candle close price
        const candles = await marketDataService.getCandles(symbol, '15m', 1);
        if (candles && candles.length > 0) {
          const candle = candles[0];
          return {
            symbol,
            bid: candle.close,
            ask: candle.close,
            created_at: new Date(candle.open_time)
          };
        }

        return null;
      }

      return {
        symbol,
        bid: priceData.bid,
        ask: priceData.ask,
        created_at: priceData.timestamp
      };
    } catch (error) {
      console.error(`[Trade Lifecycle] Error getting price for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * DEPRECATED: This method is kept for backwards compatibility but now
   * delegates ALL closure to tradeClosureCoordinator.
   *
   * AUTHORITY: tradeClosureCoordinator is the SOLE authority for trade closures.
   * This method is an orchestrator that:
   * - Calls the coordinator
   * - Handles post-closure orchestration (sounds, AI messages, playbook updates)
   * - Does NOT directly modify trade status or balance
   */
  async closeTrade(
    trade: any,
    exitPrice: number,
    _profitLoss: number,
    reason: string
  ): Promise<void> {
    try {
      if (this.recentlyClosedTrades.has(trade.id)) {
        console.log(`[Trade Lifecycle] Trade ${trade.id} is already being closed, skipping duplicate`);
        return;
      }

      this.recentlyClosedTrades.add(trade.id);

      console.log(`[Trade Lifecycle] Delegating trade closure to coordinator: ${trade.id}`);

      const { tradeClosureCoordinator } = await import('./coordinators/trade-closure-coordinator');

      const userId = trade.goal_sessions?.user_id || trade.user_id;

      const result = await tradeClosureCoordinator.closeTrade({
        tradeId: trade.id,
        currentPrice: exitPrice,
        closeReason: reason as any,
        userId,
        goalSessionId: trade.goal_session_id,
        forceClose: false,
      });

      if (!result.success) {
        console.error(`[Trade Lifecycle] Coordinator closure failed: ${result.error}`);
        this.recentlyClosedTrades.delete(trade.id);
        return;
      }

      setTimeout(() => {
        this.recentlyClosedTrades.delete(trade.id);
      }, 5000);

      const profitLoss = result.pnl || 0;
      const isProfit = profitLoss > 0;

      if (reason === 'take_profit' && isProfit) {
        console.log('[Trade Lifecycle] TP HIT! Playing celebration sound...');
        try {
          const { notificationManager } = await import('./notification-manager');
          notificationManager.playSound('trade_exit');
        } catch (soundError) {
          console.error('[Trade Lifecycle] Failed to play sound:', soundError);
        }
      }

      this.runCounterfactualAnalysis(trade, exitPrice, profitLoss).catch(err => {
        console.error('[Trade Lifecycle] Counterfactual analysis failed:', err);
      });

      let cumulativeProfit = 0;
      let progressPercentage = 0;
      let goalTargetValue = 0;
      let tradesRemaining = 0;

      if (trade.goal_session_id) {
        try {
          const { data: goalSession } = await supabase
            .from('goal_sessions')
            .select('target_value, status')
            .eq('id', trade.goal_session_id)
            .maybeSingle();

          if (goalSession) {
            goalTargetValue = goalSession.target_value;
            cumulativeProfit = await this.getCumulativeProfit(trade.goal_session_id);
            progressPercentage = (cumulativeProfit / goalTargetValue) * 100;

            if (cumulativeProfit > 0 && cumulativeProfit < goalTargetValue) {
              const { data: closedTrades } = await supabase
                .from('goal_session_trades')
                .select('id')
                .eq('goal_session_id', trade.goal_session_id)
                .eq('status', 'closed');

              const tradeCount = closedTrades?.length || 1;
              const avgProfitPerTrade = cumulativeProfit / tradeCount;
              const remainingProfit = goalTargetValue - cumulativeProfit;
              tradesRemaining = Math.ceil(remainingProfit / avgProfitPerTrade);
            }
          }
        } catch (error) {
          console.error('[Trade Lifecycle] Error calculating cumulative progress:', error);
        }
      }

      let progressMessage = `Trade on ${trade.symbol} closed! ${reason}. ${trade.direction.toUpperCase()} position exited at ${exitPrice.toFixed(5)}. ${isProfit ? 'Profit' : 'Loss'}: $${Math.abs(profitLoss).toFixed(2)}. Entry was ${trade.entry_price.toFixed(5)}.`;

      if (trade.goal_session_id && goalTargetValue > 0) {
        progressMessage += `\n\nGoal Progress: $${cumulativeProfit.toFixed(2)} / $${goalTargetValue.toFixed(2)} (${progressPercentage.toFixed(1)}%)`;

        if (cumulativeProfit < goalTargetValue) {
          const remaining = goalTargetValue - cumulativeProfit;
          progressMessage += `\nRemaining: $${remaining.toFixed(2)}`;
          if (tradesRemaining > 0) {
            progressMessage += ` (est. ${tradesRemaining} more trade${tradesRemaining > 1 ? 's' : ''})`;
          }
          progressMessage += `\nContinuing to scan for next high-quality setup...`;
        }
      }

      await goalSessionManager.addAIMessage(
        trade.goal_session_id,
        userId,
        progressMessage,
        {
          trade,
          exitPrice,
          profitLoss,
          reason,
          cumulativeProfit,
          progressPercentage,
          goalTargetValue,
          tradesRemaining
        },
        isProfit ? 'celebratory' : 'neutral'
      );

      if (result.goalAchieved) {
        console.log(`[Trade Lifecycle] Goal achieved via coordinator`);
        try {
          const { goalSessionLiveEngine } = await import('./goal-session-live-engine');
          if (goalSessionLiveEngine.getActiveSessionId() === trade.goal_session_id) {
            await goalSessionLiveEngine.stopSession();
            console.log(`[Trade Lifecycle] Live engine stopped - goal session complete`);
          }
        } catch (error) {
          console.error('[Trade Lifecycle] Error stopping live engine:', error);
        }
      }

      if (trade.playbook_id && userId) {
        try {
          let riskDollars = trade.risk_dollars;
          if (!riskDollars || riskDollars === 0) {
            const slPipDistance = calculatePipDistance(trade.symbol, trade.entry_price, trade.stop_loss);
            const dollarPerPipForRisk = calculateDollarPerPip(trade.symbol, trade.position_size);
            riskDollars = Math.abs(slPipDistance) * dollarPerPipForRisk;
          }
          const pnl_r = riskDollars > 0 ? profitLoss / riskDollars : 0;

          const tpDistance = Math.abs(trade.take_profit - trade.entry_price);
          const slDistance = Math.abs(trade.entry_price - trade.stop_loss);
          const realized_rr = slDistance > 0 ? tpDistance / slDistance : 0;

          const is_win = profitLoss > riskDollars * 0.1;
          const is_loss = profitLoss < -riskDollars * 0.1;
          const is_breakeven = !is_win && !is_loss;

          await strategyPlaybookManager.updatePlaybookStats(
            trade.playbook_id,
            userId,
            { pnl_r, realized_rr, is_win, is_loss, is_breakeven }
          );

          console.log(`[Trade Lifecycle] Updated playbook stats: ${is_win ? 'WIN' : is_loss ? 'LOSS' : 'BE'}, R=${pnl_r.toFixed(2)}`);
        } catch (error) {
          console.error('[Trade Lifecycle] Failed to update playbook stats:', error);
        }
      }

      console.log(`[Trade Lifecycle] Trade ${trade.id} closed successfully via coordinator`);
    } catch (error) {
      console.error('[Trade Lifecycle] Error closing trade:', error);
    }
  }

  async manualCloseTrade(
    tradeId: string,
    userId: string,
    reason: string = 'Manual close by user'
  ): Promise<{ success: boolean; message: string }> {
    try {
      const { data: trade, error: fetchError } = await supabase
        .from('goal_session_trades')
        .select('*, goal_sessions!inner(user_id)')
        .eq('id', tradeId)
        .eq('goal_sessions.user_id', userId)
        .single();

      if (fetchError || !trade) {
        return { success: false, message: 'Trade not found' };
      }

      if (trade.status !== 'open') {
        return { success: false, message: `Trade is ${trade.status}, cannot close` };
      }

      const currentPrice = await this.getCurrentPrice(trade.symbol);
      if (!currentPrice) {
        return { success: false, message: 'Could not get current price' };
      }

      const exitPrice = trade.direction === 'buy' ? currentPrice.bid : currentPrice.ask;

      const { tradeClosureCoordinator } = await import('./coordinators/trade-closure-coordinator');

      const result = await tradeClosureCoordinator.closeTrade({
        tradeId: trade.id,
        currentPrice: exitPrice,
        closeReason: 'manual',
        userId,
        goalSessionId: trade.goal_session_id,
        forceClose: false,
      });

      if (!result.success) {
        return { success: false, message: result.error || 'Failed to close trade' };
      }

      return {
        success: true,
        message: `Trade closed at ${exitPrice.toFixed(5)}. ${(result.pnl || 0) >= 0 ? 'Profit' : 'Loss'}: $${Math.abs(result.pnl || 0).toFixed(2)}`
      };
    } catch (error) {
      console.error('[Trade Lifecycle] Error in manual close:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async getOpenTrades(userId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('goal_session_trades')
        .select('*, goal_sessions!inner(user_id)')
        .eq('goal_sessions.user_id', userId)
        .eq('status', 'open')
        .order('opened_at', { ascending: false });

      if (error) {
        if (error.message?.includes('AbortError') || error.code === 'ABORTED') {
          return [];
        }
        console.error('[Trade Lifecycle] Error fetching open trades:', error);
        return [];
      }

      const tradesWithPrices = await Promise.all(
        (data || []).map(async (trade) => {
          const currentPrice = await this.getCurrentPrice(trade.symbol);
          const price = currentPrice ? (trade.direction === 'buy' ? currentPrice.bid : currentPrice.ask) : trade.entry_price;

          // CRITICAL FIX: Use the correct calculatePnL function that handles signs properly
          // This fixes the bug where BUY losing trades were shown as profits
          const unrealizedPL = calculatePnL(
            trade.direction,
            trade.entry_price,
            price,
            trade.position_size,
            trade.symbol
          );

          return {
            ...trade,
            current_price: price,
            unrealized_pl: unrealizedPL
          };
        })
      );

      return tradesWithPrices;
    } catch (error) {
      console.error('[Trade Lifecycle] Error getting open trades:', error);
      return [];
    }
  }

  async createGoalAchievedNotification(
    userId: string,
    goalSessionId: string,
    trade: any,
    currentPnL: number,
    targetAmount: number,
    currentPrice: number,
    achievementId?: string
  ): Promise<void> {
    try {
      // Calculate potential additional profit to TP
      const tpDistance = calculatePipDistance(trade.symbol, currentPrice, trade.take_profit);
      const tpPotential = currentPnL * (Math.abs(trade.take_profit - trade.entry_price) / Math.abs(currentPrice - trade.entry_price));

      // Calculate breakeven and safety prices
      const breakevenPrice = trade.entry_price;
      const safetyPips = calculatePipDistance(trade.symbol, trade.entry_price, currentPrice) * 0.5;
      const safetyPrice = trade.direction === 'buy'
        ? trade.entry_price + (safetyPips * 0.01)
        : trade.entry_price - (safetyPips * 0.01);

      const notification = {
        user_id: userId,
        goal_session_id: goalSessionId,
        type: 'completion',
        priority: 'high',
        title: '🎯 Goal Achieved!',
        message: `Congratulations! Your $${targetAmount} goal has been reached with current P&L of $${currentPnL.toFixed(2)}. This win is now permanently logged. What would you like to do?`,
        metadata: {
          achievement_id: achievementId,
          trade_id: trade.id,
          symbol: trade.symbol,
          current_pnl: currentPnL,
          target_amount: targetAmount,
          entry_price: trade.entry_price,
          current_price: currentPrice,
          take_profit: trade.take_profit,
          stop_loss: trade.stop_loss,
          tp_potential: tpPotential,
          breakeven_price: breakevenPrice,
          safety_price: safetyPrice
        },
        actions: [
          {
            id: 'close_now',
            label: `Close Now - Lock $${currentPnL.toFixed(0)}`,
            description: 'Exit immediately and secure your profit',
            icon: '💰'
          },
          {
            id: 'continue_breakeven',
            label: `Continue to TP ($${tpPotential.toFixed(0)}) - Breakeven Protection`,
            description: `Move stop loss to entry (${breakevenPrice.toFixed(5)}). Worst case: $0, Best case: $${tpPotential.toFixed(0)}`,
            icon: '🛡️'
          },
          {
            id: 'continue_safety',
            label: `Continue to TP ($${tpPotential.toFixed(0)}) - Lock 50%`,
            description: `Move stop loss to ${safetyPrice.toFixed(5)}. Worst case: Keep $${(currentPnL * 0.5).toFixed(0)}, Best case: $${tpPotential.toFixed(0)}`,
            icon: '⚡'
          }
        ],
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 minutes
      };

      await supabase
        .from('goal_notifications')
        .insert(notification);

      console.log(`[Trade Lifecycle] ✅ Created goal achievement notification for user ${userId}`);
    } catch (error) {
      console.error('[Trade Lifecycle] Error creating goal achievement notification:', error);
    }
  }

  async checkDefaultAction(trade: any, goalSession: any, currentPnL: number): Promise<void> {
    try {
      // Check if user has made a choice
      if (goalSession.user_choice) {
        return; // User already chose, nothing to do
      }

      // Check if notification has expired (5 minutes)
      const achievedAt = new Date(goalSession.goal_achieved_at);
      const now = new Date();
      const minutesElapsed = (now.getTime() - achievedAt.getTime()) / (1000 * 60);

      if (minutesElapsed >= 5) {
        console.log(`[Trade Lifecycle] ⏱️  No response after 5 minutes - applying default breakeven protection`);

        // Default action: Move SL to breakeven
        await this.moveStopLossToBreakeven(trade, goalSession);

        // Update goal session
        await supabase
          .from('goal_sessions')
          .update({
            user_choice: 'default_breakeven'
          })
          .eq('id', goalSession.id);

        // Send notification about auto-action
        await supabase
          .from('goal_notifications')
          .insert({
            user_id: goalSession.user_id,
            goal_session_id: goalSession.id,
            type: 'alert',
            priority: 'medium',
            title: '🛡️ Breakeven Protection Applied',
            message: 'No action was taken within 5 minutes, so we automatically moved your stop loss to breakeven to protect your profits.',
            metadata: {
              trade_id: trade.id,
              new_stop_loss: trade.entry_price,
              action: 'default_breakeven'
            }
          });
      }

      // Check if P&L is fading
      if (currentPnL < goalSession.goal_achieved_pnl * 0.75) {
        console.log(`[Trade Lifecycle] ⚠️  Profit fading! Was $${goalSession.goal_achieved_pnl}, now $${currentPnL.toFixed(2)}`);

        // Send urgent notification
        await supabase
          .from('goal_notifications')
          .insert({
            user_id: goalSession.user_id,
            goal_session_id: goalSession.id,
            type: 'alert',
            priority: 'critical',
            title: '⚠️ Profit Fading!',
            message: `Your profit has dropped from $${goalSession.goal_achieved_pnl.toFixed(2)} to $${currentPnL.toFixed(2)}. Consider closing or protecting your position!`,
            metadata: {
              trade_id: trade.id,
              peak_pnl: goalSession.goal_achieved_pnl,
              current_pnl: currentPnL,
              fade_percentage: ((1 - currentPnL / goalSession.goal_achieved_pnl) * 100).toFixed(1)
            }
          });
      }
    } catch (error) {
      console.error('[Trade Lifecycle] Error checking default action:', error);
    }
  }

  async moveStopLossToBreakeven(trade: any, goalSession: any): Promise<void> {
    try {
      const breakevenPrice = trade.entry_price;

      console.log(`[Trade Lifecycle] Moving SL to breakeven: ${trade.stop_loss} → ${breakevenPrice}`);

      await supabase
        .from('goal_session_trades')
        .update({
          stop_loss: breakevenPrice
        })
        .eq('id', trade.id);

      await supabase
        .from('goal_achievements')
        .update({
          stop_loss_after: breakevenPrice,
          user_choice: 'default_breakeven',
          choice_made_at: new Date().toISOString()
        })
        .eq('goal_session_id', goalSession.id);

      console.log(`[Trade Lifecycle] ✅ Stop loss moved to breakeven successfully`);
    } catch (error) {
      console.error('[Trade Lifecycle] Error moving stop loss to breakeven:', error);
    }
  }

  /**
   * Run counterfactual analysis on closed trade (async, non-blocking)
   * ✅ SSOT: Uses MarketDataService for candle queries
   */
  private async runCounterfactualAnalysis(
    trade: any,
    exitPrice: number,
    profitLoss: number
  ): Promise<void> {
    try {
      console.log(`[Trade Lifecycle] 🧠 Starting counterfactual analysis for ${trade.symbol}...`);

      const timeframe = '15m';
      const entryTime = new Date(trade.opened_at);
      const exitTime = new Date();

      const lookbackCandles = 500;
      const lookbackMinutes = lookbackCandles * 15;
      const startTime = new Date(entryTime.getTime() - lookbackMinutes * 60 * 1000);

      const candles = await marketDataService.getCandlesInRange(
        trade.symbol,
        timeframe,
        startTime,
        exitTime,
        true // Ascending order
      );

      if (!candles || candles.length < 10) {
        console.warn(`[Trade Lifecycle] Insufficient candle data (${candles?.length || 0}), skipping counterfactual`);
        return;
      }

      const candleData: CandleData[] = candles.map(c => ({
        time: Math.floor(new Date(c.open_time).getTime() / 1000),
        open: parseFloat(String(c.open)),
        high: parseFloat(String(c.high)),
        low: parseFloat(String(c.low)),
        close: parseFloat(String(c.close)),
        volume: c.volume ? parseFloat(String(c.volume)) : undefined
      }));

      const tradeData = {
        id: trade.id,
        user_id: trade.goal_sessions?.user_id || trade.user_id,
        symbol: trade.symbol,
        direction: trade.direction,
        entry_price: trade.entry_price,
        exit_price: exitPrice,
        stop_loss: trade.stop_loss,
        take_profit: trade.take_profit,
        position_size: trade.position_size,
        profit_loss: profitLoss,
        entry_time: trade.opened_at,
        exit_time: new Date().toISOString(),
        timeframe
      };

      await counterfactualEngine.runCounterfactuals(tradeData, candleData, {
        generateInsights: true
      });

      console.log(`[Trade Lifecycle] ✅ Counterfactual analysis complete for ${trade.symbol}`);
    } catch (error) {
      console.error('[Trade Lifecycle] Error in counterfactual analysis:', error);
    }
  }
}

export const tradeLifecycleManager = new TradeLifecycleManager();

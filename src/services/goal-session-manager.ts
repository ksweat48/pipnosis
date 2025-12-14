import { supabase } from '../lib/supabase';
import { midTradeNotificationQueue } from './mid-trade-notification-queue';
import { calculateDollarPerPip, calculatePipDistance, getCurrencyPipInfo } from '../utils/currencyHelpers';

export interface GoalSessionConfig {
  goalType: 'profit_target' | 'percentage_gain' | 'account_growth';
  targetValue: number;
  timeframe: string;
  riskMode: 'low' | 'medium' | 'high';
  autoExecute?: boolean;
  watchlist?: string[];
}

export interface GoalSession {
  id: string;
  user_id: string;
  goal_type: string;
  target_value: number;
  timeframe: string;
  timeframe_hours: number;
  risk_mode: string;
  status: string;
  starting_balance: number;
  current_progress: number;
  progress_percentage: number;
  scan_interval_minutes: number;
  auto_execute: boolean;
  watchlist: string[];
  start_time: string;
  end_time: string | null;
  last_scan_time: string | null;
  next_scan_time: string | null;
  created_at: string;
  updated_at: string;
}

class GoalSessionManager {
  parseTimeframe(timeframe: string): number {
    const normalized = timeframe.toLowerCase().trim();

    const patterns = [
      { regex: /(\d+)\s*hour?s?/i, multiplier: 1 },
      { regex: /(\d+)\s*day?s?/i, multiplier: 24 },
      { regex: /(\d+)\s*week?s?/i, multiplier: 168 },
      { regex: /(\d+)\s*month?s?/i, multiplier: 720 },
    ];

    for (const pattern of patterns) {
      const match = normalized.match(pattern.regex);
      if (match) {
        return parseInt(match[1]) * pattern.multiplier;
      }
    }

    return 24;
  }

  parseNaturalLanguageGoal(prompt: string): Partial<GoalSessionConfig> | null {
    const lowerPrompt = prompt.toLowerCase();

    const profitMatch = lowerPrompt.match(/\$?\s*(\d+(?:\.\d+)?)/);
    const percentMatch = lowerPrompt.match(/(\d+(?:\.\d+)?)\s*%/);

    const timeframePatterns = [
      { regex: /today|this\s+day/i, timeframe: '1 day' },
      { regex: /this\s+week|weekly/i, timeframe: '1 week' },
      { regex: /this\s+month|monthly/i, timeframe: '1 month' },
      { regex: /(\d+)\s+hours?/i, timeframe: null },
      { regex: /(\d+)\s+days?/i, timeframe: null },
      { regex: /(\d+)\s+weeks?/i, timeframe: null },
    ];

    let targetValue = 0;
    let goalType: 'profit_target' | 'percentage_gain' | 'account_growth' = 'profit_target';
    let timeframe = '1 day';

    if (percentMatch) {
      targetValue = parseFloat(percentMatch[1]);
      goalType = 'percentage_gain';
    } else if (profitMatch) {
      targetValue = parseFloat(profitMatch[1]);
      goalType = 'profit_target';
    } else {
      return null;
    }

    for (const pattern of timeframePatterns) {
      const match = lowerPrompt.match(pattern.regex);
      if (match) {
        if (pattern.timeframe) {
          timeframe = pattern.timeframe;
        } else {
          timeframe = match[0];
        }
        break;
      }
    }

    return {
      goalType,
      targetValue,
      timeframe,
      riskMode: 'medium',
    };
  }

  async createSession(userId: string, config: GoalSessionConfig): Promise<GoalSession | null> {
    try {
      const { data: profileData } = await supabase
        .from('user_profiles')
        .select('account_balance')
        .eq('id', userId)
        .maybeSingle();

      const startingBalance = profileData?.account_balance || 10000;
      const timeframeHours = this.parseTimeframe(config.timeframe);
      const endTime = new Date(Date.now() + timeframeHours * 60 * 60 * 1000).toISOString();

      const scanInterval = this.calculateScanInterval(config.riskMode, timeframeHours);
      const nextScanTime = new Date(Date.now() + scanInterval * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from('goal_sessions')
        .insert({
          user_id: userId,
          goal_type: config.goalType,
          target_value: config.targetValue,
          timeframe: config.timeframe,
          timeframe_hours: timeframeHours,
          risk_mode: config.riskMode,
          status: 'initializing',
          starting_balance: startingBalance,
          scan_interval_minutes: scanInterval,
          auto_execute: config.autoExecute ?? false,
          watchlist: config.watchlist ?? ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD'],
          end_time: endTime,
          next_scan_time: nextScanTime,
          server_enabled: true,
          autonomous_enabled: true,
          execution_mode: 'server'
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating goal session:', error);
        return null;
      }

      await this.addAIMessage(data.id, userId,
        `Goal session initialized! I'll help you ${config.goalType === 'profit_target' ? `make $${config.targetValue}` : `achieve ${config.targetValue}% growth`} over the next ${config.timeframe}. Starting market analysis now...`,
        { goal: config, balance: startingBalance },
        'encouraging'
      );

      await this.transitionStatus(data.id, 'scanning');

      return data;
    } catch (error) {
      console.error('Error in createSession:', error);
      return null;
    }
  }

  calculateScanInterval(riskMode: string, timeframeHours: number): number {
    const baseIntervals = {
      low: 30,
      medium: 15,
      high: 10,
    };

    let interval = baseIntervals[riskMode as keyof typeof baseIntervals] || 15;

    if (timeframeHours <= 24) {
      interval = Math.max(10, interval - 5);
    }

    return interval;
  }

  async getActiveSession(userId: string): Promise<GoalSession | null> {
    try {
      const { data, error } = await supabase
        .from('goal_sessions')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['initializing', 'scanning', 'trade_pending', 'in_trade'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Error fetching active session:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error in getActiveSession:', error);
      return null;
    }
  }

  async getAllSessions(userId: string, limit: number = 10): Promise<GoalSession[]> {
    try {
      const { data, error } = await supabase
        .from('goal_sessions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error fetching sessions:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getAllSessions:', error);
      return [];
    }
  }

  async transitionStatus(sessionId: string, newStatus: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('goal_sessions')
        .update({
          status: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', sessionId);

      if (error) {
        console.error('Error updating session status:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in transitionStatus:', error);
      return false;
    }
  }

  async updateScanTime(sessionId: string, lastScan: Date, nextScan: Date): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('goal_sessions')
        .update({
          last_scan_time: lastScan.toISOString(),
          next_scan_time: nextScan.toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', sessionId);

      if (error) {
        console.error('Error updating scan time:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in updateScanTime:', error);
      return false;
    }
  }

  async stopSession(sessionId: string, userId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('goal_sessions')
        .update({
          status: 'user_stopped',
          end_time: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', sessionId)
        .eq('user_id', userId);

      if (error) {
        console.error('Error stopping session:', error);
        return false;
      }

      await this.addAIMessage(sessionId, userId,
        'Session stopped by user. Generating final summary...',
        {},
        'neutral'
      );

      // Clear mid-trade notifications for this session
      await midTradeNotificationQueue.clearSessionNotifications(sessionId);

      return true;
    } catch (error) {
      console.error('Error in stopSession:', error);
      return false;
    }
  }

  async checkExpiredSessions(): Promise<void> {
    try {
      const { data: expiredSessions } = await supabase
        .from('goal_sessions')
        .select('id, user_id')
        .in('status', ['scanning', 'trade_pending', 'in_trade'])
        .lt('end_time', new Date().toISOString());

      if (expiredSessions && expiredSessions.length > 0) {
        for (const session of expiredSessions) {
          await this.transitionStatus(session.id, 'expired');
          await this.addAIMessage(session.id, session.user_id,
            'Session time expired. Reviewing final performance...',
            {},
            'neutral'
          );

          // Clear mid-trade notifications for expired session
          await midTradeNotificationQueue.clearSessionNotifications(session.id);
        }
      }
    } catch (error) {
      console.error('Error checking expired sessions:', error);
    }
  }

  async addAIMessage(
    sessionId: string,
    userId: string,
    message: string,
    context: any = {},
    sentiment: string = 'neutral'
  ): Promise<void> {
    try {
      await supabase
        .from('goal_ai_conversations')
        .insert({
          goal_session_id: sessionId,
          user_id: userId,
          role: 'ai',
          message,
          context,
          sentiment,
        });
    } catch (error) {
      console.error('Error adding AI message:', error);
    }
  }

  async getSessionConversations(sessionId: string, limit: number = 50): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('goal_ai_conversations')
        .select('*')
        .eq('goal_session_id', sessionId)
        .order('created_at', { ascending: true })
        .limit(limit);

      if (error) {
        console.error('Error fetching conversations:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getSessionConversations:', error);
      return [];
    }
  }

  async getSessionProgress(sessionId: string): Promise<any> {
    try {
      const [sessionData, tradesData, snapshotsData] = await Promise.all([
        supabase.from('goal_sessions').select('*').eq('id', sessionId).single(),
        supabase.from('goal_session_trades').select('*').eq('goal_session_id', sessionId),
        supabase.from('goal_progress_snapshots').select('*').eq('goal_session_id', sessionId).order('created_at', { ascending: false }).limit(10)
      ]);

      if (sessionData.error) {
        console.error('Error fetching session progress:', sessionData.error);
        return null;
      }

      const trades = tradesData.data || [];
      const snapshots = snapshotsData.data || [];

      const closedTrades = trades.filter(t => t.status === 'closed');
      const openTrades = trades.filter(t => t.status === 'open');
      const winningTrades = closedTrades.filter(t => t.profit_loss > 0);

      return {
        session: sessionData.data,
        stats: {
          totalTrades: closedTrades.length,
          openTrades: openTrades.length,
          winningTrades: winningTrades.length,
          winRate: closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0,
          totalProfit: closedTrades.reduce((sum, t) => sum + (t.profit_loss || 0), 0),
          bestTrade: closedTrades.length > 0 ? Math.max(...closedTrades.map(t => t.profit_loss || 0)) : 0,
        },
        snapshots,
        trades: trades.slice(0, 10),
      };
    } catch (error) {
      console.error('Error in getSessionProgress:', error);
      return null;
    }
  }

  async handleGoalAchievementAction(
    userId: string,
    goalSessionId: string,
    action: 'close_now' | 'continue_breakeven' | 'continue_safety',
    notificationId: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      console.log(`[Goal Session] User ${userId} chose action: ${action}`);

      // Get the goal session and trade
      const { data: goalSession } = await supabase
        .from('goal_sessions')
        .select('*, goal_session_trades!inner(*)')
        .eq('id', goalSessionId)
        .eq('user_id', userId)
        .single();

      if (!goalSession) {
        return { success: false, message: 'Goal session not found' };
      }

      const trade = goalSession.goal_session_trades[0];
      if (!trade || trade.status !== 'open') {
        return { success: false, message: 'No open trade found for this goal session' };
      }

      // Mark notification as acted upon
      await supabase
        .from('goal_notifications')
        .update({
          acknowledged_at: new Date().toISOString(),
          action_taken: action,
          action_taken_at: new Date().toISOString()
        })
        .eq('id', notificationId);

      // Update goal session with user choice
      await supabase
        .from('goal_sessions')
        .update({
          user_choice: action
        })
        .eq('id', goalSessionId);

      // Execute the chosen action
      switch (action) {
        case 'close_now':
          return await this.closeTradeNow(userId, goalSessionId, trade);

        case 'continue_breakeven':
          return await this.moveStopLossToBreakeven(userId, goalSessionId, trade);

        case 'continue_safety':
          return await this.moveStopLossToSafety(userId, goalSessionId, trade);

        default:
          return { success: false, message: 'Invalid action' };
      }
    } catch (error) {
      console.error('[Goal Session] Error handling goal achievement action:', error);
      return { success: false, message: 'Failed to process action' };
    }
  }

  private async closeTradeNow(
    userId: string,
    goalSessionId: string,
    trade: any
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Get current price
      const { data: priceData } = await supabase
        .from('forex_candles')
        .select('close')
        .eq('symbol', trade.symbol)
        .order('open_time', { ascending: false })
        .limit(1)
        .maybeSingle();

      const exitPrice = priceData ? parseFloat(priceData.close) : trade.entry_price;

      // Calculate final P&L
      const pipDistance = calculatePipDistance(trade.symbol, trade.entry_price, exitPrice);
      const dollarPerPip = calculateDollarPerPip(trade.symbol, trade.position_size);
      const finalPnL = trade.direction === 'buy' ? pipDistance * dollarPerPip : -pipDistance * dollarPerPip;

      // Close the trade
      await supabase
        .from('goal_session_trades')
        .update({
          status: 'closed',
          exit_price: exitPrice,
          profit_loss: finalPnL,
          closed_at: new Date().toISOString()
        })
        .eq('id', trade.id);

      // Update goal session
      await supabase
        .from('goal_sessions')
        .update({
          status: 'completed',
          final_pnl: finalPnL,
          completed_at: new Date().toISOString()
        })
        .eq('id', goalSessionId);

      // Clear mid-trade notifications for this session
      await midTradeNotificationQueue.clearSessionNotifications(goalSessionId);

      // Update achievement record
      const { data: achievement } = await supabase
        .from('goal_achievements')
        .update({
          final_pnl: finalPnL,
          final_outcome: 'closed_at_goal',
          completed_at: new Date().toISOString(),
          choice_made_at: new Date().toISOString()
        })
        .eq('goal_session_id', goalSessionId)
        .select('id')
        .single();

      // Apply final outcome reward bonus
      if (achievement?.id) {
        try {
          const { rewardEngine } = await import('./reward-engine');
          await rewardEngine.applyGoalFinalOutcome(
            userId,
            achievement.id,
            'closed_at_goal',
            finalPnL
          );
        } catch (error) {
          console.error('[Goal Session] Error applying final outcome reward:', error);
        }
      }

      console.log(`[Goal Session] ✅ Trade closed successfully. Final P&L: $${finalPnL.toFixed(2)}`);

      return {
        success: true,
        message: `Trade closed successfully! Final profit: $${finalPnL.toFixed(2)}`
      };
    } catch (error) {
      console.error('[Goal Session] Error closing trade:', error);
      return { success: false, message: 'Failed to close trade' };
    }
  }

  private async moveStopLossToBreakeven(
    userId: string,
    goalSessionId: string,
    trade: any
  ): Promise<{ success: boolean; message: string }> {
    try {
      const breakevenPrice = trade.entry_price;

      console.log(`[Goal Session] Moving SL to breakeven: ${trade.stop_loss} → ${breakevenPrice}`);

      await supabase
        .from('goal_session_trades')
        .update({
          stop_loss: breakevenPrice
        })
        .eq('id', trade.id);

      // Update achievement record
      await supabase
        .from('goal_achievements')
        .update({
          stop_loss_after: breakevenPrice,
          choice_made_at: new Date().toISOString()
        })
        .eq('goal_session_id', goalSessionId);

      console.log(`[Goal Session] ✅ Stop loss moved to breakeven (${breakevenPrice})`);

      return {
        success: true,
        message: `Stop loss moved to breakeven at ${breakevenPrice.toFixed(5)}. Your profits are now protected!`
      };
    } catch (error) {
      console.error('[Goal Session] Error moving stop loss to breakeven:', error);
      return { success: false, message: 'Failed to move stop loss' };
    }
  }

  private async moveStopLossToSafety(
    userId: string,
    goalSessionId: string,
    trade: any
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Get current price
      const { data: priceData } = await supabase
        .from('forex_candles')
        .select('close')
        .eq('symbol', trade.symbol)
        .order('open_time', { ascending: false })
        .limit(1)
        .maybeSingle();

      const currentPrice = priceData ? parseFloat(priceData.close) : trade.entry_price;

      // Calculate safety price (50% of current profit)
      const pipDistance = calculatePipDistance(trade.symbol, trade.entry_price, currentPrice);
      const safetyPips = pipDistance * 0.5;

      const pipInfo = getCurrencyPipInfo(trade.symbol);

      const safetyPrice = trade.direction === 'buy'
        ? trade.entry_price + (safetyPips * pipInfo.pipValue)
        : trade.entry_price - (safetyPips * pipInfo.pipValue);

      console.log(`[Goal Session] Moving SL to safety: ${trade.stop_loss} → ${safetyPrice}`);

      await supabase
        .from('goal_session_trades')
        .update({
          stop_loss: safetyPrice
        })
        .eq('id', trade.id);

      // Update achievement record
      await supabase
        .from('goal_achievements')
        .update({
          stop_loss_after: safetyPrice,
          choice_made_at: new Date().toISOString()
        })
        .eq('goal_session_id', goalSessionId);

      console.log(`[Goal Session] ✅ Stop loss moved to safety level (${safetyPrice})`);

      return {
        success: true,
        message: `Stop loss moved to safety level at ${safetyPrice.toFixed(5)}. You're guaranteed to keep at least 50% of your profits!`
      };
    } catch (error) {
      console.error('[Goal Session] Error moving stop loss to safety:', error);
      return { success: false, message: 'Failed to move stop loss' };
    }
  }
}

export const goalSessionManager = new GoalSessionManager();

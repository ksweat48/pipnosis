import { supabase } from '../lib/supabase';
import { goalSessionManager } from './goal-session-manager';

export interface RiskAssessment {
  allowed: boolean;
  reason?: string;
  adjustedRiskPercent?: number;
  defensiveModeActive: boolean;
}

class RiskManagementService {
  private readonly MAX_LOSS_STREAK = 2;
  private readonly MAX_MDD_PERCENT = 10;
  private readonly MIN_RISK_REWARD = 1.5;

  async assessTradeRisk(
    sessionId: string,
    userId: string,
    proposedTrade: {
      symbol: string;
      direction: string;
      entryPrice: number;
      stopLoss: number;
      riskReward: number;
    }
  ): Promise<RiskAssessment> {
    try {
      const { data: session } = await supabase
        .from('goal_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (!session) {
        return {
          allowed: false,
          reason: 'Session not found',
          defensiveModeActive: false
        };
      }

      if (proposedTrade.riskReward < this.MIN_RISK_REWARD) {
        return {
          allowed: false,
          reason: `Risk:reward ${proposedTrade.riskReward.toFixed(2)} below minimum ${this.MIN_RISK_REWARD}`,
          defensiveModeActive: session.defensive_mode_active
        };
      }

      const { data: openTrades } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('goal_session_id', sessionId)
        .eq('status', 'open');

      const openCount = openTrades?.length || 0;
      const maxConcurrent = session.max_concurrent_trades || 2;

      if (openCount >= maxConcurrent) {
        return {
          allowed: false,
          reason: `Maximum concurrent trades (${maxConcurrent}) reached`,
          defensiveModeActive: session.defensive_mode_active
        };
      }

      const sameSymbolOpen = openTrades?.filter(t => t.symbol === proposedTrade.symbol).length || 0;
      if (sameSymbolOpen > 0) {
        return {
          allowed: false,
          reason: `Already have open position on ${proposedTrade.symbol}`,
          defensiveModeActive: session.defensive_mode_active
        };
      }

      const { data: recentTrades } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('goal_session_id', sessionId)
        .eq('status', 'closed')
        .order('closed_at', { ascending: false })
        .limit(10);

      const lossStreak = this.calculateLossStreak(recentTrades || []);
      const currentMDD = this.calculateMDD(recentTrades || []);

      let defensiveModeActive = session.defensive_mode_active || false;

      if (lossStreak >= this.MAX_LOSS_STREAK && !defensiveModeActive) {
        await this.activateDefensiveMode(sessionId, userId, 'loss_streak', lossStreak);
        defensiveModeActive = true;
      }

      if (currentMDD >= this.MAX_MDD_PERCENT && !defensiveModeActive) {
        await this.activateDefensiveMode(sessionId, userId, 'max_drawdown', currentMDD);
        defensiveModeActive = true;
      }

      const baseRiskPercent = this.getRiskPercent(session.risk_mode);
      let adjustedRiskPercent = baseRiskPercent;

      if (defensiveModeActive) {
        adjustedRiskPercent = baseRiskPercent * 0.5;
      }

      if (lossStreak >= 1 && lossStreak < this.MAX_LOSS_STREAK) {
        adjustedRiskPercent = baseRiskPercent * 0.75;
      }

      return {
        allowed: true,
        adjustedRiskPercent,
        defensiveModeActive
      };

    } catch (error) {
      console.error('[Risk Management] Error assessing trade risk:', error);
      return {
        allowed: false,
        reason: 'Error assessing risk',
        defensiveModeActive: false
      };
    }
  }

  private calculateLossStreak(trades: any[]): number {
    let streak = 0;

    for (let i = 0; i < trades.length; i++) {
      if (trades[i].profit_loss < 0) {
        streak++;
      } else {
        break;
      }
    }

    return streak;
  }

  private calculateMDD(trades: any[]): number {
    if (trades.length === 0) return 0;

    let peak = 0;
    let runningPL = 0;
    let maxDrawdown = 0;

    for (let i = trades.length - 1; i >= 0; i--) {
      runningPL += trades[i].profit_loss || 0;

      if (runningPL > peak) {
        peak = runningPL;
      }

      const drawdown = peak - runningPL;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    const startingBalance = 10000;
    return (maxDrawdown / startingBalance) * 100;
  }

  private getRiskPercent(riskMode: string): number {
    const riskPercentages = {
      low: 0.03,
      medium: 0.05,
      high: 0.10
    };

    return riskPercentages[riskMode as keyof typeof riskPercentages] || 0.05;
  }

  async activateDefensiveMode(
    sessionId: string,
    userId: string,
    triggerReason: string,
    metricValue: number
  ): Promise<void> {
    try {
      console.log(`[Risk Management] Activating defensive mode for session ${sessionId}: ${triggerReason}`);

      const { data: session } = await supabase
        .from('goal_sessions')
        .select('risk_mode')
        .eq('id', sessionId)
        .single();

      const currentRisk = this.getRiskPercent(session?.risk_mode || 'medium');
      const newRisk = currentRisk * 0.5;

      await supabase
        .from('goal_sessions')
        .update({
          defensive_mode_active: true,
          loss_streak: triggerReason === 'loss_streak' ? metricValue : 0,
          updated_at: new Date().toISOString()
        })
        .eq('id', sessionId);

      await supabase.from('defensive_mode_log').insert({
        goal_session_id: sessionId,
        user_id: userId,
        trigger_reason: triggerReason,
        loss_streak: triggerReason === 'loss_streak' ? metricValue : null,
        mdd_percentage: triggerReason === 'max_drawdown' ? metricValue : null,
        previous_risk_percentage: currentRisk * 100,
        new_risk_percentage: newRisk * 100
      });

      await goalSessionManager.addAIMessage(
        sessionId,
        userId,
        `🛡️ Defensive mode activated due to ${triggerReason.replace('_', ' ')}. Risk per trade reduced to ${(newRisk * 100).toFixed(1)}%. Minimum confidence threshold increased. Focus on capital preservation.`,
        { triggerReason, metricValue },
        'alert'
      );

    } catch (error) {
      console.error('[Risk Management] Error activating defensive mode:', error);
    }
  }

  async deactivateDefensiveMode(sessionId: string, userId: string, reason: string): Promise<void> {
    try {
      console.log(`[Risk Management] Deactivating defensive mode for session ${sessionId}: ${reason}`);

      await supabase
        .from('goal_sessions')
        .update({
          defensive_mode_active: false,
          loss_streak: 0,
          updated_at: new Date().toISOString()
        })
        .eq('id', sessionId);

      const { data: activeLog } = await supabase
        .from('defensive_mode_log')
        .select('id')
        .eq('goal_session_id', sessionId)
        .is('deactivated_at', null)
        .order('activated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeLog) {
        await supabase
          .from('defensive_mode_log')
          .update({
            deactivated_at: new Date().toISOString(),
            recovery_achieved: true
          })
          .eq('id', activeLog.id);
      }

      await goalSessionManager.addAIMessage(
        sessionId,
        userId,
        `✅ Defensive mode deactivated. ${reason}. Risk parameters restored to normal levels. Continuing with standard strategy.`,
        { reason },
        'encouraging'
      );

    } catch (error) {
      console.error('[Risk Management] Error deactivating defensive mode:', error);
    }
  }

  async checkDefensiveModeRecovery(sessionId: string, userId: string): Promise<void> {
    try {
      const { data: session } = await supabase
        .from('goal_sessions')
        .select('defensive_mode_active')
        .eq('id', sessionId)
        .single();

      if (!session?.defensive_mode_active) {
        return;
      }

      const { data: recentTrades } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('goal_session_id', sessionId)
        .eq('status', 'closed')
        .order('closed_at', { ascending: false })
        .limit(5);

      if (!recentTrades || recentTrades.length < 3) {
        return;
      }

      const winningTrades = recentTrades.filter(t => t.profit_loss > 0).length;
      const winRate = (winningTrades / recentTrades.length) * 100;

      if (winRate >= 60 && this.calculateLossStreak(recentTrades) === 0) {
        await this.deactivateDefensiveMode(
          sessionId,
          userId,
          `Recovery confirmed with ${winRate.toFixed(0)}% win rate over last ${recentTrades.length} trades`
        );
      }

    } catch (error) {
      console.error('[Risk Management] Error checking defensive mode recovery:', error);
    }
  }

  async calculateOptimalPositionSize(
    sessionId: string,
    proposedTrade: {
      entryPrice: number;
      stopLoss: number;
    }
  ): Promise<number> {
    try {
      const { data: session } = await supabase
        .from('goal_sessions')
        .select('starting_balance, risk_mode, defensive_mode_active')
        .eq('id', sessionId)
        .single();

      if (!session) {
        return 0.01;
      }

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('demo_balance')
        .eq('id', session.user_id)
        .single();

      const currentBalance = parseFloat(profile?.demo_balance || '10000');
      let riskPercent = this.getRiskPercent(session.risk_mode);

      if (session.defensive_mode_active) {
        riskPercent *= 0.5;
      }

      const riskAmount = currentBalance * riskPercent;

      const stopDistance = Math.abs(proposedTrade.entryPrice - proposedTrade.stopLoss);
      const positionSize = stopDistance > 0 ? riskAmount / stopDistance : 0.01;

      return Math.max(0.01, Math.min(10, positionSize));

    } catch (error) {
      console.error('[Risk Management] Error calculating position size:', error);
      return 0.01;
    }
  }

  async getSessionRiskMetrics(sessionId: string): Promise<{
    lossStreak: number;
    currentMDD: number;
    defensiveModeActive: boolean;
    currentRiskPercent: number;
  }> {
    try {
      const { data: session } = await supabase
        .from('goal_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (!session) {
        return {
          lossStreak: 0,
          currentMDD: 0,
          defensiveModeActive: false,
          currentRiskPercent: 5
        };
      }

      const { data: recentTrades } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('goal_session_id', sessionId)
        .eq('status', 'closed')
        .order('closed_at', { ascending: false })
        .limit(10);

      const lossStreak = this.calculateLossStreak(recentTrades || []);
      const currentMDD = this.calculateMDD(recentTrades || []);
      const baseRisk = this.getRiskPercent(session.risk_mode) * 100;
      const currentRisk = session.defensive_mode_active ? baseRisk * 0.5 : baseRisk;

      return {
        lossStreak,
        currentMDD,
        defensiveModeActive: session.defensive_mode_active,
        currentRiskPercent: currentRisk
      };

    } catch (error) {
      console.error('[Risk Management] Error getting risk metrics:', error);
      return {
        lossStreak: 0,
        currentMDD: 0,
        defensiveModeActive: false,
        currentRiskPercent: 5
      };
    }
  }
}

export const riskManagementService = new RiskManagementService();

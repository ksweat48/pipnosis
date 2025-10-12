import { supabase } from '../../lib/supabase';
import { fxFlowScalperV2 } from '../core/fxFlowScalperV2';
import { multiSymbolScanner } from '../core/multiSymbolScanner';
import { autoTradingController } from '../core/autoTradingController';
import { shadowTradingEngine } from '../core/shadowTradingEngine';
import { TradeSignal, OpportunityRanking, PerformanceMetrics } from '../types';

class StrategyService {
  async saveSignal(userId: string, signal: TradeSignal, signalType: 'prompt' | 'automatic' | 'manual'): Promise<string | null> {
    try {
      const { data, error } = await supabase
        .from('strategy_signals')
        .insert({
          user_id: userId,
          strategy_version: signal.version,
          symbol: signal.symbol,
          timeframe: signal.timeframe,
          direction: signal.direction,
          entry_price: signal.entryPrice,
          stop_loss: signal.stopLoss,
          take_profit: signal.takeProfit,
          risk_reward: signal.riskReward,
          confidence: signal.confidence,
          approved: false,
          executed: false,
          signal_type: signalType,
          phase1_passed: signal.conditions.macro,
          phase1_bias: signal.phases.phase1.bias,
          phase1_confidence: signal.phases.phase1.confidence,
          phase1_reason: signal.phases.phase1.reason,
          phase2_passed: signal.conditions.tactical,
          phase2_confidence: signal.phases.phase2.confidence,
          phase2_reason: signal.phases.phase2.reason,
          phase3_passed: signal.conditions.entry,
          phase3_confidence: signal.phases.phase3.confidence,
          phase3_reason: signal.phases.phase3.reason,
          reasoning: signal.reasoning,
          notes: signal.notes,
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
        })
        .select()
        .single();

      if (error) {
        console.error('Error saving signal:', error);
        return null;
      }

      return data.id;
    } catch (error) {
      console.error('Error in saveSignal:', error);
      return null;
    }
  }

  async approveSignal(userId: string, signalId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('strategy_signals')
        .update({
          approved: true,
          executed: false
        })
        .eq('id', signalId)
        .eq('user_id', userId);

      if (error) {
        console.error('Error approving signal:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in approveSignal:', error);
      return false;
    }
  }

  async executeSignal(
    userId: string,
    signalId: string,
    accountBalance: number = 10000,
    riskPercentage: number = 1
  ): Promise<boolean> {
    try {
      const { data: signalData, error: fetchError } = await supabase
        .from('strategy_signals')
        .select('*')
        .eq('id', signalId)
        .eq('user_id', userId)
        .single();

      if (fetchError || !signalData) {
        console.error('Error fetching signal:', fetchError);
        return false;
      }

      const signal: TradeSignal = {
        approved: true,
        direction: signalData.direction as 'BUY' | 'SELL',
        confidence: signalData.confidence,
        symbol: signalData.symbol,
        timeframe: signalData.timeframe as '1M' | '5M' | '1H',
        entryPrice: parseFloat(signalData.entry_price),
        stopLoss: parseFloat(signalData.stop_loss),
        takeProfit: parseFloat(signalData.take_profit),
        riskReward: parseFloat(signalData.risk_reward),
        reasoning: signalData.reasoning,
        conditions: {
          macro: signalData.phase1_passed,
          tactical: signalData.phase2_passed,
          entry: signalData.phase3_passed
        },
        phases: {
          phase1: {
            passed: signalData.phase1_passed,
            bias: signalData.phase1_bias,
            h1CandleType: signalData.phase1_bias === 'BULLISH' ? 'bullish' : 'bearish',
            confidence: signalData.phase1_confidence,
            reason: signalData.phase1_reason
          },
          phase2: {
            passed: signalData.phase2_passed,
            halfTrendAligned: false,
            stochRSIAligned: false,
            signalLineAligned: false,
            confidence: signalData.phase2_confidence,
            reason: signalData.phase2_reason,
            details: {
              halfTrend: null,
              stochRSI: null,
              signalLinePosition: null
            }
          },
          phase3: {
            passed: signalData.phase3_passed,
            haCandleShifted: false,
            rsiMomentumAligned: false,
            signalLineConfirmed: false,
            confidence: signalData.phase3_confidence,
            reason: signalData.phase3_reason,
            details: {
              haCandleColor: null,
              rsiValue: null,
              rsiCrossing: 'none',
              signalLinePosition: null
            }
          }
        },
        timestamp: new Date(signalData.created_at),
        version: signalData.strategy_version,
        notes: signalData.notes
      };

      await shadowTradingEngine.createDemoTrade(
        userId,
        signal,
        signalId,
        accountBalance,
        riskPercentage
      );

      const { error: updateError } = await supabase
        .from('strategy_signals')
        .update({ executed: true })
        .eq('id', signalId);

      if (updateError) {
        console.error('Error updating signal execution status:', updateError);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in executeSignal:', error);
      return false;
    }
  }

  async getRecentSignals(userId: string, limit: number = 10): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('strategy_signals')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error fetching recent signals:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getRecentSignals:', error);
      return [];
    }
  }

  async getPerformanceMetrics(userId: string, period: 'daily' | 'weekly' | 'monthly' = 'weekly'): Promise<PerformanceMetrics | null> {
    try {
      const { data, error } = await supabase
        .from('strategy_performance')
        .select('*')
        .eq('user_id', userId)
        .eq('period', period)
        .order('period_start', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Error fetching performance metrics:', error);
        return null;
      }

      if (!data) {
        return {
          totalTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          winRate: 0,
          averageRR: 0,
          profitFactor: 0,
          totalPnL: 0,
          averageWin: 0,
          averageLoss: 0,
          maxDrawdown: 0,
          strategyVersion: 'Fx Flow Scalper v2.0',
          period
        };
      }

      return {
        totalTrades: data.total_trades,
        winningTrades: data.winning_trades,
        losingTrades: data.losing_trades,
        winRate: parseFloat(data.win_rate),
        averageRR: parseFloat(data.average_rr),
        profitFactor: parseFloat(data.profit_factor),
        totalPnL: parseFloat(data.total_pnl),
        averageWin: parseFloat(data.average_win),
        averageLoss: parseFloat(data.average_loss),
        maxDrawdown: parseFloat(data.max_drawdown),
        strategyVersion: data.strategy_version,
        period
      };
    } catch (error) {
      console.error('Error in getPerformanceMetrics:', error);
      return null;
    }
  }

  async findBestOpportunity(userId: string, prompt: string): Promise<OpportunityRanking | null> {
    try {
      const opportunity = await multiSymbolScanner.findBestOpportunity(prompt);

      if (opportunity) {
        const signalId = await this.saveSignal(userId, opportunity.signal, 'prompt');

        if (signalId) {
          console.log(`💡 Best opportunity found: ${opportunity.signal.symbol} ${opportunity.signal.direction} (Score: ${opportunity.score})`);
        }
      }

      return opportunity;
    } catch (error) {
      console.error('Error in findBestOpportunity:', error);
      return null;
    }
  }

  async startAutoTrading(userId: string): Promise<boolean> {
    try {
      await autoTradingController.start(userId);
      return true;
    } catch (error) {
      console.error('Error starting auto trading:', error);
      return false;
    }
  }

  async stopAutoTrading(): Promise<boolean> {
    try {
      await autoTradingController.stop();
      return true;
    } catch (error) {
      console.error('Error stopping auto trading:', error);
      return false;
    }
  }

  isAutoTradingActive(): boolean {
    return autoTradingController.isActive();
  }
}

export const strategyService = new StrategyService();

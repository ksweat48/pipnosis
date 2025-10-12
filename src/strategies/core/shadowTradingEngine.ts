import { supabase } from '../../lib/supabase';
import { TradeSignal, DemoTradeRecord } from '../types';
import { calculatePositionSize } from './riskManagement';
import { getSignalLineValue } from '../indicators/linearRegression';
import { Candle } from '../../lib/indicators';

export class ShadowTradingEngine {
  async createDemoTrade(
    userId: string,
    signal: TradeSignal,
    signalId: string,
    accountBalance: number = 10000,
    riskPercentage: number = 1
  ): Promise<DemoTradeRecord | null> {
    try {
      const lotSize = calculatePositionSize(
        accountBalance,
        riskPercentage,
        signal.stopLoss,
        10
      );

      const { data, error } = await supabase
        .from('ai_demo_trades')
        .insert({
          signal_id: signalId,
          user_id: userId,
          symbol: signal.symbol,
          direction: signal.direction,
          entry_price: signal.entryPrice,
          stop_loss: signal.stopLoss,
          take_profit: signal.takeProfit,
          lot_size: lotSize,
          entry_time: new Date().toISOString(),
          status: 'open',
          is_ai_trade: true,
          confidence: signal.confidence,
          strategy_version: signal.version,
          learning_metadata: {
            phase1_confidence: signal.phases.phase1.confidence,
            phase2_confidence: signal.phases.phase2.confidence,
            phase3_confidence: signal.phases.phase3.confidence,
            overall_confidence: signal.confidence
          }
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating demo trade:', error);
        return null;
      }

      console.log(`🎯 AI Demo Trade Created: ${signal.direction} ${signal.symbol} @ ${signal.entryPrice}`);

      return {
        id: data.id,
        signalId: data.signal_id,
        userId: data.user_id,
        symbol: data.symbol,
        direction: data.direction as 'BUY' | 'SELL',
        entryPrice: parseFloat(data.entry_price),
        stopLoss: parseFloat(data.stop_loss),
        takeProfit: parseFloat(data.take_profit),
        lotSize: parseFloat(data.lot_size),
        entryTime: new Date(data.entry_time),
        exitTime: null,
        exitPrice: null,
        pnl: null,
        pnlPips: null,
        status: 'open',
        isAITrade: true,
        confidence: data.confidence,
        strategyVersion: data.strategy_version
      };
    } catch (error) {
      console.error('Error in createDemoTrade:', error);
      return null;
    }
  }

  async monitorOpenTrades(userId: string, currentCandles: Candle[]): Promise<void> {
    try {
      const { data: openTrades, error } = await supabase
        .from('ai_demo_trades')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'open');

      if (error) {
        console.error('Error fetching open trades:', error);
        return;
      }

      if (!openTrades || openTrades.length === 0) {
        return;
      }

      for (const trade of openTrades) {
        await this.checkTradeExit(trade, currentCandles);
      }
    } catch (error) {
      console.error('Error monitoring open trades:', error);
    }
  }

  private async checkTradeExit(trade: any, candles: Candle[]): Promise<void> {
    if (candles.length === 0) {
      return;
    }

    const currentPrice = candles[candles.length - 1].close;
    const direction = trade.direction as 'BUY' | 'SELL';

    const stopLoss = parseFloat(trade.stop_loss);
    const takeProfit = parseFloat(trade.take_profit);
    const entryPrice = parseFloat(trade.entry_price);

    let shouldExit = false;
    let exitReason: 'stopped' | 'target_hit' | 'closed' = 'closed';

    if (direction === 'BUY') {
      if (currentPrice <= stopLoss) {
        shouldExit = true;
        exitReason = 'stopped';
      } else if (currentPrice >= takeProfit) {
        shouldExit = true;
        exitReason = 'target_hit';
      }
    } else {
      if (currentPrice >= stopLoss) {
        shouldExit = true;
        exitReason = 'stopped';
      } else if (currentPrice <= takeProfit) {
        shouldExit = true;
        exitReason = 'target_hit';
      }
    }

    try {
      const signalLineValue = getSignalLineValue(candles, 50);
      if (signalLineValue) {
        const crossedSignalLine = direction === 'BUY'
          ? currentPrice < signalLineValue
          : currentPrice > signalLineValue;

        if (crossedSignalLine && !shouldExit) {
          shouldExit = true;
          exitReason = 'closed';
        }
      }
    } catch (error) {
      console.warn('Could not check signal line exit:', error);
    }

    if (shouldExit) {
      await this.closeDemoTrade(trade.id, currentPrice, exitReason);
    }
  }

  async closeDemoTrade(
    tradeId: string,
    exitPrice: number,
    status: 'closed' | 'stopped' | 'target_hit'
  ): Promise<void> {
    try {
      const { data: trade, error: fetchError } = await supabase
        .from('ai_demo_trades')
        .select('*')
        .eq('id', tradeId)
        .single();

      if (fetchError || !trade) {
        console.error('Error fetching trade for closure:', fetchError);
        return;
      }

      const entryPrice = parseFloat(trade.entry_price);
      const lotSize = parseFloat(trade.lot_size);
      const direction = trade.direction as 'BUY' | 'SELL';

      const priceDiff = direction === 'BUY'
        ? exitPrice - entryPrice
        : entryPrice - exitPrice;

      const pipValue = 10;
      const pnlPips = priceDiff / 0.0001;
      const pnl = pnlPips * lotSize * pipValue;

      const { error: updateError } = await supabase
        .from('ai_demo_trades')
        .update({
          exit_time: new Date().toISOString(),
          exit_price: exitPrice,
          pnl,
          pnl_pips: pnlPips,
          status,
          updated_at: new Date().toISOString()
        })
        .eq('id', tradeId);

      if (updateError) {
        console.error('Error closing demo trade:', updateError);
        return;
      }

      const outcomeIcon = pnl > 0 ? '✅' : '❌';
      console.log(`${outcomeIcon} AI Demo Trade Closed: ${trade.symbol} ${direction} | PnL: $${pnl.toFixed(2)} (${pnlPips.toFixed(1)} pips) | Reason: ${status}`);
    } catch (error) {
      console.error('Error in closeDemoTrade:', error);
    }
  }

  async getTradePerformance(userId: string, days: number = 7): Promise<{
    totalTrades: number;
    winRate: number;
    avgPnL: number;
    totalPnL: number;
  }> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const { data, error } = await supabase
        .from('ai_demo_trades')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['closed', 'stopped', 'target_hit'])
        .gte('exit_time', startDate.toISOString());

      if (error) {
        console.error('Error fetching trade performance:', error);
        return { totalTrades: 0, winRate: 0, avgPnL: 0, totalPnL: 0 };
      }

      if (!data || data.length === 0) {
        return { totalTrades: 0, winRate: 0, avgPnL: 0, totalPnL: 0 };
      }

      const totalTrades = data.length;
      const winningTrades = data.filter(t => parseFloat(t.pnl) > 0).length;
      const winRate = (winningTrades / totalTrades) * 100;
      const totalPnL = data.reduce((sum, t) => sum + parseFloat(t.pnl || '0'), 0);
      const avgPnL = totalPnL / totalTrades;

      return {
        totalTrades,
        winRate,
        avgPnL,
        totalPnL
      };
    } catch (error) {
      console.error('Error in getTradePerformance:', error);
      return { totalTrades: 0, winRate: 0, avgPnL: 0, totalPnL: 0 };
    }
  }
}

export const shadowTradingEngine = new ShadowTradingEngine();

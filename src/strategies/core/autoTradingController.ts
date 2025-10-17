import { supabase } from '../../lib/supabase';
import { FxFlowScalperV2, MultiTimeframeCandles } from './fxFlowScalperV2';
import { TradeSignal, AutoTradingConfig } from '../types';
import { marketDataService } from '../../services/market-data';
import { Timeframe } from '../../services/metaapi';

export class AutoTradingController {
  private strategy: FxFlowScalperV2;
  private isRunning: boolean = false;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private lastTradeTime: Date | null = null;
  private readonly MIN_TRADE_SPACING_MINUTES = 5;

  constructor() {
    this.strategy = new FxFlowScalperV2();
  }

  async getAutoTradingConfig(userId: string): Promise<AutoTradingConfig | null> {
    try {
      const { data, error } = await supabase
        .from('auto_trading_sessions')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.error('Error fetching auto trading config:', error);
        return null;
      }

      if (!data) {
        return null;
      }

      return {
        enabled: data.enabled,
        maxDailyTrades: data.max_daily_trades,
        minConfidence: data.min_confidence,
        symbols: data.active_symbols || [],
        tradingHours: {
          start: data.trading_hours_start,
          end: data.trading_hours_end
        },
        riskPercentage: data.risk_percentage
      };
    } catch (error) {
      console.error('Error in getAutoTradingConfig:', error);
      return null;
    }
  }

  async updateAutoTradingConfig(
    userId: string,
    config: Partial<AutoTradingConfig>
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('auto_trading_sessions')
        .upsert({
          user_id: userId,
          enabled: config.enabled,
          max_daily_trades: config.maxDailyTrades,
          min_confidence: config.minConfidence,
          active_symbols: config.symbols,
          trading_hours_start: config.tradingHours?.start,
          trading_hours_end: config.tradingHours?.end,
          risk_percentage: config.riskPercentage,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id',
          ignoreDuplicates: false
        });

      if (error) {
        console.error('Error updating auto trading config:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in updateAutoTradingConfig:', error);
      return false;
    }
  }

  async start(userId: string): Promise<void> {
    if (this.isRunning) {
      console.log('Auto trading already running');
      return;
    }

    const config = await this.getAutoTradingConfig(userId);

    if (!config || !config.enabled) {
      console.log('Auto trading not enabled');
      return;
    }

    this.isRunning = true;
    console.log('🤖 Auto trading started');

    this.monitoringInterval = setInterval(async () => {
      await this.scanForOpportunities(userId, config);
    }, 60000);

    await this.scanForOpportunities(userId, config);
  }

  async stop(): Promise<void> {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    this.isRunning = false;
    console.log('🛑 Auto trading stopped');
  }

  private async scanForOpportunities(
    userId: string,
    config: AutoTradingConfig
  ): Promise<void> {
    try {
      if (!this.isWithinTradingHours(config.tradingHours)) {
        return;
      }

      if (this.lastTradeTime && this.getMinutesSinceLastTrade() < this.MIN_TRADE_SPACING_MINUTES) {
        return;
      }

      for (const symbol of config.symbols) {
        const signal = await this.evaluateSymbol(symbol, config.minConfidence);

        if (signal) {
          await this.executeAutoTrade(userId, signal);
          this.lastTradeTime = new Date();
          break;
        }
      }
    } catch (error) {
      console.error('Error scanning for opportunities:', error);
    }
  }

  private async evaluateSymbol(
    symbol: string,
    minConfidence: number
  ): Promise<TradeSignal | null> {
    try {
      const [h1Candles, m5Candles, m1Candles] = await Promise.all([
        marketDataService.getHistoricalData(symbol, 'H1' as Timeframe, 50, true, true),
        marketDataService.getHistoricalData(symbol, 'M5' as Timeframe, 100, true, true),
        marketDataService.getHistoricalData(symbol, 'M1' as Timeframe, 100, true, true)
      ]);

      const candles: MultiTimeframeCandles = {
        h1: h1Candles,
        m5: m5Candles,
        m1: m1Candles
      };

      const evaluation = await this.strategy.evaluateStrategy(symbol, candles);

      if (evaluation.trade && evaluation.trade.confidence >= minConfidence) {
        return evaluation.trade;
      }

      return null;
    } catch (error) {
      console.error(`Error evaluating ${symbol}:`, error);
      return null;
    }
  }

  private async executeAutoTrade(userId: string, signal: TradeSignal): Promise<void> {
    try {
      const { error } = await supabase
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
          approved: true,
          executed: true,
          signal_type: 'automatic',
          phase1_passed: signal.conditions.macro,
          phase1_reason: signal.phases.phase1.reason,
          phase2_passed: signal.conditions.tactical,
          phase2_reason: signal.phases.phase2.reason,
          phase3_passed: signal.conditions.entry,
          phase3_reason: signal.phases.phase3.reason,
          reasoning: signal.reasoning,
          notes: signal.notes
        });

      if (error) {
        console.error('Error saving automatic trade:', error);
        return;
      }

      await this.incrementTradeCount(userId);

      console.log(`✅ Automatic trade executed: ${signal.direction} ${signal.symbol} @ ${signal.entryPrice}`);
    } catch (error) {
      console.error('Error in executeAutoTrade:', error);
    }
  }

  private async getTodayTradesCount(userId: string): Promise<number> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from('strategy_signals')
        .select('id', { count: 'exact' })
        .eq('user_id', userId)
        .eq('signal_type', 'automatic')
        .gte('created_at', today.toISOString());

      if (error) {
        console.error('Error getting today trades count:', error);
        return 0;
      }

      return data?.length || 0;
    } catch (error) {
      console.error('Error in getTodayTradesCount:', error);
      return 0;
    }
  }

  private async incrementTradeCount(userId: string): Promise<void> {
    try {
      await supabase
        .from('auto_trading_sessions')
        .update({
          trades_taken_today: supabase.rpc('increment', { x: 1 }),
          last_trade_time: new Date().toISOString()
        })
        .eq('user_id', userId);
    } catch (error) {
      console.error('Error incrementing trade count:', error);
    }
  }

  private isWithinTradingHours(tradingHours: { start: string; end: string }): boolean {
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 8);

    return currentTime >= tradingHours.start && currentTime <= tradingHours.end;
  }

  private getMinutesSinceLastTrade(): number {
    if (!this.lastTradeTime) {
      return Infinity;
    }

    const now = new Date();
    const diff = now.getTime() - this.lastTradeTime.getTime();
    return Math.floor(diff / 60000);
  }

  isActive(): boolean {
    return this.isRunning;
  }
}

export const autoTradingController = new AutoTradingController();

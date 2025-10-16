import { supabase } from '@/lib/supabase';
import { aiTradingEngine, AIAnalysisRequest } from './ai-trading-engine';
import { simulatedTradingService } from './simulated-trading';

export interface AutoTradingStatus {
  id: string;
  userId: string;
  enabled: boolean;
  tradesTakenToday: number;
  maxDailyTrades: number;
  lastScanTime?: Date;
  lastTradeTime?: Date;
  opportunityWindowStart?: Date;
  opportunityWindowEnd?: Date;
  scanningActive: boolean;
  lastOpportunityFound?: Date;
  consecutiveNoOpportunityCount: number;
  dailyPnl: number;
  dailyLossLimit: number;
  emergencyStop: boolean;
  continuousMode?: boolean;
  learningMode?: boolean;
  totalTradesExecuted?: number;
}

export interface ScanResult {
  opportunityFound: boolean;
  decision?: any;
  trade?: any;
  message: string;
  scanDuration: number;
}

class AutoTradingScanner {
  private scannerIntervals: Map<string, NodeJS.Timeout> = new Map();
  private opportunityTimeouts: Map<string, NodeJS.Timeout> = new Map();

  async startAutoTrading(userId: string): Promise<{ success: boolean; message: string }> {
    try {
      const { data: userProfile } = await supabase
        .from('user_profiles')
        .select('is_admin')
        .eq('id', userId)
        .single();

      if (!userProfile || userProfile.is_admin !== true) {
        return {
          success: false,
          message: 'Auto trading is currently available for admin users only during testing phase'
        };
      }

      const status = await this.getAutoTradingStatus(userId);

      if (!status) {
        await this.initializeAutoTradingStatus(userId);
      }

      const { data: preferences } = await supabase
        .from('user_trading_preferences')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (!preferences) {
        await supabase.from('user_trading_preferences').insert({
          user_id: userId,
          auto_trading_enabled: true,
          min_confidence_threshold: 75
        });
      }

      await this.updateAutoTradingStatus(userId, {
        enabled: true,
        scanning_active: true,
        continuous_mode: true,
        learning_mode: true,
        started_by_admin: userId,
        opportunity_window_start: new Date().toISOString()
      });

      this.startScanning(userId, preferences || { preferred_pairs: ['EURUSD', 'GBPUSD', 'XAUUSD'], min_confidence_threshold: 75 });

      return {
        success: true,
        message: 'Auto trading started in continuous learning mode. Scanning markets every 2-3 minutes. No trade limits.'
      };
    } catch (error) {
      console.error('Failed to start auto trading:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to start auto trading'
      };
    }
  }

  async stopAutoTrading(userId: string): Promise<{ success: boolean; message: string }> {
    try {
      if (this.scannerIntervals.has(userId)) {
        clearInterval(this.scannerIntervals.get(userId)!);
        this.scannerIntervals.delete(userId);
      }

      if (this.opportunityTimeouts.has(userId)) {
        clearTimeout(this.opportunityTimeouts.get(userId)!);
        this.opportunityTimeouts.delete(userId);
      }

      await this.updateAutoTradingStatus(userId, {
        enabled: false,
        scanning_active: false
      });

      return {
        success: true,
        message: 'Auto trading stopped'
      };
    } catch (error) {
      console.error('Failed to stop auto trading:', error);
      return {
        success: false,
        message: 'Failed to stop auto trading'
      };
    }
  }

  private startScanning(userId: string, preferences: any) {
    const scanInterval = setInterval(async () => {
      await this.performScan(userId, preferences);
    }, 2 * 60 * 1000);

    this.scannerIntervals.set(userId, scanInterval);

    this.performScan(userId, preferences);
  }

  private async performScan(userId: string, preferences: any): Promise<ScanResult> {
    const scanStartTime = Date.now();

    try {
      const status = await this.getAutoTradingStatus(userId);

      if (!status || !status.enabled || status.emergencyStop) {
        return {
          opportunityFound: false,
          message: 'Auto trading is disabled or emergency stopped',
          scanDuration: Date.now() - scanStartTime
        };
      }

      if (!status.continuousMode && status.tradesTakenToday >= status.maxDailyTrades) {
        await this.updateAutoTradingStatus(userId, { scanning_active: false });
        return {
          opportunityFound: false,
          message: `Daily trade limit reached (${status.tradesTakenToday}/${status.maxDailyTrades})`,
          scanDuration: Date.now() - scanStartTime
        };
      }

      if (status.dailyPnl <= status.dailyLossLimit) {
        await this.updateAutoTradingStatus(userId, {
          emergency_stop: true,
          scanning_active: false
        });

        await this.notifyUser(userId, 'Emergency stop triggered', 'Daily loss limit exceeded. Auto trading has been stopped.');

        return {
          opportunityFound: false,
          message: 'Emergency stop: Daily loss limit exceeded',
          scanDuration: Date.now() - scanStartTime
        };
      }

      if (!this.isWithinTradingHours(preferences)) {
        return {
          opportunityFound: false,
          message: 'Outside trading hours',
          scanDuration: Date.now() - scanStartTime
        };
      }

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('account_balance')
        .eq('id', userId)
        .single();

      const accountBalance = parseFloat(profile?.account_balance || '10000');

      const analysisRequest: AIAnalysisRequest = {
        userId,
        prompt: 'Scan for the best high-confidence trading opportunity',
        accountBalance,
        decisionType: 'auto',
        symbols: preferences.preferred_pairs || ['EURUSD', 'GBPUSD', 'XAUUSD']
      };

      const analysisResult = await aiTradingEngine.analyzeTradeRequest(analysisRequest);

      if (!analysisResult.decision || !analysisResult.options.length) {
        await this.incrementNoOpportunityCount(userId);
        return {
          opportunityFound: false,
          message: 'No high-confidence opportunities found',
          scanDuration: Date.now() - scanStartTime
        };
      }

      const selectedOption = this.selectBestAutoOption(analysisResult.options, preferences);

      if (selectedOption.confidence < preferences.min_confidence_threshold) {
        await this.incrementNoOpportunityCount(userId);
        return {
          opportunityFound: false,
          message: `Opportunity confidence (${selectedOption.confidence}%) below threshold (${preferences.min_confidence_threshold}%)`,
          scanDuration: Date.now() - scanStartTime
        };
      }

      await aiTradingEngine.approveTradeOption(selectedOption.id, userId);

      const tradeResult = await simulatedTradingService.executeTrade(
        {
          symbol: selectedOption.symbol,
          action: selectedOption.direction.toLowerCase() as 'buy' | 'sell',
          lotSize: selectedOption.lotSize,
          entry: selectedOption.entryPrice,
          stopLoss: selectedOption.stopLoss,
          takeProfit: selectedOption.takeProfit,
          strategy: {
            type: 'ai_auto',
            optionType: selectedOption.optionType,
            confidence: selectedOption.confidence
          }
        },
        userId
      );

      if (!tradeResult.success) {
        throw new Error(tradeResult.message);
      }

      await supabase
        .from('ai_trade_decisions')
        .update({
          executed: true,
          executed_at: new Date().toISOString(),
          trade_id: tradeResult.trade?.id
        })
        .eq('id', analysisResult.decision.id);

      await this.updateAutoTradingStatus(userId, {
        trades_taken_today: status.tradesTakenToday + 1,
        total_trades_executed: (status.totalTradesExecuted || 0) + 1,
        last_trade_time: new Date().toISOString(),
        last_opportunity_found: new Date().toISOString(),
        consecutive_no_opportunity_count: 0
      });

      await this.recordLearningMetric(userId, analysisResult.decision.id, selectedOption, tradeResult.trade);


      await this.notifyUser(
        userId,
        'Auto Trade Executed',
        `${selectedOption.direction} ${selectedOption.symbol} at ${selectedOption.entryPrice}. Confidence: ${selectedOption.confidence}%`
      );

      return {
        opportunityFound: true,
        decision: analysisResult.decision,
        trade: tradeResult.trade,
        message: `Trade executed: ${selectedOption.direction} ${selectedOption.symbol}`,
        scanDuration: Date.now() - scanStartTime
      };

    } catch (error) {
      console.error('Scan error:', error);
      await this.incrementNoOpportunityCount(userId);
      return {
        opportunityFound: false,
        message: error instanceof Error ? error.message : 'Scan failed',
        scanDuration: Date.now() - scanStartTime
      };
    } finally {
      await this.updateAutoTradingStatus(userId, {
        last_scan_time: new Date().toISOString()
      });
    }
  }

  private selectBestAutoOption(options: any[], preferences: any) {
    const riskTolerance = preferences.risk_tolerance || 'medium';

    const riskTypeMap = {
      'low': 'low_risk',
      'medium': 'medium_risk',
      'high': 'high_risk'
    };

    const preferredType = riskTypeMap[riskTolerance as keyof typeof riskTypeMap];

    return options.find(opt => opt.optionType === preferredType) || options[1];
  }

  private isWithinTradingHours(preferences: any): boolean {
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 8);

    const startTime = preferences.auto_trading_hours_start || '00:00:00';
    const endTime = preferences.auto_trading_hours_end || '23:59:59';

    return currentTime >= startTime && currentTime <= endTime;
  }

  private async handleNoOpportunityTimeout(userId: string) {
    await this.notifyUser(
      userId,
      'No Opportunities Found',
      'No profitable trades were found within the past hour. Auto trading will continue scanning.'
    );

    const newTimeout = setTimeout(async () => {
      await this.handleNoOpportunityTimeout(userId);
    }, 60 * 60 * 1000);

    this.opportunityTimeouts.set(userId, newTimeout);
  }

  private async incrementNoOpportunityCount(userId: string) {
    const { data: status } = await supabase
      .from('auto_trading_status')
      .select('consecutive_no_opportunity_count')
      .eq('user_id', userId)
      .single();

    if (status) {
      await supabase
        .from('auto_trading_status')
        .update({
          consecutive_no_opportunity_count: status.consecutive_no_opportunity_count + 1
        })
        .eq('user_id', userId);
    }
  }

  async getAutoTradingStatus(userId: string): Promise<AutoTradingStatus | null> {
    try {
      const { data, error } = await supabase
        .from('auto_trading_status')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error || !data) return null;

      return {
        id: data.id,
        userId: data.user_id,
        enabled: data.enabled,
        tradesTakenToday: data.trades_taken_today,
        maxDailyTrades: data.max_daily_trades,
        lastScanTime: data.last_scan_time ? new Date(data.last_scan_time) : undefined,
        lastTradeTime: data.last_trade_time ? new Date(data.last_trade_time) : undefined,
        opportunityWindowStart: data.opportunity_window_start ? new Date(data.opportunity_window_start) : undefined,
        opportunityWindowEnd: data.opportunity_window_end ? new Date(data.opportunity_window_end) : undefined,
        scanningActive: data.scanning_active,
        lastOpportunityFound: data.last_opportunity_found ? new Date(data.last_opportunity_found) : undefined,
        consecutiveNoOpportunityCount: data.consecutive_no_opportunity_count,
        dailyPnl: parseFloat(data.daily_pnl),
        dailyLossLimit: parseFloat(data.daily_loss_limit),
        emergencyStop: data.emergency_stop,
        continuousMode: data.continuous_mode || false,
        learningMode: data.learning_mode || false,
        totalTradesExecuted: data.total_trades_executed || 0
      };
    } catch (error) {
      console.error('Error getting auto trading status:', error);
      return null;
    }
  }

  private async initializeAutoTradingStatus(userId: string) {
    await supabase
      .from('auto_trading_status')
      .insert({
        user_id: userId,
        enabled: false,
        trades_taken_today: 0,
        max_daily_trades: 6,
        scanning_active: false,
        consecutive_no_opportunity_count: 0,
        daily_pnl: 0,
        daily_loss_limit: -500,
        emergency_stop: false
      });
  }

  private async updateAutoTradingStatus(userId: string, updates: any) {
    await supabase
      .from('auto_trading_status')
      .upsert({
        user_id: userId,
        ...updates,
        updated_at: new Date().toISOString()
      });
  }

  private async notifyUser(userId: string, title: string, message: string) {
    console.log(`[AUTO TRADE NOTIFICATION] ${userId}: ${title} - ${message}`);
  }

  private async recordLearningMetric(userId: string, decisionId: string, option: any, trade: any) {
    try {
      await supabase.from('ai_learning_metrics').insert({
        user_id: userId,
        trade_id: trade.id,
        decision_id: decisionId,
        strategy_used: 'ai_auto_continuous',
        predicted_confidence: option.confidence,
        actual_outcome: 'pending',
        predicted_pnl: option.estimatedProfit,
        market_conditions: {
          symbol: option.symbol,
          entryPrice: option.entryPrice,
          timestamp: new Date().toISOString()
        },
        indicators_used: {
          strategy: 'FxFlowScalperV2',
          riskLevel: option.optionType,
          confidence: option.confidence
        }
      });
    } catch (error) {
      console.error('Failed to record learning metric:', error);
    }
  }

  async resetDailyCounters() {
    await supabase
      .from('auto_trading_status')
      .update({
        trades_taken_today: 0,
        daily_pnl: 0,
        consecutive_no_opportunity_count: 0,
        emergency_stop: false
      })
      .eq('enabled', true);
  }
}

export const autoTradingScanner = new AutoTradingScanner();

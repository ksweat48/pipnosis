import { supabase } from '@/lib/supabase';
import { aiTradingEngine, AIAnalysisRequest } from './ai-trading-engine';
import { simulatedTradingService } from './simulated-trading';
import { thoughtProcessLogger } from './thought-process-logger';

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
        await supabase.from('user_trading_preferences').upsert({
          user_id: userId,
          auto_trading_enabled: true,
          min_confidence_threshold: 75
        }, {
          onConflict: 'user_id',
          ignoreDuplicates: false
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
    let scanStepNumber = 0;
    let decisionId: string | null = null;

    try {
      // Create the decision record FIRST before any thought logging
      const { data: decisionData, error: decisionError } = await supabase
        .from('ai_trade_decisions')
        .insert({
          user_id: userId,
          symbol: 'SCANNING',
          timeframe: 'M15',
          decision_type: 'auto',
          chatgpt_prompt: 'Auto trading market scan',
          chatgpt_response: { status: 'scanning' },
          market_context: { scanStartTime: new Date().toISOString() },
          strategy_used: 'FxFlowScalperV2',
          reasoning: 'Automated market scan for trading opportunities',
          approved: false,
          executed: false
        })
        .select('id')
        .single();

      if (decisionError || !decisionData) {
        console.error('Failed to create decision record:', decisionError);
        return {
          opportunityFound: false,
          message: 'Failed to initialize scan decision record',
          scanDuration: Date.now() - scanStartTime
        };
      }

      decisionId = decisionData.id;

      const status = await this.getAutoTradingStatus(userId);

      await thoughtProcessLogger.logThought({
        userId,
        decisionId,
        stepNumber: ++scanStepNumber,
        stepType: 'auto_scan_start',
        title: 'Auto Trading Scan Started',
        content: `Continuous mode: ${status?.continuousMode ? 'Enabled' : 'Disabled'}
Trades taken today: ${status?.tradesTakenToday || 0}/${status?.maxDailyTrades || 0}
Daily P&L: $${status?.dailyPnl.toFixed(2) || '0.00'}
Loss limit: $${status?.dailyLossLimit || '-500.00'}`,
        metadata: {
          scanTime: new Date().toISOString(),
          tradesTaken: status?.tradesTakenToday,
          dailyPnl: status?.dailyPnl
        }
      });

      if (!status || !status.enabled || status.emergencyStop) {
        await thoughtProcessLogger.logThought({
          userId,
          decisionId: decisionId!,
          stepNumber: ++scanStepNumber,
          stepType: 'warning',
          title: 'Scan Aborted',
          content: 'Auto trading is disabled or emergency stopped. No scan will be performed.',
          metadata: { enabled: status?.enabled, emergencyStop: status?.emergencyStop }
        });
        return {
          opportunityFound: false,
          message: 'Auto trading is disabled or emergency stopped',
          scanDuration: Date.now() - scanStartTime
        };
      }

      await thoughtProcessLogger.logThought({
        userId,
        decisionId: decisionId!,
        stepNumber: ++scanStepNumber,
        stepType: 'auto_limit_check',
        title: 'Checking Trade Limits',
        content: `Continuous Mode: ${status.continuousMode ? 'YES - No daily limits' : 'NO - Daily limits enforced'}
Trades Today: ${status.tradesTakenToday}/${status.maxDailyTrades}
${!status.continuousMode && status.tradesTakenToday >= status.maxDailyTrades ? '⚠️ Daily trade limit reached' : '✓ Trade limits OK'}`,
        metadata: { continuousMode: status.continuousMode, tradesTaken: status.tradesTakenToday, maxTrades: status.maxDailyTrades }
      });

      if (!status.continuousMode && status.tradesTakenToday >= status.maxDailyTrades) {
        await this.updateAutoTradingStatus(userId, { scanning_active: false });
        await thoughtProcessLogger.logThought({
          userId,
          decisionId: decisionId!,
          stepNumber: ++scanStepNumber,
          stepType: 'auto_scan_complete',
          title: 'Daily Limit Reached',
          content: `Trade limit reached (${status.tradesTakenToday}/${status.maxDailyTrades}). Auto trading paused until tomorrow.`,
          metadata: { reason: 'daily_limit' }
        });
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

        await thoughtProcessLogger.logThought({
          userId,
          decisionId: decisionId!,
          stepNumber: ++scanStepNumber,
          stepType: 'auto_emergency_stop',
          title: 'EMERGENCY STOP TRIGGERED',
          content: `Daily P&L ($${status.dailyPnl.toFixed(2)}) has exceeded loss limit ($${status.dailyLossLimit.toFixed(2)}).

Per Pipnosis Law #3 (Drawdown Management), auto trading has been automatically stopped to protect your capital.

Manual intervention required to restart.`,
          metadata: { dailyPnl: status.dailyPnl, lossLimit: status.dailyLossLimit }
        });

        await this.notifyUser(userId, 'Emergency stop triggered', 'Daily loss limit exceeded. Auto trading has been stopped.');

        return {
          opportunityFound: false,
          message: 'Emergency stop: Daily loss limit exceeded',
          scanDuration: Date.now() - scanStartTime
        };
      }

      const isWithinHours = this.isWithinTradingHours(preferences);
      await thoughtProcessLogger.logThought({
        userId,
        decisionId: decisionId!,
        stepNumber: ++scanStepNumber,
        stepType: 'auto_market_hours_check',
        title: 'Market Hours Validation',
        content: `Current Time: ${new Date().toLocaleTimeString()}
Trading Hours: ${preferences.auto_trading_hours_start || '00:00:00'} - ${preferences.auto_trading_hours_end || '23:59:59'}
Status: ${isWithinHours ? '✓ Within trading hours' : '⚠️ Outside trading hours'}`,
        metadata: { withinHours: isWithinHours, currentTime: new Date().toISOString() }
      });

      if (!isWithinHours) {
        await thoughtProcessLogger.logThought({
          userId,
          decisionId: decisionId!,
          stepNumber: ++scanStepNumber,
          stepType: 'auto_scan_complete',
          title: 'Scan Skipped - Outside Trading Hours',
          content: 'Per Pipnosis Law #8 (Market Hours), scanning paused until trading hours resume.',
          metadata: { reason: 'outside_hours' }
        });
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
        symbols: preferences.preferred_pairs || ['EURUSD', 'GBPUSD', 'XAUUSD'],
        existingDecisionId: decisionId
      };

      await thoughtProcessLogger.logThought({
        userId,
        decisionId: decisionId!,
        stepNumber: ++scanStepNumber,
        stepType: 'initialization',
        title: 'Starting AI Market Analysis',
        content: `Account Balance: $${accountBalance}
Scanning Symbols: ${analysisRequest.symbols.join(', ')}
Min Confidence Threshold: ${preferences.min_confidence_threshold || 75}%
Risk Tolerance: ${preferences.risk_tolerance || 'medium'}`,
        metadata: { accountBalance, symbols: analysisRequest.symbols }
      });

      const analysisResult = await aiTradingEngine.analyzeTradeRequest(analysisRequest);

      // Update the decision ID if it changed
      if (analysisResult.decision?.id && analysisResult.decision.id !== decisionId) {
        decisionId = analysisResult.decision.id;
      }

      if (!analysisResult.decision || !analysisResult.options.length) {
        await thoughtProcessLogger.logThought({
          userId,
          decisionId: decisionId!,
          stepNumber: ++scanStepNumber,
          stepType: 'auto_trade_skip',
          title: 'No Opportunities Found',
          content: 'AI analysis completed but found no high-confidence trading opportunities in current market conditions.',
          metadata: { reason: 'no_opportunities' }
        });
        await this.incrementNoOpportunityCount(userId);
        return {
          opportunityFound: false,
          message: 'No high-confidence opportunities found',
          scanDuration: Date.now() - scanStartTime
        };
      }

      const selectedOption = this.selectBestAutoOption(analysisResult.options, preferences);

      await thoughtProcessLogger.logThought({
        userId,
        decisionId: decisionId!,
        stepNumber: ++scanStepNumber,
        stepType: 'auto_threshold_check',
        title: 'Evaluating Confidence Threshold',
        content: `Best Option Found:
Symbol: ${selectedOption.symbol}
Direction: ${selectedOption.direction}
Confidence: ${selectedOption.confidence}%
Required Threshold: ${preferences.min_confidence_threshold || 75}%
Risk Level: ${selectedOption.optionType}

${selectedOption.confidence >= (preferences.min_confidence_threshold || 75) ? '✓ Confidence threshold met - Trade approved' : '⚠️ Below confidence threshold - Trade rejected'}`,
        metadata: {
          confidence: selectedOption.confidence,
          threshold: preferences.min_confidence_threshold,
          symbol: selectedOption.symbol,
          direction: selectedOption.direction
        }
      });

      if (selectedOption.confidence < preferences.min_confidence_threshold) {
        await thoughtProcessLogger.logThought({
          userId,
          decisionId: decisionId!,
          stepNumber: ++scanStepNumber,
          stepType: 'auto_trade_skip',
          title: 'Trade Rejected - Low Confidence',
          content: `Confidence (${selectedOption.confidence}%) below minimum threshold (${preferences.min_confidence_threshold}%).

Per Pipnosis Law #6 (Quality Over Quantity), only high-probability setups are executed.`,
          metadata: { confidence: selectedOption.confidence, threshold: preferences.min_confidence_threshold, reason: 'low_confidence' }
        });
        await this.incrementNoOpportunityCount(userId);
        return {
          opportunityFound: false,
          message: `Opportunity confidence (${selectedOption.confidence}%) below threshold (${preferences.min_confidence_threshold}%)`,
          scanDuration: Date.now() - scanStartTime
        };
      }

      await aiTradingEngine.approveTradeOption(selectedOption.id, userId);

      await thoughtProcessLogger.logThought({
        userId,
        decisionId: decisionId!,
        stepNumber: ++scanStepNumber,
        stepType: 'auto_trade_execute',
        title: 'Executing Auto Trade',
        content: `Trade Details:
Symbol: ${selectedOption.symbol}
Direction: ${selectedOption.direction}
Entry Price: ${selectedOption.entryPrice}
Stop Loss: ${selectedOption.stopLoss}
Take Profit: ${selectedOption.takeProfit}
Lot Size: ${selectedOption.lotSize}
Risk Level: ${selectedOption.optionType}
Estimated Profit: $${selectedOption.estimatedProfit.toFixed(2)}
Estimated Loss: $${selectedOption.estimatedLoss.toFixed(2)}
R:R Ratio: ${selectedOption.riskRewardRatio.toFixed(2)}

Executing trade now...`,
        metadata: {
          symbol: selectedOption.symbol,
          direction: selectedOption.direction,
          entryPrice: selectedOption.entryPrice,
          lotSize: selectedOption.lotSize
        }
      });

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
        await thoughtProcessLogger.logThought({
          userId,
          decisionId: decisionId!,
          stepNumber: ++scanStepNumber,
          stepType: 'error',
          title: 'Trade Execution Failed',
          content: `Failed to execute trade: ${tradeResult.message}`,
          metadata: { error: tradeResult.message }
        });
        throw new Error(tradeResult.message);
      }

      await supabase
        .from('ai_trade_decisions')
        .update({
          executed: true,
          executed_at: new Date().toISOString(),
          trade_id: tradeResult.trade?.id
        })
        .eq('id', decisionId!);

      await this.updateAutoTradingStatus(userId, {
        trades_taken_today: status.tradesTakenToday + 1,
        total_trades_executed: (status.totalTradesExecuted || 0) + 1,
        last_trade_time: new Date().toISOString(),
        last_opportunity_found: new Date().toISOString(),
        consecutive_no_opportunity_count: 0
      });

      await this.recordLearningMetric(userId, decisionId!, selectedOption, tradeResult.trade);

      await thoughtProcessLogger.logThought({
        userId,
        decisionId: decisionId!,
        stepNumber: ++scanStepNumber,
        stepType: 'auto_scan_complete',
        title: 'Trade Successfully Executed',
        content: `✓ ${selectedOption.direction} ${selectedOption.symbol} position opened

Trade ID: ${tradeResult.trade?.id}
Entry: ${selectedOption.entryPrice}
Current Price: ${tradeResult.trade?.entryPrice}
Position Size: ${selectedOption.lotSize} lots

Trades today: ${status.tradesTakenToday + 1}
Total auto trades: ${(status.totalTradesExecuted || 0) + 1}

Next scan in approximately 2 minutes.`,
        metadata: {
          tradeId: tradeResult.trade?.id,
          success: true,
          tradesCount: status.tradesTakenToday + 1
        }
      });

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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isNoOpportunityError = errorMessage.includes('No profitable trade opportunities');

      if (isNoOpportunityError) {
        await this.incrementNoOpportunityCount(userId);
        return {
          opportunityFound: false,
          message: 'No opportunities found',
          scanDuration: Date.now() - scanStartTime
        };
      }

      console.error('❌ Auto Trading Error:', errorMessage);

      if (decisionId) {
        await thoughtProcessLogger.logThought({
          userId,
          decisionId,
          stepNumber: ++scanStepNumber,
          stepType: 'error',
          title: '❌ Auto Trading Paused - Error Occurred',
          content: `An error occurred during the auto trading scan: ${errorMessage}

Auto trading has been paused to prevent further issues. Please review the error and restart manually when ready.`,
          metadata: { error: errorMessage, pausedAt: new Date().toISOString() }
        });
      }

      await this.updateAutoTradingStatus(userId, {
        enabled: false,
        scanning_active: false,
        emergency_stop: true
      });

      if (this.scannerIntervals.has(userId)) {
        clearInterval(this.scannerIntervals.get(userId)!);
        this.scannerIntervals.delete(userId);
      }

      await this.notifyUser(
        userId,
        'Auto Trading Paused - Error',
        `Auto trading has been paused due to an error: ${errorMessage}. Manual restart required.`
      );

      return {
        opportunityFound: false,
        message: `Auto trading paused: ${errorMessage}`,
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
      .upsert({
        user_id: userId,
        enabled: false,
        trades_taken_today: 0,
        max_daily_trades: 6,
        scanning_active: false,
        consecutive_no_opportunity_count: 0,
        daily_pnl: 0,
        daily_loss_limit: -500,
        emergency_stop: false,
        is_active: false,
        monitored_symbols: [],
        trades_today: 0,
        trades_remaining: 0
      }, {
        onConflict: 'user_id',
        ignoreDuplicates: false
      });
  }

  private async updateAutoTradingStatus(userId: string, updates: any) {
    await supabase
      .from('auto_trading_status')
      .upsert({
        user_id: userId,
        ...updates,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id',
        ignoreDuplicates: false
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

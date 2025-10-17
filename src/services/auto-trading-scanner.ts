import { supabase } from '@/lib/supabase';
import { aiTradingEngine, AIAnalysisRequest } from './ai-trading-engine';
import { simulatedTradingService } from './simulated-trading';
import { thoughtProcessLogger } from './thought-process-logger';
import { autoTradingPersistence } from './auto-trading-persistence';

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
  currentSessionId?: string;
  sessionStartedAt?: Date;
  sessionEndedAt?: Date;
}

export interface ScanResult {
  opportunityFound: boolean;
  decision?: any;
  trade?: any;
  message: string;
  scanDuration: number;
}

class AutoTradingScanner {
  private opportunityTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private isListeningForScheduledScans: boolean = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.setupScheduledScanListener();
    }
  }

  private setupScheduledScanListener() {
    if (this.isListeningForScheduledScans) {
      console.log('[AutoTradingScanner] Scheduled scan listener already initialized');
      return;
    }

    console.log('[AutoTradingScanner] Setting up scheduled scan listener...');

    window.addEventListener('autoTradingScheduledScan', async (event: any) => {
      try {
        const { userId, scheduledAt } = event.detail;
        console.log('┌─────────────────────────────────────────────────────────────────────┐');
        console.log('│          🔔 SCHEDULED SCAN EVENT RECEIVED                            │');
        console.log('└─────────────────────────────────────────────────────────────────────┘');
        console.log(`[AutoTradingScanner] User ID: ${userId}`);
        console.log(`[AutoTradingScanner] Scheduled at: ${scheduledAt}`);
        console.log(`[AutoTradingScanner] Current time: ${new Date().toISOString()}`);

        // Load preferences with fallback to defaults
        console.log('[AutoTradingScanner] Loading user trading preferences...');
        const { data: preferences, error: preferencesError } = await supabase
          .from('user_trading_preferences')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();

        if (preferencesError) {
          console.error('[AutoTradingScanner] Error loading preferences:', preferencesError);
        }

        // Use loaded preferences or fallback to defaults
        const effectivePreferences = preferences || {
          user_id: userId,
          preferred_pairs: ['EURUSD', 'GBPUSD', 'XAUUSD'],
          min_confidence_threshold: 75,
          risk_tolerance: 'medium',
          auto_trading_enabled: true,
          auto_trading_hours_start: '00:00:00',
          auto_trading_hours_end: '23:59:59'
        };

        console.log('[AutoTradingScanner] Using preferences:', {
          pairs: effectivePreferences.preferred_pairs,
          minConfidence: effectivePreferences.min_confidence_threshold,
          riskTolerance: effectivePreferences.risk_tolerance
        });

        // Verify auto trading is still enabled before performing scan
        const { data: status } = await supabase
          .from('auto_trading_status')
          .select('enabled, scanning_active, emergency_stop, should_be_scanning')
          .eq('user_id', userId)
          .maybeSingle();

        if (!status) {
          console.log('[AutoTradingScanner] ⚠️ No auto trading status found - skipping scan');
          return;
        }

        if (!status.enabled || !status.scanning_active || status.emergency_stop || !status.should_be_scanning) {
          console.log('[AutoTradingScanner] ⚠️ Auto trading not active - skipping scan:', {
            enabled: status.enabled,
            scanningActive: status.scanning_active,
            emergencyStop: status.emergency_stop,
            shouldBeScanning: status.should_be_scanning
          });
          return;
        }

        console.log('[AutoTradingScanner] ✓ Auto trading is active - proceeding with scan');
        console.log('[AutoTradingScanner] Calling performScan...');

        // Perform the scan
        const scanResult = await this.performScan(userId, effectivePreferences);

        console.log('[AutoTradingScanner] Scan completed:', {
          opportunityFound: scanResult.opportunityFound,
          message: scanResult.message,
          duration: scanResult.scanDuration + 'ms'
        });

      } catch (error) {
        console.error('┌─────────────────────────────────────────────────────────────────────┐');
        console.error('│          ❌ ERROR IN SCHEDULED SCAN EVENT HANDLER                    │');
        console.error('└─────────────────────────────────────────────────────────────────────┘');
        console.error('[AutoTradingScanner] Error details:', error);
        console.error('[AutoTradingScanner] Error stack:', error instanceof Error ? error.stack : 'No stack trace');

        // Don't let one error stop future scans - just log it
      }
    });

    this.isListeningForScheduledScans = true;
    console.log('[AutoTradingScanner] ✓ Scheduled scan listener initialized successfully');
    console.log('[AutoTradingScanner] Listener is ready to receive autoTradingScheduledScan events');
  }

  async startAutoTrading(userId: string): Promise<{ success: boolean; message: string }> {
    console.log('\n╔═══════════════════════════════════════════════════════════════════════╗');
    console.log('║           🚀 AUTO TRADING START REQUEST RECEIVED                      ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════╝');
    console.log(`[AutoTradingScanner.startAutoTrading] Requested by user: ${userId}`);
    console.log(`[AutoTradingScanner.startAutoTrading] Timestamp: ${new Date().toISOString()}`);

    try {
      console.log('[AutoTradingScanner.startAutoTrading] Checking admin privileges...');
      const { data: userProfile } = await supabase
        .from('user_profiles')
        .select('is_admin')
        .eq('id', userId)
        .single();

      if (!userProfile || userProfile.is_admin !== true) {
        console.log('[AutoTradingScanner.startAutoTrading] ❌ Access denied - User is not admin');
        return {
          success: false,
          message: 'Auto trading is currently available for admin users only during testing phase'
        };
      }

      console.log('[AutoTradingScanner.startAutoTrading] ✓ Admin privileges confirmed');

      console.log('[AutoTradingScanner.startAutoTrading] Loading auto trading status...');
      const status = await this.getAutoTradingStatus(userId);

      if (!status) {
        console.log('[AutoTradingScanner.startAutoTrading] No existing status found, initializing...');
        await this.initializeAutoTradingStatus(userId);
      } else {
        console.log('[AutoTradingScanner.startAutoTrading] ✓ Existing status loaded');
      }

      console.log('[AutoTradingScanner.startAutoTrading] Loading user trading preferences...');
      const { data: preferences } = await supabase
        .from('user_trading_preferences')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (!preferences) {
        console.log('[AutoTradingScanner.startAutoTrading] No preferences found, creating defaults...');
        await supabase.from('user_trading_preferences').upsert({
          user_id: userId,
          auto_trading_enabled: true,
          min_confidence_threshold: 75
        }, {
          onConflict: 'user_id',
          ignoreDuplicates: false
        });
      } else {
        console.log('[AutoTradingScanner.startAutoTrading] ✓ User preferences loaded');
      }

      console.log('[AutoTradingScanner.startAutoTrading] Generating new session ID...');
      const newSessionId = crypto.randomUUID();
      console.log(`[AutoTradingScanner.startAutoTrading] Session ID: ${newSessionId}`);

      console.log('[AutoTradingScanner.startAutoTrading] Updating auto trading status in database...');
      const scanInterval = 120; // 2 minutes
      const nextScanTime = new Date(Date.now() + scanInterval * 1000);

      await this.updateAutoTradingStatus(userId, {
        enabled: true,
        scanning_active: true,
        continuous_mode: true,
        learning_mode: true,
        emergency_stop: false,
        started_by_admin: userId,
        opportunity_window_start: new Date().toISOString(),
        current_session_id: newSessionId,
        session_started_at: new Date().toISOString(),
        session_ended_at: null,
        should_be_scanning: true,
        scan_interval_seconds: scanInterval,
        next_scan_scheduled_at: nextScanTime.toISOString(),
        last_heartbeat_at: new Date().toISOString()
      });
      console.log('[AutoTradingScanner.startAutoTrading] ✓ Status updated successfully (emergency stop cleared)');

      // Enable persistence layer
      console.log('[AutoTradingScanner.startAutoTrading] Enabling persistence layer...');
      await autoTradingPersistence.enableScanning(userId, scanInterval);
      console.log('[AutoTradingScanner.startAutoTrading] ✓ Persistence enabled');

      console.log('[AutoTradingScanner.startAutoTrading] Performing initial scan...');
      // Perform an immediate initial scan
      await this.performScan(userId, preferences || { preferred_pairs: ['EURUSD', 'GBPUSD', 'XAUUSD'], min_confidence_threshold: 75 });

      console.log('╔═══════════════════════════════════════════════════════════════════════╗');
      console.log('║              ✅ AUTO TRADING STARTED SUCCESSFULLY                      ║');
      console.log('╚═══════════════════════════════════════════════════════════════════════╝\n');

      return {
        success: true,
        message: '✅ Auto trading started! The system will automatically scan markets every 2 minutes. This will continue even if you reload the page or navigate away.'
      };
    } catch (error) {
      console.error('╔═══════════════════════════════════════════════════════════════════════╗');
      console.error('║              ❌ FAILED TO START AUTO TRADING                          ║');
      console.error('╚═══════════════════════════════════════════════════════════════════════╝');
      console.error('[AutoTradingScanner.startAutoTrading] Error:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to start auto trading'
      };
    }
  }

  async stopAutoTrading(userId: string): Promise<{ success: boolean; message: string }> {
    console.log('\n╔═══════════════════════════════════════════════════════════════════════╗');
    console.log('║           🛑 AUTO TRADING STOP REQUEST RECEIVED                       ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════╝');
    console.log(`[AutoTradingScanner.stopAutoTrading] Requested by user: ${userId}`);
    console.log(`[AutoTradingScanner.stopAutoTrading] Timestamp: ${new Date().toISOString()}`);

    try {
      console.log('[AutoTradingScanner.stopAutoTrading] Disabling persistence layer...');
      await autoTradingPersistence.disableScanning(userId);
      console.log('[AutoTradingScanner.stopAutoTrading] ✓ Persistence disabled');

      console.log('[AutoTradingScanner.stopAutoTrading] Loading current session...');
      const { data: currentStatus } = await supabase
        .from('auto_trading_status')
        .select('current_session_id')
        .eq('user_id', userId)
        .maybeSingle();

      console.log(`[AutoTradingScanner.stopAutoTrading] Current session ID: ${currentStatus?.current_session_id || 'None'}`);

      console.log('[AutoTradingScanner.stopAutoTrading] Updating status in database...');
      await this.updateAutoTradingStatus(userId, {
        enabled: false,
        scanning_active: false,
        session_ended_at: new Date().toISOString(),
        should_be_scanning: false,
        next_scan_scheduled_at: null,
        last_heartbeat_at: null
      });
      console.log('[AutoTradingScanner.stopAutoTrading] ✓ Status updated successfully');

      console.log('╔═══════════════════════════════════════════════════════════════════════╗');
      console.log('║              ✅ AUTO TRADING STOPPED SUCCESSFULLY                      ║');
      console.log('╚═══════════════════════════════════════════════════════════════════════╝\n');

      return {
        success: true,
        message: 'Auto trading stopped'
      };
    } catch (error) {
      console.error('╔═══════════════════════════════════════════════════════════════════════╗');
      console.error('║              ❌ FAILED TO STOP AUTO TRADING                           ║');
      console.error('╚═══════════════════════════════════════════════════════════════════════╝');
      console.error('[AutoTradingScanner.stopAutoTrading] Error:', error);
      return {
        success: false,
        message: 'Failed to stop auto trading'
      };
    }
  }


  private async performScan(userId: string, preferences: any): Promise<ScanResult> {
    const scanStartTime = Date.now();
    let scanStepNumber = 0;
    let decisionId: string | null = null;
    let sessionId: string | null = null;

    console.log('┌─────────────────────────────────────────────────────────────────────┐');
    console.log('│                    🔍 STARTING MARKET SCAN CYCLE                     │');
    console.log('└─────────────────────────────────────────────────────────────────────┘');
    console.log(`[AutoTradingScanner] Scan started at: ${new Date().toLocaleString()}`);
    console.log(`[AutoTradingScanner] User ID: ${userId}`);

    try {
      console.log('[AutoTradingScanner] Step 1: Creating decision record in database...');
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
        console.error('[AutoTradingScanner] ❌ Failed to create decision record:', decisionError);
        return {
          opportunityFound: false,
          message: 'Failed to initialize scan decision record',
          scanDuration: Date.now() - scanStartTime
        };
      }

      decisionId = decisionData.id;
      console.log(`[AutoTradingScanner] ✓ Decision record created with ID: ${decisionId}`);

      console.log('[AutoTradingScanner] Step 2: Loading auto trading status...');
      const status = await this.getAutoTradingStatus(userId);
      sessionId = status?.currentSessionId || null;
      console.log(`[AutoTradingScanner] ✓ Status loaded - Session ID: ${sessionId || 'No active session'}`);
      console.log(`[AutoTradingScanner] Enabled: ${status?.enabled}, Scanning Active: ${status?.scanningActive}`);
      console.log(`[AutoTradingScanner] Daily P&L: $${status?.dailyPnl.toFixed(2) || '0.00'}, Total Trades: ${status?.totalTradesExecuted || 0}`);

      console.log('[AutoTradingScanner] Step 3: Logging thought process - Scan started...');
      await thoughtProcessLogger.logThought({
        userId,
        decisionId,
        stepNumber: ++scanStepNumber,
        stepType: 'auto_scan_start',
        title: 'Auto Trading Scan Started',
        content: `Continuous learning mode: Enabled
Daily P&L: $${status?.dailyPnl.toFixed(2) || '0.00'}
Loss limit: $${status?.dailyLossLimit || '-500.00'}
Total trades executed: ${status?.totalTradesExecuted || 0}`,
        metadata: {
          scanTime: new Date().toISOString(),
          dailyPnl: status?.dailyPnl,
          totalTrades: status?.totalTradesExecuted,
          sessionId
        }
      }, sessionId);

      if (!status || !status.enabled || status.emergencyStop) {
        console.log('[AutoTradingScanner] ⚠️  Scan aborted - Auto trading disabled or emergency stopped');
        console.log(`[AutoTradingScanner] Status: enabled=${status?.enabled}, emergencyStop=${status?.emergencyStop}`);
        await thoughtProcessLogger.logThought({
          userId,
          decisionId: decisionId!,
          stepNumber: ++scanStepNumber,
          stepType: 'warning',
          title: 'Scan Aborted',
          content: 'Auto trading is disabled or emergency stopped. No scan will be performed.',
          metadata: { enabled: status?.enabled, emergencyStop: status?.emergencyStop }
        }, sessionId);
        return {
          opportunityFound: false,
          message: 'Auto trading is disabled or emergency stopped',
          scanDuration: Date.now() - scanStartTime
        };
      }

      console.log('[AutoTradingScanner] Step 4: Performing system status checks...');

      await thoughtProcessLogger.logThought({
        userId,
        decisionId: decisionId!,
        stepNumber: ++scanStepNumber,
        stepType: 'auto_limit_check',
        title: 'System Status Check',
        content: `Continuous Learning Mode: Active
Trades Executed: ${status.totalTradesExecuted || 0}
Daily P&L: $${status.dailyPnl.toFixed(2)}
✓ System operational - no trade limits`,
        metadata: { continuousMode: status.continuousMode, totalTrades: status.totalTradesExecuted, dailyPnl: status.dailyPnl }
      }, sessionId);

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
        }, sessionId);

        await this.notifyUser(userId, 'Emergency stop triggered', 'Daily loss limit exceeded. Auto trading has been stopped.');

        return {
          opportunityFound: false,
          message: 'Emergency stop: Daily loss limit exceeded',
          scanDuration: Date.now() - scanStartTime
        };
      }

      console.log('[AutoTradingScanner] Step 5: Checking trading hours...');
      const isWithinHours = this.isWithinTradingHours(preferences);
      console.log(`[AutoTradingScanner] Current time: ${new Date().toLocaleTimeString()}`);
      console.log(`[AutoTradingScanner] Trading hours: ${preferences.auto_trading_hours_start || '00:00:00'} - ${preferences.auto_trading_hours_end || '23:59:59'}`);
      console.log(`[AutoTradingScanner] Within trading hours: ${isWithinHours ? 'YES ✓' : 'NO ✗'}`);

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
      }, sessionId);

      if (!isWithinHours) {
        await thoughtProcessLogger.logThought({
          userId,
          decisionId: decisionId!,
          stepNumber: ++scanStepNumber,
          stepType: 'auto_scan_complete',
          title: 'Scan Skipped - Outside Trading Hours',
          content: 'Per Pipnosis Law #8 (Market Hours), scanning paused until trading hours resume.',
          metadata: { reason: 'outside_hours' }
        }, sessionId);
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

      console.log('[AutoTradingScanner] Step 6: Preparing AI analysis request...');
      console.log(`[AutoTradingScanner] Account balance: $${accountBalance}`);
      console.log(`[AutoTradingScanner] Symbols to scan: ${preferences.preferred_pairs?.join(', ') || 'EURUSD, GBPUSD, XAUUSD'}`);

      const analysisRequest: AIAnalysisRequest = {
        userId,
        prompt: 'Scan for the best high-confidence trading opportunity',
        accountBalance,
        decisionType: 'auto',
        symbols: preferences.preferred_pairs || ['EURUSD', 'GBPUSD', 'XAUUSD'],
        existingDecisionId: decisionId,
        sessionId: sessionId
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
      }, sessionId);

      console.log('[AutoTradingScanner] Step 7: Calling AI Trading Engine for market analysis...');
      const analysisResult = await aiTradingEngine.analyzeTradeRequest(analysisRequest);
      console.log(`[AutoTradingScanner] ✓ AI analysis complete - Found ${analysisResult.options?.length || 0} trade options`);

      // Update the decision ID if it changed
      if (analysisResult.decision?.id && analysisResult.decision.id !== decisionId) {
        decisionId = analysisResult.decision.id;
      }

      if (!analysisResult.decision || !analysisResult.options.length) {
        console.log('[AutoTradingScanner] ⚠️  No opportunities found in this scan cycle');
        await thoughtProcessLogger.logThought({
          userId,
          decisionId: decisionId!,
          stepNumber: ++scanStepNumber,
          stepType: 'auto_trade_skip',
          title: 'No Opportunities Found',
          content: 'AI analysis completed but found no high-confidence trading opportunities in current market conditions.',
          metadata: { reason: 'no_opportunities' }
        }, sessionId);
        await this.incrementNoOpportunityCount(userId);
        return {
          opportunityFound: false,
          message: 'No high-confidence opportunities found',
          scanDuration: Date.now() - scanStartTime
        };
      }

      console.log('[AutoTradingScanner] Step 8: Selecting best trade option based on risk preference...');
      const selectedOption = this.selectBestAutoOption(analysisResult.options, preferences);
      console.log(`[AutoTradingScanner] ✓ Selected: ${selectedOption.symbol} ${selectedOption.direction} - Confidence: ${selectedOption.confidence}%`);
      console.log(`[AutoTradingScanner] Entry: ${selectedOption.entryPrice}, SL: ${selectedOption.stopLoss}, TP: ${selectedOption.takeProfit}`);

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
      }, sessionId);

      if (selectedOption.confidence < preferences.min_confidence_threshold) {
        console.log(`[AutoTradingScanner] ⚠️  Trade rejected - Confidence ${selectedOption.confidence}% below threshold ${preferences.min_confidence_threshold}%`);
        await thoughtProcessLogger.logThought({
          userId,
          decisionId: decisionId!,
          stepNumber: ++scanStepNumber,
          stepType: 'auto_trade_skip',
          title: 'Trade Rejected - Low Confidence',
          content: `Confidence (${selectedOption.confidence}%) below minimum threshold (${preferences.min_confidence_threshold}%).

Per Pipnosis Law #6 (Quality Over Quantity), only high-probability setups are executed.`,
          metadata: { confidence: selectedOption.confidence, threshold: preferences.min_confidence_threshold, reason: 'low_confidence' }
        }, sessionId);
        await this.incrementNoOpportunityCount(userId);
        return {
          opportunityFound: false,
          message: `Opportunity confidence (${selectedOption.confidence}%) below threshold (${preferences.min_confidence_threshold}%)`,
          scanDuration: Date.now() - scanStartTime
        };
      }

      console.log('[AutoTradingScanner] Step 9: Approving trade option...');
      await aiTradingEngine.approveTradeOption(selectedOption.id, userId);
      console.log('[AutoTradingScanner] ✓ Trade option approved');

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
      }, sessionId);

      console.log('[AutoTradingScanner] Step 10: Executing trade via simulated trading service...');
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
        console.error(`[AutoTradingScanner] ❌ Trade execution failed: ${tradeResult.message}`);
        await thoughtProcessLogger.logThought({
          userId,
          decisionId: decisionId!,
          stepNumber: ++scanStepNumber,
          stepType: 'error',
          title: 'Trade Execution Failed',
          content: `Failed to execute trade: ${tradeResult.message}`,
          metadata: { error: tradeResult.message }
        }, sessionId);
        throw new Error(tradeResult.message);
      }

      console.log(`[AutoTradingScanner] ✓ Trade executed successfully! Trade ID: ${tradeResult.trade?.id}`);
      console.log(`[AutoTradingScanner] Position: ${selectedOption.direction} ${selectedOption.lotSize} lots ${selectedOption.symbol}`);

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

      console.log('[AutoTradingScanner] Step 11: Recording learning metrics and updating status...');
      await this.recordLearningMetric(userId, decisionId!, selectedOption, tradeResult.trade);
      console.log('[AutoTradingScanner] ✓ Learning metrics recorded');

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

Total auto trades: ${(status.totalTradesExecuted || 0) + 1}
Daily P&L: $${(status.dailyPnl + selectedOption.estimatedProfit).toFixed(2)}

Next scan in approximately 2 minutes.`,
        metadata: {
          tradeId: tradeResult.trade?.id,
          success: true,
          totalTrades: (status.totalTradesExecuted || 0) + 1
        }
      }, sessionId);

      await this.notifyUser(
        userId,
        'Auto Trade Executed',
        `${selectedOption.direction} ${selectedOption.symbol} at ${selectedOption.entryPrice}. Confidence: ${selectedOption.confidence}%`
      );

      const scanDuration = Date.now() - scanStartTime;
      console.log('┌─────────────────────────────────────────────────────────────────────┐');
      console.log('│                    ✅ SCAN CYCLE COMPLETED SUCCESSFULLY               │');
      console.log('└─────────────────────────────────────────────────────────────────────┘');
      console.log(`[AutoTradingScanner] Scan duration: ${scanDuration}ms`);
      console.log(`[AutoTradingScanner] Trade executed: ${selectedOption.direction} ${selectedOption.symbol}`);
      console.log(`[AutoTradingScanner] Total trades today: ${(status.totalTradesExecuted || 0) + 1}`);
      console.log(`[AutoTradingScanner] Next scan in approximately 2 minutes`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

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
        console.log('[AutoTradingScanner] ℹ️  No profitable opportunities found in this scan cycle');
        await this.incrementNoOpportunityCount(userId);
        return {
          opportunityFound: false,
          message: 'No opportunities found',
          scanDuration: Date.now() - scanStartTime
        };
      }

      console.error('┌─────────────────────────────────────────────────────────────────────┐');
      console.error('│                    ❌ AUTO TRADING ERROR OCCURRED                     │');
      console.error('└─────────────────────────────────────────────────────────────────────┘');
      console.error(`[AutoTradingScanner] Error: ${errorMessage}`);

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
        }, sessionId);
      }

      await this.updateAutoTradingStatus(userId, {
        enabled: false,
        scanning_active: false,
        emergency_stop: true,
        should_be_scanning: false,
        next_scan_scheduled_at: null
      });

      // Disable persistence layer
      await autoTradingPersistence.disableScanning(userId);

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
        totalTradesExecuted: data.total_trades_executed || 0,
        currentSessionId: data.current_session_id,
        sessionStartedAt: data.session_started_at ? new Date(data.session_started_at) : undefined,
        sessionEndedAt: data.session_ended_at ? new Date(data.session_ended_at) : undefined
      };
    } catch (error) {
      console.error('Error getting auto trading status:', error);
      return null;
    }
  }

  private async initializeAutoTradingStatus(userId: string) {
    console.log('[AutoTradingScanner.initializeAutoTradingStatus] Initializing status for user:', userId);

    const { data, error } = await supabase
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
        continuous_mode: false,
        learning_mode: true,
        total_trades_executed: 0,
        is_active: false,
        monitored_symbols: [],
        trades_today: 0,
        trades_remaining: 0,
        should_be_scanning: false,
        scan_interval_seconds: 120,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id',
        ignoreDuplicates: false
      })
      .select();

    if (error) {
      console.error('[AutoTradingScanner.initializeAutoTradingStatus] Failed to initialize:', error);
      throw new Error(`Failed to initialize auto trading status: ${error.message}`);
    }

    console.log('[AutoTradingScanner.initializeAutoTradingStatus] ✓ Status initialized successfully');
    return data;
  }

  private async updateAutoTradingStatus(userId: string, updates: any) {
    console.log('[AutoTradingScanner.updateAutoTradingStatus] Updating status for user:', userId);
    console.log('[AutoTradingScanner.updateAutoTradingStatus] Updates:', JSON.stringify(updates, null, 2));

    const { data, error } = await supabase
      .from('auto_trading_status')
      .upsert({
        user_id: userId,
        ...updates,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id',
        ignoreDuplicates: false
      })
      .select();

    if (error) {
      console.error('[AutoTradingScanner.updateAutoTradingStatus] Database error:', error);
      console.error('[AutoTradingScanner.updateAutoTradingStatus] Error details:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });
      throw new Error(`Failed to update auto trading status: ${error.message}`);
    }

    console.log('[AutoTradingScanner.updateAutoTradingStatus] ✓ Status updated successfully');
    return data;
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

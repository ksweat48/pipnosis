import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { backtestingEngine, BacktestConfig, BacktestResult } from '../services/backtesting-engine';
import { syntheticBacktestingEngine, SyntheticBacktestConfig, SyntheticBacktestResult } from '../services/synthetic-backtesting-engine';
import { aiCapabilityScorer, CapabilityScoreBreakdown } from '../services/ai-capability-scorer';
import { backtestDiagnostics } from '../services/backtest-diagnostics';
import { aiLearningEngine } from '../services/ai-learning-engine';
import { aiSkillTracker } from '../services/ai-skill-tracker';
import SyntheticEquityCurve from '../components/SyntheticEquityCurve';
import SyntheticCandlestickChart from '../components/SyntheticCandlestickChart';
import SyntheticBacktestResults from '../components/SyntheticBacktestResults';
import AILearningProgressDashboard from '../components/AILearningProgressDashboard';
import PlateauBreakthroughDashboard from '../components/PlateauBreakthroughDashboard';
import { NavigationMenu } from '../components/NavigationMenu';
import { simpleAutoBacktestService, SimpleAutoBacktestState } from '../services/simple-auto-backtest-service';
import { Play, TrendingUp, AlertCircle, Calendar, Settings, BarChart3, Target, CheckCircle, XCircle, Clock, Sparkles, RefreshCw, Brain, Zap, Square, Activity } from 'lucide-react';

export default function AITrainingPage() {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestAborted, setBacktestAborted] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [useSyntheticData, setUseSyntheticData] = useState(true);
  const [marketScenario, setMarketScenario] = useState('mixed');
  const [syntheticCandles, setSyntheticCandles] = useState<any[]>([]);
  const [generationProgress, setGenerationProgress] = useState<any>(null);

  // Backtest Configuration
  const [sessionName, setSessionName] = useState('');
  const [selectedSymbols, setSelectedSymbols] = useState(['EURUSD']);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [riskMode, setRiskMode] = useState<'low' | 'medium' | 'high'>('medium');
  const [useGPT4, setUseGPT4] = useState(false);
  const [confidenceThreshold, setConfidenceThreshold] = useState(75);

  // Results
  const [backtestResult, setBacktestResult] = useState<BacktestResult | SyntheticBacktestResult | null>(null);
  const [capabilityScore, setCapabilityScore] = useState<CapabilityScoreBreakdown | null>(null);
  const [pastSessions, setPastSessions] = useState<any[]>([]);
  const [selectedSession, setSelectedSession] = useState<any | null>(null);

  // Tab system - default to 'progress' tab
  const [activeTab, setActiveTab] = useState<'progress' | 'backtest'>('progress');

  // Auto-backtest mode - default to Auto
  const [isAutoMode, setIsAutoMode] = useState(true);
  const [autoBacktestState, setAutoBacktestState] = useState<SimpleAutoBacktestState | null>(null);

  const availableSymbols = ['EURUSD', 'XAUUSD', 'GBPUSD', 'USDJPY', 'US30'];

  useEffect(() => {
    checkAdminStatus();
    loadPastSessions();
    setDefaultDateRange();

    // Initialize auto-backtest service with database state
    if (user) {
      simpleAutoBacktestService.initialize(user.id).then(() => {
        // Load initial state from database
        simpleAutoBacktestService.getState().then(state => {
          setAutoBacktestState(state);
          // If auto-backtest is running, switch to auto mode
          if (state.isRunning) {
            setIsAutoMode(true);
          }
        });
      });
    }

    // Poll auto-backtest state from database (always poll to show cross-device state)
    let stateInterval: NodeJS.Timeout | null = null;
    if (user) {
      stateInterval = setInterval(async () => {
        const state = await simpleAutoBacktestService.getState();
        setAutoBacktestState(state);
        // Auto-switch to auto mode if it's running
        if (state.isRunning) {
          setIsAutoMode(true);
        }

        // Check if a backtest just completed and reload sessions
        if (!state.isRunning && state.lastBacktestResult) {
          loadPastSessions();
        }
      }, 3000); // Poll every 3 seconds
    }

    // Set up realtime subscriptions for backtest sessions
    let realtimeChannel: any = null;
    if (user) {
      realtimeChannel = supabase
        .channel(`backtest-sessions-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'backtest_sessions',
            filter: `user_id=eq.${user.id}`
          },
          () => {
            console.log('[AI Training] New backtest session detected, reloading...');
            loadPastSessions();
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'synthetic_backtest_sessions',
            filter: `user_id=eq.${user.id}`
          },
          () => {
            console.log('[AI Training] New synthetic backtest session detected, reloading...');
            loadPastSessions();
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'backtest_sessions',
            filter: `user_id=eq.${user.id}`
          },
          (payload) => {
            console.log('[AI Training] Backtest session updated:', payload);
            // If we're viewing this session, update it
            if (selectedSession && payload.new.id === selectedSession.id) {
              handleLoadSession({ ...payload.new, sessionType: 'real' });
            } else {
              loadPastSessions();
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'synthetic_backtest_sessions',
            filter: `user_id=eq.${user.id}`
          },
          (payload) => {
            console.log('[AI Training] Synthetic backtest session updated:', payload);
            // If we're viewing this session, update it
            if (selectedSession && payload.new.id === selectedSession.id) {
              handleLoadSession({ ...payload.new, sessionType: 'synthetic' });
            } else {
              loadPastSessions();
            }
          }
        )
        .subscribe();
    }

    return () => {
      if (stateInterval) clearInterval(stateInterval);
      if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
      }
    };
  }, [user]);

  useEffect(() => {
    // Update date range when switching between synthetic and real data
    setDefaultDateRange();
  }, [useSyntheticData]);

  const setDefaultDateRange = () => {
    const startDateDefault = new Date();
    // For synthetic data, use 1 month by default to reduce generation time
    startDateDefault.setMonth(startDateDefault.getMonth() - (useSyntheticData ? 1 : 3));
    const endDateDefault = new Date();

    setStartDate(startDateDefault.toISOString().split('T')[0]);
    setEndDate(endDateDefault.toISOString().split('T')[0]);
  };

  const checkAdminStatus = async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single();

      if (error) {
        console.error('[AI Training] Error fetching user profile:', error);

        // If profile doesn't exist, try to create it
        if (error.code === 'PGRST116') {
          console.log('[AI Training] User profile not found, creating one...');
          const { error: insertError } = await supabase
            .from('user_profiles')
            .insert({
              id: user.id,
              email: user.email || '',
              is_admin: true, // Grant admin by default for development
              plan_type: 'beta',
              account_balance: 10000
            });

          if (!insertError) {
            console.log('[AI Training] Profile created successfully');
            setIsAdmin(true);
          } else {
            console.error('[AI Training] Failed to create profile:', insertError);
            setIsAdmin(false);
          }
        } else {
          setIsAdmin(false);
        }
      } else {
        setIsAdmin(data?.is_admin || false);
      }
    } catch (error) {
      console.error('[AI Training] Unexpected error checking admin status:', error);
      setIsAdmin(false);
    } finally {
      setLoading(false);
    }
  };

  const loadPastSessions = async () => {
    if (!user) return;

    // Load both real and synthetic backtest sessions
    const { data: realSessions } = await supabase
      .from('backtest_sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10);

    const { data: syntheticSessions } = await supabase
      .from('synthetic_backtest_sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10);

    // Tag sessions with their type for easy identification
    const taggedReal = (realSessions || []).map(s => ({ ...s, sessionType: 'real' }));
    const taggedSynthetic = (syntheticSessions || []).map(s => ({ ...s, sessionType: 'synthetic' }));

    // Combine and sort by created_at
    const combined = [...taggedReal, ...taggedSynthetic].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    // Take top 10 most recent
    setPastSessions(combined.slice(0, 10));
  };

  const handleRunBacktest = async () => {
    if (!user || !sessionName || !startDate || !endDate) {
      alert('Please fill in all required fields');
      return;
    }

    setBacktestLoading(true);
    setBacktestResult(null);
    setCapabilityScore(null);
    setBacktestAborted(false);
    setBacktestError(null);
    setSyntheticCandles([]);
    setGenerationProgress(null);

    const timeoutDuration = useSyntheticData ? 10 * 60 * 1000 : 5 * 60 * 1000;
    const timeoutId = setTimeout(() => {
      if (backtestLoading) {
        console.error(`[AI Training] Backtest timeout - exceeded ${timeoutDuration / 60000} minutes`);
        setBacktestError(`Backtest timed out after ${timeoutDuration / 60000} minutes. Try reducing the date range or check console for errors.`);
        setBacktestLoading(false);
        setGenerationProgress(null);
      }
    }, timeoutDuration);

    try {
      if (useSyntheticData) {
        console.log('[AI Training] Running SYNTHETIC backtest with scenario:', marketScenario);

        const config: SyntheticBacktestConfig = {
          sessionName: `${sessionName} (SYNTHETIC)`,
          description: `Synthetic ${marketScenario} scenario - Risk: ${riskMode}, Threshold: ${confidenceThreshold}%`,
          symbols: selectedSymbols,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          timeframes: ['H1', 'M5', 'M1'],
          useGPT4Reasoning: false,
          confidenceThreshold,
          riskMode,
          maxConcurrentTrades: 2,
          initialBalance: 10000,
          positionSizePercent: 2,
          commissionPerTrade: 0,
          slippagePips: 1,
          marketScenario
        };

        const result = await syntheticBacktestingEngine.runSyntheticBacktest(user.id, config, (progress) => {
          setGenerationProgress(progress);
          console.log('[AI Training] Progress:', progress.message, `${progress.percentComplete.toFixed(1)}%`);
        });
        setBacktestResult(result);

        // Trigger AI learning from synthetic backtest
        console.log('[AI Training] Triggering AI learning from synthetic backtest...');
        if (result.trades && result.trades.length > 0) {
          await aiLearningEngine.analyzeBacktestSession(
            user.id,
            result.sessionId,
            result.trades.map((t: any) => ({
              id: t.id,
              symbol: t.symbol,
              direction: t.direction,
              outcome: t.outcome,
              pnl: t.pnl,
              entryTime: new Date(t.entryTime),
              exitTime: new Date(t.exitTime),
              entryPrice: t.entryPrice,
              exitPrice: t.exitPrice,
              stopLoss: t.stopLoss,
              takeProfit: t.takeProfit,
              confidence: t.confidence || 75,
              setupType: t.setupType || 'flow_v2'
            })),
            'synthetic'
          );
          console.log('[AI Training] AI learning complete for synthetic backtest');
        }

        const { data: candles } = await supabase
          .from('synthetic_candles')
          .select('*')
          .eq('synthetic_session_id', result.syntheticGenerationId)
          .eq('symbol', selectedSymbols[0])
          .eq('timeframe', 'H1')
          .order('open_time', { ascending: true })
          .limit(200);

        setSyntheticCandles(candles || []);

        console.log('[AI Training] Synthetic backtest complete!');

        // Reload past sessions to show the new synthetic backtest
        await loadPastSessions();
      } else {
        console.log('[AI Training] Running pre-flight diagnostics...');
        const diagnostics = await backtestDiagnostics.runFullDiagnostics(
        selectedSymbols,
        new Date(startDate),
        new Date(endDate)
      );

      if (diagnostics.criticalIssues.length > 0) {
        const errorMsg = 'Cannot run backtest due to critical issues:\n\n' +
          diagnostics.criticalIssues.join('\n') +
          '\n\nCheck the browser console for detailed diagnostics.';
        alert(errorMsg);
        setBacktestLoading(false);
        return;
      }

      if (diagnostics.warnings.length > 0) {
        const warningMsg = 'Warnings detected:\n\n' +
          diagnostics.warnings.join('\n') +
          '\n\nDo you want to continue?';
        if (!confirm(warningMsg)) {
          setBacktestLoading(false);
          return;
        }
      }
      const config: BacktestConfig = {
        sessionName,
        description: `Risk: ${riskMode}, Threshold: ${confidenceThreshold}%, GPT-4: ${useGPT4 ? 'Yes' : 'No'}`,
        symbols: selectedSymbols,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        timeframes: ['1h', '5m', '1m'],
        useGPT4Reasoning: useGPT4,
        confidenceThreshold,
        riskMode,
        maxConcurrentTrades: 2,
        initialBalance: 10000,
        positionSizePercent: 2,
        commissionPerTrade: 0,
        slippagePips: 1
      };

      console.log('[AI Training] Starting backtest...');
      const result = await backtestingEngine.runBacktest(user.id, config);

      console.log('[AI Training] Calculating capability score...');
      const score = await aiCapabilityScorer.calculateCapabilityScore(result.sessionId, user.id);

      setBacktestResult(result);
      setCapabilityScore(score);

      // Trigger AI learning from real backtest
      console.log('[AI Training] Triggering AI learning from real backtest...');
      if (result.trades && result.trades.length > 0) {
        await aiLearningEngine.analyzeBacktestSession(
          user.id,
          result.sessionId,
          result.trades.map((t: any) => ({
            id: t.id,
            symbol: t.symbol,
            direction: t.direction,
            outcome: t.outcome,
            pnl: t.pnl,
            entryTime: new Date(t.entryTime),
            exitTime: new Date(t.exitTime),
            entryPrice: t.entryPrice,
            exitPrice: t.exitPrice,
            stopLoss: t.stopLoss,
            takeProfit: t.takeProfit,
            confidence: t.confidence || 75,
            setupType: t.setupType || 'flow_v2'
          })),
          'real'
        );
        console.log('[AI Training] AI learning complete for real backtest');
      }

        await loadPastSessions();

        console.log('[AI Training] Backtest complete!');
        clearTimeout(timeoutId);
      }
    } catch (error: any) {
      console.error('[AI Training] Error:', error);
      clearTimeout(timeoutId);

      const errorMessage = error?.message || 'Unknown error occurred';
      setBacktestError(errorMessage);

      if (errorMessage.includes('Data validation failed')) {
        alert('Backtest failed: Insufficient historical data for the selected date range.\n\n' + errorMessage);
      } else {
        alert('Backtest failed. Check console for details.\n\nError: ' + errorMessage);
      }
    } finally {
      setBacktestLoading(false);
      clearTimeout(timeoutId);
    }
  };

  const handleCancelBacktest = () => {
    console.log('[AI Training] Backtest cancelled by user');
    setBacktestAborted(true);
    setBacktestLoading(false);
    setBacktestError('Backtest cancelled by user');
    setGenerationProgress(null);
  };

  const handleLoadSession = async (session: any) => {
    setSelectedSession(session);

    const isSynthetic = session.sessionType === 'synthetic';
    const tradesTable = isSynthetic ? 'synthetic_backtest_trades' : 'backtest_trades';

    // Load trades from appropriate table
    const { data: trades } = await supabase
      .from(tradesTable)
      .select('*')
      .eq('session_id', session.id)
      .order('entry_time', { ascending: true });

    // Only load capability scores for real backtests
    let scores = null;
    if (!isSynthetic) {
      const { data: scoresData } = await supabase
        .from('ai_capability_scores')
        .select('*')
        .gte('period_start', session.start_date)
        .lte('period_end', session.end_date)
        .single();
      scores = scoresData;
    }

    // Build backtest result with synthetic flag if applicable
    const result: any = {
      sessionId: session.id,
      totalTrades: session.total_trades,
      winningTrades: session.winning_trades,
      losingTrades: session.losing_trades,
      breakevenTrades: session.breakeven_trades,
      totalPnL: session.total_pnl,
      finalBalance: session.final_balance,
      winRate: session.win_rate,
      avgWin: session.avg_win,
      avgLoss: session.avg_loss,
      profitFactor: session.profit_factor,
      sharpeRatio: session.sharpe_ratio,
      maxDrawdown: session.max_drawdown,
      maxDrawdownPercent: session.max_drawdown_percent,
      trades: trades || [],
      missedOpportunities: [],
      signalsGenerated: session.signals_generated,
      signalsExecuted: session.signals_executed,
      signalsSkipped: session.signals_skipped
    };

    // Add synthetic flag and generation ID if applicable
    if (isSynthetic) {
      result.isSynthetic = true;
      result.syntheticGenerationId = session.synthetic_generation_id;

      // Load synthetic candles for chart if available
      if (session.synthetic_generation_id) {
        const { data: candles } = await supabase
          .from('synthetic_candles')
          .select('*')
          .eq('synthetic_session_id', session.synthetic_generation_id)
          .eq('symbol', session.symbols[0])
          .eq('timeframe', 'H1')
          .order('open_time', { ascending: true })
          .limit(200);

        setSyntheticCandles(candles || []);
      }
    }

    setBacktestResult(result);

    // Set capability scores only for real backtests
    if (scores) {
      setCapabilityScore({
        overallCapability: scores.overall_capability_percent,
        capabilityGrade: scores.capability_grade,
        signalQualityScore: scores.signal_quality_score,
        executionTimingScore: scores.execution_timing_score,
        riskManagementScore: scores.risk_management_score,
        winRateScore: scores.win_rate_score,
        profitConsistencyScore: scores.profit_consistency_score,
        symbolBreakdown: {
          EURUSD: scores.eurusd_capability,
          XAUUSD: scores.xauusd_capability,
          US30: scores.us30_capability,
          GBPUSD: scores.gbpusd_capability,
          USDJPY: scores.usdjpy_capability
        },
        marketConditionBreakdown: {
          trending: scores.trending_market_capability,
          ranging: scores.ranging_market_capability,
          highVolatility: scores.high_volatility_capability,
          lowVolatility: scores.low_volatility_capability
        },
        aiMetrics: {
          gpt4DecisionAccuracy: scores.gpt4_decision_accuracy,
          thresholdOptimizationScore: scores.threshold_optimization_score,
          falseNegativeRate: scores.false_negative_rate,
          falsePositiveRate: scores.false_positive_rate
        },
        gapToTarget: scores.gap_to_target,
        recommendations: {
          primaryWeakness: scores.primary_weakness,
          suggestedAdjustments: scores.recommended_adjustments,
          estimatedCapabilityAfterAdjustments: scores.estimated_capability_after_adjustments
        }
      });
    } else {
      // Clear capability scores for synthetic backtests
      setCapabilityScore(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950">
        <NavigationMenu />
        <div className="flex items-center justify-center min-h-[80vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-4"></div>
            <p className="text-white/70">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950">
        <NavigationMenu />
        <div className="flex items-center justify-center min-h-[80vh]">
          <div className="text-center p-8 bg-gray-800/50 backdrop-blur-sm rounded-lg shadow-md border border-gray-700 max-w-md">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-white mb-2">Access Denied</h2>
            <p className="text-gray-400 mb-4">This page is only accessible to administrators.</p>
            <div className="text-left bg-gray-900/50 p-4 rounded-lg border border-gray-600 text-sm text-gray-300">
              <p className="mb-2"><strong className="text-white">To gain access:</strong></p>
              <ol className="list-decimal list-inside space-y-1 ml-2">
                <li>Contact the system administrator</li>
                <li>Or apply the SQL migration to grant admin access</li>
              </ol>
              <p className="mt-3 text-xs text-gray-500">
                Check the browser console for more details
              </p>
            </div>
            <button
              onClick={() => {
                setLoading(true);
                checkAdminStatus();
              }}
              className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              <RefreshCw className="w-4 h-4 inline mr-2" />
              Retry Access Check
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950">
      <NavigationMenu />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">AI Training & Backtesting Lab</h1>
          <p className="text-gray-400">Test and optimize AI trading performance with historical data</p>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('progress')}
            className={`flex items-center gap-2 px-6 py-3 rounded-lg font-semibold transition-all ${
              activeTab === 'progress'
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50'
            }`}
          >
            <Brain className="w-5 h-5" />
            AI Learning Progress
          </button>
          <button
            onClick={() => setActiveTab('backtest')}
            className={`flex items-center gap-2 px-6 py-3 rounded-lg font-semibold transition-all ${
              activeTab === 'backtest'
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50'
            }`}
          >
            <Play className="w-5 h-5" />
            Run Backtest
          </button>
        </div>

        {/* AI Learning Progress Tab */}
        {activeTab === 'progress' && (
          <div className="space-y-6">
            {user && <PlateauBreakthroughDashboard userId={user.id} />}
            <AILearningProgressDashboard />
          </div>
        )}

        {/* Backtest Configuration Tab */}
        {activeTab === 'backtest' && (
          <>
        {/* Manual/Auto Mode Toggle */}
        <div className="bg-gradient-to-r from-blue-900/30 to-purple-900/30 backdrop-blur-sm border-2 border-blue-500/30 rounded-lg shadow-md p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white mb-2 flex items-center gap-2">
                {isAutoMode ? (
                  <><Zap className="w-6 h-6 text-yellow-400" /> Auto-Backtest Mode</>
                ) : (
                  <><Play className="w-6 h-6 text-emerald-400" /> Manual Backtest Mode</>
                )}
              </h2>
              <p className="text-sm text-gray-300">
                {isAutoMode
                  ? 'Continuous automated backtesting with AI learning'
                  : 'Run individual backtests with custom parameters'
                }
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-sm font-semibold ${isAutoMode ? 'text-gray-400' : 'text-white'}`}>
                Manual
              </span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={isAutoMode}
                  onChange={(e) => {
                    const newMode = e.target.checked;
                    setIsAutoMode(newMode);
                    // Stop auto-backtest when switching to manual
                    if (!newMode && autoBacktestState?.isRunning) {
                      simpleAutoBacktestService.stop();
                    }
                  }}
                  className="sr-only peer"
                />
                <div className="w-14 h-7 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
              <span className={`text-sm font-semibold ${isAutoMode ? 'text-white' : 'text-gray-400'}`}>
                Auto
              </span>
            </div>
          </div>
        </div>

        {/* Auto-Backtest Controls */}
        {isAutoMode && (
          <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-6 mb-6">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Auto-Backtest Status
            </h3>

            {autoBacktestState?.isRunning ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-green-900/20 border border-green-500/30 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Activity className="w-6 h-6 text-green-400 animate-pulse" />
                    <div>
                      <p className="text-lg font-bold text-green-400">Running</p>
                      <p className="text-sm text-gray-300">
                        Backtest #{autoBacktestState.currentBacktestNumber} in progress
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => simpleAutoBacktestService.stop()}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-colors"
                  >
                    <Square className="w-4 h-4" />
                    Stop
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 bg-gray-700/50 rounded-lg">
                    <p className="text-sm text-gray-400 mb-1">Total Completed</p>
                    <p className="text-3xl font-bold text-white">{autoBacktestState.totalBacktestsCompleted}</p>
                  </div>
                  <div className="p-4 bg-gray-700/50 rounded-lg">
                    <p className="text-sm text-gray-400 mb-1">Current Backtest</p>
                    <p className="text-3xl font-bold text-white">#{autoBacktestState.currentBacktestNumber}</p>
                  </div>
                  {autoBacktestState.lastBacktestResult && (
                    <div className="p-4 bg-gray-700/50 rounded-lg">
                      <p className="text-sm text-gray-400 mb-1">Last Win Rate</p>
                      <p className={`text-3xl font-bold ${
                        autoBacktestState.lastBacktestResult.winRate >= 50 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {autoBacktestState.lastBacktestResult.winRate.toFixed(1)}%
                      </p>
                    </div>
                  )}
                </div>

                {autoBacktestState.lastBacktestResult && (
                  <div className="p-3 bg-blue-900/20 border-l-4 border-blue-400 rounded">
                    <p className="text-sm text-blue-200">
                      <strong>Last Completed:</strong> {autoBacktestState.lastBacktestResult.sessionName} •{' '}
                      {autoBacktestState.lastBacktestResult.totalTrades} trades •{' '}
                      ${autoBacktestState.lastBacktestResult.pnl.toFixed(2)} P&L
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-4 bg-gray-700/50 rounded-lg text-center">
                  <p className="text-gray-400 mb-4">Auto-backtest is not running</p>
                  <button
                    onClick={async () => {
                      if (user) {
                        const result = await simpleAutoBacktestService.start(user.id);
                        if (!result.success) {
                          alert(result.message);
                        }
                      }
                    }}
                    className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-colors mx-auto"
                  >
                    <Play className="w-5 h-5" />
                    Start Auto-Backtest
                  </button>
                </div>

                {autoBacktestState && autoBacktestState.totalBacktestsCompleted > 0 && (
                  <div className="p-3 bg-gray-700/30 border border-gray-600 rounded">
                    <p className="text-sm text-gray-300">
                      <strong>Total backtests completed:</strong> {autoBacktestState.totalBacktestsCompleted}
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 space-y-3">
              <div className="p-3 bg-yellow-900/20 border-l-4 border-yellow-400 rounded">
                <p className="text-sm text-yellow-200">
                  <strong>Auto Mode:</strong> System automatically runs backtests with randomized parameters (1-3 days, mixed conditions, all pairs).
                  Each backtest includes AI learning and skill progression updates.
                </p>
              </div>

              {/* Cross-device status indicator */}
              {autoBacktestState && autoBacktestState.startedFromDevice && (
                <div className="p-3 bg-blue-900/20 border-l-4 border-blue-400 rounded">
                  <p className="text-sm text-blue-200">
                    <strong>Started from:</strong> {autoBacktestState.startedFromDevice}
                    {autoBacktestState.sessionId && (
                      <span className="ml-2 text-xs opacity-70">• Session: {autoBacktestState.sessionId.slice(-8)}</span>
                    )}
                  </p>
                </div>
              )}

              {/* Usage warning indicator */}
              {autoBacktestState && autoBacktestState.usageWarningLevel && autoBacktestState.usageWarningLevel !== 'normal' && (
                <div className={`p-3 border-l-4 rounded ${
                  autoBacktestState.usageWarningLevel === 'critical'
                    ? 'bg-red-900/20 border-red-400'
                    : 'bg-orange-900/20 border-orange-400'
                }`}>
                  <p className={`text-sm ${
                    autoBacktestState.usageWarningLevel === 'critical'
                      ? 'text-red-200'
                      : 'text-orange-200'
                  }`}>
                    <strong>⚠️ {autoBacktestState.usageWarningLevel.toUpperCase()}:</strong> {autoBacktestState.usageWarningMessage}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Manual Configuration Panel */}
        {!isAutoMode && (
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Backtest Configuration
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Session Name */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Session Name
              </label>
              <input
                type="text"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-md focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                placeholder="e.g., Nov 2025 Test Run"
              />
            </div>

            {/* Start Date */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-md focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
            </div>

            {/* End Date */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-md focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
            </div>

            {/* Risk Mode */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Risk Mode
              </label>
              <select
                value={riskMode}
                onChange={(e) => setRiskMode(e.target.value as any)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-md focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              >
                <option value="low">Low (85% confidence)</option>
                <option value="medium">Medium (75% confidence)</option>
                <option value="high">High (70% confidence)</option>
              </select>
            </div>

            {/* Confidence Threshold */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Confidence Threshold: {confidenceThreshold}%
              </label>
              <input
                type="range"
                min="60"
                max="90"
                value={confidenceThreshold}
                onChange={(e) => setConfidenceThreshold(parseInt(e.target.value))}
                className="w-full"
              />
            </div>

            {/* Use GPT-4 */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                AI Reasoning
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useGPT4}
                  onChange={(e) => setUseGPT4(e.target.checked)}
                  className="w-5 h-5 text-emerald-600"
                  disabled={useSyntheticData}
                />
                <span className="text-sm text-gray-300">Use GPT-4 Reasoning</span>
              </label>
            </div>
          </div>

          {/* SYNTHETIC DATA CONTROLS */}
          <div className="mt-6 p-4 bg-gradient-to-r from-purple-50 to-orange-50 border-2 border-purple-200 rounded-lg">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-600" />
                <h3 className="font-semibold text-gray-900">Synthetic Data Training Mode</h3>
                <span className="px-2 py-1 bg-purple-600 text-white text-xs font-bold rounded-full">
                  BETA
                </span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useSyntheticData}
                  onChange={(e) => setUseSyntheticData(e.target.checked)}
                  className="w-5 h-5 text-purple-600"
                />
                <span className="text-sm font-semibold text-gray-900">Enable Synthetic Data</span>
              </label>
            </div>

            {useSyntheticData && (
              <div className="space-y-4">
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-xs text-yellow-800 mb-2">
                    <strong>Training Mode:</strong> Using AI-generated synthetic market data for testing.
                    This allows training without needing real historical data. Results are for testing only.
                  </p>
                  <p className="text-xs text-yellow-800">
                    <strong>💡 Tip:</strong> For faster generation, use 1-4 weeks of data. Longer periods (3+ months)
                    can take 2-5 minutes to generate synthetic candles.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Market Scenario
                  </label>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    {[
                      { value: 'trending_up', label: 'Trending Up', icon: '📈' },
                      { value: 'trending_down', label: 'Trending Down', icon: '📉' },
                      { value: 'ranging', label: 'Ranging', icon: '↔️' },
                      { value: 'high_volatility', label: 'High Volatility', icon: '⚡' },
                      { value: 'mixed', label: 'Mixed Conditions', icon: '🎲' }
                    ].map(scenario => (
                      <button
                        key={scenario.value}
                        onClick={() => setMarketScenario(scenario.value)}
                        className={`p-3 rounded-lg border-2 transition-all ${
                          marketScenario === scenario.value
                            ? 'border-purple-500 bg-purple-100 text-purple-900'
                            : 'border-gray-300 bg-white text-gray-700 hover:border-purple-300'
                        }`}
                      >
                        <div className="text-2xl mb-1">{scenario.icon}</div>
                        <div className="text-xs font-semibold">{scenario.label}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Symbol Selection */}
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Trading Pairs
            </label>
            <div className="flex flex-wrap gap-2">
              {availableSymbols.map(symbol => (
                <label key={symbol} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedSymbols.includes(symbol)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedSymbols([...selectedSymbols, symbol]);
                      } else {
                        setSelectedSymbols(selectedSymbols.filter(s => s !== symbol));
                      }
                    }}
                    className="w-4 h-4 text-emerald-600"
                  />
                  <span className="text-sm font-medium text-gray-300">{symbol}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Run/Cancel Buttons */}
          <div className="mt-6 flex items-center gap-4">
            <button
              onClick={handleRunBacktest}
              disabled={backtestLoading || !sessionName || !startDate || !endDate || selectedSymbols.length === 0}
              className="px-6 py-3 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 disabled:bg-gray-600 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {backtestLoading ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  Running Backtest...
                </>
              ) : (
                <>
                  <Play className="w-5 h-5" />
                  Run Backtest
                </>
              )}
            </button>

            {backtestLoading && (
              <button
                onClick={handleCancelBacktest}
                className="px-6 py-3 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 flex items-center justify-center gap-2"
              >
                <XCircle className="w-5 h-5" />
                Cancel
              </button>
            )}
          </div>

          {/* Progress Display */}
          {backtestLoading && generationProgress && (
            <div className="mt-4 p-4 bg-emerald-900/20 border-l-4 border-emerald-400 rounded">
              <div className="flex items-center gap-2 mb-3">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-emerald-400"></div>
                <p className="text-sm text-emerald-300 font-semibold">{generationProgress.message}</p>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-3 mb-2">
                <div
                  className="bg-emerald-500 h-3 rounded-full transition-all duration-300"
                  style={{ width: `${generationProgress.percentComplete}%` }}
                ></div>
              </div>
              <div className="flex justify-between text-xs text-gray-400">
                <span>{generationProgress.phase} - {generationProgress.timeframe || ''}</span>
                <span>{generationProgress.percentComplete.toFixed(1)}%</span>
              </div>
              {generationProgress.candlesGenerated > 0 && (
                <div className="mt-2 text-xs text-gray-400">
                  Generated: {generationProgress.candlesGenerated.toLocaleString()} / {generationProgress.totalEstimated.toLocaleString()} candles
                </div>
              )}
            </div>
          )}

          {/* Error Display */}
          {backtestError && (
            <div className="mt-4 p-4 bg-red-900/20 border-l-4 border-red-400 rounded">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-400" />
                <p className="text-sm text-red-300 font-semibold">Backtest Error</p>
              </div>
              <p className="mt-2 text-sm text-red-400">{backtestError}</p>
            </div>
          )}
        </div>
        )}

        {/* Diagnostic Alert - Show when no trades */}
        {backtestResult && backtestResult.totalTrades === 0 && !backtestError && (
          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-6 rounded-lg shadow-md">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-6 h-6 text-yellow-600 flex-shrink-0 mt-1" />
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-yellow-900 mb-2">No Trades Executed - Diagnostic Information</h3>
                <p className="text-yellow-800 mb-4">
                  The backtest completed but no trades were taken. This typically means signals were either not generated or were filtered out. Check the browser console for detailed logs about:
                </p>
                <ul className="list-disc list-inside space-y-2 text-yellow-800 mb-4">
                  <li><strong>Data Availability:</strong> Verify historical candle data exists for your date range</li>
                  <li><strong>Phase Failures:</strong> Look for which Flow V2 phase (H1, M5, M1) rejected signals</li>
                  <li><strong>Signal Quality:</strong> Check if confidence thresholds or risk:reward requirements were too strict</li>
                  <li><strong>Date Range:</strong> Ensure your selected dates are in the past and contain market data</li>
                </ul>
                <div className="bg-white p-4 rounded border border-yellow-200">
                  <h4 className="font-semibold text-gray-900 mb-2">Quick Diagnostic:</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">Signals Generated:</span>
                      <span className="ml-2 font-semibold">{backtestResult.signalsGenerated}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Signals Executed:</span>
                      <span className="ml-2 font-semibold">{backtestResult.signalsExecuted}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Signals Skipped:</span>
                      <span className="ml-2 font-semibold">{backtestResult.signalsSkipped}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Date Range:</span>
                      <span className="ml-2 font-semibold">{startDate} to {endDate}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded">
                  <p className="text-sm text-blue-900">
                    <strong>Tip:</strong> Open your browser's Developer Console (F12) and look for detailed logs from:
                    <code className="mx-1 px-2 py-1 bg-blue-100 rounded text-xs">[Backtesting]</code>
                    <code className="mx-1 px-2 py-1 bg-blue-100 rounded text-xs">[Flow V2]</code>
                    <code className="mx-1 px-2 py-1 bg-blue-100 rounded text-xs">[Reasoning Engine]</code>
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SYNTHETIC BACKTEST RESULTS - Comprehensive Analytics Dashboard */}
        {backtestResult && 'isSynthetic' in backtestResult && backtestResult.isSynthetic && backtestResult.totalTrades > 0 && (
          <div className="space-y-6">
            {/* Synthetic Mode Banner */}
            <div className="bg-gradient-to-r from-purple-100 to-orange-100 border-2 border-purple-300 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <Sparkles className="w-6 h-6 text-purple-600" />
                <div>
                  <h3 className="font-bold text-purple-900">SYNTHETIC TRAINING MODE RESULTS</h3>
                  <p className="text-sm text-purple-800">
                    These results are from AI-generated market data for training purposes only.
                    Not representative of real market performance.
                  </p>
                </div>
              </div>
            </div>

            {/* Comprehensive Analytics Dashboard */}
            {backtestResult.analytics && (
              <SyntheticBacktestResults
                analytics={backtestResult.analytics}
                trades={backtestResult.trades}
                totalPnL={backtestResult.totalPnL}
                finalBalance={backtestResult.finalBalance}
                initialBalance={10000}
              />
            )}

            {/* Charts */}
            <div className="space-y-6">
              <SyntheticEquityCurve
                trades={backtestResult.trades}
                initialBalance={10000}
                finalBalance={backtestResult.finalBalance}
                maxDrawdown={backtestResult.maxDrawdown}
              />

              {syntheticCandles.length > 0 && (
                <SyntheticCandlestickChart
                  candles={syntheticCandles}
                  trades={backtestResult.trades}
                  symbol={selectedSymbols[0]}
                  timeframe="H1"
                />
              )}
            </div>
          </div>
        )}

        {/* REAL DATA BACKTEST RESULTS - Show basic metrics for real data */}
        {backtestResult && backtestResult.totalTrades > 0 && !('isSynthetic' in backtestResult && backtestResult.isSynthetic) && (
          <div className="space-y-6">

            {/* Capability Score Card - Only for real data with capability scores */}
            {capabilityScore && (
              <div className="bg-gradient-to-br from-emerald-900/30 to-blue-900/30 backdrop-blur-sm border-2 border-emerald-500/30 rounded-lg shadow-md p-6">
                <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                  <Target className="w-6 h-6 text-emerald-400" />
                  AI Capability Score
                </h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Overall Score */}
                <div className="text-center">
                  <div className="text-6xl font-bold text-emerald-400 mb-2">
                    {capabilityScore.overallCapability}%
                  </div>
                  <div className="text-sm text-gray-400 uppercase tracking-wide">
                    Overall Capability
                  </div>
                  <div className="mt-2">
                    <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                      capabilityScore.capabilityGrade === 'excellent' ? 'bg-green-100 text-green-800' :
                      capabilityScore.capabilityGrade === 'good' ? 'bg-blue-100 text-blue-800' :
                      capabilityScore.capabilityGrade === 'fair' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {capabilityScore.capabilityGrade.toUpperCase()}
                    </span>
                  </div>
                </div>

                {/* Gap to Target */}
                <div className="text-center">
                  <div className={`text-4xl font-bold mb-2 ${
                    capabilityScore.gapToTarget <= 0 ? 'text-green-600' : 'text-orange-600'
                  }`}>
                    {capabilityScore.gapToTarget > 0 ? '+' : ''}{capabilityScore.gapToTarget.toFixed(1)}%
                  </div>
                  <div className="text-sm text-gray-400 uppercase tracking-wide">
                    Gap to 75% Target
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    {capabilityScore.gapToTarget <= 0 ? 'Target achieved!' : 'Improvement needed'}
                  </p>
                </div>

                {/* Primary Weakness */}
                <div className="text-center">
                  <div className="text-lg font-semibold text-white mb-2">
                    {capabilityScore.recommendations.primaryWeakness}
                  </div>
                  <div className="text-sm text-gray-400 uppercase tracking-wide">
                    Primary Weakness
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    Focus improvement efforts here
                  </p>
                </div>
              </div>

              {/* Component Scores */}
              <div className="mt-6 grid grid-cols-2 md:grid-cols-5 gap-4">
                <ScoreBar label="Signal Quality" score={capabilityScore.signalQualityScore} />
                <ScoreBar label="Execution Timing" score={capabilityScore.executionTimingScore} />
                <ScoreBar label="Risk Management" score={capabilityScore.riskManagementScore} />
                <ScoreBar label="Win Rate" score={capabilityScore.winRateScore} />
                <ScoreBar label="Consistency" score={capabilityScore.profitConsistencyScore} />
              </div>
            </div>
            )}

            {/* Performance Metrics */}
            <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                Performance Metrics
              </h2>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard
                  label="Total Trades"
                  value={backtestResult.totalTrades}
                  icon={<TrendingUp className="w-5 h-5 text-blue-600" />}
                />
                <MetricCard
                  label="Win Rate"
                  value={`${backtestResult.winRate.toFixed(1)}%`}
                  icon={<CheckCircle className="w-5 h-5 text-green-600" />}
                  valueColor={backtestResult.winRate >= 55 ? 'text-green-600' : 'text-red-600'}
                />
                <MetricCard
                  label="Total P&L"
                  value={`$${backtestResult.totalPnL.toFixed(2)}`}
                  icon={<TrendingUp className="w-5 h-5 text-blue-600" />}
                  valueColor={backtestResult.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}
                />
                <MetricCard
                  label="Profit Factor"
                  value={backtestResult.profitFactor.toFixed(2)}
                  icon={<BarChart3 className="w-5 h-5 text-purple-600" />}
                  valueColor={backtestResult.profitFactor >= 1.5 ? 'text-green-600' : 'text-red-600'}
                />
                <MetricCard
                  label="Winning Trades"
                  value={backtestResult.winningTrades}
                  icon={<CheckCircle className="w-5 h-5 text-green-600" />}
                />
                <MetricCard
                  label="Losing Trades"
                  value={backtestResult.losingTrades}
                  icon={<XCircle className="w-5 h-5 text-red-600" />}
                />
                <MetricCard
                  label="Max Drawdown"
                  value={`${backtestResult.maxDrawdownPercent.toFixed(2)}%`}
                  icon={<TrendingUp className="w-5 h-5 text-orange-600" />}
                />
                <MetricCard
                  label="Signals Skipped"
                  value={backtestResult.signalsSkipped}
                  icon={<Clock className="w-5 h-5 text-gray-600" />}
                />
              </div>
            </div>

            {/* AI Metrics - Only for real data backtests with capability scores */}
            {capabilityScore && capabilityScore.aiMetrics && (
              <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-6">
                <h2 className="text-xl font-semibold text-white mb-4">AI Decision Metrics</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <MetricCard
                    label="GPT-4 Accuracy"
                    value={`${capabilityScore.aiMetrics.gpt4DecisionAccuracy}%`}
                  />
                  <MetricCard
                    label="Threshold Score"
                    value={`${capabilityScore.aiMetrics.thresholdOptimizationScore}%`}
                  />
                  <MetricCard
                    label="False Negatives"
                    value={`${capabilityScore.aiMetrics.falseNegativeRate.toFixed(1)}%`}
                    valueColor="text-orange-600"
                  />
                  <MetricCard
                    label="False Positives"
                    value={`${capabilityScore.aiMetrics.falsePositiveRate.toFixed(1)}%`}
                    valueColor="text-orange-600"
                  />
                </div>
              </div>
            )}

            {/* Recommendations - Only for real data backtests */}
            {capabilityScore && capabilityScore.recommendations && Object.keys(capabilityScore.recommendations.suggestedAdjustments).length > 0 && (
              <div className="bg-yellow-900/20 backdrop-blur-sm rounded-lg shadow-md p-6 border-2 border-yellow-500/30">
                <h2 className="text-xl font-semibold text-white mb-4">Recommended Adjustments</h2>
                <div className="space-y-3">
                  {Object.entries(capabilityScore.recommendations.suggestedAdjustments).map(([key, adjustment]: [string, any]) => (
                    <div key={key} className="bg-gray-700/50 p-4 rounded-lg">
                      <h3 className="font-semibold text-white mb-2">
                        {key.replace(/([A-Z])/g, ' $1').trim()}
                      </h3>
                      <p className="text-sm text-gray-300 mb-2">{adjustment.reason}</p>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-gray-300">
                          Current: <span className="font-semibold">{adjustment.current}</span>
                        </span>
                        <span className="text-emerald-400">→</span>
                        <span className="text-emerald-400">
                          Suggested: <span className="font-semibold">{adjustment.suggested}</span>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 p-3 bg-emerald-900/20 rounded-lg">
                  <p className="text-sm text-gray-300">
                    Estimated capability after adjustments:{' '}
                    <span className="font-bold text-emerald-400">
                      {capabilityScore.recommendations.estimatedCapabilityAfterAdjustments.toFixed(1)}%
                    </span>
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Past Sessions */}
        <div className="mt-8 bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Past Backtest Sessions
          </h2>

          {pastSessions.length === 0 ? (
            <p className="text-gray-400 text-center py-8">No past sessions yet. Run your first backtest!</p>
          ) : (
            <div className="space-y-2">
              {pastSessions.map(session => {
                const startDate = new Date(session.start_date);
                const endDate = new Date(session.end_date);
                const durationDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
                const isAutoBacktest = session.session_name?.startsWith('Auto-BT-');

                return (
                  <div
                    key={session.id}
                    onClick={() => handleLoadSession(session)}
                    className="p-4 border border-gray-600 rounded-lg hover:bg-gray-700/50 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-white">{session.session_name}</h3>
                          {isAutoBacktest ? (
                            <span className="px-2 py-0.5 bg-green-600 text-white text-xs font-bold rounded-full flex items-center gap-1">
                              <Zap className="w-3 h-3" />
                              AUTO
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 bg-blue-600 text-white text-xs font-bold rounded-full flex items-center gap-1">
                              <Play className="w-3 h-3" />
                              MANUAL
                            </span>
                          )}
                          {session.sessionType === 'synthetic' && (
                            <span className="px-2 py-0.5 bg-purple-600 text-white text-xs font-bold rounded-full">
                              SYNTHETIC
                            </span>
                          )}
                          {session.sessionType === 'real' && (
                            <span className="px-2 py-0.5 bg-blue-600 text-white text-xs font-bold rounded-full">
                              REAL DATA
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-sm text-gray-400">
                          <span>
                            {startDate.toLocaleDateString()} - {endDate.toLocaleDateString()}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {durationDays} {durationDays === 1 ? 'day' : 'days'}
                          </span>
                          {session.risk_mode && (
                            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                              session.risk_mode === 'low' ? 'bg-green-900/30 text-green-400' :
                              session.risk_mode === 'medium' ? 'bg-yellow-900/30 text-yellow-400' :
                              'bg-red-900/30 text-red-400'
                            }`}>
                              {session.risk_mode.toUpperCase()} RISK
                            </span>
                          )}
                          {session.symbols && (
                            <span className="text-xs">
                              {Array.isArray(session.symbols) ? session.symbols.length : 0} pairs
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-lg font-bold ${session.win_rate >= 55 ? 'text-green-400' : 'text-red-400'}`}>
                          {session.win_rate.toFixed(1)}%
                        </div>
                        <div className="text-sm text-gray-400">
                          {session.total_trades} trades
                        </div>
                        {session.total_pnl && (
                          <div className={`text-xs mt-1 ${session.total_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            ${session.total_pnl.toFixed(2)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
          </>
        )}
      </main>
    </div>
  );
}

function MetricCard({ label, value, icon, valueColor = 'text-white' }: any) {
  return (
    <div className="bg-gray-700/50 p-4 rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm text-gray-400">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${valueColor}`}>{value}</div>
    </div>
  );
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const percentage = Math.min(100, Math.max(0, score));
  const color = percentage >= 75 ? 'bg-green-500' : percentage >= 60 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div>
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className="w-full bg-gray-700 rounded-full h-2 mb-1">
        <div className={`${color} h-2 rounded-full transition-all duration-500`} style={{ width: `${percentage}%` }}></div>
      </div>
      <div className="text-xs font-semibold text-gray-300">{score}%</div>
    </div>
  );
}

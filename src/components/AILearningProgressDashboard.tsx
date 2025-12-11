import React, { useState, useEffect, useRef, memo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { aiSkillTracker, SkillProgressionData, MilestoneData, SkillLevel } from '../services/ai-skill-tracker';
import { aiIndicatorTracker, IndicatorExperiment, IndicatorEffectiveness } from '../services/ai-indicator-tracker';
import { liveTradeLearningTrigger } from '../services/live-trade-learning-trigger';
import { supabase } from '../lib/supabase';
import MonthlyPerformanceCalendar from './MonthlyPerformanceCalendar';
import ConfidenceOverviewCard from './ConfidenceOverviewCard';
import Last10TradesConfidenceWidget from './Last10TradesConfidenceWidget';
import {
  Brain,
  TrendingUp,
  Target,
  Award,
  Sparkles,
  Activity,
  BarChart3,
  CheckCircle,
  Clock,
  Zap,
  AlertCircle,
  Eye,
  Lightbulb,
  Trophy,
  PlayCircle,
  BarChart2,
  BookOpen
} from 'lucide-react';

function AILearningProgressDashboard() {
  const { user } = useAuth();
  const [skillData, setSkillData] = useState<SkillProgressionData | null>(null);
  const [milestones, setMilestones] = useState<MilestoneData[]>([]);
  const [adoptedIndicators, setAdoptedIndicators] = useState<IndicatorExperiment[]>([]);
  const [activeExperiments, setActiveExperiments] = useState<IndicatorExperiment[]>([]);
  const [indicatorEffectiveness, setIndicatorEffectiveness] = useState<IndicatorEffectiveness[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSymbol, setSelectedSymbol] = useState('EURUSD');
  const [liveStats, setLiveStats] = useState<any>(null);
  const [backtestStats, setBacktestStats] = useState<any>(null);
  const [autoBacktestState, setAutoBacktestState] = useState<any>(null);

  // Use refs to track values without triggering re-renders
  const userIdRef = useRef(user?.id);
  const selectedSymbolRef = useRef(selectedSymbol);
  const isLoadingRef = useRef(false);
  const isMountedRef = useRef(true);
  const previousDataRef = useRef<string>('');

  // Update refs when values change
  useEffect(() => {
    userIdRef.current = user?.id;
  }, [user?.id]);

  useEffect(() => {
    selectedSymbolRef.current = selectedSymbol;
  }, [selectedSymbol]);

  // Simple polling for auto-refresh every 10 seconds
  useEffect(() => {
    if (!user) return;

    const loadData = async () => {
      if (isLoadingRef.current || !isMountedRef.current || !userIdRef.current) return;

      isLoadingRef.current = true;
      if (previousDataRef.current === '') {
        setLoading(true);
      }

      try {
        const [skill, milestonesData, adopted, experiments, effectiveness, liveStatsData] = await Promise.all([
          aiSkillTracker.getSkillProgression(userIdRef.current),
          aiSkillTracker.getRecentMilestones(userIdRef.current, 5),
          aiIndicatorTracker.getAdoptedIndicators(userIdRef.current),
          aiIndicatorTracker.getActiveExperiments(userIdRef.current),
          aiIndicatorTracker.getIndicatorEffectiveness(userIdRef.current, selectedSymbolRef.current),
          liveTradeLearningTrigger.getLearningStats(userIdRef.current)
        ]);

        // Fetch backtest stats
        const { data: backtestInsights } = await supabase
          .from('ai_learning_insights')
          .select('*')
          .eq('user_id', userIdRef.current)
          .eq('learned_from_live_trading', false);

        const newBacktestStats = {
          total_insights: backtestInsights?.length || 0,
          avg_confidence: backtestInsights && backtestInsights.length > 0
            ? backtestInsights.reduce((sum, i) => sum + parseFloat(i.confidence_score.toString()), 0) / backtestInsights.length
            : 0
        };

        // Backtest system removed - using goal sessions only
        const state = null;

        // Create a snapshot of all data for deep equality check
        const newDataSnapshot = JSON.stringify({
          skill,
          milestonesData,
          liveStatsData,
          newBacktestStats,
          adopted,
          experiments,
          effectiveness,
          state
        });

        // Only update if data actually changed
        if (previousDataRef.current !== newDataSnapshot && isMountedRef.current) {
          console.log('[AI Learning Dashboard] Data changed, updating...');
          setSkillData(skill);
          setMilestones(milestonesData);
          setLiveStats(liveStatsData);
          setBacktestStats(newBacktestStats);
          setAdoptedIndicators(adopted);
          setActiveExperiments(experiments);
          setIndicatorEffectiveness(effectiveness);
          setAutoBacktestState(state);
          previousDataRef.current = newDataSnapshot;
        }
      } catch (error) {
        console.error('[AI Learning Dashboard] Error loading data:', error);
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
        isLoadingRef.current = false;
      }
    };

    // Load immediately
    loadData();

    // Set up polling interval
    const pollInterval = setInterval(loadData, 10000);

    return () => {
      clearInterval(pollInterval);
    };
  }, [user, selectedSymbol]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  if (!skillData || skillData.totalTradesAnalyzed === 0) {
    return (
      <div className="space-y-6">
        <div className="bg-gradient-to-br from-emerald-900/30 to-blue-900/30 backdrop-blur-sm border-2 border-emerald-500/30 rounded-lg shadow-md p-6">
          <div className="flex items-center gap-3 mb-2">
            <Brain className="w-8 h-8 text-emerald-400" />
            <h2 className="text-2xl font-bold text-white">AI Learning Progress</h2>
          </div>
          <p className="text-gray-400">
            Track the AI's evolution from Novice to Exceptional trading mastery
          </p>
        </div>

        <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-12 text-center">
          <Sparkles className="w-20 h-20 text-blue-400 mx-auto mb-6 opacity-50" />
          <h3 className="text-2xl font-bold text-white mb-3">Ready for New GPT-4 AI Engine</h3>
          <p className="text-gray-400 mb-6 max-w-md mx-auto">
            No AI learning data yet. The new GPT-4 system is ready to start learning from backtests and live trades.
            Start running backtests to generate AI insights and skill progression.
          </p>
          <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto mt-8">
            <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
              <Trophy className="w-8 h-8 text-gray-600 mx-auto mb-2" />
              <div className="text-sm text-gray-500 mb-1">Skill Level</div>
              <div className="text-xl font-bold text-gray-600">Novice</div>
            </div>
            <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
              <Target className="w-8 h-8 text-gray-600 mx-auto mb-2" />
              <div className="text-sm text-gray-500 mb-1">Trades Analyzed</div>
              <div className="text-xl font-bold text-gray-600">0</div>
            </div>
            <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
              <Award className="w-8 h-8 text-gray-600 mx-auto mb-2" />
              <div className="text-sm text-gray-500 mb-1">Milestones</div>
              <div className="text-xl font-bold text-gray-600">0</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const skillLevelColor = {
    'Novice': 'from-gray-600 to-gray-800',
    'Intermediate': 'from-blue-600 to-blue-800',
    'Pro': 'from-purple-600 to-purple-800',
    'Expert': 'from-orange-600 to-orange-800',
    'Master': 'from-red-600 to-red-800',
    'Exceptional': 'from-yellow-400 to-yellow-600'
  }[skillData.currentSkillLevel];

  const skillThresholds = aiSkillTracker.getSkillLevelThresholds();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-br from-emerald-900/30 to-blue-900/30 backdrop-blur-sm border-2 border-emerald-500/30 rounded-lg shadow-md p-6">
        <div className="flex items-center gap-3 mb-2">
          <Brain className="w-8 h-8 text-emerald-400" />
          <h2 className="text-2xl font-bold text-white">AI Learning Progress</h2>
        </div>
        <p className="text-gray-400">
          Track the AI's evolution from Novice to Exceptional trading mastery
        </p>
      </div>

      {/* Main Skill Level Display */}
      <div className={`bg-gradient-to-br ${skillLevelColor} rounded-lg shadow-xl p-8 border-2 border-white/20`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Trophy className="w-12 h-12 text-yellow-300" />
              <div>
                <p className="text-white/80 text-sm uppercase tracking-wide">Current Skill Level</p>
                <h1 className="text-5xl font-bold text-white">{skillData.currentSkillLevel}</h1>
              </div>
            </div>
            <p className="text-white/90 mt-3 max-w-md">
              {aiSkillTracker.getSkillLevelDescription(skillData.currentSkillLevel as SkillLevel)}
            </p>
          </div>
          <div className="text-right space-y-3">
            {/* Winning Trades */}
            <div>
              <div className="text-4xl font-bold text-white mb-1">
                {skillData.totalTradesAnalyzed.toLocaleString()}
              </div>
              <p className="text-white/80 text-sm">Winning Trades</p>
              <p className="text-white/50 text-xs mt-1">Win Rate: {skillData.currentWinRate.toFixed(1)}%</p>
            </div>

            {/* Balance & PnL */}
            <div className="pt-3 border-t border-white/10">
              <div className="text-2xl font-bold text-emerald-400 mb-1">
                ${skillData.currentBalance?.toLocaleString() || '10,000'}
              </div>
              <p className="text-white/80 text-sm">Current Balance</p>
              {skillData.balanceGrowthPercent !== undefined && (
                <p className={`text-xs mt-1 font-semibold ${
                  skillData.balanceGrowthPercent >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  {skillData.balanceGrowthPercent >= 0 ? '+' : ''}{skillData.balanceGrowthPercent.toFixed(2)}% Growth
                </p>
              )}
            </div>

            {/* Total PnL */}
            {skillData.totalPnL !== undefined && (
              <div className="pt-3 border-t border-white/10">
                <div className={`text-xl font-bold mb-1 ${
                  skillData.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  {skillData.totalPnL >= 0 ? '+' : ''}${skillData.totalPnL.toFixed(2)}
                </div>
                <p className="text-white/70 text-xs">Total P&L</p>
                {skillData.totalPnLWinningTrades !== undefined && skillData.totalPnLWinningTrades > 0 && (
                  <p className="text-emerald-400/70 text-xs mt-1">
                    ${skillData.totalPnLWinningTrades.toFixed(2)} from wins
                  </p>
                )}
              </div>
            )}

            {/* Average Profit Per Win */}
            {skillData.averagePnLPerWinningTrade !== undefined && skillData.averagePnLPerWinningTrade > 0 && (
              <div className="pt-3 border-t border-white/10">
                <div className="text-lg font-bold text-blue-400 mb-1">
                  ${skillData.averagePnLPerWinningTrade.toFixed(2)}
                </div>
                <p className="text-white/70 text-xs">Avg Profit Per Win</p>
              </div>
            )}
          </div>
        </div>

        {/* Progress Bar to Next Level */}
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white/80 text-sm">Progress to Next Level</span>
            <span className="text-white font-bold">{skillData.progressToNextLevelPercent.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-black/30 rounded-full h-4 overflow-hidden">
            <div
              className="h-4 bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-500 rounded-full"
              style={{ width: `${skillData.progressToNextLevelPercent}%` }}
            ></div>
          </div>
          <div className="flex items-center justify-between mt-2 text-sm">
            <span className="text-white/70">{skillData.tradesNeededForNextLevel} winning trades needed</span>
            <span className="text-white/70">Target: {skillThresholds[skillData.skillLevelNumeric]?.level || 'Max Level'}</span>
          </div>

          {/* Performance Requirements Card */}
          <div className="mt-4 p-4 bg-blue-500/10 rounded border border-blue-500/30">
            <h4 className="text-sm font-semibold text-blue-300 mb-3">Requirements for Next Level (updates daily)</h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
              <div>
                <div className="text-white/60 mb-1">Winning Trades</div>
                <div className="font-bold text-white">
                  {skillData.totalTradesAnalyzed} / {skillThresholds[skillData.skillLevelNumeric]?.minTrades || '?'}
                </div>
                <div className={`text-xs mt-1 ${skillData.totalTradesAnalyzed >= (skillThresholds[skillData.skillLevelNumeric]?.minTrades || 0) ? 'text-green-400' : 'text-yellow-400'}`}>
                  {skillData.totalTradesAnalyzed >= (skillThresholds[skillData.skillLevelNumeric]?.minTrades || 0) ? '✓ Met' : 'In progress'}
                </div>
              </div>
              <div>
                <div className="text-white/60 mb-1 flex items-center gap-1">
                  Win Rate (10-session avg)
                  <span className="text-white/40 text-[10px]" title="Average win rate over your last 10 completed backtest sessions. Updates after each session.">ⓘ</span>
                </div>
                <div className="font-bold text-white">
                  {skillData.last10SessionWRAvg !== undefined ? skillData.last10SessionWRAvg.toFixed(1) : skillData.currentWinRate.toFixed(1)}% / {skillThresholds[skillData.skillLevelNumeric]?.minWinRate || '?'}%
                </div>
                <div className={`text-xs mt-1 ${(skillData.last10SessionWRAvg || skillData.currentWinRate) >= (skillThresholds[skillData.skillLevelNumeric]?.minWinRate || 0) ? 'text-green-400' : 'text-yellow-400'}`}>
                  {(skillData.last10SessionWRAvg || skillData.currentWinRate) >= (skillThresholds[skillData.skillLevelNumeric]?.minWinRate || 0) ? '✓ Met' : `Need +${((skillThresholds[skillData.skillLevelNumeric]?.minWinRate || 0) - (skillData.last10SessionWRAvg || skillData.currentWinRate)).toFixed(1)}%`}
                </div>
              </div>
              <div>
                <div className="text-white/60 mb-1 flex items-center gap-1">
                  Profit Factor (10-session avg)
                  <span className="text-white/40 text-[10px]" title="Average profit factor over your last 10 completed backtest sessions. Updates after each session.">ⓘ</span>
                </div>
                <div className="font-bold text-white">
                  {skillData.last10SessionPFAvg !== undefined ? skillData.last10SessionPFAvg.toFixed(2) : skillData.currentProfitFactor.toFixed(2)} / {skillThresholds[skillData.skillLevelNumeric]?.minProfitFactor?.toFixed(2) || '?'}
                </div>
                <div className={`text-xs mt-1 ${(skillData.last10SessionPFAvg || skillData.currentProfitFactor) >= (skillThresholds[skillData.skillLevelNumeric]?.minProfitFactor || 0) ? 'text-green-400' : 'text-yellow-400'}`}>
                  {(skillData.last10SessionPFAvg || skillData.currentProfitFactor) >= (skillThresholds[skillData.skillLevelNumeric]?.minProfitFactor || 0) ? '✓ Met' : `Need +${((skillThresholds[skillData.skillLevelNumeric]?.minProfitFactor || 0) - (skillData.last10SessionPFAvg || skillData.currentProfitFactor)).toFixed(2)}`}
                </div>
              </div>
              <div>
                <div className="text-white/60 mb-1 flex items-center gap-1">
                  Consistency (10-session)
                  <span className="text-white/40 text-[10px]" title="Win rate spread over last 10 sessions. Lower spread = more consistent performance. Updates after each session.">ⓘ</span>
                </div>
                <div className="font-bold text-white">
                  {(() => {
                    const wrSpreadLimits: Record<number, number> = {
                      1: 35.0, 2: 25.0, 3: 15.0, 4: 12.0, 5: 10.0, 6: 8.0
                    };
                    const currentSpread = skillData.last10SessionWRSpread !== undefined ? skillData.last10SessionWRSpread : 0;
                    const requiredSpread = wrSpreadLimits[skillData.skillLevelNumeric] || 10.0;
                    const sessionCount = (skillData as any).totalBacktestsCompleted || 0;

                    if (sessionCount < 10) {
                      return `${sessionCount}/10 sessions`;
                    }
                    return `${currentSpread.toFixed(1)}% / ≤${requiredSpread.toFixed(0)}%`;
                  })()}
                </div>
                <div className={`text-xs mt-1 ${(() => {
                  const wrSpreadLimits: Record<number, number> = {
                    1: 35.0, 2: 25.0, 3: 15.0, 4: 12.0, 5: 10.0, 6: 8.0
                  };
                  const currentSpread = skillData.last10SessionWRSpread !== undefined ? skillData.last10SessionWRSpread : 0;
                  const requiredSpread = wrSpreadLimits[skillData.skillLevelNumeric] || 10.0;
                  const sessionCount = (skillData as any).totalBacktestsCompleted || 0;

                  if (sessionCount < 10) {
                    return 'text-blue-400';
                  }
                  if (skillData.consistencyValidationPassed === false) {
                    return 'text-red-400';
                  }
                  if (currentSpread <= requiredSpread) {
                    return 'text-green-400';
                  }
                  return 'text-yellow-400';
                })()}`}>
                  {(() => {
                    const wrSpreadLimits: Record<number, number> = {
                      1: 35.0, 2: 25.0, 3: 15.0, 4: 12.0, 5: 10.0, 6: 8.0
                    };
                    const currentSpread = skillData.last10SessionWRSpread !== undefined ? skillData.last10SessionWRSpread : 0;
                    const requiredSpread = wrSpreadLimits[skillData.skillLevelNumeric] || 10.0;
                    const sessionCount = (skillData as any).totalBacktestsCompleted || 0;

                    if (sessionCount < 10) {
                      return 'Building history';
                    }
                    if (skillData.consistencyValidationPassed === false) {
                      return '✗ Failed';
                    }
                    if (currentSpread <= requiredSpread) {
                      return '✓ Met';
                    }
                    return `Need -${(currentSpread - requiredSpread).toFixed(1)}%`;
                  })()}
                </div>
              </div>
              <div>
                <div className="text-white/60 mb-1 flex items-center gap-1">
                  Total P&L
                  <span className="text-white/40 text-[10px]" title="Cumulative profit from all winning trades">ⓘ</span>
                </div>
                <div className="font-bold text-white">
                  ${skillData.totalPnL?.toFixed(0) || '0'} / ${skillThresholds[skillData.skillLevelNumeric]?.minTotalPnL || '?'}
                </div>
                <div className={`text-xs mt-1 ${(skillData.totalPnL || 0) >= (skillThresholds[skillData.skillLevelNumeric]?.minTotalPnL || 0) ? 'text-green-400' : 'text-yellow-400'}`}>
                  {(skillData.totalPnL || 0) >= (skillThresholds[skillData.skillLevelNumeric]?.minTotalPnL || 0) ? '✓ Met' : `Need $${((skillThresholds[skillData.skillLevelNumeric]?.minTotalPnL || 0) - (skillData.totalPnL || 0)).toFixed(0)} more`}
                </div>
              </div>
            </div>
            <p className="text-xs text-blue-300 mt-3">
              <strong>Note:</strong> All FIVE criteria must be met to advance. All metrics update after each daily session. Total P&L tracks cumulative profit to ensure quality trading.
            </p>
          </div>

          {/* Consistency Validation Status */}
          {skillData.consistencyValidationPassed === false && skillData.consistencyFailureReason && (
            <div className="mt-3 p-3 bg-yellow-500/10 rounded border border-yellow-500/30">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-yellow-300 mb-1">Level Up Blocked - Consistency Check Failed</p>
                  <p className="text-xs text-yellow-200 mb-2">{skillData.consistencyFailureReason}</p>
                  <p className="text-xs text-yellow-100">
                    <strong>What this means:</strong> Your performance varies too much between sessions. The AI needs to demonstrate consistent results across at least 10 sessions before advancing. Keep training to stabilize your win rate.
                  </p>
                  {skillData.last10SessionWRSpread !== undefined && (
                    <div className="mt-2 text-xs text-yellow-200">
                      <div>Win Rate Spread: {skillData.last10SessionWRSpread.toFixed(1)}% (Max allowed: 10%)</div>
                      {skillData.last10SessionPFAverage !== undefined && (
                        <div>Avg Profit Factor: {skillData.last10SessionPFAverage.toFixed(2)}</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="mt-3 p-3 bg-emerald-500/10 rounded border border-emerald-500/30">
            <p className="text-xs text-emerald-300">
              <strong>Progress System:</strong> The AI only learns and progresses from successful, profitable trades.
              Losing trades are analyzed but don't count toward skill advancement. This ensures the AI truly masters winning patterns.
            </p>
          </div>

          {/* 30-Day Monthly Progress */}
          {autoBacktestState && autoBacktestState.isRunning && autoBacktestState.currentDayInMonth > 0 && (
            <div className="mt-4 p-4 bg-blue-500/10 rounded border border-blue-500/30">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-blue-300">30-Day Progressive Learning</h4>
                <span className="text-xs text-blue-200 bg-blue-500/20 px-2 py-1 rounded">
                  Day {autoBacktestState.currentDayInMonth}/30
                </span>
              </div>

              <div className="w-full bg-black/30 rounded-full h-2 overflow-hidden mb-3">
                <div
                  className="h-2 bg-gradient-to-r from-blue-400 to-blue-600 transition-all duration-500 rounded-full"
                  style={{ width: `${(autoBacktestState.currentDayInMonth / 30) * 100}%` }}
                ></div>
              </div>

              <p className="text-xs text-blue-200 mb-2">
                <strong>Month #{autoBacktestState.currentMonthNumber}</strong> - AI learns after each daily session
              </p>

              {autoBacktestState.lastDayResult && (
                <div className="mt-3 bg-black/20 p-3 rounded">
                  <div className="text-xs text-white/60 mb-2">Last Day Result (Day {autoBacktestState.lastDayResult.dayNumber}):</div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-white/60">Win Rate</div>
                      <div className="text-green-400 font-bold">{autoBacktestState.lastDayResult.winRate.toFixed(1)}%</div>
                    </div>
                    <div>
                      <div className="text-white/60">Trades</div>
                      <div className="text-white font-bold">{autoBacktestState.lastDayResult.totalTrades}</div>
                    </div>
                    <div>
                      <div className="text-white/60">P&L</div>
                      <div className={`font-bold ${autoBacktestState.lastDayResult.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ${autoBacktestState.lastDayResult.pnl.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-3 p-2 bg-emerald-500/10 rounded border border-emerald-500/30">
                <p className="text-xs text-emerald-300">
                  ✓ Total months completed: <strong>{autoBacktestState.totalMonthsCompleted}</strong>
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Monthly Performance Calendar - NEW */}
      {user && (
        <div className="bg-gradient-to-br from-blue-900/20 to-purple-900/20 backdrop-blur-sm border-2 border-blue-500/30 rounded-lg shadow-md p-6">
          <div className="flex items-center gap-3 mb-4">
            <BookOpen className="w-6 h-6 text-blue-400" />
            <h3 className="text-xl font-bold text-white">30-Day Monthly Performance</h3>
          </div>
          <p className="text-sm text-gray-400 mb-4">
            Visual snapshot of each trading day's performance. Green checkmarks indicate profitable days, red X marks show losing days.
          </p>
          <MonthlyPerformanceCalendar userId={user.id} />
        </div>
      )}

      {/* Daily Learnings Section - Moved here */}
      <DailyLearningsSection userId={user?.id} />

      {/* Live vs Backtest Learning Stats */}
      {(!autoBacktestState?.isRunning && (liveStats || backtestStats)) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Live Trading Learning */}
          <div className="bg-gradient-to-br from-green-900/20 to-emerald-900/20 backdrop-blur-sm border-2 border-green-500/30 rounded-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <PlayCircle className="w-6 h-6 text-green-400" />
              <h3 className="text-xl font-bold text-white">Historical Live Demo Trades</h3>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Total Live Trades:</span>
                <span className="text-white font-bold">{liveStats?.total_live_trades || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Analyzed:</span>
                <span className="text-emerald-400 font-bold">{liveStats?.trades_analyzed || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Pending Analysis:</span>
                <span className="text-yellow-400 font-bold">{liveStats?.trades_pending_analysis || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Insights Created:</span>
                <span className="text-blue-400 font-bold">{liveStats?.live_insights_created || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Learning Weight:</span>
                <span className="text-purple-400 font-bold">2.0x</span>
              </div>
              <div className="mt-3 p-2 bg-purple-500/10 rounded border border-purple-500/30">
                <p className="text-xs text-purple-300">
                  Live demo trades count <strong>double (2.0x)</strong> toward skill progression compared to standard backtests.
                </p>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Avg Quality Score:</span>
                <span className="text-emerald-400 font-bold">
                  {liveStats?.avg_learning_quality ? `${parseFloat(liveStats.avg_learning_quality).toFixed(1)}%` : 'N/A'}
                </span>
              </div>
            </div>
          </div>

          {/* Backtest Learning */}
          <div className="bg-gradient-to-br from-blue-900/20 to-indigo-900/20 backdrop-blur-sm border-2 border-blue-500/30 rounded-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <BarChart2 className="w-6 h-6 text-blue-400" />
              <h3 className="text-xl font-bold text-white">Backtest Learning</h3>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Total Insights:</span>
                <span className="text-white font-bold">{backtestStats?.total_insights || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Avg Confidence:</span>
                <span className="text-blue-400 font-bold">
                  {backtestStats?.avg_confidence ? `${backtestStats.avg_confidence.toFixed(1)}%` : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Real Data Weight:</span>
                <span className="text-gray-400 font-bold">1.0x</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Synthetic Weight:</span>
                <span className="text-gray-500 font-bold">0.5x</span>
              </div>
              <div className="mt-4 p-3 bg-blue-500/10 rounded border border-blue-500/30">
                <p className="text-sm text-gray-300">
                  <strong>Learning weights:</strong> Live demo (2.0x) &gt; Real backtest (1.0x) &gt; Synthetic (0.5x).
                  Live trading provides the highest quality learning signal.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Performance Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard
          icon={<Target className="w-6 h-6 text-emerald-500" />}
          label="Current Win Rate"
          value={`${skillData.currentWinRate.toFixed(1)}%`}
          subtext={`${skillData.gapToTarget.toFixed(1)}% to 80% target`}
          trend={skillData.gapToTarget < 0 ? 'positive' : 'neutral'}
        />
        <MetricCard
          icon={<TrendingUp className="w-6 h-6 text-blue-500" />}
          label="Profit Factor"
          value={skillData.currentProfitFactor.toFixed(2)}
          subtext={skillData.currentProfitFactor >= 1.5 ? 'Excellent' : 'Building'}
          trend={skillData.currentProfitFactor >= 1.5 ? 'positive' : 'neutral'}
        />
        <MetricCard
          icon={<Zap className="w-6 h-6 text-yellow-500" />}
          label="Learning Velocity"
          value={`${skillData.learningVelocityScore.toFixed(1)}`}
          subtext="Win rate improvement"
          trend="neutral"
        />
        <MetricCard
          icon={<Lightbulb className="w-6 h-6 text-purple-500" />}
          label="Patterns Learned"
          value={skillData.totalPatternsLearned}
          subtext={`${skillData.winningPatternsCount} winning patterns`}
          trend="neutral"
        />
      </div>

      {/* Confidence Prediction Accuracy Section */}
      {user && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ConfidenceOverviewCard userId={user.id} />
          <Last10TradesConfidenceWidget userId={user.id} />
        </div>
      )}

      {/* Removed: Cycle-based automatic adjustments section */}

      {/* Skill Level Roadmap */}
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-6">
        <h3 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
          <Award className="w-5 h-5 text-yellow-500" />
          Skill Level Roadmap
        </h3>
        <p className="text-sm text-gray-400 mb-4">
          Requirements shown are for <span className="text-emerald-400 font-semibold">winning trades only</span>.
          The AI must demonstrate consistent profitability to advance through skill levels.
        </p>
        <div className="space-y-3">
          {skillThresholds.map((threshold, index) => {
            const isCompleted = skillData.skillLevelNumeric > index + 1;
            const isCurrent = skillData.skillLevelNumeric === index + 1;
            const isNext = skillData.skillLevelNumeric === index;

            return (
              <div
                key={threshold.level}
                className={`p-4 rounded-lg border-2 transition-all ${
                  isCompleted
                    ? 'border-green-500 bg-green-900/20'
                    : isCurrent
                    ? 'border-emerald-500 bg-emerald-900/30'
                    : isNext
                    ? 'border-blue-500 bg-blue-900/20'
                    : 'border-gray-700 bg-gray-900/20'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {isCompleted && <CheckCircle className="w-5 h-5 text-green-500" />}
                    {isCurrent && <Activity className="w-5 h-5 text-emerald-500 animate-pulse" />}
                    {!isCompleted && !isCurrent && <Clock className="w-5 h-5 text-gray-500" />}
                    <div>
                      <h4 className={`font-semibold ${isCompleted || isCurrent ? 'text-white' : 'text-gray-400'}`}>
                        {threshold.level}
                      </h4>
                      <p className={`text-sm ${isCompleted || isCurrent ? 'text-gray-300' : 'text-gray-500'}`}>
                        {threshold.description}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-semibold ${isCompleted || isCurrent ? 'text-white' : 'text-gray-500'}`}>
                      {threshold.minTrades}+ wins
                    </div>
                    <div className={`text-xs ${isCompleted || isCurrent ? 'text-gray-400' : 'text-gray-600'}`}>
                      {threshold.minWinRate}% WR · {threshold.minProfitFactor}+ PF
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Indicator Stack Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Adopted Indicators */}
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-6">
          <h3 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-500" />
            Active Indicator Stack
          </h3>
          <p className="text-sm text-gray-400 mb-4">
            Technical indicators AI is currently using for analysis
          </p>
          {adoptedIndicators.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No indicators adopted yet. Core indicators will be added after first backtest.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {adoptedIndicators.map((indicator) => (
                <div key={indicator.id} className="p-3 bg-green-900/20 border border-green-500/30 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-white">{indicator.indicatorName}</h4>
                    <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">
                      {indicator.indicatorCategory}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-300">
                      Win Rate: <span className="font-semibold text-green-400">{indicator.winRateWithIndicator.toFixed(1)}%</span>
                    </span>
                    <span className="text-gray-400">{indicator.tradesWithIndicator} trades</span>
                  </div>
                  {indicator.adoptionReasoning && (
                    <p className="text-xs text-gray-400 mt-2">{indicator.adoptionReasoning}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Experimental Indicators */}
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-6">
          <h3 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-yellow-500" />
            Experimental Indicators
          </h3>
          <p className="text-sm text-gray-400 mb-4">
            New indicators AI is testing to improve performance
          </p>
          {activeExperiments.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No active experiments. AI will test new indicators as it gains experience.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeExperiments.map((experiment) => {
                const progress = (experiment.tradesWithIndicator / 30) * 100;
                return (
                  <div key={experiment.id} className="p-3 bg-blue-900/20 border border-blue-500/30 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold text-white">{experiment.indicatorName}</h4>
                      <span className="px-2 py-1 bg-blue-600 text-white text-xs rounded-full">
                        Testing
                      </span>
                    </div>
                    <div className="mb-2">
                      <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                        <span>Experiment Progress</span>
                        <span>{experiment.tradesWithIndicator} / 30 trades</span>
                      </div>
                      <div className="w-full bg-gray-700 rounded-full h-2">
                        <div
                          className="h-2 bg-blue-500 rounded-full transition-all"
                          style={{ width: `${Math.min(100, progress)}%` }}
                        ></div>
                      </div>
                    </div>
                    {experiment.tradesWithIndicator > 0 && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-300">
                          Win Rate: <span className="font-semibold text-blue-400">{experiment.winRateWithIndicator.toFixed(1)}%</span>
                        </span>
                        <span className={`text-xs ${experiment.improvementVsBaseline >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {experiment.improvementVsBaseline >= 0 ? '+' : ''}{experiment.improvementVsBaseline.toFixed(1)}% vs baseline
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Indicator Effectiveness by Symbol */}
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold text-white flex items-center gap-2">
            <Eye className="w-5 h-5 text-purple-500" />
            Indicator Effectiveness - {selectedSymbol}
          </h3>
          <select
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            className="px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-md text-sm"
          >
            <option value="EURUSD">EURUSD</option>
            <option value="XAUUSD">XAUUSD</option>
            <option value="GBPUSD">GBPUSD</option>
            <option value="USDJPY">USDJPY</option>
            <option value="US30">US30</option>
          </select>
        </div>

        {indicatorEffectiveness.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No effectiveness data yet. Complete backtests to see indicator performance.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {indicatorEffectiveness.map((eff, index) => (
              <div key={index} className="p-4 bg-gray-900/50 rounded-lg border border-gray-700">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-white">{eff.indicatorName}</h4>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-400">Quality Score:</span>
                    <span className={`font-bold ${
                      eff.signalQualityScore >= 75 ? 'text-green-400' :
                      eff.signalQualityScore >= 60 ? 'text-yellow-400' :
                      'text-red-400'
                    }`}>
                      {eff.signalQualityScore.toFixed(0)}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-gray-400">Win Rate</span>
                    <div className="font-semibold text-white">{eff.winRate.toFixed(1)}%</div>
                  </div>
                  <div>
                    <span className="text-gray-400">Signals</span>
                    <div className="font-semibold text-white">{eff.totalSignals}</div>
                  </div>
                  <div>
                    <span className="text-gray-400">Decision Weight</span>
                    <div className="font-semibold text-white">{eff.weightInDecision.toFixed(0)}%</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Milestones */}
      {milestones.length > 0 && (
        <div className="bg-gradient-to-br from-yellow-900/20 to-orange-900/20 backdrop-blur-sm border border-yellow-500/30 rounded-lg shadow-md p-6">
          <h3 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-500" />
            Recent Achievements
          </h3>
          <div className="space-y-3">
            {milestones.map((milestone, index) => (
              <div key={index} className="p-3 bg-yellow-900/20 border border-yellow-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <Sparkles className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-1" />
                  <div className="flex-1">
                    <h4 className="font-semibold text-white mb-1">{milestone.milestoneTitle}</h4>
                    <p className="text-sm text-gray-300">{milestone.milestoneDescription}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                      <span>{new Date(milestone.achievedAt).toLocaleDateString()}</span>
                      <span>·</span>
                      <span>{milestone.skillLevelAtAchievement} level</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Journey to Mastery */}
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-6">
        <h3 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-blue-500" />
          Journey to Mastery
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <JourneyCard
            title="To Master Level"
            trades={skillData.estimatedTradesToMaster}
            description="Trades needed to reach Master status with 70%+ win rate"
            color="orange"
          />
          <JourneyCard
            title="To Exceptional"
            trades={skillData.estimatedTradesToExceptional}
            description="Trades needed to reach elite 80%+ win rate performance"
            color="yellow"
          />
          <JourneyCard
            title="Current Pace"
            trades={skillData.learningVelocityScore > 0 ? Math.round(1 / skillData.learningVelocityScore) : 0}
            description="Estimated trades per 1% win rate improvement"
            color="blue"
          />
        </div>
      </div>
    </div>
  );
}

function DailyLearningsSection({ userId }: { userId?: string }) {
  const [recentLearning, setRecentLearning] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const userIdRef = React.useRef(userId);
  const isMountedRef = React.useRef(true);

  // Update ref when userId changes
  React.useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  React.useEffect(() => {
    if (!userId) return;

    const loadRecentLearning = async () => {
      if (!isMountedRef.current || !userIdRef.current) return;

      try {
        const { sessionLearningGenerator } = await import('../services/session-learning-generator');
        const recent = await sessionLearningGenerator.getRecentLearnings(userIdRef.current, 1);

        if (isMountedRef.current) {
          setRecentLearning(recent[0] || null);
        }
      } catch (error) {
        console.error('[Daily Learnings] Error loading:', error);
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    };

    loadRecentLearning();

    return () => {
      isMountedRef.current = false;
    };
  }, [userId]);

  if (loading) {
    return (
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-6">
        <h3 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-blue-400" />
          Daily Learnings
        </h3>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }

  if (!recentLearning) {
    return (
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-6">
        <h3 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-blue-400" />
          Daily Learnings
        </h3>
        <div className="text-center py-8 text-gray-500">
          <p className="text-sm">No learning data yet. Run backtests to generate insights.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-blue-900/20 to-purple-900/20 backdrop-blur-sm border-2 border-blue-500/30 rounded-lg shadow-md p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-semibold text-white flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-blue-400" />
          Daily Learnings
        </h3>
        <span className="text-sm text-gray-400">
          {new Date(recentLearning.session_date).toLocaleDateString()}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700">
          <div className="text-xs text-gray-400 mb-1">Session CSS</div>
          <div className="text-lg font-bold text-blue-400">
            {recentLearning.session_css?.toFixed(1) || 'N/A'}
          </div>
        </div>
        <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700">
          <div className="text-xs text-gray-400 mb-1">Session EV</div>
          <div className={`text-lg font-bold ${recentLearning.session_ev > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {recentLearning.session_ev?.toFixed(2) || 'N/A'}
          </div>
        </div>
        <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700">
          <div className="text-xs text-gray-400 mb-1">Trades Taken</div>
          <div className="text-lg font-bold text-white">
            {recentLearning.trades_taken || 0}
          </div>
        </div>
        <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700">
          <div className="text-xs text-gray-400 mb-1">Patterns</div>
          <div className="text-lg font-bold text-purple-400">
            {recentLearning.patterns_discovered?.length || 0}
          </div>
        </div>
      </div>

      {recentLearning.key_learnings && recentLearning.key_learnings.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-gray-300 mb-2">Key Insights</h4>
          {recentLearning.key_learnings.slice(0, 3).map((learning: string, index: number) => (
            <div key={index} className="flex items-start gap-2 p-2 bg-gray-900/50 rounded">
              <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-gray-300">{learning}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetricCard({ icon, label, value, subtext, trend }: any) {
  const trendColors = {
    positive: 'border-green-500 bg-green-900/20',
    negative: 'border-red-500 bg-red-900/20',
    neutral: 'border-gray-700 bg-gray-900/20'
  };

  return (
    <div className={`p-4 rounded-lg border-2 ${trendColors[trend]}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm text-gray-400">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white mb-1">{value}</div>
      <div className="text-xs text-gray-400">{subtext}</div>
    </div>
  );
}

function JourneyCard({ title, trades, description, color }: any) {
  const colorClasses = {
    orange: 'border-orange-500 bg-orange-900/20',
    yellow: 'border-yellow-500 bg-yellow-900/20',
    blue: 'border-blue-500 bg-blue-900/20'
  };

  return (
    <div className={`p-4 rounded-lg border-2 ${colorClasses[color]}`}>
      <h4 className="font-semibold text-white mb-2">{title}</h4>
      <div className="text-3xl font-bold text-white mb-2">
        {trades === 0 ? 'Achieved!' : trades.toLocaleString()}
      </div>
      <p className="text-sm text-gray-400">{description}</p>
      {trades > 0 && (
        <p className="text-xs text-gray-500 mt-2">Winning trades only</p>
      )}
    </div>
  );
}

export default memo(AILearningProgressDashboard);

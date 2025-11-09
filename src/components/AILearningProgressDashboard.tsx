import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { aiSkillTracker, SkillProgressionData, MilestoneData, SkillLevel } from '../services/ai-skill-tracker';
import { aiIndicatorTracker, IndicatorExperiment, IndicatorEffectiveness } from '../services/ai-indicator-tracker';
import { liveTradeLearningTrigger } from '../services/live-trade-learning-trigger';
import { supabase } from '../lib/supabase';
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
  BarChart2
} from 'lucide-react';

export default function AILearningProgressDashboard() {
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

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user, selectedSymbol]);

  const loadData = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const [skill, milestonesData, adopted, experiments, effectiveness, liveStatsData] = await Promise.all([
        aiSkillTracker.getSkillProgression(user.id),
        aiSkillTracker.getRecentMilestones(user.id, 5),
        aiIndicatorTracker.getAdoptedIndicators(user.id),
        aiIndicatorTracker.getActiveExperiments(user.id),
        aiIndicatorTracker.getIndicatorEffectiveness(user.id, selectedSymbol),
        liveTradeLearningTrigger.getLearningStats(user.id)
      ]);

      setSkillData(skill);
      setMilestones(milestonesData);
      setAdoptedIndicators(adopted);
      setActiveExperiments(experiments);
      setIndicatorEffectiveness(effectiveness);
      setLiveStats(liveStatsData);

      // Fetch backtest stats
      const { data: backtestInsights } = await supabase
        .from('ai_learning_insights')
        .select('*')
        .eq('user_id', user.id)
        .eq('learned_from_live_trading', false);

      setBacktestStats({
        total_insights: backtestInsights?.length || 0,
        avg_confidence: backtestInsights && backtestInsights.length > 0
          ? backtestInsights.reduce((sum, i) => sum + parseFloat(i.confidence_score.toString()), 0) / backtestInsights.length
          : 0
      });
    } catch (error) {
      console.error('[AI Learning Dashboard] Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !skillData) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
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
          <div className="text-right">
            <div className="text-4xl font-bold text-white mb-2">
              {skillData.totalTradesAnalyzed.toLocaleString()}
            </div>
            <p className="text-white/80 text-sm">Trades Analyzed</p>
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
            <span className="text-white/70">{skillData.tradesNeededForNextLevel} trades needed</span>
            <span className="text-white/70">Target: {skillThresholds[skillData.skillLevelNumeric]?.level || 'Max Level'}</span>
          </div>
        </div>
      </div>

      {/* Live vs Backtest Learning Stats */}
      {(liveStats || backtestStats) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Live Trading Learning */}
          <div className="bg-gradient-to-br from-green-900/20 to-emerald-900/20 backdrop-blur-sm border-2 border-green-500/30 rounded-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <PlayCircle className="w-6 h-6 text-green-400" />
              <h3 className="text-xl font-bold text-white">Live Demo Trading Learning</h3>
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
                <span className="text-gray-400">Learning Weight:</span>
                <span className="text-gray-400 font-bold">1.0x</span>
              </div>
              <div className="mt-4 p-3 bg-blue-500/10 rounded border border-blue-500/30">
                <p className="text-sm text-gray-300">
                  Live trades have <span className="text-emerald-400 font-bold">2x learning weight</span> compared to backtests, making them more impactful for AI improvement.
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

      {/* Skill Level Roadmap */}
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-6">
        <h3 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
          <Award className="w-5 h-5 text-yellow-500" />
          Skill Level Roadmap
        </h3>
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
                      {threshold.minTrades}+ trades
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
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { sessionLearningGenerator } from '../services/session-learning-generator';
import {
  BookOpen,
  TrendingUp,
  TrendingDown,
  Target,
  AlertCircle,
  CheckCircle,
  Lightbulb,
  Calendar,
  ArrowUp,
  ArrowDown,
  Sparkles,
  BarChart3
} from 'lucide-react';

export default function SessionLearningDashboard() {
  const { user } = useAuth();
  const [todayLearning, setTodayLearning] = useState<any>(null);
  const [recentLearnings, setRecentLearnings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());

  useEffect(() => {
    if (user) {
      loadLearnings();
    }
  }, [user, selectedDate]);

  const loadLearnings = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const [today, recent] = await Promise.all([
        sessionLearningGenerator.getLearningForDate(user.id, selectedDate),
        sessionLearningGenerator.getRecentLearnings(user.id, 7)
      ]);

      setTodayLearning(today);
      setRecentLearnings(recent);
    } catch (error) {
      console.error('[Session Learning Dashboard] Error loading:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateLearning = async () => {
    if (!user) return;

    setGenerating(true);
    try {
      const learning = await sessionLearningGenerator.generateDailyLearning(user.id, selectedDate);
      if (learning) {
        setTodayLearning(learning);
        await loadLearnings();
      }
    } catch (error) {
      console.error('[Session Learning Dashboard] Error generating:', error);
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-br from-blue-900/30 to-purple-900/30 backdrop-blur-sm border-2 border-blue-500/30 rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BookOpen className="w-8 h-8 text-blue-400" />
            <div>
              <h2 className="text-2xl font-bold text-white">Daily Learning Summaries</h2>
              <p className="text-gray-400">What the AI learned from today's trading</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={selectedDate.toISOString().split('T')[0]}
              onChange={(e) => setSelectedDate(new Date(e.target.value))}
              className="px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-md"
            />
            {!todayLearning && (
              <button
                onClick={handleGenerateLearning}
                disabled={generating}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-semibold transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {generating ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Generate Learning
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {!todayLearning ? (
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-12 text-center">
          <Calendar className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">No Learning Data Available</h3>
          <p className="text-gray-400 mb-6">
            No trades were recorded for {selectedDate.toLocaleDateString()}. Complete some trades first, then generate learning insights.
          </p>
          <button
            onClick={handleGenerateLearning}
            disabled={generating}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-semibold transition-colors disabled:opacity-50 inline-flex items-center gap-2"
          >
            <Sparkles className="w-5 h-5" />
            Try Generating Learning
          </button>
        </div>
      ) : (
        <>
          {/* Today's Summary */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <MetricCard
              icon={<BarChart3 className="w-6 h-6 text-blue-500" />}
              label="Session CSS"
              value={todayLearning.session_css?.toFixed(1) || 'N/A'}
              subtext={getCSSLevel(todayLearning.session_css)}
            />
            <MetricCard
              icon={<Target className="w-6 h-6 text-green-500" />}
              label="Session EV"
              value={todayLearning.session_ev?.toFixed(2) || 'N/A'}
              subtext={todayLearning.session_ev > 0 ? 'Positive EV' : 'Negative EV'}
            />
            <MetricCard
              icon={<CheckCircle className="w-6 h-6 text-emerald-500" />}
              label="Trades Taken"
              value={todayLearning.trades_taken || 0}
              subtext={`${todayLearning.trades_avoided || 0} avoided`}
            />
            <MetricCard
              icon={<Lightbulb className="w-6 h-6 text-yellow-500" />}
              label="Patterns Discovered"
              value={todayLearning.patterns_discovered?.length || 0}
              subtext={`${todayLearning.patterns_degraded?.length || 0} degraded`}
            />
          </div>

          {/* Best and Worst Setups */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Best Setup */}
            {todayLearning.best_setup_name && (
              <div className="bg-gradient-to-br from-green-900/20 to-emerald-900/20 backdrop-blur-sm border-2 border-green-500/30 rounded-lg p-6">
                <div className="flex items-center gap-3 mb-4">
                  <TrendingUp className="w-6 h-6 text-green-400" />
                  <h3 className="text-xl font-bold text-white">Best Performing Setup</h3>
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="text-2xl font-bold text-white mb-1">{todayLearning.best_setup_name}</div>
                    <div className="text-sm text-gray-400">Most profitable pattern today</div>
                  </div>
                  <div className="grid grid-cols-3 gap-4 pt-4 border-t border-green-500/30">
                    <div>
                      <div className="text-sm text-gray-400">Expected Value</div>
                      <div className="text-lg font-bold text-green-400">
                        {todayLearning.best_setup_ev?.toFixed(2) || 'N/A'}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-400">Win Rate</div>
                      <div className="text-lg font-bold text-white">
                        {todayLearning.best_setup_win_rate?.toFixed(1)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-400">Trades</div>
                      <div className="text-lg font-bold text-white">
                        {todayLearning.best_setup_trades_count || 0}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Worst Setup */}
            {todayLearning.worst_setup_name && todayLearning.worst_setup_ev < 0 && (
              <div className="bg-gradient-to-br from-red-900/20 to-orange-900/20 backdrop-blur-sm border-2 border-red-500/30 rounded-lg p-6">
                <div className="flex items-center gap-3 mb-4">
                  <TrendingDown className="w-6 h-6 text-red-400" />
                  <h3 className="text-xl font-bold text-white">Worst Performing Setup</h3>
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="text-2xl font-bold text-white mb-1">{todayLearning.worst_setup_name}</div>
                    <div className="text-sm text-gray-400">Avoid this pattern</div>
                  </div>
                  <div className="grid grid-cols-3 gap-4 pt-4 border-t border-red-500/30">
                    <div>
                      <div className="text-sm text-gray-400">Expected Value</div>
                      <div className="text-lg font-bold text-red-400">
                        {todayLearning.worst_setup_ev?.toFixed(2) || 'N/A'}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-400">Win Rate</div>
                      <div className="text-lg font-bold text-white">
                        {todayLearning.worst_setup_win_rate?.toFixed(1)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-400">Trades</div>
                      <div className="text-lg font-bold text-white">
                        {todayLearning.worst_setup_trades_count || 0}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Confidence Adjustments */}
          {todayLearning.confidence_adjustments && todayLearning.confidence_adjustments.length > 0 && (
            <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-6">
              <div className="flex items-center gap-3 mb-4">
                <Target className="w-5 h-5 text-purple-500" />
                <h3 className="text-xl font-semibold text-white">Confidence Adjustments</h3>
              </div>
              <div className="space-y-3">
                {todayLearning.confidence_adjustments.map((adj: any, index: number) => (
                  <div key={index} className="p-4 bg-gray-900/50 rounded-lg border border-gray-700">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold text-white">{adj.pattern}</h4>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400">{adj.oldConfidence.toFixed(0)}%</span>
                        {adj.newConfidence > adj.oldConfidence ? (
                          <ArrowUp className="w-4 h-4 text-green-500" />
                        ) : (
                          <ArrowDown className="w-4 h-4 text-red-500" />
                        )}
                        <span className={`font-bold ${adj.newConfidence > adj.oldConfidence ? 'text-green-400' : 'text-red-400'}`}>
                          {adj.newConfidence.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-gray-400">{adj.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Key Learnings */}
          {todayLearning.key_learnings && todayLearning.key_learnings.length > 0 && (
            <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-6">
              <div className="flex items-center gap-3 mb-4">
                <Lightbulb className="w-5 h-5 text-yellow-500" />
                <h3 className="text-xl font-semibold text-white">Key Learnings</h3>
              </div>
              <div className="space-y-2">
                {todayLearning.key_learnings.map((learning: string, index: number) => (
                  <div key={index} className="flex items-start gap-3 p-3 bg-gray-900/50 rounded-lg">
                    <CheckCircle className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                    <p className="text-gray-300">{learning}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actionable Recommendations */}
          {todayLearning.actionable_recommendations && todayLearning.actionable_recommendations.length > 0 && (
            <div className="bg-gradient-to-br from-blue-900/20 to-cyan-900/20 backdrop-blur-sm border border-blue-500/30 rounded-lg shadow-md p-6">
              <div className="flex items-center gap-3 mb-4">
                <Sparkles className="w-5 h-5 text-blue-400" />
                <h3 className="text-xl font-semibold text-white">Recommendations for Tomorrow</h3>
              </div>
              <div className="space-y-2">
                {todayLearning.actionable_recommendations.map((rec: string, index: number) => (
                  <div key={index} className="flex items-start gap-3 p-3 bg-blue-900/20 rounded-lg">
                    <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                    <p className="text-gray-300">{rec}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Recent Learning History */}
      {recentLearnings.length > 0 && (
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-6">
          <h3 className="text-xl font-semibold text-white mb-4">Recent Learning History</h3>
          <div className="space-y-3">
            {recentLearnings.slice(0, 5).map((learning) => (
              <div
                key={learning.id}
                className="p-4 bg-gray-900/50 rounded-lg border border-gray-700 hover:border-blue-500/50 transition-colors cursor-pointer"
                onClick={() => setSelectedDate(new Date(learning.session_date))}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <Calendar className="w-5 h-5 text-gray-400" />
                    <span className="font-semibold text-white">
                      {new Date(learning.session_date).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-gray-400">
                      CSS: <span className="text-white font-semibold">{learning.session_css?.toFixed(1) || 'N/A'}</span>
                    </span>
                    <span className="text-gray-400">
                      EV: <span className={`font-semibold ${learning.session_ev > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {learning.session_ev?.toFixed(2) || 'N/A'}
                      </span>
                    </span>
                    <span className="text-gray-400">
                      {learning.trades_taken || 0} trades
                    </span>
                  </div>
                </div>
                {learning.key_learnings && learning.key_learnings.length > 0 && (
                  <p className="text-sm text-gray-400 truncate">{learning.key_learnings[0]}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ icon, label, value, subtext }: any) {
  return (
    <div className="p-4 rounded-lg border-2 border-gray-700 bg-gray-900/20">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm text-gray-400">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white mb-1">{value}</div>
      <div className="text-xs text-gray-400">{subtext}</div>
    </div>
  );
}

function getCSSLevel(css: number | null): string {
  if (!css) return 'No data';
  if (css >= 85) return 'Exceptional';
  if (css >= 75) return 'Expert';
  if (css >= 70) return 'Pro';
  if (css >= 60) return 'Intermediate';
  return 'Novice';
}

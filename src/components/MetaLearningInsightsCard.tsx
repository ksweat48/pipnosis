import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { recommendationTracker } from '../services/recommendation-tracker';
import {
  Brain,
  Sparkles,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Lightbulb,
  Target,
  Shield,
  Activity,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader
} from 'lucide-react';

interface MetaLearningInsight {
  id: string;
  analysis_date: string;
  analysis_type: string;
  high_level_interpretation: string;
  strategic_recommendations: Array<{
    category: string;
    recommendation: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
    expectedImpact: string;
  }>;
  patterns_to_emphasize: string[];
  patterns_to_deweight: string[];
  patterns_to_ignore: string[];
  new_rule_ideas: Array<{
    ruleName: string;
    description: string;
    rationale: string;
    testPriority: 'high' | 'medium' | 'low';
  }>;
  risk_management_adjustments: Array<{
    area: string;
    currentState: string;
    recommendedChange: string;
    reasoning: string;
  }>;
  regime_changes_detected: Array<{
    market: string;
    symbol: string;
    changeDetected: string;
    actionRequired: string;
  }>;
  tomorrow_priorities: string[];
  tokens_used: number;
  created_at: string;
}

export default function MetaLearningInsightsCard() {
  const { user } = useAuth();
  const [insights, setInsights] = useState<MetaLearningInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedInsight, setExpandedInsight] = useState<string | null>(null);
  const [recommendationStatuses, setRecommendationStatuses] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (user) {
      loadInsights();
      loadRecommendationStatuses();
      // Refresh statuses every 30 seconds
      const interval = setInterval(loadRecommendationStatuses, 30000);
      return () => clearInterval(interval);
    }
  }, [user]);

  const loadInsights = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('ai_meta_learning_insights')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) {
        console.error('Error loading meta-learning insights:', error);
        return;
      }

      setInsights(data || []);
    } catch (error) {
      console.error('Exception loading insights:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadRecommendationStatuses = async () => {
    if (!user) return;

    try {
      const recommendations = await recommendationTracker.getRecommendationsWithStatus(user.id, 50);
      const statusMap = new Map<string, string>();

      recommendations.forEach(rec => {
        if (rec.meta_learning_insight_id) {
          const key = `${rec.meta_learning_insight_id}-${rec.recommendation_text}`;
          statusMap.set(key, rec.status);
        }
      });

      setRecommendationStatuses(statusMap);
    } catch (error) {
      console.error('Error loading recommendation statuses:', error);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'bg-red-500/20 text-red-400 border-red-500/50';
      case 'high': return 'bg-orange-500/20 text-orange-400 border-orange-500/50';
      case 'medium': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50';
      case 'low': return 'bg-blue-500/20 text-blue-400 border-blue-500/50';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/50';
    }
  };

  const getStatusBadge = (insightId: string, recommendationText: string) => {
    const key = `${insightId}-${recommendationText}`;
    const status = recommendationStatuses.get(key);

    if (!status || status === 'pending') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-700/50 text-gray-400 text-xs rounded-full">
          <Clock className="w-3 h-3" />
          Pending
        </span>
      );
    }

    if (status === 'in_progress') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-500/20 text-yellow-400 text-xs rounded-full">
          <Loader className="w-3 h-3 animate-spin" />
          Implementing
        </span>
      );
    }

    if (status === 'completed') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-full">
          <CheckCircle className="w-3 h-3" />
          Implemented
        </span>
      );
    }

    if (status === 'failed') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded-full">
          <XCircle className="w-3 h-3" />
          Failed
        </span>
      );
    }

    return null;
  };

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <Brain className="w-6 h-6 text-purple-400 animate-pulse" />
          <h3 className="text-xl font-bold text-white">GPT-4o Strategic Insights</h3>
        </div>
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-700 rounded w-3/4"></div>
          <div className="h-4 bg-gray-700 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (insights.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <Brain className="w-6 h-6 text-purple-400" />
          <h3 className="text-xl font-bold text-white">GPT-4o Strategic Insights</h3>
        </div>
        <div className="text-center py-8">
          <Sparkles className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">
            Complete a backtest to receive GPT-4o strategic analysis
          </p>
          <p className="text-gray-500 text-sm mt-2">
            The AI strategist will analyze your results and provide high-level recommendations
          </p>
        </div>
      </div>
    );
  }

  const latestInsight = insights[0];

  return (
    <div className="space-y-4">
      {/* Latest Insight - Featured Display */}
      <div className="bg-gradient-to-br from-purple-900/30 to-blue-900/30 backdrop-blur-sm border-2 border-purple-500/30 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Brain className="w-7 h-7 text-purple-400" />
            <div>
              <h3 className="text-xl font-bold text-white">GPT-4o Strategic Analysis</h3>
              <p className="text-gray-400 text-sm">
                Latest insight from {new Date(latestInsight.created_at).toLocaleDateString()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-yellow-400" />
            <span className="text-sm text-gray-400">{latestInsight.tokens_used} tokens</span>
          </div>
        </div>

        {/* High-Level Interpretation */}
        <div className="bg-gray-800/50 rounded-lg p-4 mb-4">
          <div className="flex items-start gap-3">
            <Target className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-1" />
            <div>
              <h4 className="text-sm font-semibold text-emerald-400 uppercase tracking-wide mb-2">
                Strategic Overview
              </h4>
              <p className="text-gray-200 leading-relaxed">
                {latestInsight.high_level_interpretation}
              </p>
            </div>
          </div>
        </div>

        {/* Strategic Recommendations */}
        {latestInsight.strategic_recommendations.length > 0 && (
          <div className="mb-4">
            <h4 className="text-sm font-semibold text-blue-400 uppercase tracking-wide mb-3 flex items-center gap-2">
              <Lightbulb className="w-4 h-4" />
              Key Recommendations ({latestInsight.strategic_recommendations.length})
            </h4>
            <div className="space-y-2">
              {latestInsight.strategic_recommendations.slice(0, 3).map((rec, idx) => (
                <div
                  key={idx}
                  className={`border rounded-lg p-3 ${getPriorityColor(rec.priority)}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold uppercase tracking-wide">
                          {rec.category}
                        </span>
                        <span className="text-xs px-2 py-0.5 bg-black/30 rounded-full">
                          {rec.priority}
                        </span>
                        {getStatusBadge(latestInsight.id, rec.recommendation)}
                      </div>
                      <p className="text-sm font-medium mb-1">{rec.recommendation}</p>
                      <p className="text-xs opacity-80">{rec.expectedImpact}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pattern Management */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          {latestInsight.patterns_to_emphasize.length > 0 && (
            <div className="bg-green-900/20 border border-green-500/30 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-4 h-4 text-green-400" />
                <h5 className="text-sm font-semibold text-green-400">Emphasize</h5>
              </div>
              <div className="space-y-1">
                {latestInsight.patterns_to_emphasize.slice(0, 3).map((pattern, idx) => (
                  <p key={idx} className="text-xs text-green-300">{pattern}</p>
                ))}
              </div>
            </div>
          )}

          {latestInsight.patterns_to_deweight.length > 0 && (
            <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-yellow-400" />
                <h5 className="text-sm font-semibold text-yellow-400">De-weight</h5>
              </div>
              <div className="space-y-1">
                {latestInsight.patterns_to_deweight.slice(0, 3).map((pattern, idx) => (
                  <p key={idx} className="text-xs text-yellow-300">{pattern}</p>
                ))}
              </div>
            </div>
          )}

          {latestInsight.patterns_to_ignore.length > 0 && (
            <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <XCircle className="w-4 h-4 text-red-400" />
                <h5 className="text-sm font-semibold text-red-400">Ignore</h5>
              </div>
              <div className="space-y-1">
                {latestInsight.patterns_to_ignore.slice(0, 3).map((pattern, idx) => (
                  <p key={idx} className="text-xs text-red-300">{pattern}</p>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Implementation Priorities with Status */}
        {latestInsight.tomorrow_priorities.length > 0 && (
          <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-blue-400 uppercase tracking-wide mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Implementation Priorities & Status
            </h4>
            <ul className="space-y-2">
              {latestInsight.tomorrow_priorities.map((priority, idx) => {
                const status = getStatusBadge(latestInsight.id, priority);
                return (
                  <li key={idx} className="flex items-start justify-between gap-3 text-sm">
                    <div className="flex items-start gap-2 flex-1">
                      <span className="text-blue-400 font-bold">{idx + 1}.</span>
                      <span className="text-gray-200">{priority}</span>
                    </div>
                    {status}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Expand to see more details */}
        <button
          onClick={() => setExpandedInsight(expandedInsight === latestInsight.id ? null : latestInsight.id)}
          className="mt-4 w-full flex items-center justify-center gap-2 text-purple-400 hover:text-purple-300 transition-colors"
        >
          <span className="text-sm font-medium">
            {expandedInsight === latestInsight.id ? 'Show Less' : 'Show All Details'}
          </span>
          {expandedInsight === latestInsight.id ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>

        {/* Expanded Details */}
        {expandedInsight === latestInsight.id && (
          <div className="mt-4 space-y-4 pt-4 border-t border-gray-700">
            {/* New Rule Ideas */}
            {latestInsight.new_rule_ideas.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-purple-400 uppercase tracking-wide mb-3">
                  New Rule Ideas to Test
                </h4>
                <div className="space-y-3">
                  {latestInsight.new_rule_ideas.map((idea, idx) => (
                    <div key={idx} className="bg-gray-800/50 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <h5 className="font-semibold text-white">{idea.ruleName}</h5>
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          idea.testPriority === 'high' ? 'bg-red-500/20 text-red-400' :
                          idea.testPriority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-blue-500/20 text-blue-400'
                        }`}>
                          {idea.testPriority} priority
                        </span>
                      </div>
                      <p className="text-sm text-gray-300 mb-2">{idea.description}</p>
                      <p className="text-xs text-gray-400">{idea.rationale}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Risk Management Adjustments */}
            {latestInsight.risk_management_adjustments.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-orange-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Risk Management Adjustments
                </h4>
                <div className="space-y-2">
                  {latestInsight.risk_management_adjustments.map((adj, idx) => (
                    <div key={idx} className="bg-orange-900/10 border border-orange-500/30 rounded-lg p-3">
                      <h5 className="text-sm font-semibold text-orange-300 mb-1">{adj.area}</h5>
                      <div className="grid grid-cols-2 gap-3 text-xs mb-2">
                        <div>
                          <span className="text-gray-400">Current:</span>
                          <p className="text-gray-200">{adj.currentState}</p>
                        </div>
                        <div>
                          <span className="text-gray-400">Recommended:</span>
                          <p className="text-emerald-300">{adj.recommendedChange}</p>
                        </div>
                      </div>
                      <p className="text-xs text-gray-400">{adj.reasoning}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Regime Changes */}
            {latestInsight.regime_changes_detected.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-red-400 uppercase tracking-wide mb-3">
                  Market Regime Changes Detected
                </h4>
                <div className="space-y-2">
                  {latestInsight.regime_changes_detected.map((change, idx) => (
                    <div key={idx} className="bg-red-900/10 border border-red-500/30 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <h5 className="text-sm font-semibold text-red-300">{change.symbol}</h5>
                        <span className="text-xs text-gray-400">({change.market})</span>
                      </div>
                      <p className="text-sm text-gray-200 mb-1">{change.changeDetected}</p>
                      <p className="text-xs text-red-300">{change.actionRequired}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Historical Insights Summary */}
      {insights.length > 1 && (
        <div className="bg-gray-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Previous Strategic Insights ({insights.length - 1})
          </h4>
          <div className="space-y-2">
            {insights.slice(1, 4).map((insight) => (
              <div
                key={insight.id}
                className="flex items-center justify-between p-2 hover:bg-gray-700/50 rounded transition-colors cursor-pointer"
                onClick={() => setExpandedInsight(expandedInsight === insight.id ? null : insight.id)}
              >
                <div>
                  <p className="text-sm text-gray-200">
                    {new Date(insight.created_at).toLocaleDateString()}
                  </p>
                  <p className="text-xs text-gray-500 capitalize">{insight.analysis_type}</p>
                </div>
                <TrendingUp className="w-4 h-4 text-gray-500" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

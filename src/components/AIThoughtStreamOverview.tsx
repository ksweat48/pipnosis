import React, { useState, useEffect } from 'react';
import { Brain, Calendar, TrendingUp, Target, Lightbulb, AlertCircle, Zap, RefreshCw, AlertTriangle, XCircle } from 'lucide-react';
import { aiThoughtGenerator } from '../services/ai-thought-generator';
import { aiDataAccessValidator, type ValidationResult } from '../services/ai-data-access-validator';
import { useAuth } from '../hooks/useAuth';

interface AIThoughtStreamOverviewProps {
  onRefresh?: () => void;
}

export function AIThoughtStreamOverview({ onRefresh }: AIThoughtStreamOverviewProps) {
  const { user } = useAuth();
  const [reflections, setReflections] = useState<any[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedReflection, setSelectedReflection] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [showValidationDetails, setShowValidationDetails] = useState(false);

  useEffect(() => {
    if (user) {
      loadReflections();
    }
  }, [user]);

  const loadReflections = async () => {
    if (!user) return;

    setLoading(true);
    try {
      // Validate data access
      const validationResult = await aiDataAccessValidator.quickHealthCheck(user.id, true);
      setValidation(validationResult);

      const data = await aiThoughtGenerator.getDailyReflections(user.id, 30);
      setReflections(data);

      // Auto-select most recent reflection
      if (data.length > 0 && !selectedDate) {
        setSelectedDate(data[0].session_date);
        setSelectedReflection(data[0]);
      }
    } catch (error) {
      console.error('Error loading reflections:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDateSelect = (date: string) => {
    setSelectedDate(date);
    const reflection = reflections.find(r => r.session_date === date);
    setSelectedReflection(reflection);
  };

  const getMoodEmoji = (mood: string) => {
    switch (mood) {
      case 'excited': return '🤩';
      case 'confident': return '😎';
      case 'focused': return '🎯';
      case 'frustrated': return '😤';
      case 'curious': return '🤔';
      case 'cautious': return '🧐';
      default: return '🤖';
    }
  };

  const getMoodColor = (mood: string) => {
    switch (mood) {
      case 'excited': return 'text-yellow-400';
      case 'confident': return 'text-emerald-400';
      case 'focused': return 'text-blue-400';
      case 'frustrated': return 'text-red-400';
      case 'curious': return 'text-purple-400';
      case 'cautious': return 'text-orange-400';
      default: return 'text-gray-400';
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <Brain className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">Please sign in to view AI learning journey</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
      </div>
    );
  }

  if (reflections.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-white">AI Learning Journey</h2>
        <div className="bg-gradient-to-br from-blue-900/30 to-purple-900/30 backdrop-blur-sm border-2 border-blue-500/30 rounded-lg p-8 text-center">
          <Brain className="w-16 h-16 text-blue-400 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-white mb-2">No Learning Sessions Yet</h3>
          <p className="text-gray-400 mb-4">
            The AI hasn't completed any training sessions yet. Run backtests to start the learning journey!
          </p>
          <div className="bg-gray-800/50 rounded-lg p-4 text-left">
            <p className="text-sm text-gray-300 mb-2">To start learning:</p>
            <ul className="text-sm text-gray-400 space-y-1">
              <li>• Navigate to AI Training & Backtesting Lab</li>
              <li>• Enable Auto-Backtest Mode</li>
              <li>• After each session, AI will reflect on what it learned</li>
              <li>• Thoughts and reflections will appear here in plain English</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  const criticalIssues = validation?.issues.filter(i => i.severity === 'critical') || [];
  const warningIssues = validation?.issues.filter(i => i.severity === 'warning') || [];
  const hasCriticalIssues = criticalIssues.length > 0;
  const hasWarnings = warningIssues.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white flex items-center gap-3">
          <Brain className="w-8 h-8 text-emerald-400" />
          AI Learning Journey
        </h2>
        <button
          onClick={() => {
            loadReflections();
            onRefresh?.();
          }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg flex items-center gap-2 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Critical Alert Banner */}
      {hasCriticalIssues && (
        <div className="bg-red-900/50 border-2 border-red-500 rounded-lg p-6 animate-pulse">
          <div className="flex items-start gap-4">
            <XCircle className="w-8 h-8 text-red-400 flex-shrink-0 mt-1" />
            <div className="flex-1">
              <h3 className="text-xl font-bold text-red-300 mb-2">🚨 CRITICAL: AI Cannot Learn</h3>
              <p className="text-red-200 mb-4">
                The AI is experiencing critical data access issues that prevent it from learning.
                These must be fixed immediately.
              </p>
              <div className="space-y-2 mb-4">
                {criticalIssues.map((issue, idx) => (
                  <div key={idx} className="bg-red-950/50 rounded p-3">
                    <div className="font-semibold text-red-300">{issue.table}</div>
                    <div className="text-sm text-red-200">{issue.explanation}</div>
                    <div className="text-xs text-red-400 mt-1">Fix: {issue.suggestedFix}</div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setShowValidationDetails(!showValidationDetails)}
                className="text-sm text-red-300 hover:text-red-100 underline"
              >
                {showValidationDetails ? 'Hide' : 'Show'} Technical Details
              </button>
              {showValidationDetails && validation && (
                <div className="mt-4 bg-gray-900/50 rounded p-3 text-xs text-gray-400 font-mono">
                  <pre>{JSON.stringify(validation, null, 2)}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Warning Banner */}
      {!hasCriticalIssues && hasWarnings && (
        <div className="bg-yellow-900/30 border-2 border-yellow-500/50 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-yellow-400 flex-shrink-0" />
            <div className="flex-1">
              <h4 className="text-lg font-semibold text-yellow-300 mb-2">⚠️ AI Learning Degraded</h4>
              <p className="text-yellow-200 text-sm mb-2">
                The AI can still function but learning effectiveness is reduced:
              </p>
              <ul className="text-sm text-yellow-200 space-y-1">
                {warningIssues.map((issue, idx) => (
                  <li key={idx}>• {issue.explanation}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Session Timeline */}
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-4 lg:col-span-1">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-400" />
            Recent Sessions
          </h3>
          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {reflections.map((reflection) => {
              const isSelected = selectedDate === reflection.session_date;
              const date = new Date(reflection.session_date);
              const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

              return (
                <button
                  key={reflection.id}
                  onClick={() => handleDateSelect(reflection.session_date)}
                  className={`w-full text-left p-3 rounded-lg transition-all ${
                    isSelected
                      ? 'bg-emerald-600 text-white shadow-lg'
                      : 'bg-gray-900/50 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold">Day {reflection.session_number}</span>
                    <span className={`text-2xl ${isSelected ? '' : getMoodColor(reflection.mood)}`}>
                      {getMoodEmoji(reflection.mood)}
                    </span>
                  </div>
                  <div className="text-sm opacity-80">{dateStr}</div>
                  <div className="text-xs mt-1 opacity-70">
                    {reflection.session_win_rate?.toFixed(1)}% WR • {reflection.trades_count} trades
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Main Reflection Panel */}
        <div className="lg:col-span-2 space-y-4">
          {selectedReflection ? (
            <>
              {/* Current Status Card */}
              <div className="bg-gradient-to-br from-emerald-900/30 to-blue-900/30 backdrop-blur-sm border-2 border-emerald-500/30 rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-2xl font-bold text-white flex items-center gap-2">
                      <span className="text-3xl">{getMoodEmoji(selectedReflection.mood)}</span>
                      Day {selectedReflection.session_number}
                    </h3>
                    <p className="text-gray-400 text-sm">
                      {new Date(selectedReflection.session_date).toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className={`text-3xl font-bold ${getMoodColor(selectedReflection.mood)}`}>
                      {selectedReflection.session_win_rate?.toFixed(1)}%
                    </div>
                    <div className="text-sm text-gray-400">Win Rate</div>
                  </div>
                </div>

                {/* Reflection Text */}
                <div className="bg-gray-900/50 rounded-lg p-4 mb-4">
                  <p className="text-gray-200 leading-relaxed">{selectedReflection.reflection_text}</p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-gray-900/30 rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-white">{selectedReflection.trades_count}</div>
                    <div className="text-xs text-gray-400">Trades</div>
                  </div>
                  <div className="bg-gray-900/30 rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-emerald-400">
                      {selectedReflection.session_profit_factor?.toFixed(2) || '0.00'}
                    </div>
                    <div className="text-xs text-gray-400">Profit Factor</div>
                  </div>
                  <div className="bg-gray-900/30 rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-blue-400">
                      {selectedReflection.on_track ? '✓' : '✗'}
                    </div>
                    <div className="text-xs text-gray-400">On Track</div>
                  </div>
                </div>
              </div>

              {/* Goal Progress */}
              {selectedReflection.current_goal && (
                <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-4">
                  <h4 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                    <Target className="w-5 h-5 text-yellow-400" />
                    Current Goal
                  </h4>
                  <div className="mb-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-gray-300">{selectedReflection.current_goal}</span>
                      <span className="text-emerald-400 font-semibold">
                        {selectedReflection.goal_progress_percentage?.toFixed(0) || 0}%
                      </span>
                    </div>
                    <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-500"
                        style={{ width: `${selectedReflection.goal_progress_percentage || 0}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Key Discoveries */}
              {selectedReflection.key_discoveries && selectedReflection.key_discoveries.length > 0 && (
                <div className="bg-gray-800/50 backdrop-blur-sm border border-emerald-900/50 rounded-lg p-4">
                  <h4 className="text-lg font-semibold text-emerald-400 mb-3 flex items-center gap-2">
                    <Lightbulb className="w-5 h-5" />
                    Key Discoveries
                  </h4>
                  <ul className="space-y-2">
                    {selectedReflection.key_discoveries.map((discovery: string, idx: number) => (
                      <li key={idx} className="flex items-start gap-2">
                        <Zap className="w-4 h-4 text-yellow-400 mt-1 flex-shrink-0" />
                        <span className="text-gray-300">{discovery}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Challenges */}
              {selectedReflection.challenges_faced && selectedReflection.challenges_faced.length > 0 && (
                <div className="bg-gray-800/50 backdrop-blur-sm border border-red-900/50 rounded-lg p-4">
                  <h4 className="text-lg font-semibold text-red-400 mb-3 flex items-center gap-2">
                    <AlertCircle className="w-5 h-5" />
                    Challenges
                  </h4>
                  <ul className="space-y-2">
                    {selectedReflection.challenges_faced.map((challenge: string, idx: number) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-red-400 mt-1">⚠</span>
                        <span className="text-gray-300">{challenge}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Tomorrow's Focus */}
              {selectedReflection.tomorrow_focus && selectedReflection.tomorrow_focus.length > 0 && (
                <div className="bg-gray-800/50 backdrop-blur-sm border border-blue-900/50 rounded-lg p-4">
                  <h4 className="text-lg font-semibold text-blue-400 mb-3 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5" />
                    Tomorrow's Focus
                  </h4>
                  <ul className="space-y-2">
                    {selectedReflection.tomorrow_focus.map((focus: string, idx: number) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-blue-400 mt-1">▸</span>
                        <span className="text-gray-300">{focus}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center py-20">
              <p className="text-gray-400">Select a session to view reflection</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

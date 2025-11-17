import React, { useState, useEffect } from 'react';
import { NavigationMenu } from '../components/NavigationMenu';
import SessionLearningDashboard from '../components/SessionLearningDashboard';
import PatternDiscoveryTimeline from '../components/PatternDiscoveryTimeline';
import StrategyArsenalDashboard from '../components/StrategyArsenalDashboard';
import AILearningDiagnosticsPanel from '../components/AILearningDiagnosticsPanel';
import AILearningProgressDashboard from '../components/AILearningProgressDashboard';
import { BookOpen, Sparkles, Target, Activity, Brain, TrendingUp, Zap } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

export default function SessionLearningsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'progress' | 'learnings' | 'patterns' | 'strategy-arsenal' | 'diagnostics'>('progress');
  const [recentBacktests, setRecentBacktests] = useState<any[]>([]);
  const [trainingStats, setTrainingStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTrainingData();

    // Set up real-time subscriptions for live updates
    const backtestChannel = supabase
      .channel('learning-center-backtests')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'backtest_sessions'
        },
        () => {
          console.log('[Learning Center] New backtest detected, reloading...');
          loadTrainingData();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'synthetic_backtest_sessions'
        },
        () => {
          console.log('[Learning Center] New synthetic backtest detected, reloading...');
          loadTrainingData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(backtestChannel);
    };
  }, []);

  const loadTrainingData = async () => {
    if (!user) return;

    setLoading(true);
    try {
      // Load recent backtest sessions
      const { data: realSessions } = await supabase
        .from('backtest_sessions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5);

      const { data: syntheticSessions } = await supabase
        .from('synthetic_backtest_sessions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5);

      // Tag and combine sessions
      const taggedReal = (realSessions || []).map(s => ({ ...s, sessionType: 'real', isAuto: s.session_name?.startsWith('Auto-BT-') }));
      const taggedSynthetic = (syntheticSessions || []).map(s => ({ ...s, sessionType: 'synthetic', isAuto: s.session_name?.startsWith('Auto-BT-') }));
      const combined = [...taggedReal, ...taggedSynthetic].sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setRecentBacktests(combined.slice(0, 5));

      // Load training statistics
      const { data: skillData } = await supabase
        .from('ai_skill_tracking')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: insightsCount } = await supabase
        .from('ai_learning_insights')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);

      const totalBacktests = (realSessions?.length || 0) + (syntheticSessions?.length || 0);
      const autoBacktests = combined.filter(s => s.isAuto).length;

      setTrainingStats({
        skillLevel: skillData?.skill_level || 0,
        totalInsights: insightsCount || 0,
        totalBacktests,
        autoBacktests,
        manualBacktests: totalBacktests - autoBacktests
      });

    } catch (error) {
      console.error('[Learning Center] Error loading training data:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <NavigationMenu />
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Page Header */}
        <div className="bg-gradient-to-br from-blue-900/30 to-purple-900/30 backdrop-blur-sm border-2 border-blue-500/30 rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <Brain className="w-10 h-10 text-blue-400" />
                <h1 className="text-3xl font-bold text-white">AI Learning Center</h1>
              </div>
              <p className="text-gray-300">
                Real-time insights, pattern discoveries, and continuous learning from AI Training Lab
              </p>
            </div>
            {!loading && trainingStats && (
              <div className="hidden lg:flex items-center gap-6">
                <div className="text-center">
                  <div className="text-3xl font-bold text-emerald-400">{trainingStats.skillLevel}%</div>
                  <div className="text-xs text-gray-400 uppercase">AI Skill Level</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-400">{trainingStats.totalBacktests}</div>
                  <div className="text-xs text-gray-400 uppercase">Total Training Sessions</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-400">{trainingStats.totalInsights}</div>
                  <div className="text-xs text-gray-400 uppercase">Learning Insights</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Recent Training Sessions */}
        {!loading && recentBacktests.length > 0 && (
          <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
              Recent Training Sessions from AI Lab
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {recentBacktests.map((session) => (
                <div key={session.id} className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-white font-semibold truncate" title={session.session_name}>
                      {session.session_name}
                    </span>
                    <div className="flex items-center gap-1">
                      {session.isAuto && (
                        <span className="px-2 py-0.5 bg-green-600 text-white text-xs font-bold rounded-full flex items-center gap-1">
                          <Zap className="w-3 h-3" />
                          AUTO
                        </span>
                      )}
                      {session.sessionType === 'synthetic' && (
                        <span className="px-2 py-0.5 bg-purple-600 text-white text-xs font-bold rounded-full">
                          SYNTHETIC
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">{session.total_trades} trades</span>
                    <span className={`font-bold ${
                      session.win_rate >= 55 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {session.win_rate.toFixed(1)}% win
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {new Date(session.created_at).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-2 flex gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('progress')}
            className={`flex-1 px-6 py-3 rounded-md font-semibold transition-all flex items-center justify-center gap-2 whitespace-nowrap ${
              activeTab === 'progress'
                ? 'bg-emerald-600 text-white shadow-lg'
                : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
            }`}
          >
            <Brain className="w-5 h-5" />
            AI Progress
          </button>
          <button
            onClick={() => setActiveTab('learnings')}
            className={`flex-1 px-6 py-3 rounded-md font-semibold transition-all flex items-center justify-center gap-2 whitespace-nowrap ${
              activeTab === 'learnings'
                ? 'bg-blue-600 text-white shadow-lg'
                : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
            }`}
          >
            <BookOpen className="w-5 h-5" />
            Daily Learnings
          </button>
          <button
            onClick={() => setActiveTab('patterns')}
            className={`flex-1 px-6 py-3 rounded-md font-semibold transition-all flex items-center justify-center gap-2 whitespace-nowrap ${
              activeTab === 'patterns'
                ? 'bg-green-600 text-white shadow-lg'
                : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
            }`}
          >
            <Sparkles className="w-5 h-5" />
            Patterns
          </button>
          <button
            onClick={() => setActiveTab('strategy-arsenal')}
            className={`flex-1 px-6 py-3 rounded-md font-semibold transition-all flex items-center justify-center gap-2 whitespace-nowrap ${
              activeTab === 'strategy-arsenal'
                ? 'bg-orange-600 text-white shadow-lg'
                : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
            }`}
          >
            <Target className="w-5 h-5" />
            Strategy Arsenal
          </button>
          <button
            onClick={() => setActiveTab('diagnostics')}
            className={`flex-1 px-6 py-3 rounded-md font-semibold transition-all flex items-center justify-center gap-2 whitespace-nowrap ${
              activeTab === 'diagnostics'
                ? 'bg-cyan-600 text-white shadow-lg'
                : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
            }`}
          >
            <Activity className="w-5 h-5" />
            System Diagnostics
          </button>
        </div>

        {/* Tab Content */}
        <div>
          {activeTab === 'progress' && user && <AILearningProgressDashboard />}
          {activeTab === 'learnings' && <SessionLearningDashboard />}
          {activeTab === 'patterns' && <PatternDiscoveryTimeline />}
          {activeTab === 'strategy-arsenal' && <StrategyArsenalDashboard />}
          {activeTab === 'diagnostics' && <AILearningDiagnosticsPanel />}
        </div>
      </div>
    </div>
  );
}

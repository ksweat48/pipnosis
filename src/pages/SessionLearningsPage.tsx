import React, { useState } from 'react';
import { NavigationMenu } from '../components/NavigationMenu';
import SessionLearningDashboard from '../components/SessionLearningDashboard';
import PatternDiscoveryTimeline from '../components/PatternDiscoveryTimeline';
import StrategyArsenalDashboard from '../components/StrategyArsenalDashboard';
import AILearningDiagnosticsPanel from '../components/AILearningDiagnosticsPanel';
import { BookOpen, Sparkles, Target, Activity } from 'lucide-react';

export default function SessionLearningsPage() {
  const [activeTab, setActiveTab] = useState<'learnings' | 'patterns' | 'strategy-arsenal' | 'diagnostics'>('learnings');

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <NavigationMenu />
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Page Header */}
        <div className="bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-6">
          <h1 className="text-3xl font-bold text-white mb-2">AI Learning Center</h1>
          <p className="text-gray-400">
            Daily insights, pattern discoveries, and continuous learning from trading sessions
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-2 flex gap-2">
          <button
            onClick={() => setActiveTab('learnings')}
            className={`flex-1 px-6 py-3 rounded-md font-semibold transition-all flex items-center justify-center gap-2 ${
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
            className={`flex-1 px-6 py-3 rounded-md font-semibold transition-all flex items-center justify-center gap-2 ${
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
            className={`flex-1 px-6 py-3 rounded-md font-semibold transition-all flex items-center justify-center gap-2 ${
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
            className={`flex-1 px-6 py-3 rounded-md font-semibold transition-all flex items-center justify-center gap-2 ${
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
          {activeTab === 'learnings' && <SessionLearningDashboard />}
          {activeTab === 'patterns' && <PatternDiscoveryTimeline />}
          {activeTab === 'strategy-arsenal' && <StrategyArsenalDashboard />}
          {activeTab === 'diagnostics' && <AILearningDiagnosticsPanel />}
        </div>
      </div>
    </div>
  );
}

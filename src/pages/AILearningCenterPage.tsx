import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Brain, Target, TrendingUp, Award, Activity, BarChart3 } from 'lucide-react';
import ConfidenceCalibrationDeepDive from '../components/ConfidenceCalibrationDeepDive';

function AILearningCenterPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'confidence' | 'patterns' | 'strategies' | 'performance'>('confidence');

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Brain className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">Please sign in to access the AI Learning Center</p>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'confidence', label: 'Confidence Analysis', icon: Target },
    { id: 'patterns', label: 'Pattern Discovery', icon: Activity },
    { id: 'strategies', label: 'Strategy Evolution', icon: TrendingUp },
    { id: 'performance', label: 'Performance Trends', icon: BarChart3 }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-br from-emerald-900/30 to-blue-900/30 backdrop-blur-sm border-2 border-emerald-500/30 rounded-lg shadow-md p-6 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <Brain className="w-10 h-10 text-emerald-400" />
            <h1 className="text-3xl font-bold text-white">AI Learning Center</h1>
          </div>
          <p className="text-gray-400">
            Deep dive into AI confidence, pattern discovery, and performance analytics
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-2 mb-6">
          <div className="flex gap-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg transition-all ${
                    isActive
                      ? 'bg-emerald-600 text-white shadow-lg'
                      : 'bg-gray-900/50 text-gray-400 hover:bg-gray-700 hover:text-white'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-semibold text-sm">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab Content */}
        <div className="space-y-6">
          {activeTab === 'confidence' && <ConfidenceCalibrationDeepDive userId={user.id} />}

          {activeTab === 'patterns' && (
            <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-8 text-center">
              <Activity className="w-16 h-16 text-gray-600 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-white mb-2">Pattern Discovery Timeline</h3>
              <p className="text-gray-400">Coming soon - Track pattern lifecycle across learning cycles</p>
            </div>
          )}

          {activeTab === 'strategies' && (
            <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-8 text-center">
              <TrendingUp className="w-16 h-16 text-gray-600 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-white mb-2">Strategy Evolution</h3>
              <p className="text-gray-400">Coming soon - Analyze strategy performance evolution</p>
            </div>
          )}

          {activeTab === 'performance' && (
            <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-8 text-center">
              <BarChart3 className="w-16 h-16 text-gray-600 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-white mb-2">Performance Trends</h3>
              <p className="text-gray-400">Coming soon - Comprehensive performance analytics</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AILearningCenterPage;

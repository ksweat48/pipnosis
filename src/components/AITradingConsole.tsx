import React from 'react';
import { SmartGoalPanel } from './SmartGoalPanel';
import { GoalSessionDashboard } from './GoalSessionDashboard';
import { Target } from 'lucide-react';

export function AITradingConsole() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-lg shadow-lg shadow-blue-500/30">
          <Target className="w-6 h-6 text-white" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-white">AI Trading Console</h3>
          <p className="text-sm text-gray-400">Set goals and let AI work toward achieving them</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <SmartGoalPanel />
        </div>

        <div className="lg:col-span-2">
          <GoalSessionDashboard />
        </div>
      </div>

      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
        <h4 className="text-lg font-semibold text-white mb-4">How AI Trading Works</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-2">
            <h5 className="text-sm font-semibold text-blue-400">Set Your Goal</h5>
            <p className="text-xs text-gray-400 leading-relaxed">
              Tell the AI what you want to achieve using natural language or quick templates.
            </p>
          </div>
          <div className="space-y-2">
            <h5 className="text-sm font-semibold text-blue-400">AI Analyzes & Acts</h5>
            <p className="text-xs text-gray-400 leading-relaxed">
              The AI continuously scans markets and forecasts opportunities to reach your goal.
            </p>
          </div>
          <div className="space-y-2">
            <h5 className="text-sm font-semibold text-blue-400">Track Progress</h5>
            <p className="text-xs text-gray-400 leading-relaxed">
              Monitor real-time updates, insights, and performance until your goal is achieved.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

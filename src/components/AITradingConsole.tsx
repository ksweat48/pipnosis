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
    </div>
  );
}

import React from 'react';
import { SmartGoalPanel } from './SmartGoalPanel';
import { GoalSessionDashboard } from './GoalSessionDashboard';

export function AITradingConsole() {
  return (
    <div className="p-4">
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

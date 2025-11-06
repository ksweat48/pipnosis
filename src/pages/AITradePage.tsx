import React from 'react';
import { NavigationMenu } from '@/components/NavigationMenu';
import { SmartGoalPanel } from '@/components/SmartGoalPanel';
import { GoalSessionDashboard } from '@/components/GoalSessionDashboard';

export function AITradePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950">
      <NavigationMenu />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">AI Trade</h1>
          <p className="text-gray-400 text-lg">Let AI analyze markets and execute your trading goals autonomously</p>
        </div>

        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1">
              <SmartGoalPanel />
            </div>

            <div className="lg:col-span-2">
              <GoalSessionDashboard />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

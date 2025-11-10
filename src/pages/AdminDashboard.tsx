import React, { useState } from 'react';
import { NavigationMenu } from '@/components/NavigationMenu';
import { DataManagementPanel } from '@/components/DataManagementPanel';
import { CandleAggregatorStatus } from '@/components/CandleAggregatorStatus';
import { PersistentPollingStatus } from '@/components/PersistentPollingStatus';
import { PollingHealthDashboard } from '@/components/PollingHealthDashboard';
import { ServerSideCandleMonitor } from '@/components/ServerSideCandleMonitor';
import APIUsageMonitor from '@/components/APIUsageMonitor';
import { Database, BarChart3, Settings, Activity, Heart } from 'lucide-react';

type AdminTab = 'data' | 'analytics' | 'api-usage' | 'polling-health' | 'settings';

export function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<AdminTab>('data');

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950">
      <NavigationMenu />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-3xl font-bold text-white mb-6">Admin Dashboard</h1>

        <div className="flex gap-2 mb-6 overflow-x-auto">
          <button
            onClick={() => setActiveTab('polling-health')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === 'polling-health'
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <Heart size={18} />
            Polling Health
          </button>
          <button
            onClick={() => setActiveTab('data')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === 'data'
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <Database size={18} />
            Data Management
          </button>
          <button
            onClick={() => setActiveTab('api-usage')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === 'api-usage'
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <Activity size={18} />
            API Usage
          </button>
          <button
            onClick={() => setActiveTab('analytics')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === 'analytics'
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <BarChart3 size={18} />
            Analytics
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === 'settings'
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <Settings size={18} />
            Settings
          </button>
        </div>

        {activeTab === 'polling-health' && (
          <PollingHealthDashboard />
        )}

        {activeTab === 'data' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <CandleAggregatorStatus />
              <PersistentPollingStatus />
            </div>
            <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <Activity size={20} className="text-emerald-400" />
                <h2 className="text-xl font-semibold text-white">System Monitoring</h2>
              </div>
              <ServerSideCandleMonitor />
            </div>
            <DataManagementPanel />
          </div>
        )}

        {activeTab === 'api-usage' && (
          <APIUsageMonitor />
        )}

        {activeTab === 'analytics' && (
          <div className="glass-card p-6">
            <div className="text-gray-400">Analytics coming soon</div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="glass-card p-6">
            <div className="text-gray-400">Settings coming soon</div>
          </div>
        )}
      </main>
    </div>
  );
}

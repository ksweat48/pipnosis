import React from 'react';
import { Header } from '../components/Header';
import StrategyArsenalDashboard from '../components/StrategyArsenalDashboard';
import { Brain, Target } from 'lucide-react';

export default function StrategyArsenalPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black text-white">
      <Header />

      <main className="container mx-auto px-4 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-blue-500 rounded-lg flex items-center justify-center">
              <Target className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
                Strategy Arsenal
              </h1>
              <p className="text-gray-400 mt-1">
                AI-discovered trading strategies that match or exceed Flow Trader V2 performance
              </p>
            </div>
          </div>

          {/* Info Banner */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Brain className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-gray-300">
                <p className="font-semibold text-blue-400 mb-1">How It Works</p>
                <p>
                  The AI analyzes your trading patterns during backtests and live trading to discover new strategies.
                  Only strategies that beat the Flow Trader V2 baseline (55%+ win rate, 1.5+ profit factor) are shown here.
                  The AI also evolves existing strategies by optimizing parameters and adapting to market regimes.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Strategy Arsenal Dashboard */}
        <StrategyArsenalDashboard />
      </main>
    </div>
  );
}

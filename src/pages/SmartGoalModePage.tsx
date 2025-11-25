import React from 'react';
import { SmartGoalPanel } from '../components/SmartGoalPanel';
import { GoalSessionDashboard } from '../components/GoalSessionDashboard';
import { ToastContainer } from '../components/ToastNotification';
import { useToast } from '../hooks/useToast';

export const SmartGoalModePage: React.FC = () => {
  const toast = useToast();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <ToastContainer toasts={toast.toasts} onRemove={toast.removeToast} />
      <div className="max-w-full mx-auto px-2 py-6">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">Smart Goal Mode</h1>
          <p className="text-gray-400 text-lg">
            AI-driven trading goals that work around the clock to achieve your targets
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="lg:col-span-1">
            <SmartGoalPanel />
          </div>

          <div className="lg:col-span-1">
            <GoalSessionDashboard />
          </div>
        </div>

        <div className="mt-6 bg-gray-800 rounded-lg p-4 border border-gray-700">
          <h3 className="text-xl font-bold text-white mb-4">How It Works</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="text-3xl font-bold text-blue-400 mb-2">1</div>
              <h4 className="text-lg font-semibold text-white mb-2">Set Your Goal</h4>
              <p className="text-sm text-gray-400">
                Tell me what you want to achieve: a dollar amount, percentage gain, or timeframe goal.
              </p>
            </div>
            <div>
              <div className="text-3xl font-bold text-blue-400 mb-2">2</div>
              <h4 className="text-lg font-semibold text-white mb-2">AI Analyzes Markets</h4>
              <p className="text-sm text-gray-400">
                I continuously scan markets, forecast opportunities, and alert you when high-quality setups appear.
              </p>
            </div>
            <div>
              <div className="text-3xl font-bold text-blue-400 mb-2">3</div>
              <h4 className="text-lg font-semibold text-white mb-2">Track Progress</h4>
              <p className="text-sm text-gray-400">
                Get real-time updates, progress tracking, and performance insights until your goal is achieved.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 bg-blue-900/20 border border-blue-700 rounded-lg p-4">
          <h4 className="text-lg font-semibold text-blue-400 mb-3">What Makes This Different?</h4>
          <ul className="space-y-2 text-sm text-gray-300">
            <li className="flex items-start gap-2">
              <span className="text-blue-400 mt-1">•</span>
              <span><strong className="text-white">Always Active:</strong> Even when markets are quiet, I'm forecasting the next opportunity</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-400 mt-1">•</span>
              <span><strong className="text-white">Risk-Aware:</strong> Every trade is sized and evaluated based on your goal and risk tolerance</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-400 mt-1">•</span>
              <span><strong className="text-white">Educational:</strong> Learn what's working through AI insights and performance analytics</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-400 mt-1">•</span>
              <span><strong className="text-white">Transparent:</strong> See exactly why each trade is recommended with clear reasoning</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};

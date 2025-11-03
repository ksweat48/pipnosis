import React, { useState, useEffect } from 'react';
import { Target, TrendingUp, Clock, AlertCircle, Loader2 } from 'lucide-react';
import { goalSessionManager, GoalSessionConfig } from '../services/goal-session-manager';
import { useAuth } from '../hooks/useAuth';

interface GoalTemplate {
  label: string;
  prompt: string;
  config: Partial<GoalSessionConfig>;
}

const GOAL_TEMPLATES: GoalTemplate[] = [
  {
    label: 'Quick $100 Today',
    prompt: 'Make me $100 today',
    config: { goalType: 'profit_target', targetValue: 100, timeframe: '1 day', riskMode: 'medium' }
  },
  {
    label: 'Weekly $500 Target',
    prompt: 'Earn $500 this week',
    config: { goalType: 'profit_target', targetValue: 500, timeframe: '1 week', riskMode: 'medium' }
  },
  {
    label: '5% Growth Goal',
    prompt: 'Grow my account by 5% this month',
    config: { goalType: 'percentage_gain', targetValue: 5, timeframe: '1 month', riskMode: 'low' }
  },
  {
    label: 'Aggressive Daily',
    prompt: 'Make me $200 today',
    config: { goalType: 'profit_target', targetValue: 200, timeframe: '1 day', riskMode: 'high' }
  },
];

export const SmartGoalPanel: React.FC = () => {
  const { user } = useAuth();
  const [goalPrompt, setGoalPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [parsedGoal, setParsedGoal] = useState<Partial<GoalSessionConfig> | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customConfig, setCustomConfig] = useState<Partial<GoalSessionConfig>>({
    riskMode: 'medium',
    autoExecute: false,
  });

  useEffect(() => {
    if (goalPrompt.trim()) {
      const parsed = goalSessionManager.parseNaturalLanguageGoal(goalPrompt);
      setParsedGoal(parsed);
    } else {
      setParsedGoal(null);
    }
  }, [goalPrompt]);

  const handleTemplateClick = (template: GoalTemplate) => {
    setGoalPrompt(template.prompt);
    setParsedGoal(template.config);
  };

  const handleCreateSession = async () => {
    if (!user || !parsedGoal) return;

    setLoading(true);
    setError('');

    try {
      const config: GoalSessionConfig = {
        goalType: parsedGoal.goalType || 'profit_target',
        targetValue: parsedGoal.targetValue || 100,
        timeframe: parsedGoal.timeframe || '1 day',
        riskMode: customConfig.riskMode || parsedGoal.riskMode || 'medium',
        autoExecute: customConfig.autoExecute || false,
        watchlist: customConfig.watchlist || ['XAUUSD', 'EURUSD', 'GBPUSD'],
      };

      const session = await goalSessionManager.createSession(user.id, config);

      if (session) {
        window.dispatchEvent(new CustomEvent('goal-session-created', { detail: session }));
        setGoalPrompt('');
        setParsedGoal(null);
      } else {
        setError('Failed to create goal session. Please try again.');
      }
    } catch (err) {
      console.error('Error creating session:', err);
      setError('An error occurred while creating your goal session.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-blue-600 rounded-lg">
          <Target className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Smart Goal Mode</h2>
          <p className="text-sm text-gray-400">Tell me your trading goal and I'll make it happen</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {GOAL_TEMPLATES.map((template, index) => (
            <button
              key={index}
              onClick={() => handleTemplateClick(template)}
              className="px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-left transition-colors border border-gray-600 hover:border-blue-500"
            >
              <div className="text-sm font-medium text-white">{template.label}</div>
              <div className="text-xs text-gray-400 mt-1">{template.prompt}</div>
            </button>
          ))}
        </div>

        <div className="relative">
          <input
            type="text"
            value={goalPrompt}
            onChange={(e) => setGoalPrompt(e.target.value)}
            placeholder="e.g., 'Make me $100 today' or 'Earn 3% this week'"
            className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
          />
          <TrendingUp className="absolute right-3 top-3 w-5 h-5 text-gray-500" />
        </div>

        {parsedGoal && (
          <div className="bg-gray-700 rounded-lg p-4 border border-green-600">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-green-400 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-medium text-green-400 mb-2">Goal Understood!</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-gray-400">Type:</span>
                    <span className="text-white ml-2">{parsedGoal.goalType === 'profit_target' ? 'Profit Target' : 'Percentage Gain'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Target:</span>
                    <span className="text-white ml-2">
                      {parsedGoal.goalType === 'profit_target' ? `$${parsedGoal.targetValue}` : `${parsedGoal.targetValue}%`}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400">Timeframe:</span>
                    <span className="text-white ml-2">{parsedGoal.timeframe}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Risk:</span>
                    <span className="text-white ml-2 capitalize">{customConfig.riskMode}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-sm text-blue-400 hover:text-blue-300"
          >
            {showAdvanced ? 'Hide' : 'Show'} Advanced Options
          </button>

          {showAdvanced && (
            <div className="mt-3 space-y-3 p-4 bg-gray-700 rounded-lg">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Risk Mode</label>
                <select
                  value={customConfig.riskMode}
                  onChange={(e) => setCustomConfig({ ...customConfig, riskMode: e.target.value as any })}
                  className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded text-white"
                >
                  <option value="low">Low Risk (3% capital per trade, 80% confidence)</option>
                  <option value="medium">Medium Risk (5% capital per trade, 70% confidence)</option>
                  <option value="high">High Risk (10% capital per trade, 60% confidence)</option>
                </select>
              </div>

              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={customConfig.autoExecute}
                    onChange={(e) => setCustomConfig({ ...customConfig, autoExecute: e.target.checked })}
                    className="w-4 h-4 text-blue-600 bg-gray-600 border-gray-500 rounded"
                  />
                  <span className="text-sm text-gray-300">Auto-execute trades (requires approval first time)</span>
                </label>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-600 rounded-lg p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <button
          onClick={handleCreateSession}
          disabled={!parsedGoal || loading}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-medium text-white transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Activating AI Goal Mode...
            </>
          ) : (
            <>
              <Target className="w-5 h-5" />
              Start Goal Session
            </>
          )}
        </button>
      </div>
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { Target, TrendingUp, Clock, AlertCircle, Loader2, Zap, AlertTriangle, CheckCircle } from 'lucide-react';
import { smartGoalSessionManager, SmartGoalConfig } from '../services/smart-goal-session-manager';
import { PIPNOSIS_CORE_RULES } from '../lib/pipnosis-core-rules';
import { aiGoalParser } from '../lib/aiGoalParser';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';

interface GoalTemplate {
  label: string;
  prompt: string;
  description: string;
}

const GOAL_TEMPLATES: GoalTemplate[] = [
  {
    label: 'Quick $100 Today',
    prompt: 'Make me $100 today with moderate exposure',
    description: '1 high-quality trade, backup trades if needed'
  },
  {
    label: 'Weekly $500 Target',
    prompt: 'Earn $500 this week with moderate exposure',
    description: '1 premium trade per day, more if needed'
  },
  {
    label: 'Conservative $50',
    prompt: 'Make me $50 today with conservative exposure',
    description: 'Conservative capital exposure, patient AI'
  },
  {
    label: 'Fast $200 Today',
    prompt: 'Make me $200 today with aggressive exposure',
    description: 'Aggressive capital exposure, autonomous AI'
  },
];

interface ValidationResult {
  isRealistic: boolean;
  warnings: string[];
  suggestions: string[];
}

export const SmartGoalPanel: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();
  const [goalPrompt, setGoalPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [accountBalance] = useState(10000);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [showWarning, setShowWarning] = useState(true);
  const [parsedGoal, setParsedGoal] = useState<any>(null);

  useEffect(() => {
    const validateGoal = async () => {
      if (!goalPrompt.trim()) {
        setValidation(null);
        setParsedGoal(null);
        setShowWarning(true);
        return;
      }

      try {
        const parsed = await aiGoalParser.parseGoal(goalPrompt, accountBalance);
        setParsedGoal(parsed);

        const validationResult = await aiGoalParser.validateGoal(parsed.config, accountBalance);
        setValidation(validationResult);
        setShowWarning(true);
      } catch (err) {
        console.error('Validation error:', err);
        setValidation(null);
      }
    };

    const debounceTimer = setTimeout(validateGoal, 500);
    return () => clearTimeout(debounceTimer);
  }, [goalPrompt, accountBalance]);

  const handleTemplateClick = (template: GoalTemplate) => {
    setGoalPrompt(template.prompt);
  };

  const handleCreateSession = async () => {
    if (!user || !goalPrompt.trim()) return;

    setLoading(true);
    setError('');

    try {
      const session = await smartGoalSessionManager.createSmartGoalSession(
        user.id,
        goalPrompt,
        accountBalance
      );

      if (session) {
        window.dispatchEvent(new CustomEvent('goal-session-created', { detail: session }));
        setGoalPrompt('');

        toast.success(
          'Goal Session Started!',
          `Target: $${session.config.goalAmount} • ${session.strategy.targetTradeCount} trades • Autonomous AI brain with live demo monitoring`,
          8000
        );
      } else {
        toast.error('Session Failed', 'Failed to create goal session');
        setError('Failed to create goal session.');
      }
    } catch (err) {
      console.error('Error creating session:', err);
      toast.error('Error', 'An error occurred while creating your goal session');
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
        <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-3 mb-3">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-semibold text-blue-400">Short-Term Trading Mode</span>
          </div>
          <p className="text-xs text-gray-300">
            Pipnosis specializes in trades lasting <strong>minutes to hours</strong>, never overnight.
            <strong>Pipnosis will always try to complete your goal in ONE trade</strong>, but may use several trades if needed depending on markets and the goal itself.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {GOAL_TEMPLATES.map((template, index) => (
            <button
              key={index}
              onClick={() => handleTemplateClick(template)}
              className="px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-left transition-colors border border-gray-600 hover:border-blue-500"
            >
              <div className="text-sm font-medium text-white">{template.label}</div>
              <div className="text-xs text-gray-400 mt-1">{template.description}</div>
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

        {goalPrompt.trim() && validation && !validation.isRealistic && showWarning && (
          <div className="bg-yellow-900/30 border border-yellow-600 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <div className="text-sm font-bold text-yellow-400 mb-2">Goal Assessment</div>
                {parsedGoal && (
                  <div className="text-xs text-gray-300 mb-3 pb-3 border-b border-yellow-600/30">
                    <p><strong>Your Request:</strong> {parsedGoal.interpretation}</p>
                    <p className="mt-1"><strong>Account Balance:</strong> ${accountBalance.toLocaleString()}</p>
                  </div>
                )}

                <div className="space-y-2 mb-3">
                  <div className="text-xs font-semibold text-yellow-300">Reality Check:</div>
                  {validation.warnings.map((warning, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-xs text-yellow-200">
                      <span className="text-yellow-400 mt-0.5">⚠</span>
                      <span>{warning}</span>
                    </div>
                  ))}
                </div>

                <div className="space-y-2 mb-3">
                  <div className="text-xs font-semibold text-green-300">Recommended Alternatives:</div>
                  {validation.suggestions.map((suggestion, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-xs text-gray-300">
                      <CheckCircle className="w-3 h-3 text-green-400 mt-0.5 flex-shrink-0" />
                      <span>{suggestion}</span>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 mt-3 pt-3 border-t border-yellow-600/30">
                  <button
                    onClick={() => setShowWarning(false)}
                    className="flex-1 px-3 py-2 bg-yellow-600/20 hover:bg-yellow-600/30 border border-yellow-600 rounded text-xs font-medium text-yellow-200 transition-colors"
                  >
                    I Understand - Proceed Anyway
                  </button>
                  <button
                    onClick={() => setGoalPrompt('')}
                    className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded text-xs font-medium text-gray-300 transition-colors"
                  >
                    Adjust My Goal
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {goalPrompt.trim() && validation && validation.isRealistic && (
          <div className="bg-green-900/20 border border-green-600 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-400 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-medium text-green-400 mb-2">Realistic Goal - Ready to Start!</div>
                {parsedGoal && (
                  <div className="text-xs text-gray-300 mb-2">
                    <p><strong>Target:</strong> {parsedGoal.interpretation}</p>
                  </div>
                )}
                <div className="text-xs text-gray-300">
                  <p className="mb-2">Pipnosis will try to achieve your goal efficiently:</p>
                  <ul className="space-y-1 ml-4 list-disc">
                    <li>Each trade lasts minutes to hours (max {PIPNOSIS_CORE_RULES.TRADE_DURATION_MAX_HOURS}h)</li>
                    <li>Scans markets every {PIPNOSIS_CORE_RULES.SCAN_FREQUENCY_MINUTES} minutes for best setups</li>
                    <li>1-3 minute countdown before auto-execution</li>
                    <li>All positions close before end of day</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {goalPrompt.trim() && validation && !validation.isRealistic && !showWarning && (
          <div className="bg-gray-700/50 border border-gray-600 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-gray-400 mt-0.5" />
              <div className="text-xs text-gray-300">
                <p className="font-medium text-gray-200 mb-1">Proceeding with high-risk goal</p>
                <p>AI will do its best, but success probability is low. Each trade protected by 5% max risk limit.</p>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-900/30 border border-red-600 rounded-lg p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <button
          onClick={handleCreateSession}
          disabled={!goalPrompt.trim() || loading || (validation && !validation.isRealistic && showWarning)}
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
              {validation && !validation.isRealistic && showWarning ? 'Review Warning Above' : 'Start Goal Session'}
            </>
          )}
        </button>
      </div>
    </div>
  );
};

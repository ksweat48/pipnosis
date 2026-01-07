/**
 * SMART GOAL PANEL
 *
 * ARCHITECTURE PRINCIPLE: Risk and Style are INDEPENDENT dimensions
 *
 * Quick prompt buttons communicate:
 * - Conservative/Moderate/Aggressive: Money exposure level (0.3-3% risk per trade)
 * - "Quick Scalp": Time style preference (fast entries/exits)
 *
 * CRITICAL: These are NOT coupled in the UI messaging:
 * - "Conservative" = Low $ risk, Alpha chooses style (Intraday-only)
 * - "Aggressive" = High $ risk, Alpha chooses style (Intraday-only)
 * - "Quick Scalp" = Fast style preference, Alpha determines risk level
 *
 * Users understand they can be conservative with money while still scalping,
 * or aggressive with money while trading patiently. The two dimensions are independent.
 * All trades are INTRADAY-ONLY (20min to 10hrs).
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Target, TrendingUp, Clock, AlertCircle, Loader2, Zap, AlertTriangle, CheckCircle, Sparkles, ChevronDown, Shield } from 'lucide-react';
import { smartGoalSessionManager, SmartGoalConfig } from '../services/smart-goal-session-manager';
import { PIPNOSIS_CORE_RULES } from '../lib/pipnosis-core-rules';
import { aiGoalParser } from '../lib/aiGoalParser';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { supabase } from '../lib/supabase';
import { getRiskPercentage, getRiskModeDescription } from '../config/risk-levels';

interface GoalTemplate {
  label: string;
  prompt: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
}

/**
 * Calculate dynamic goal amounts based on user's account balance
 * Ensures goals are realistic and scale with account size
 */
const calculateDynamicGoalAmounts = (balance: number) => {
  // Conservative: 0.5% of balance (min $10, max $100)
  const conservative = Math.max(10, Math.min(100, Math.round(balance * 0.005)));

  // Moderate: 1% of balance (min $25, max $250)
  const moderate = Math.max(25, Math.min(250, Math.round(balance * 0.01)));

  // Quick Scalp: 2% of balance (min $50, max $500)
  const quickScalp = Math.max(50, Math.min(500, Math.round(balance * 0.02)));

  // Aggressive: 3% of balance (min $75, max $750)
  const aggressive = Math.max(75, Math.min(750, Math.round(balance * 0.03)));

  return { conservative, moderate, quickScalp, aggressive };
};

/**
 * Generate dynamic goal templates based on user's balance
 */
const generateGoalTemplates = (balance: number): GoalTemplate[] => {
  const amounts = calculateDynamicGoalAmounts(balance);

  return [
    {
      label: `Conservative $${amounts.conservative}`,
      prompt: `Make me $${amounts.conservative} today with conservative exposure, close all positions before market close`,
      description: 'Low money exposure (0.3-0.8% risk), Alpha chooses style',
      riskLevel: 'low'
    },
    {
      label: `Moderate $${amounts.moderate}`,
      prompt: `Make me $${amounts.moderate} today with moderate exposure, close all positions before market close`,
      description: 'Balanced exposure (0.5-1.5% risk), Alpha chooses style',
      riskLevel: 'medium'
    },
    {
      label: `Quick Scalp $${amounts.quickScalp}`,
      prompt: `Find me a quick scalp move for $${amounts.quickScalp} today, fast entry and exit, close before market close`,
      description: 'Fast scalp-style preference, Alpha determines risk',
      riskLevel: 'high'
    },
    {
      label: `Aggressive $${amounts.aggressive}`,
      prompt: `Make me $${amounts.aggressive} today with aggressive exposure, close all positions before market close`,
      description: 'High money exposure (1-3% risk), Alpha chooses style',
      riskLevel: 'high'
    },
  ];
};

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
  const [accountBalance, setAccountBalance] = useState(10000);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [showWarning, setShowWarning] = useState(true);
  const [parsedGoal, setParsedGoal] = useState<any>(null);
  const [isTradingModeExpanded, setIsTradingModeExpanded] = useState(false);
  const [multiTradeEnabled, setMultiTradeEnabled] = useState(false);
  const [loadingPreferences, setLoadingPreferences] = useState(true);

  // Generate dynamic templates based on current balance
  const goalTemplates = useMemo(() => generateGoalTemplates(accountBalance), [accountBalance]);

  useEffect(() => {
    const loadUserPreferences = async () => {
      if (!user) {
        setLoadingPreferences(false);
        return;
      }

      try {
        // CRITICAL FIX: Load ACTUAL user balance from database, not hardcoded $10k
        const { data, error } = await supabase
          .from('user_profiles')
          .select('trading_preferences, account_balance')
          .eq('id', user.id)
          .maybeSingle();

        if (error) {
          console.error('Error loading user preferences:', error);
        } else if (data) {
          setMultiTradeEnabled(data.trading_preferences?.multiTradeMode ?? false);
          // Set actual account balance
          setAccountBalance(parseFloat(data.account_balance || '10000'));
        }
      } catch (err) {
        console.error('Error loading preferences:', err);
      } finally {
        setLoadingPreferences(false);
      }
    };

    loadUserPreferences();
  }, [user]);

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
      // Check if trading is enabled platform-wide
      const { data: tradingStatus } = await supabase.rpc('is_trading_enabled');

      if (tradingStatus === false) {
        toast.error(
          'Trading Temporarily Disabled',
          'We are currently upgrading and improving Pipnosis. Trading will be back live soon.',
          10000
        );
        setError('We are currently upgrading and improving Pipnosis. Trading will be back live soon.');
        setLoading(false);
        return;
      }

      const session = await smartGoalSessionManager.createSmartGoalSession(
        user.id,
        goalPrompt,
        accountBalance,
        multiTradeEnabled
      );

      if (session) {
        window.dispatchEvent(new CustomEvent('goal-session-created', { detail: session }));
        setGoalPrompt('');

        const modeText = multiTradeEnabled ? 'Multi-Trade Mode ON' : 'Single-Trade Mode';
        toast.success(
          'Goal Session Started!',
          `Target: $${session.config.goalAmount} • ${session.strategy.targetTradeCount} trades • ${modeText}`,
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
    <div className="relative group">
      <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-xl opacity-20 group-hover:opacity-40 transition duration-300 blur" />

      <div className="relative bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-xl p-6 border border-gray-700/50 shadow-2xl">
        <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {goalTemplates.map((template, index) => (
            <button
              key={index}
              onClick={() => handleTemplateClick(template)}
              className="group relative px-4 py-4 bg-gradient-to-br from-gray-700/50 to-gray-800/50 hover:from-gray-600/50 hover:to-gray-700/50 backdrop-blur-sm rounded-xl text-left transition-all duration-300 border border-gray-600/50 hover:border-emerald-500/50 hover:shadow-lg hover:shadow-emerald-500/10 hover:scale-105"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/0 to-blue-500/0 group-hover:from-emerald-500/5 group-hover:to-blue-500/5 rounded-xl transition-all duration-300" />
              <div className="relative">
                <div className="text-sm font-semibold text-white group-hover:text-emerald-300 transition-colors">{template.label}</div>
                <div className="text-xs text-gray-400 group-hover:text-gray-300 mt-1.5 transition-colors">{template.description}</div>
              </div>
            </button>
          ))}
        </div>

        <div className="relative group">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-xl opacity-0 group-focus-within:opacity-20 transition duration-300 blur" />
          <input
            type="text"
            value={goalPrompt}
            onChange={(e) => setGoalPrompt(e.target.value)}
            placeholder="e.g., 'Make me $150 today' or 'Find a quick scalp for $75'"
            className="relative w-full px-4 py-4 bg-gray-800/50 backdrop-blur-sm border border-gray-600/50 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 transition-all duration-300"
          />
          <TrendingUp className="absolute right-4 top-4 w-5 h-5 text-gray-500 group-focus-within:text-emerald-400 transition-colors" />
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
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-green-400">Realistic Goal - Ready to Start!</div>
                  {parsedGoal?.config?.riskMode && (
                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                      parsedGoal.config.riskMode === 'low'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : parsedGoal.config.riskMode === 'medium'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : 'bg-red-500/20 text-red-300 border border-red-500/30'
                    }`}>
                      <Shield className="w-3.5 h-3.5" />
                      {parsedGoal.config.riskMode === 'low' ? 'Low Risk' : parsedGoal.config.riskMode === 'medium' ? 'Medium Risk' : 'High Risk'}
                      <span className="text-[10px] opacity-75">
                        ({getRiskPercentage(parsedGoal.config.riskMode)}% per trade)
                      </span>
                    </div>
                  )}
                </div>
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

        <div className="relative group">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500 via-blue-500 to-emerald-500 rounded-xl opacity-70 group-hover:opacity-100 transition duration-300 blur" />
          <button
            onClick={handleCreateSession}
            disabled={!goalPrompt.trim() || loading || loadingPreferences || (validation && !validation.isRealistic && showWarning)}
            className="relative w-full py-4 bg-gradient-to-r from-emerald-600 to-blue-600 hover:from-emerald-500 hover:to-blue-500 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed rounded-xl font-semibold text-white transition-all duration-300 flex items-center justify-center gap-2 shadow-lg hover:shadow-emerald-500/25 hover:scale-[1.02] active:scale-[0.98]"
          >
            {loading || loadingPreferences ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="animate-pulse">
                  {loadingPreferences ? 'Loading preferences...' : 'Activating AI Goal Mode...'}
                </span>
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
      </div>
    </div>
  );
};

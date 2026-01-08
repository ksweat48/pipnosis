/**
 * SMART GOAL PANEL - Trade Styles System
 *
 * INTRADAY-ONLY PLATFORM: All trades close before market close
 *
 * NEW ARCHITECTURE: 2-Step Goal Creation Flow
 *
 * Step 1: Choose Trading Style (scalper, micro, intraday)
 * Step 2: Pick Dollar Amount to risk per trade
 *
 * RISK POLICY: Risk up to 10% per trade, 20% total exposure
 * - Style determines trade duration and patience
 * - Dollar amount determines position sizing
 * - Alpha Brain handles everything else intelligently
 *
 * NO SWING TRADES ALLOWED - Pipnosis is intraday-only
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Target, Clock, AlertCircle, Loader2, Zap, CheckCircle, Shield, ArrowLeft } from 'lucide-react';
import { smartGoalSessionManager } from '../services/smart-goal-session-manager';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { supabase } from '../lib/supabase';
import { TRADE_STYLES, TradeStyle, calculateSuggestedAmounts, validateDollarAmount } from '../config/trade-styles';

const STYLE_ICONS = {
  Zap,
  Target,
  Clock,
};

type Step = 'style' | 'amount';

export const SmartGoalPanel: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();
  const [currentStep, setCurrentStep] = useState<Step>('style');
  const [selectedStyle, setSelectedStyle] = useState<TradeStyle | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [accountBalance, setAccountBalance] = useState(10000);
  const [loadingPreferences, setLoadingPreferences] = useState(true);
  const [multiTradeEnabled, setMultiTradeEnabled] = useState(false);

  useEffect(() => {
    const loadUserPreferences = async () => {
      if (!user) {
        setLoadingPreferences(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('user_profiles')
          .select('trading_preferences, account_balance')
          .eq('id', user.id)
          .maybeSingle();

        if (error) {
          console.error('Error loading user preferences:', error);
        } else if (data) {
          setMultiTradeEnabled(data.trading_preferences?.multiTradeMode ?? false);
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

  const suggestedAmounts = useMemo(() => {
    if (!selectedStyle) return null;
    return calculateSuggestedAmounts(accountBalance, selectedStyle);
  }, [selectedStyle, accountBalance]);

  const amountValidation = useMemo(() => {
    const amount = parseFloat(customAmount);
    if (isNaN(amount) || amount <= 0) return null;
    return validateDollarAmount(amount, accountBalance);
  }, [customAmount, accountBalance]);

  const handleStyleSelection = (style: TradeStyle) => {
    setSelectedStyle(style);
    setCurrentStep('amount');
    setCustomAmount('');
    setError('');
  };

  const handleAmountSelection = (amount: number) => {
    setCustomAmount(amount.toString());
  };

  const handleBack = () => {
    setCurrentStep('style');
    setSelectedStyle(null);
    setCustomAmount('');
    setError('');
  };

  const handleCreateSession = async () => {
    if (!user || !selectedStyle || !customAmount) return;

    const dollarRisk = parseFloat(customAmount);
    const validation = validateDollarAmount(dollarRisk, accountBalance);

    if (!validation.valid) {
      setError(validation.error || 'Invalid dollar amount');
      return;
    }

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
        `Make me money using ${TRADE_STYLES[selectedStyle].displayName} style with $${dollarRisk} risk per trade`,
        accountBalance,
        multiTradeEnabled,
        selectedStyle,
        dollarRisk
      );

      if (session) {
        window.dispatchEvent(new CustomEvent('goal-session-created', { detail: session }));
        setSelectedStyle(null);
        setCustomAmount('');
        setCurrentStep('style');

        const styleConfig = TRADE_STYLES[selectedStyle];
        const modeText = multiTradeEnabled ? 'Multi-Trade Mode ON' : 'Single-Trade Mode';
        toast.success(
          'Goal Session Started!',
          `Style: ${styleConfig.displayName} • Risk: $${dollarRisk}/trade • ${modeText}`,
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

  const selectedConfig = selectedStyle ? TRADE_STYLES[selectedStyle] : null;
  const IconComponent = selectedConfig ? STYLE_ICONS[selectedConfig.icon as keyof typeof STYLE_ICONS] : null;

  return (
    <div className="relative group">
      <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-xl opacity-20 group-hover:opacity-40 transition duration-300 blur" />

      <div className="relative bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-xl p-6 border border-gray-700/50 shadow-2xl">
        {/* Step 1: Choose Trading Style */}
        {currentStep === 'style' && (
          <div className="space-y-4">
            <div className="text-center mb-6">
              <h3 className="text-lg font-bold text-white mb-2">Choose Your Trading Style</h3>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {(Object.keys(TRADE_STYLES) as TradeStyle[]).map((style) => {
                const config = TRADE_STYLES[style];
                const Icon = STYLE_ICONS[config.icon as keyof typeof STYLE_ICONS];

                return (
                  <button
                    key={style}
                    onClick={() => handleStyleSelection(style)}
                    disabled={loadingPreferences}
                    className="group relative px-6 py-5 bg-gradient-to-br from-gray-700/50 to-gray-800/50 hover:from-gray-600/50 hover:to-gray-700/50 backdrop-blur-sm rounded-xl text-left transition-all duration-300 border border-gray-600/50 hover:border-emerald-500/50 hover:shadow-lg hover:shadow-emerald-500/10 hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/0 to-blue-500/0 group-hover:from-emerald-500/5 group-hover:to-blue-500/5 rounded-xl transition-all duration-300" />
                    <div className="relative flex items-start gap-4">
                      <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-gradient-to-br from-emerald-500/20 to-blue-500/20 flex items-center justify-center group-hover:from-emerald-500/30 group-hover:to-blue-500/30 transition-all">
                        <Icon className="w-6 h-6 text-emerald-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-base font-bold text-white group-hover:text-emerald-300 transition-colors mb-1">
                          {config.displayName}
                        </div>
                        <div className="text-sm text-gray-400 group-hover:text-gray-300 transition-colors">
                          {config.description}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 2: Choose Dollar Amount */}
        {currentStep === 'amount' && selectedConfig && IconComponent && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={handleBack}
                className="p-2 hover:bg-gray-700/50 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-gray-400 hover:text-white" />
              </button>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <IconComponent className="w-5 h-5 text-emerald-400" />
                  <h3 className="text-lg font-bold text-white">{selectedConfig.displayName} Style</h3>
                </div>
                <p className="text-sm text-gray-400">{selectedConfig.description}</p>
              </div>
            </div>

            <div className="bg-gray-700/30 rounded-lg p-4 mb-4">
              <div className="text-sm text-gray-300 mb-2">
                <strong>Account Balance:</strong> ${accountBalance.toLocaleString()}
              </div>
              <div className="text-xs text-gray-400">
                Choose how much to risk per trade (up to 10% of balance)
              </div>
            </div>

            {suggestedAmounts && (
              <div className="grid grid-cols-3 gap-3 mb-4">
                <button
                  onClick={() => handleAmountSelection(suggestedAmounts.low)}
                  className={`px-4 py-4 rounded-lg text-left transition-all border-2 ${
                    customAmount === suggestedAmounts.low.toString()
                      ? 'bg-emerald-500/20 border-emerald-500/50 shadow-lg shadow-emerald-500/20'
                      : 'bg-gray-700/30 border-gray-600/50 hover:border-emerald-500/30 hover:bg-gray-700/50'
                  }`}
                >
                  <div className="text-xs text-gray-400 mb-1">Conservative</div>
                  <div className="text-lg font-bold text-white">${suggestedAmounts.low}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    {((suggestedAmounts.low / accountBalance) * 100).toFixed(1)}%
                  </div>
                </button>

                <button
                  onClick={() => handleAmountSelection(suggestedAmounts.medium)}
                  className={`px-4 py-4 rounded-lg text-left transition-all border-2 ${
                    customAmount === suggestedAmounts.medium.toString()
                      ? 'bg-emerald-500/20 border-emerald-500/50 shadow-lg shadow-emerald-500/20'
                      : 'bg-gray-700/30 border-gray-600/50 hover:border-emerald-500/30 hover:bg-gray-700/50'
                  }`}
                >
                  <div className="text-xs text-gray-400 mb-1">Balanced</div>
                  <div className="text-lg font-bold text-white">${suggestedAmounts.medium}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    {((suggestedAmounts.medium / accountBalance) * 100).toFixed(1)}%
                  </div>
                </button>

                <button
                  onClick={() => handleAmountSelection(suggestedAmounts.high)}
                  className={`px-4 py-4 rounded-lg text-left transition-all border-2 ${
                    customAmount === suggestedAmounts.high.toString()
                      ? 'bg-emerald-500/20 border-emerald-500/50 shadow-lg shadow-emerald-500/20'
                      : 'bg-gray-700/30 border-gray-600/50 hover:border-emerald-500/30 hover:bg-gray-700/50'
                  }`}
                >
                  <div className="text-xs text-gray-400 mb-1">Aggressive</div>
                  <div className="text-lg font-bold text-white">${suggestedAmounts.high}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    {((suggestedAmounts.high / accountBalance) * 100).toFixed(1)}%
                  </div>
                </button>
              </div>
            )}

            <div className="relative">
              <input
                type="number"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                placeholder="Or enter custom amount..."
                min="50"
                max={accountBalance * 0.10}
                className="w-full px-4 py-4 bg-gray-800/50 backdrop-blur-sm border border-gray-600/50 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 transition-all duration-300"
              />
            </div>

            {customAmount && amountValidation && !amountValidation.valid && (
              <div className="bg-red-900/30 border border-red-600 rounded-lg p-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-red-400">{amountValidation.error}</div>
              </div>
            )}

            {customAmount && amountValidation && amountValidation.valid && (
              <div className="bg-green-900/20 border border-green-600 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-400 mt-0.5" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-green-400 mb-2">Ready to Start!</div>
                    <div className="text-xs text-gray-300 space-y-1">
                      <div className="flex items-center gap-2">
                        <Shield className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Risk per trade: ${parseFloat(customAmount).toFixed(0)} ({((parseFloat(customAmount) / accountBalance) * 100).toFixed(1)}% of balance)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <IconComponent className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Trade duration: {selectedConfig.durationMin}min - {selectedConfig.durationMax}min</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Target className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Alpha Brain will handle all trade decisions</span>
                      </div>
                    </div>
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
                disabled={!customAmount || loading || loadingPreferences || (amountValidation && !amountValidation.valid)}
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
                    Start {selectedConfig.displayName} Session
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

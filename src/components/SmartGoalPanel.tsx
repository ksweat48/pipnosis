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
import { useSearchParams } from 'react-router-dom';
import { Target, Clock, AlertCircle, Loader2, Zap, CheckCircle, Shield, ArrowLeft, ChevronDown, ChevronUp, Coins, Crown, Lock, Sparkles } from 'lucide-react';
import { smartGoalSessionManager } from '../services/smart-goal-session-manager';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { supabase } from '../lib/supabase';
import { TRADE_STYLES, TradeStyle, calculateSuggestedAmounts, validateDollarAmount, MINIMUM_ACCOUNT_BALANCE } from '../config/trade-styles';
import { getAssetClassInfo, type AssetClass } from '../utils/asset-class-mapper';
import { creditMeterService } from '../services/credit-meter-service';
import { InsufficientCreditsModal } from './InsufficientCreditsModal';
import { TOKENOMICS } from '../config/tokenomics-constants';
import { clubMembershipService, type UserMembership } from '../services/club-membership-service';

const STYLE_ICONS = {
  Zap,
  Target,
  Clock,
};

type Step = 'style' | 'amount';

export const SmartGoalPanel: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [currentStep, setCurrentStep] = useState<Step>('style');
  const [selectedStyle, setSelectedStyle] = useState<TradeStyle | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [accountBalance, setAccountBalance] = useState(10000);
  const [loadingPreferences, setLoadingPreferences] = useState(true);
  const [multiTradeEnabled, setMultiTradeEnabled] = useState(false);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [selectedAssetClasses, setSelectedAssetClasses] = useState<AssetClass[]>(['forex', 'crypto', 'indices', 'gold']);
  const [customInstructions, setCustomInstructions] = useState('');
  const [pendingSymbol, setPendingSymbol] = useState<string | null>(null);
  const [pendingCardSignal, setPendingCardSignal] = useState<Record<string, unknown> | null>(null);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [showInsufficientCreditsModal, setShowInsufficientCreditsModal] = useState(false);
  const [userMembership, setUserMembership] = useState<UserMembership | null | undefined>(undefined);

  useEffect(() => {
    const styleParam = searchParams.get('style') as TradeStyle | null;
    const symbolParam = searchParams.get('symbol');
    if (styleParam && TRADE_STYLES[styleParam]) {
      setSelectedStyle(styleParam);
      setCurrentStep('amount');
      if (symbolParam) {
        setCustomInstructions(`Focus on ${symbolParam}`);
        try {
          const raw = sessionStorage.getItem('im_card_signal');
          if (raw) {
            const signal = JSON.parse(raw) as Record<string, unknown>;
            if (signal.symbol && typeof signal.symbol === 'string') {
              setPendingSymbol(signal.symbol);
              setPendingCardSignal(signal);
            }
            sessionStorage.removeItem('im_card_signal');
          }
        } catch {
          sessionStorage.removeItem('im_card_signal');
        }
      }
      setSearchParams({}, { replace: true });
      window.dispatchEvent(new CustomEvent('smart-goal-panel-scroll-to-top'));
    }
  }, [searchParams]);

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

        const membership = await clubMembershipService.getUserMembership(user.id);
        setUserMembership(membership);
      } catch (err) {
        console.error('Error loading preferences:', err);
        setUserMembership(null);
      } finally {
        setLoadingPreferences(false);
      }
    };

    loadUserPreferences();
  }, [user]);

  useEffect(() => {
    if (!user) return;

    let unsubscribe: (() => void) | undefined;

    const loadCreditBalance = async () => {
      const balance = await creditMeterService.getBalance(user.id);
      if (balance) {
        setIsAdminUser(balance.isAdmin);
        setCreditBalance(balance.isAdmin ? Infinity : balance.balance);
      }
    };

    loadCreditBalance();

    unsubscribe = creditMeterService.subscribeToBalance(user.id, (newBalance) => {
      setIsAdminUser(newBalance.isAdmin);
      setCreditBalance(newBalance.isAdmin ? Infinity : newBalance.balance);
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
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
    // SSOT: Enforce minimum account balance
    if (accountBalance < MINIMUM_ACCOUNT_BALANCE) {
      toast.error(
        'Insufficient Account Balance',
        `Minimum account balance of $${MINIMUM_ACCOUNT_BALANCE} required. Please update your balance to start trading.`,
        8000
      );
      setError(`Minimum account balance of $${MINIMUM_ACCOUNT_BALANCE} required`);
      return;
    }

    // SSOT Credit Gate: Block non-admin users who lack minimum credits before any session flow begins
    if (!isAdminUser && creditBalance !== null && creditBalance < TOKENOMICS.CREDITS.MIN_BALANCE_FOR_SESSION) {
      setShowInsufficientCreditsModal(true);
      return;
    }

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

    // SSOT: Safety check for minimum account balance
    if (accountBalance < MINIMUM_ACCOUNT_BALANCE) {
      toast.error(
        'Insufficient Account Balance',
        `Minimum account balance of $${MINIMUM_ACCOUNT_BALANCE} required. Please update your balance to start trading.`,
        8000
      );
      setError(`Minimum account balance of $${MINIMUM_ACCOUNT_BALANCE} required`);
      return;
    }

    const dollarRisk = parseFloat(customAmount);
    const validation = validateDollarAmount(dollarRisk, accountBalance);

    if (!validation.valid) {
      setError(validation.error || 'Invalid dollar amount');
      return;
    }

    // SSOT Credit Gate: Synchronous pre-flight — bail immediately if balance is known to be insufficient.
    // This avoids the round-trip to the server and gives instant feedback via the modal.
    if (!isAdminUser && creditBalance !== null && creditBalance < TOKENOMICS.CREDITS.MIN_BALANCE_FOR_SESSION) {
      setShowInsufficientCreditsModal(true);
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Check if user already has an active session
      const existingSession = await smartGoalSessionManager.getActiveSession(user.id);
      if (existingSession) {
        toast.error(
          'Active Session Already Running',
          'Please stop your current session before starting a new one. Go to AI Trade page to manage sessions.',
          8000
        );
        setError('You already have an active session running. Stop it first.');
        setLoading(false);
        return;
      }

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
        dollarRisk,
        selectedAssetClasses.length < 4 ? selectedAssetClasses : undefined,
        pendingSymbol ? [pendingSymbol] : undefined,
        customInstructions || undefined,
        pendingCardSignal || undefined
      );

      if (session) {
        window.dispatchEvent(new CustomEvent('goal-session-created', { detail: session }));
        setSelectedStyle(null);
        setCustomAmount('');
        setCurrentStep('style');
        setPendingSymbol(null);
        setPendingCardSignal(null);

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
      const errorMessage = err instanceof Error ? err.message : 'An error occurred while creating your goal session';

      if (errorMessage.toLowerCase().includes('insufficient credits') || errorMessage.toLowerCase().includes('minimum') && errorMessage.toLowerCase().includes('credits')) {
        setShowInsufficientCreditsModal(true);
      } else if (errorMessage.includes('already has an active session')) {
        toast.error('Active Session Exists', errorMessage, 8000);
        setError(errorMessage);
      } else {
        toast.error('Error', errorMessage);
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  const selectedConfig = selectedStyle ? TRADE_STYLES[selectedStyle] : null;
  const IconComponent = selectedConfig ? STYLE_ICONS[selectedConfig.icon as keyof typeof STYLE_ICONS] : null;

  const showLowCreditBanner = !isAdminUser && creditBalance !== null && creditBalance < TOKENOMICS.CREDITS.MIN_BALANCE_FOR_SESSION;
  const showLowCreditWarning = !isAdminUser && creditBalance !== null && !showLowCreditBanner && creditBalance < TOKENOMICS.CREDITS.BASE_TRADE_COST * 2;

  return (
    <>
      <InsufficientCreditsModal
        isOpen={showInsufficientCreditsModal}
        currentBalance={creditBalance ?? 0}
        onDismiss={() => setShowInsufficientCreditsModal(false)}
      />

    <div className="relative group">
      <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-xl opacity-20 group-hover:opacity-40 transition duration-300 blur" />

      <div className="relative bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-xl p-6 border border-gray-700/50 shadow-2xl">
        {/* No-Credits Hard Block Banner */}
        {showLowCreditBanner && !loadingPreferences && (
          <div className="mb-4 p-4 bg-red-500/10 border border-red-500/40 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-300 mb-1">No Credits Available</p>
              <p className="text-xs text-red-400 mb-2">
                You need at least {TOKENOMICS.CREDITS.MIN_BALANCE_FOR_SESSION} credits to start a session.
                Current balance: <span className="font-bold">{creditBalance} credits</span>.
              </p>
              <button
                onClick={() => setShowInsufficientCreditsModal(true)}
                className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 underline underline-offset-2 transition-colors"
              >
                Buy credits to continue
              </button>
            </div>
            <div className="flex-shrink-0 flex items-center gap-1 text-xs text-gray-400 bg-gray-800/60 px-2 py-1 rounded-full">
              <Coins className="w-3 h-3" />
              <span>{creditBalance}</span>
            </div>
          </div>
        )}

        {/* Low-Credits Advisory Banner (non-blocking) */}
        {showLowCreditWarning && !loadingPreferences && (
          <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-3">
            <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <p className="text-xs text-amber-300 flex-1">
              Low credits — <span className="font-semibold">{creditBalance} remaining</span>. You may only have {Math.floor(creditBalance! / TOKENOMICS.CREDITS.BASE_TRADE_COST)} trade(s) left.{' '}
              <button
                onClick={() => setShowInsufficientCreditsModal(true)}
                className="font-semibold text-emerald-400 hover:text-emerald-300 underline underline-offset-2 transition-colors"
              >
                Top up
              </button>
            </p>
            <div className="flex-shrink-0 flex items-center gap-1 text-xs text-amber-400 bg-amber-900/20 px-2 py-1 rounded-full">
              <Coins className="w-3 h-3" />
              <span>{creditBalance}</span>
            </div>
          </div>
        )}

        {/* Low Balance Warning Banner */}
        {accountBalance < MINIMUM_ACCOUNT_BALANCE && !loadingPreferences && (
          <div className="mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-300 mb-1">Insufficient Account Balance</p>
              <p className="text-xs text-red-400">
                Minimum balance of ${MINIMUM_ACCOUNT_BALANCE} required to start trading.
                Current balance: ${accountBalance.toFixed(2)}. Please update your balance to continue.
              </p>
            </div>
          </div>
        )}

        {/* Step 1: Choose Trading Style */}
        {currentStep === 'style' && (
          <div className="space-y-4">
            <div className="text-center mb-6">
              {/* Club Level Badge — SSOT: derived from clubMembershipService */}
              {userMembership !== undefined && (
                <div className="flex justify-center mb-3">
                  {userMembership && userMembership.status === 'active' ? (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border border-amber-500/40">
                      <Crown className="w-3 h-3 text-amber-400" />
                      <span className="text-xs font-bold text-amber-300 tracking-wide">{userMembership.tierName}</span>
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-700/50 border border-gray-600/50">
                      <Lock className="w-3 h-3 text-gray-500" />
                      <span className="text-xs font-medium text-gray-500">Not Yet A Club Member</span>
                    </div>
                  )}
                </div>
              )}
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

            {/* Club CTA Banner — always visible on style step */}
            <div className="relative mt-2 overflow-hidden rounded-xl border border-emerald-500/25">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-900/40 via-teal-900/30 to-gray-900/60" />
              <div className="relative flex items-start gap-3 p-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center mt-0.5">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white mb-0.5">Improve Your Edge</p>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    Unlock advanced trading tools, deeper AI analysis, and exclusive features as a Club Member.
                  </p>
                </div>
                <a
                  href="/club"
                  className="flex-shrink-0 self-center ml-1 px-3 py-1.5 rounded-lg bg-emerald-600/80 hover:bg-emerald-500/90 text-white text-xs font-semibold transition-colors whitespace-nowrap"
                >
                  Join Club
                </a>
              </div>
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
              <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
                <button
                  onClick={() => handleAmountSelection(suggestedAmounts.low)}
                  className={`px-2 sm:px-4 py-4 rounded-lg text-center transition-all border-2 ${
                    customAmount === suggestedAmounts.low.toString()
                      ? 'bg-emerald-500/20 border-emerald-500/50 shadow-lg shadow-emerald-500/20'
                      : 'bg-gray-700/30 border-gray-600/50 hover:border-emerald-500/30 hover:bg-gray-700/50'
                  }`}
                >
                  <div className="text-xs text-gray-400 mb-1">Conservative</div>
                  <div className="flex flex-col items-end justify-center leading-tight">
                    <div className="text-lg font-bold text-white">
                      ${Math.floor(suggestedAmounts.low)}
                    </div>
                    <div className="text-[10px] text-gray-300 -mt-0.5">
                      .{(suggestedAmounts.low % 1).toFixed(2).substring(2)}
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    {((suggestedAmounts.low / accountBalance) * 100).toFixed(1)}%
                  </div>
                </button>

                <button
                  onClick={() => handleAmountSelection(suggestedAmounts.medium)}
                  className={`px-2 sm:px-4 py-4 rounded-lg text-center transition-all border-2 ${
                    customAmount === suggestedAmounts.medium.toString()
                      ? 'bg-emerald-500/20 border-emerald-500/50 shadow-lg shadow-emerald-500/20'
                      : 'bg-gray-700/30 border-gray-600/50 hover:border-emerald-500/30 hover:bg-gray-700/50'
                  }`}
                >
                  <div className="text-xs text-gray-400 mb-1">Balanced</div>
                  <div className="flex flex-col items-end justify-center leading-tight">
                    <div className="text-lg font-bold text-white">
                      ${Math.floor(suggestedAmounts.medium)}
                    </div>
                    <div className="text-[10px] text-gray-300 -mt-0.5">
                      .{(suggestedAmounts.medium % 1).toFixed(2).substring(2)}
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    {((suggestedAmounts.medium / accountBalance) * 100).toFixed(1)}%
                  </div>
                </button>

                <button
                  onClick={() => handleAmountSelection(suggestedAmounts.high)}
                  className={`px-2 sm:px-4 py-4 rounded-lg text-center transition-all border-2 ${
                    customAmount === suggestedAmounts.high.toString()
                      ? 'bg-emerald-500/20 border-emerald-500/50 shadow-lg shadow-emerald-500/20'
                      : 'bg-gray-700/30 border-gray-600/50 hover:border-emerald-500/30 hover:bg-gray-700/50'
                  }`}
                >
                  <div className="text-xs text-gray-400 mb-1">Aggressive</div>
                  <div className="flex flex-col items-end justify-center leading-tight">
                    <div className="text-lg font-bold text-white">
                      ${Math.floor(suggestedAmounts.high)}
                    </div>
                    <div className="text-[10px] text-gray-300 -mt-0.5">
                      .{(suggestedAmounts.high % 1).toFixed(2).substring(2)}
                    </div>
                  </div>
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

            {/* Advanced Options */}
            <div className="border border-gray-700/50 rounded-xl bg-gray-800/30 backdrop-blur-sm overflow-hidden">
              <button
                onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-700/30 transition-colors"
              >
                <span className="text-sm font-medium text-gray-300">Advanced Options (Optional)</span>
                {showAdvancedOptions ? (
                  <ChevronUp className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                )}
              </button>

              {showAdvancedOptions && (
                <div className="px-4 pb-4 space-y-4 border-t border-gray-700/50 pt-4">
                  {/* Asset Class Filter */}
                  <div>
                    <label className="text-sm font-medium text-gray-300 mb-2 block">
                      Asset Classes
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {getAssetClassInfo().map((info) => (
                        <button
                          key={info.assetClass}
                          onClick={() => {
                            setSelectedAssetClasses(prev =>
                              prev.includes(info.assetClass)
                                ? prev.filter(c => c !== info.assetClass)
                                : [...prev, info.assetClass]
                            );
                          }}
                          className={`px-3 py-2 rounded-lg text-sm transition-all border ${
                            selectedAssetClasses.includes(info.assetClass)
                              ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                              : 'bg-gray-700/30 border-gray-600/50 text-gray-400 hover:border-gray-500/50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span>{info.emoji}</span>
                            <span className="font-medium">{info.displayName}</span>
                            <span className="text-xs opacity-70">({info.symbols.length})</span>
                          </div>
                        </button>
                      ))}
                    </div>
                    <div className="text-xs text-gray-500 mt-2">
                      {selectedAssetClasses.length === 4 ? 'All markets selected' : `${selectedAssetClasses.length} asset class(es) selected`}
                    </div>
                  </div>

                  {/* Custom Instructions */}
                  <div>
                    <label className="text-sm font-medium text-gray-300 mb-2 block">
                      Custom Instructions
                    </label>
                    <textarea
                      value={customInstructions}
                      onChange={(e) => setCustomInstructions(e.target.value.slice(0, 200))}
                      placeholder="e.g., 'Focus on high-probability setups only' or 'Be aggressive with entries'"
                      maxLength={200}
                      rows={3}
                      className="w-full px-3 py-2 bg-gray-800/50 border border-gray-600/50 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 transition-all resize-none"
                    />
                    <div className="text-xs text-gray-500 mt-1">
                      {customInstructions.length}/200 characters
                    </div>
                  </div>
                </div>
              )}
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
    </>
  );
};

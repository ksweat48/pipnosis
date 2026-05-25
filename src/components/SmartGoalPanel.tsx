import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useUserBalance } from '@/hooks/useUserBalance';
import { useCreditBalance } from '@/hooks/useCreditBalance';
import { smartGoalSessionManager } from '@/services/smart-goal-session-manager';
import { creditValidationService } from '@/services/credit-validation-service';
import { getAssetClassInfo, type AssetClass } from '@/utils/asset-class-mapper';
import { calculateSuggestedAmounts, MINIMUM_ACCOUNT_BALANCE, validateDollarAmount, type TradeStyle } from '@/config/trade-styles';
import { supabase } from '@/lib/supabase';
import { Target, DollarSign, TrendingUp, Zap, AlertCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';

export function SmartGoalPanel() {
  const { user } = useAuth();
  const { balance, loading: balanceLoading } = useUserBalance(user?.id || null);
  const { balance: creditBalance } = useCreditBalance(user?.id || null);

  const [dollarRisk, setDollarRisk] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [selectedAssetClasses, setSelectedAssetClasses] = useState<AssetClass[]>(['forex', 'indices', 'gold']);
  const [customInstructions, setCustomInstructions] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [multiTradeEnabled, setMultiTradeEnabled] = useState(false);

  const tradeStyle: TradeStyle = 'micro';
  const suggestedAmounts = calculateSuggestedAmounts(balance, tradeStyle);
  const assetClassInfo = getAssetClassInfo();

  useEffect(() => {
    if (!user) return;
    supabase
      .from('trading_preferences')
      .select('multi_trade_mode')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.multi_trade_mode) setMultiTradeEnabled(true);
      });
  }, [user]);

  const handleAmountSelect = (amount: number) => {
    setDollarRisk(amount);
    setCustomAmount('');
    setError(null);
  };

  const handleCustomAmountChange = (value: string) => {
    setCustomAmount(value);
    const parsed = parseFloat(value);
    if (!isNaN(parsed) && parsed > 0) {
      setDollarRisk(parsed);
      setError(null);
    } else {
      setDollarRisk(null);
    }
  };

  const toggleAssetClass = (ac: AssetClass) => {
    setSelectedAssetClasses(prev => {
      if (prev.includes(ac)) {
        if (prev.length <= 1) return prev;
        return prev.filter(a => a !== ac);
      }
      return [...prev, ac];
    });
  };

  const handleStartSession = useCallback(async () => {
    if (!user || !dollarRisk) return;

    const validation = validateDollarAmount(dollarRisk, balance);
    if (!validation.valid) {
      setError(validation.error || 'Invalid amount');
      return;
    }

    if (balance < MINIMUM_ACCOUNT_BALANCE) {
      setError(`Minimum account balance of $${MINIMUM_ACCOUNT_BALANCE} required`);
      return;
    }

    const creditCheck = await creditValidationService.validatePreSession(user.id);
    if (!creditCheck.valid) {
      setError(creditCheck.reason || 'Insufficient credits to start a session');
      return;
    }

    setIsStarting(true);
    setError(null);

    try {
      const prompt = `Trade with $${dollarRisk.toFixed(2)} risk per trade`;
      await smartGoalSessionManager.createSmartGoalSession(
        user.id,
        prompt,
        balance,
        multiTradeEnabled,
        tradeStyle,
        dollarRisk,
        selectedAssetClasses,
        undefined,
        customInstructions || undefined
      );

      window.dispatchEvent(new CustomEvent('smart-goal-panel-scroll-to-top'));
    } catch (err: any) {
      setError(err.message || 'Failed to start session');
    } finally {
      setIsStarting(false);
    }
  }, [user, dollarRisk, balance, multiTradeEnabled, selectedAssetClasses, customInstructions, tradeStyle]);

  if (!user) return null;

  if (balanceLoading) {
    return (
      <div className="bg-gray-800/60 backdrop-blur-sm rounded-2xl border border-gray-700/50 p-6 flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
      </div>
    );
  }

  const riskPercent = dollarRisk ? ((dollarRisk / balance) * 100).toFixed(1) : '0';

  return (
    <div className="bg-gray-800/60 backdrop-blur-sm rounded-2xl border border-gray-700/50 overflow-hidden">
      <div className="p-5 border-b border-gray-700/50">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-500/10 rounded-xl">
            <Target className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Start Trading Session</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Balance: ${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              {creditBalance && <span className="ml-2 text-emerald-400/70">{creditBalance.balance} credits</span>}
            </p>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Risk Amount Selection */}
        <div>
          <label className="text-sm font-medium text-gray-300 mb-2.5 block flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-400" />
            Risk Per Trade
          </label>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              { label: 'Conservative', amount: suggestedAmounts.low, color: 'emerald' },
              { label: 'Moderate', amount: suggestedAmounts.medium, color: 'blue' },
              { label: 'Aggressive', amount: suggestedAmounts.high, color: 'amber' },
            ].map(({ label, amount, color }) => (
              <button
                key={label}
                onClick={() => handleAmountSelect(amount)}
                className={`p-3 rounded-xl border text-center transition-all duration-200 ${
                  dollarRisk === amount && !customAmount
                    ? `border-${color}-500/50 bg-${color}-500/10 ring-1 ring-${color}-500/30`
                    : 'border-gray-600/50 hover:border-gray-500/50 hover:bg-gray-700/30'
                }`}
              >
                <p className="text-xs text-gray-400">{label}</p>
                <p className={`text-lg font-bold ${
                  dollarRisk === amount && !customAmount ? `text-${color}-400` : 'text-white'
                }`}>
                  ${amount.toFixed(2)}
                </p>
                <p className="text-[10px] text-gray-500">
                  {((amount / balance) * 100).toFixed(1)}%
                </p>
              </button>
            ))}
          </div>

          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
            <input
              type="number"
              value={customAmount}
              onChange={e => handleCustomAmountChange(e.target.value)}
              placeholder="Custom amount..."
              className="w-full bg-gray-700/50 border border-gray-600/50 rounded-xl pl-7 pr-20 py-2.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/50"
            />
            {dollarRisk && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                {riskPercent}% risk
              </span>
            )}
          </div>
        </div>

        {/* Asset Class Selection */}
        <div>
          <label className="text-sm font-medium text-gray-300 mb-2.5 block flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-400" />
            Markets
          </label>
          <div className="grid grid-cols-3 gap-2">
            {assetClassInfo.map(info => (
              <button
                key={info.assetClass}
                onClick={() => toggleAssetClass(info.assetClass)}
                className={`p-3 rounded-xl border text-center transition-all duration-200 ${
                  selectedAssetClasses.includes(info.assetClass)
                    ? 'border-blue-500/50 bg-blue-500/10 ring-1 ring-blue-500/30'
                    : 'border-gray-600/50 hover:border-gray-500/50 hover:bg-gray-700/30'
                }`}
              >
                <p className="text-lg">{info.emoji}</p>
                <p className={`text-xs font-medium mt-1 ${
                  selectedAssetClasses.includes(info.assetClass) ? 'text-blue-300' : 'text-gray-400'
                }`}>
                  {info.displayName}
                </p>
                <p className="text-[10px] text-gray-500 mt-0.5">{info.symbols.length} pairs</p>
              </button>
            ))}
          </div>
        </div>

        {/* Advanced Options Toggle */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-300 transition-colors"
        >
          {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          Advanced Options
        </button>

        {showAdvanced && (
          <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
            {/* Multi-Trade Mode */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-gray-700/30 border border-gray-600/30">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                <div>
                  <p className="text-sm text-gray-300">Multi-Trade Mode</p>
                  <p className="text-[10px] text-gray-500">Execute multiple trades per scan</p>
                </div>
              </div>
              <button
                onClick={() => setMultiTradeEnabled(!multiTradeEnabled)}
                className={`w-10 h-5 rounded-full transition-all duration-200 ${
                  multiTradeEnabled ? 'bg-amber-500' : 'bg-gray-600'
                }`}
              >
                <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  multiTradeEnabled ? 'translate-x-5' : 'translate-x-0.5'
                }`} />
              </button>
            </div>

            {/* Custom Instructions */}
            <div>
              <label className="text-xs text-gray-400 mb-1.5 block">Custom Instructions (optional)</label>
              <textarea
                value={customInstructions}
                onChange={e => setCustomInstructions(e.target.value.slice(0, 200))}
                placeholder="e.g., Focus on XAUUSD, avoid GBP pairs..."
                rows={2}
                className="w-full bg-gray-700/50 border border-gray-600/50 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/50 resize-none"
              />
              <p className="text-[10px] text-gray-500 mt-1 text-right">{customInstructions.length}/200</p>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-300">{error}</p>
          </div>
        )}

        {/* Start Button */}
        <button
          onClick={handleStartSession}
          disabled={!dollarRisk || isStarting || selectedAssetClasses.length === 0}
          className={`w-full py-3.5 rounded-xl font-semibold text-sm transition-all duration-300 flex items-center justify-center gap-2 ${
            !dollarRisk || isStarting || selectedAssetClasses.length === 0
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
              : 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white hover:from-emerald-500 hover:to-emerald-400 shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 active:scale-[0.98]'
          }`}
        >
          {isStarting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Starting Session...
            </>
          ) : (
            <>
              <Zap className="w-4 h-4" />
              Analyze with Alpha
            </>
          )}
        </button>
      </div>
    </div>
  );
}

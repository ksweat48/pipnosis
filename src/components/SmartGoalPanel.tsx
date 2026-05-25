import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useUserBalance } from '@/hooks/useUserBalance';
import { useCreditBalance } from '@/hooks/useCreditBalance';
import { useClubMembership } from '@/hooks/useClubMembership';
import { smartGoalSessionManager } from '@/services/smart-goal-session-manager';
import { creditValidationService } from '@/services/credit-validation-service';
import { getAssetClassInfo, getSymbolsByAssetClass, type AssetClass } from '@/utils/asset-class-mapper';
import { calculateSuggestedAmounts, MINIMUM_ACCOUNT_BALANCE, validateDollarAmount, TRADE_STYLES, type TradeStyle } from '@/config/trade-styles';
import { supabase } from '@/lib/supabase';
import { Target, Zap, AlertCircle, Loader2 } from 'lucide-react';

export function SmartGoalPanel() {
  const { user } = useAuth();
  const { balance, loading: balanceLoading } = useUserBalance(user?.id || null);
  const { balance: creditBalance } = useCreditBalance(user?.id || null);
  const { membership } = useClubMembership(user?.id);

  const [dollarRisk, setDollarRisk] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [selectedAssetClasses, setSelectedAssetClasses] = useState<AssetClass[]>(['forex', 'indices', 'gold']);
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [multiTradeEnabled, setMultiTradeEnabled] = useState(false);

  const tradeStyle: TradeStyle = 'micro';
  const styleConfig = TRADE_STYLES[tradeStyle];
  const suggestedAmounts = calculateSuggestedAmounts(balance, tradeStyle);
  const assetClassInfo = getAssetClassInfo();

  const availableSymbols = useMemo(() => {
    return getSymbolsByAssetClass(selectedAssetClasses);
  }, [selectedAssetClasses]);

  useEffect(() => {
    setSelectedSymbols(availableSymbols);
  }, [availableSymbols]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('user_profiles')
      .select('trading_preferences')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.trading_preferences?.multiTradeMode) setMultiTradeEnabled(true);
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
      const newClasses = prev.includes(ac)
        ? prev.filter(a => a !== ac)
        : [...prev, ac];

      if (newClasses.length === 0) return prev;
      return newClasses;
    });
  };

  const toggleSymbol = (symbol: string) => {
    setSelectedSymbols(prev => {
      if (prev.includes(symbol)) {
        if (prev.length <= 1) return prev;
        return prev.filter(s => s !== symbol);
      }
      return [...prev, symbol];
    });
  };

  const handleStartSession = useCallback(async () => {
    if (!user || !dollarRisk || selectedSymbols.length === 0) return;

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
        selectedSymbols,
        undefined
      );

      window.dispatchEvent(new CustomEvent('smart-goal-panel-scroll-to-top'));
    } catch (err: any) {
      setError(err.message || 'Failed to start session');
    } finally {
      setIsStarting(false);
    }
  }, [user, dollarRisk, balance, multiTradeEnabled, selectedAssetClasses, selectedSymbols, tradeStyle]);

  if (!user) return null;

  if (balanceLoading) {
    return (
      <div className="bg-gray-800/60 backdrop-blur-sm rounded-2xl border border-gray-700/50 p-6 flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
      </div>
    );
  }

  const riskPercent = dollarRisk ? ((dollarRisk / balance) * 100).toFixed(1) : null;

  return (
    <div className="bg-gray-800/60 backdrop-blur-sm rounded-2xl border border-gray-700/50 overflow-hidden">
      {/* Membership & Mode Badges */}
      <div className="p-4 pb-0 flex items-center justify-center gap-2">
        {membership && membership.status === 'active' && (
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            {membership.tierName}
          </span>
        )}
        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
          {multiTradeEnabled ? 'Multi' : 'Single'}
        </span>
      </div>

      {/* Trade Style Info */}
      <div className="p-5 pb-3">
        <div className="flex items-center gap-2 mb-1">
          <Target className="w-4 h-4 text-emerald-400" />
          <h3 className="text-base font-bold text-white">{styleConfig.displayName}</h3>
        </div>
        <p className="text-xs text-gray-400 leading-relaxed">{styleConfig.description}</p>
      </div>

      <div className="px-5 pb-5 space-y-4">
        {/* Account Balance Display */}
        <div className="p-3 rounded-xl bg-gray-700/30 border border-gray-600/30">
          <p className="text-sm font-semibold text-white">
            Account Balance: ${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">Choose your risk (up to 10% of balance)</p>
        </div>

        {/* Risk Amount Presets */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Conservative', amount: suggestedAmounts.low },
            { label: 'Moderate', amount: suggestedAmounts.medium },
            { label: 'Aggressive', amount: suggestedAmounts.high },
          ].map(({ label, amount }) => {
            const isSelected = dollarRisk === amount && !customAmount;
            const wholePart = Math.floor(amount);
            const centsPart = Math.round((amount - wholePart) * 100).toString().padStart(2, '0');
            const pct = ((amount / balance) * 100).toFixed(1);

            return (
              <button
                key={label}
                onClick={() => handleAmountSelect(amount)}
                className={`p-3 rounded-xl border text-center transition-all duration-200 ${
                  isSelected
                    ? 'border-emerald-500/50 bg-emerald-500/10 ring-1 ring-emerald-500/30'
                    : 'border-gray-600/50 hover:border-gray-500/50 hover:bg-gray-700/30'
                }`}
              >
                <p className={`text-[11px] ${isSelected ? 'text-emerald-300' : 'text-gray-400'}`}>{label}</p>
                <p className={`text-xl font-bold ${isSelected ? 'text-emerald-300' : 'text-white'}`}>
                  ${wholePart}
                  <span className="text-xs opacity-60">.{centsPart}</span>
                </p>
                <p className="text-[10px] text-gray-500">{pct}%</p>
              </button>
            );
          })}
        </div>

        {/* Custom Amount Input */}
        <div className="relative">
          <input
            type="number"
            value={customAmount}
            onChange={e => handleCustomAmountChange(e.target.value)}
            placeholder="Custom amount"
            className="w-full bg-gray-700/50 border border-gray-600/50 rounded-xl px-4 py-3 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/50"
          />
          {customAmount && riskPercent && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
              {riskPercent}%
            </span>
          )}
        </div>

        {/* Asset Classes */}
        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-2.5">Asset Classes</h4>
          <div className="flex flex-wrap gap-2 mb-3">
            {assetClassInfo.map(info => {
              const isSelected = selectedAssetClasses.includes(info.assetClass);
              const symbolCount = info.symbols.length;

              return (
                <button
                  key={info.assetClass}
                  onClick={() => toggleAssetClass(info.assetClass)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm transition-all duration-200 ${
                    isSelected
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                      : 'border-gray-600/50 text-gray-400 hover:border-gray-500/50 hover:bg-gray-700/30'
                  }`}
                >
                  <span>{info.emoji}</span>
                  <span className="font-medium">{info.displayName}</span>
                  <span className={`text-xs ${isSelected ? 'text-emerald-400/70' : 'text-gray-500'}`}>
                    ({symbolCount})
                  </span>
                </button>
              );
            })}
          </div>

          {/* Individual Symbol Chips */}
          <div className="flex flex-wrap gap-1.5">
            {availableSymbols.map(symbol => {
              const isSelected = selectedSymbols.includes(symbol);

              return (
                <button
                  key={symbol}
                  onClick={() => toggleSymbol(symbol)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-150 ${
                    isSelected
                      ? 'bg-gray-600/80 text-white border border-gray-500/50'
                      : 'bg-transparent text-gray-500 border border-gray-600/30 hover:text-gray-400 hover:border-gray-500/50'
                  }`}
                >
                  {symbol}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-gray-500 mt-2">{selectedSymbols.length} pairs selected</p>
        </div>

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
          disabled={!dollarRisk || isStarting || selectedSymbols.length === 0}
          className={`w-full py-3.5 rounded-xl font-semibold text-sm transition-all duration-300 flex items-center justify-center gap-2 ${
            !dollarRisk || isStarting || selectedSymbols.length === 0
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
              Ready to Start!
            </>
          )}
        </button>
      </div>
    </div>
  );
}

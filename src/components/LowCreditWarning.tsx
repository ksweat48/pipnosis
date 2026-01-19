import React, { useState, useEffect } from 'react';
import { AlertTriangle, CreditCard, X, TrendingDown } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useCreditBalance } from '@/hooks/useCreditBalance';
import { useNavigate } from 'react-router-dom';
import { creditValidationService } from '@/services/credit-validation-service';

interface LowCreditWarningProps {
  thresholds?: {
    critical: number;
    warning: number;
    low: number;
  };
  showInHeader?: boolean;
}

export function LowCreditWarning({
  thresholds = {
    critical: 10, // Minimum to start session
    warning: 30,  // Warning level
    low: 50       // Low level
  },
  showInHeader = false
}: LowCreditWarningProps) {
  const { user } = useAuth();
  const { balance, isLoading } = useCreditBalance(user?.id || null);
  const navigate = useNavigate();
  const [isDismissed, setIsDismissed] = useState(false);
  const [dismissedLevel, setDismissedLevel] = useState<string | null>(null);

  const minBalance = creditValidationService.getMinBalanceForSession();
  const signalCost = creditValidationService.getSignalCost();

  useEffect(() => {
    if (balance && dismissedLevel) {
      const currentBalance = balance.balance;
      if (
        (dismissedLevel === 'critical' && currentBalance >= thresholds.warning) ||
        (dismissedLevel === 'warning' && currentBalance >= thresholds.low) ||
        (dismissedLevel === 'low' && currentBalance >= 100)
      ) {
        setIsDismissed(false);
        setDismissedLevel(null);
      }
    }
  }, [balance, dismissedLevel, thresholds]);

  if (isLoading || !balance || balance.isAdmin || isDismissed) {
    return null;
  }

  const currentBalance = balance.balance;

  const getAlertLevel = (): 'critical' | 'warning' | 'low' | null => {
    if (currentBalance < thresholds.critical) return 'critical';
    if (currentBalance < thresholds.warning) return 'warning';
    if (currentBalance < thresholds.low) return 'low';
    return null;
  };

  const alertLevel = getAlertLevel();

  if (!alertLevel) {
    return null;
  }

  const handleDismiss = () => {
    setIsDismissed(true);
    setDismissedLevel(alertLevel);
  };

  const handleBuyCredits = () => {
    navigate('/credits');
  };

  const getAlertConfig = () => {
    switch (alertLevel) {
      case 'critical':
        return {
          title: 'Critical: Credits Almost Depleted',
          message: `You have only ${currentBalance.toFixed(0)} credits remaining. You need at least ${minBalance} credits to start a new session and ${signalCost} credits per signal.`,
          bgGradient: 'from-red-900/90 to-orange-900/90',
          borderColor: 'border-red-500/50',
          iconBg: 'from-red-600 to-orange-600',
          textColor: 'text-red-200',
          buttonGradient: 'from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500',
          icon: <AlertTriangle size={showInHeader ? 20 : 24} className="text-white" />,
          tradesRemaining: Math.floor(currentBalance / signalCost)
        };
      case 'warning':
        return {
          title: 'Warning: Credits Running Low',
          message: `You have ${currentBalance.toFixed(0)} credits remaining. Consider purchasing more to avoid session interruptions.`,
          bgGradient: 'from-yellow-900/90 to-orange-900/90',
          borderColor: 'border-yellow-500/50',
          iconBg: 'from-yellow-600 to-orange-600',
          textColor: 'text-yellow-200',
          buttonGradient: 'from-yellow-600 to-orange-600 hover:from-yellow-500 hover:to-orange-500',
          icon: <TrendingDown size={showInHeader ? 20 : 24} className="text-white" />,
          tradesRemaining: Math.floor(currentBalance / signalCost)
        };
      case 'low':
        return {
          title: 'Credits Getting Low',
          message: `You have ${currentBalance.toFixed(0)} credits. Stock up now to ensure uninterrupted trading.`,
          bgGradient: 'from-blue-900/90 to-purple-900/90',
          borderColor: 'border-blue-500/50',
          iconBg: 'from-blue-600 to-purple-600',
          textColor: 'text-blue-200',
          buttonGradient: 'from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500',
          icon: <CreditCard size={showInHeader ? 20 : 24} className="text-white" />,
          tradesRemaining: Math.floor(currentBalance / signalCost)
        };
    }
  };

  const config = getAlertConfig();

  if (showInHeader) {
    return (
      <div className="relative group">
        <div className={`absolute -inset-0.5 bg-gradient-to-r ${config.iconBg.replace('from-', 'from-').replace('to-', 'to-')} rounded-lg opacity-50 blur`} />

        <div className={`relative bg-gradient-to-br ${config.bgGradient} backdrop-blur-xl border ${config.borderColor} rounded-lg px-3 py-2 flex items-center gap-2`}>
          <div className="flex-shrink-0">
            {config.icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${config.textColor} truncate`}>
              {currentBalance.toFixed(0)} credits remaining
            </p>
          </div>
          <button
            onClick={handleBuyCredits}
            className={`flex-shrink-0 px-3 py-1 bg-gradient-to-r ${config.buttonGradient} text-white text-xs font-semibold rounded transition-all`}
          >
            Buy
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative group animate-in fade-in slide-in-from-top-2 duration-300">
      <div className={`absolute -inset-0.5 bg-gradient-to-r ${config.iconBg.replace('from-', 'from-').replace('to-', 'to-')} rounded-xl opacity-30 blur`} />

      <div className={`relative bg-gradient-to-br ${config.bgGradient} backdrop-blur-xl border ${config.borderColor} rounded-xl p-4 shadow-xl`}>
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 mt-0.5">
            <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${config.iconBg} flex items-center justify-center shadow-lg`}>
              {config.icon}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-white mb-1">{config.title}</h3>
            <p className={`${config.textColor} text-sm mb-3`}>{config.message}</p>

            <div className="flex items-center gap-4 mb-3 p-2 bg-black/20 rounded-lg">
              <div className="text-center">
                <div className="text-xs text-gray-300">Current Balance</div>
                <div className="text-xl font-bold text-white">{currentBalance.toFixed(0)}</div>
              </div>
              <div className="h-8 w-px bg-gray-600"></div>
              <div className="text-center">
                <div className="text-xs text-gray-300">Estimated Trades</div>
                <div className="text-xl font-bold text-emerald-400">{config.tradesRemaining}</div>
              </div>
              <div className="h-8 w-px bg-gray-600"></div>
              <div className="text-center">
                <div className="text-xs text-gray-300">Cost per Signal</div>
                <div className="text-xl font-bold text-blue-400">{signalCost}</div>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleBuyCredits}
                className={`flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r ${config.buttonGradient} text-white font-semibold rounded-lg transition-all shadow-lg`}
              >
                <CreditCard size={18} />
                <span>Buy Credits Now</span>
              </button>

              {alertLevel !== 'critical' && (
                <button
                  onClick={handleDismiss}
                  className="px-4 py-2 bg-gray-700/50 hover:bg-gray-600/50 text-white rounded-lg transition-all"
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>

          {alertLevel !== 'critical' && (
            <button
              onClick={handleDismiss}
              className="flex-shrink-0 p-2 hover:bg-white/10 rounded-lg transition-colors"
              aria-label="Dismiss"
            >
              <X size={20} className="text-white" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

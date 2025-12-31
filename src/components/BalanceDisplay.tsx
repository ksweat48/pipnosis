import React, { useState, useEffect } from 'react';
import { DollarSign, TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { format } from '@/utils/displayFormatters';

interface BalanceDisplayProps {
  refreshTrigger?: number;
}

export function BalanceDisplay({ refreshTrigger }: BalanceDisplayProps) {
  const [balance, setBalance] = useState<number>(10000);
  const [loading, setLoading] = useState(true);
  const [usedMargin, setUsedMargin] = useState<number>(0);
  const [unrealizedPnL, setUnrealizedPnL] = useState<number>(0);

  useEffect(() => {
    fetchBalance();
    const interval = setInterval(fetchBalance, 3000);
    return () => clearInterval(interval);
  }, [refreshTrigger]);

  const fetchBalance = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // SINGLE SOURCE OF TRUTH: Use database function
      const { data: balanceData, error: balanceError } = await supabase
        .rpc('get_total_balance', { p_user_id: user.id });

      if (balanceError) throw balanceError;

      if (balanceData) {
        setBalance(balanceData.balance || 10000);
        setUnrealizedPnL(balanceData.unrealized_pnl || 0);
      }

      // Get positions for margin calculation
      const { data: positions, error: positionsError } = await supabase
        .from('goal_session_trades')
        .select('position_size, lot_size')
        .eq('user_id', user.id)
        .eq('status', 'open');

      if (positionsError) throw positionsError;

      if (positions && positions.length > 0) {
        // Calculate used margin (lot_size * 1000 per position)
        const totalMargin = positions.reduce((sum, pos) => {
          const lotSize = pos.lot_size || pos.position_size || 0;
          return sum + (lotSize * 1000);
        }, 0);
        setUsedMargin(totalMargin);
      } else {
        setUsedMargin(0);
      }

      setLoading(false);
    } catch (error) {
      console.error('[BalanceDisplay] Failed to fetch balance:', error);
      setLoading(false);
    }
  };

  const freeMargin = balance - usedMargin;
  const equity = balance + unrealizedPnL;
  const marginLevel = usedMargin > 0 ? (equity / usedMargin) * 100 : 0;

  const getMarginLevelColor = (): string => {
    if (marginLevel >= 200) return 'text-green-400';
    if (marginLevel >= 100) return 'text-yellow-400';
    return 'text-red-400';
  };

  if (loading) {
    return (
      <div className="flex items-center space-x-2 text-gray-400">
        <Wallet className="w-4 h-4 sm:w-5 sm:h-5 animate-pulse" />
        <span className="text-xs sm:text-sm">Loading...</span>
      </div>
    );
  }

  return (
    <>
      {/* Mobile: Compact view - Balance and P&L only */}
      <div className="flex sm:hidden items-center space-x-3">
        <div className="flex items-center space-x-1.5">
          <DollarSign className="w-4 h-4 text-green-400" />
          <div>
            <div className="text-xs font-bold text-white">
              {format.balance(balance, 'mobile')}
            </div>
          </div>
        </div>

        {usedMargin > 0 && (
          <>
            <div className="h-6 w-px bg-gray-700"></div>
            <div className="flex items-center space-x-1">
              {unrealizedPnL >= 0 ? (
                <TrendingUp className="w-3 h-3 text-green-400" />
              ) : (
                <TrendingDown className="w-3 h-3 text-red-400" />
              )}
              <div className={`text-xs font-bold ${unrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {format.pnl(unrealizedPnL, 'mobile')}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Desktop: Full view */}
      <div className="hidden sm:flex items-center space-x-6">
        <div className="flex items-center space-x-2">
          <DollarSign className="w-5 h-5 text-green-400" />
          <div>
            <div className="text-xs text-gray-400">Balance</div>
            <div className="text-lg font-bold text-white">
              {format.balance(balance, 'desktop')}
            </div>
          </div>
        </div>

        <div className="h-8 w-px bg-gray-700"></div>

        <div className="flex items-center space-x-2">
          <Wallet className="w-5 h-5 text-blue-400" />
          <div>
            <div className="text-xs text-gray-400">Free Margin</div>
            <div className="text-lg font-bold text-white">
              {format.balance(freeMargin, 'desktop')}
            </div>
          </div>
        </div>

        {usedMargin > 0 && (
          <>
            <div className="h-8 w-px bg-gray-700"></div>

            <div className="flex items-center space-x-2">
              {unrealizedPnL >= 0 ? (
                <TrendingUp className="w-5 h-5 text-green-400" />
              ) : (
                <TrendingDown className="w-5 h-5 text-red-400" />
              )}
              <div>
                <div className="text-xs text-gray-400">Unrealized P&L</div>
                <div className={`text-lg font-bold ${unrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {format.pnl(unrealizedPnL, 'desktop')}
                </div>
              </div>
            </div>

            <div className="h-8 w-px bg-gray-700"></div>

            <div className="flex items-center space-x-2">
              <div>
                <div className="text-xs text-gray-400">Margin Level</div>
                <div className={`text-lg font-bold ${getMarginLevelColor()}`}>
                  {format.percent(marginLevel, 0, 'desktop')}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

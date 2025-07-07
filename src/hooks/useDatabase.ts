import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { isValidUUID } from '../lib/supabase';

// Hook for database statistics
export const useDatabaseStats = () => {
  const { user, profile, databaseConnected } = useAuth();
  const [stats, setStats] = useState({
    totalPrompts: 0,
    totalTrades: 0,
    totalJournalEntries: 0,
    accountValue: 0,
    winRate: 0,
    totalPnL: 0
  });
  const [isLoading, setIsLoading] = useState(false);

  const loadStats = useCallback(async () => {
    if (!user) {
      setStats({
        totalPrompts: 0,
        totalTrades: 0,
        totalJournalEntries: 0,
        accountValue: 0,
        winRate: 0,
        totalPnL: 0
      });
      return;
    }

    setIsLoading(true);

    try {
      // Check for MT5 data first for more accurate stats
      const mt5Connected = localStorage.getItem('pipnosis_mt5_connected') === 'true';
      const mt5AccountData = localStorage.getItem('pipnosis_mt5_account');
      let mt5Positions = [];
      let mt5Balance = 0;
      
      const isAdmin = user.email?.includes('admin');
        
      // Get trade count from localStorage if available
      let tradeCount = 0;
      try {
        const storedTradeCount = localStorage.getItem('pipnosis_trade_count');
        if (storedTradeCount) {
          tradeCount = parseInt(storedTradeCount, 10);
        } else {
          tradeCount = isAdmin ? 32 : 8;
          // Store initial count
          localStorage.setItem('pipnosis_trade_count', tradeCount.toString());
        }
      } catch (error) {
        tradeCount = isAdmin ? 32 : 8;
      }
        
      try {
        const parsedData = JSON.parse(mt5AccountData);
        // Add null check before accessing properties
        if (parsedData) {
          mt5Balance = parsedData.balance || 0;
          mt5Positions = parsedData.openPositions || [];
        }
      } catch (error) {
        console.error('Error parsing MT5 account data:', error);
      }

      // For test users, provide realistic stats based on user type
      if (!isValidUUID(user.id)) {
        console.log('⚠️ Using realistic stats for test user:', user.id);

        const isAdmin = user.email?.includes('admin');
        // Use MT5 balance if available, otherwise use profile balance
        const accountBalance = mt5Balance || profile?.account_balance || (isAdmin ? 50000 : 10000);
        // Count MT5 positions if available
        const openPositionsCount = mt5Positions.length;
        
        // Get trade counts from localStorage
        let totalTrades = 0;
        let winningTrades = 0;
        let losingTrades = 0;
        
        try {
          const storedTotalTrades = localStorage.getItem('pipnosis_trade_count');
          const storedWinningTrades = localStorage.getItem('pipnosis_winning_trades');
          const storedLosingTrades = localStorage.getItem('pipnosis_losing_trades');
          
          if (storedTotalTrades) {
            totalTrades = parseInt(storedTotalTrades, 10);
          } else {
            totalTrades = isAdmin ? 32 : (openPositionsCount > 0 ? openPositionsCount + 5 : 8);
            localStorage.setItem('pipnosis_trade_count', totalTrades.toString());
          }
          
          if (storedWinningTrades) {
            winningTrades = parseInt(storedWinningTrades, 10);
          } else {
            winningTrades = Math.round(totalTrades * 0.75);
            localStorage.setItem('pipnosis_winning_trades', winningTrades.toString());
          }
          
          if (storedLosingTrades) {
            losingTrades = parseInt(storedLosingTrades, 10);
          } else {
            losingTrades = totalTrades - winningTrades;
            localStorage.setItem('pipnosis_losing_trades', losingTrades.toString());
          }
        } catch (error) {
          totalTrades = isAdmin ? 32 : (openPositionsCount > 0 ? openPositionsCount + 5 : 8);
          winningTrades = Math.round(totalTrades * 0.75);
          losingTrades = totalTrades - winningTrades;
        }
        
        const winRate = isAdmin ? 78.5 : 75.0;
        const pnl = isAdmin ? accountBalance * 0.15 : accountBalance * 0.05;
        
        setStats({
          totalPrompts: isAdmin ? 18 : 5,
          totalTrades: totalTrades,
          totalJournalEntries: isAdmin ? 42 : 12,
          accountValue: accountBalance,
          winRate: winRate,
          totalPnL: pnl
        });
        
        setIsLoading(false);
        return;
      }

      // For real users with database connection
      if (databaseConnected) {
        // In a real implementation, this would fetch data from the database
        // Get trade counts from localStorage
        let totalTrades = 0;
        let winningTrades = 0;
        let losingTrades = 0;
        
        try {
          const storedTotalTrades = localStorage.getItem('pipnosis_trade_count');
          const storedWinningTrades = localStorage.getItem('pipnosis_winning_trades');
          const storedLosingTrades = localStorage.getItem('pipnosis_losing_trades');
          
          if (storedTotalTrades) {
            totalTrades = parseInt(storedTotalTrades, 10);
          } else {
            totalTrades = 12;
            localStorage.setItem('pipnosis_trade_count', totalTrades.toString());
          }
          
          if (storedWinningTrades) {
            winningTrades = parseInt(storedWinningTrades, 10);
          } else {
            winningTrades = Math.round(totalTrades * 0.75);
            localStorage.setItem('pipnosis_winning_trades', winningTrades.toString());
          }
          
          if (storedLosingTrades) {
            losingTrades = parseInt(storedLosingTrades, 10);
          } else {
            losingTrades = totalTrades - winningTrades;
            localStorage.setItem('pipnosis_losing_trades', losingTrades.toString());
          }
        } catch (error) {
          totalTrades = 12;
          winningTrades = 9;
          losingTrades = 3;
        }
        
        // Use MT5 balance if available, otherwise use profile balance
        const accountBalance = mt5Balance || profile?.account_balance || 10000;
        const openPositionsCount = mt5Positions.length;
        const calculatedWinRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 75.0;        
        
        setStats({
          totalPrompts: Math.max(3, Math.round(totalTrades * 0.8)),
          totalTrades: totalTrades,
          totalJournalEntries: Math.max(5, Math.round(totalTrades * 1.5)),
          accountValue: accountBalance,
          winRate: calculatedWinRate,
          totalPnL: Math.round(accountBalance * 0.05)
        });
      } else {
        // For users without database connection, use profile data
        const accountBalance = mt5Balance || profile?.account_balance || 10000;
        const openPositionsCount = mt5Positions.length;
        
        setStats({
          totalPrompts: openPositionsCount,
          totalTrades: openPositionsCount,
          totalJournalEntries: openPositionsCount > 0 ? openPositionsCount * 2 : 0,
          accountValue: accountBalance,
          winRate: openPositionsCount > 0 ? 75.0 : 0,
          totalPnL: openPositionsCount > 0 ? Math.round(accountBalance * 0.02) : 0
        });
      }
    } catch (err) {
      console.error('❌ Error loading database stats:', err);
      // Fallback to profile data on error
      // Try to get MT5 balance first
      let accountBalance = 10000;
      try {
        const mt5Connected = localStorage.getItem('pipnosis_mt5_connected') === 'true';
        const mt5AccountData = localStorage.getItem('pipnosis_mt5_account');
        
        if (mt5Connected && mt5AccountData) {
          const parsedData = JSON.parse(mt5AccountData);
          // Add null check before accessing properties
          if (parsedData && parsedData.balance) {
            accountBalance = parsedData.balance;
          } else {
            accountBalance = profile?.account_balance || 10000;
          }
        } else {
          accountBalance = profile?.account_balance || 10000;
        }
      } catch (error) {
        accountBalance = profile?.account_balance || 10000;
      }
      
      setStats({
        totalPrompts: 0,
        totalTrades: 0,
        totalJournalEntries: 0,
        accountValue: accountBalance,
        winRate: 0,
        totalPnL: 0
      });
    } finally {
      setIsLoading(false);
    }
  }, [user, profile, databaseConnected]);

  // Load stats on mount and when dependencies change
  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 60000);
    return () => clearInterval(interval);
  }, [loadStats]);

  // Function to update trade count when a new trade is executed
  const updateTradeCount = useCallback((success: boolean = true) => {
    if (!user) return;

    try {
      // Get current counts
      const totalTradesStr = localStorage.getItem('pipnosis_trade_count') || '0';
      const winningTradesStr = localStorage.getItem('pipnosis_winning_trades') || '0';
      const losingTradesStr = localStorage.getItem('pipnosis_losing_trades') || '0';

      // Parse to numbers
      let totalTrades = parseInt(totalTradesStr, 10);
      let winningTrades = parseInt(winningTradesStr, 10);
      let losingTrades = parseInt(losingTradesStr, 10);

      // Increment counts
      totalTrades += 1;
      if (success) {
        winningTrades += 1;
      } else {
        losingTrades += 1;
      }

      // Store updated counts
      localStorage.setItem('pipnosis_trade_count', totalTrades.toString());
      localStorage.setItem('pipnosis_winning_trades', winningTrades.toString());
      localStorage.setItem('pipnosis_losing_trades', losingTrades.toString());

      // Refresh stats
      setTimeout(loadStats, 500);
      
      console.log('✅ Trade count updated:', { totalTrades, winningTrades, losingTrades });
    } catch (error) {
      console.error('Error updating trade count:', error);
    }
  }, [user, loadStats]);

  return {
    stats,
    isLoading,
    refreshStats: loadStats,
    updateTradeCount
  };
};

// Hook for waitlist
export const useWaitlist = () => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const submitToWaitlist = useCallback(async (email: string, planType: 'free' | 'beta') => {
    setIsSubmitting(true);
    setError(null);
    setSuccess(false);

    try {
      // In a real implementation, this would call the API
      // For now, we'll simulate a successful submission
      await new Promise(resolve => setTimeout(resolve, 1000));
      setSuccess(true);
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to join waitlist';
      setError(errorMessage);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  const resetState = useCallback(() => {
    setError(null);
    setSuccess(false);
  }, []);

  return {
    submitToWaitlist,
    isSubmitting,
    error,
    success,
    resetState
  };
};
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { isValidUUID, supabase } from '../lib/supabase';

// Hook for database statistics
export const useDatabaseStats = () => {
  const { user, profile, databaseConnected } = useAuth();
  const [stats, setStats] = useState({
    openPositions: 0,
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
      // Get real data from database
      if (databaseConnected) {
        try {
          // Get trade records count
          const { count: tradeCount, error: tradeError } = await supabase
            .from('trade_records')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id);
            
          // Get prompts count
          const { count: promptCount, error: promptError } = await supabase
            .from('trading_prompts')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id);
            
          // Get journal entries count
          const { count: journalCount, error: journalError } = await supabase
            .from('journal_entries')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id);
            
          // Get open positions count
          const { count: openPositionsCount, error: positionsError } = await supabase
            .from('trade_records')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('status', 'open');
            
          // Get total PnL
          const { data: pnlData, error: pnlError } = await supabase
            .from('trade_records')
            .select('pnl')
            .eq('user_id', user.id);
            
          const totalPnL = pnlData ? pnlData.reduce((sum, record) => sum + (record.pnl || 0), 0) : 0;
          
          // Calculate win rate
          const { data: winData, error: winError } = await supabase
            .from('trade_records')
            .select('pnl')
            .eq('user_id', user.id)
            .eq('status', 'closed');
            
          const winningTrades = winData ? winData.filter(record => record.pnl > 0).length : 0;
          const totalClosedTrades = winData ? winData.length : 0;
          const winRate = totalClosedTrades > 0 ? (winningTrades / totalClosedTrades) * 100 : 0;
          
          // Get MT5 data for account balance
          const mt5Connected = localStorage.getItem('pipnosis_mt5_connected') === 'true';
          const mt5AccountData = localStorage.getItem('pipnosis_mt5_account');
          let mt5Balance = 0;
          
          try {
            if (mt5Connected && mt5AccountData) {
              const parsedData = JSON.parse(mt5AccountData);
              if (parsedData && parsedData.balance) {
                mt5Balance = parsedData.balance;
              }
            }
          } catch (error) {
            console.error('Error parsing MT5 account data:', error);
          }
          
          // Use MT5 balance if available, otherwise use profile balance
          const accountBalance = mt5Balance || profile?.account_balance || 10000;
          
          setStats({
            openPositions: openPositionsCount || 0,
            totalPrompts: promptCount || 0,
            totalTrades: tradeCount || 0,
            totalJournalEntries: journalCount || 0,
            accountValue: accountBalance,
            winRate: winRate,
            totalPnL: totalPnL
          });
        } catch (error) {
          console.error('Error fetching database stats:', error);
          
          // Fallback to profile data
          setStats({
            openPositions: 0,
            totalPrompts: 0,
            totalTrades: 0,
            totalJournalEntries: 0,
            accountValue: profile?.account_balance || 10000,
            winRate: 0,
            totalPnL: 0
          });
        }
      } else {
        // For users without database connection, use profile data
        const accountBalance = profile?.account_balance || 10000;
        
        setStats({
          openPositions: 0,
          totalPrompts: 0,
          totalTrades: 0,
          totalJournalEntries: 0,
          accountValue: accountBalance,
          winRate: 0,
          totalPnL: 0
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
        openPositions: 0,
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
    
    // Immediately refresh stats
    loadStats();
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
      // Call the API to submit to waitlist
      const { data, error } = await supabase
        .from('waitlist')
        .insert({
          email,
          plan_type: planType,
          created_at: new Date().toISOString()
        });
        
      if (error) {
        if (error.code === '23505') { // Unique constraint violation
          setError('This email is already on the waitlist');
        } else {
          setError(error.message);
        }
        return false;
      }
      
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
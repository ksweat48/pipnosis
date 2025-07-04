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
      // For test users, provide realistic stats based on user type
      if (!isValidUUID(user.id)) {
        console.log('⚠️ Using realistic stats for test user:', user.id);
        
        const isAdmin = user.email?.includes('admin');
        const accountBalance = profile?.account_balance || (isAdmin ? 50000 : 10000);
        const tradeCount = isAdmin ? 32 : 8;
        const winRate = isAdmin ? 78.5 : 75.0;
        const pnl = isAdmin ? accountBalance * 0.15 : accountBalance * 0.05;
        
        setStats({
          totalPrompts: isAdmin ? 18 : 5,
          totalTrades: tradeCount,
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
        // For now, we'll use mock data
        const accountBalance = profile?.account_balance || 10000;
        
        setStats({
          totalPrompts: 5,
          totalTrades: 12,
          totalJournalEntries: 18,
          accountValue: accountBalance,
          winRate: 75.0,
          totalPnL: accountBalance * 0.05
        });
      } else {
        // For users without database connection, use profile data
        const accountBalance = profile?.account_balance || 10000;
        
        setStats({
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
      const accountBalance = profile?.account_balance || 10000;
      
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

  return {
    stats,
    isLoading,
    refreshStats: loadStats
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
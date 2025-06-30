import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  saveTradingPrompt,
  getTradingPrompts,
  saveTradeRecord,
  getTradeRecords,
  saveJournalEntry,
  getJournalEntries,
  joinWaitlist,
  TradingPrompt,
  TradeRecord,
  JournalEntry,
  WaitlistEntry
} from '../lib/supabase';

// Helper function to check if a string is a valid UUID
const isValidUUID = (str: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
};

// Hook for trading prompts
export const useTradingPrompts = () => {
  const { user, databaseConnected } = useAuth();
  const [prompts, setPrompts] = useState<TradingPrompt[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPrompts = useCallback(async () => {
    if (!user || !databaseConnected) return;

    // Skip database operations for test users (they don't have valid UUIDs)
    if (!isValidUUID(user.id)) {
      console.log('⚠️ Skipping database operation for test user:', user.id);
      setPrompts([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await getTradingPrompts(user.id);
      setPrompts(data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load prompts';
      setError(errorMessage);
      console.error('❌ Error loading prompts:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user, databaseConnected]);

  const savePrompt = useCallback(async (promptData: Partial<TradingPrompt>) => {
    if (!user || !databaseConnected) return null;

    // Skip database operations for test users
    if (!isValidUUID(user.id)) {
      console.log('⚠️ Skipping database operation for test user:', user.id);
      return null;
    }

    try {
      const prompt = await saveTradingPrompt({
        ...promptData,
        user_id: user.id,
      });
      
      // Add to local state
      setPrompts(prev => [prompt, ...prev]);
      return prompt;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save prompt';
      setError(errorMessage);
      console.error('❌ Error saving prompt:', err);
      return null;
    }
  }, [user, databaseConnected]);

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  return {
    prompts,
    isLoading,
    error,
    savePrompt,
    refreshPrompts: loadPrompts
  };
};

// Hook for trade records
export const useTradeRecords = () => {
  const { user, databaseConnected } = useAuth();
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTrades = useCallback(async () => {
    if (!user || !databaseConnected) return;

    // Skip database operations for test users
    if (!isValidUUID(user.id)) {
      console.log('⚠️ Skipping database operation for test user:', user.id);
      setTrades([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await getTradeRecords(user.id);
      setTrades(data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load trades';
      setError(errorMessage);
      console.error('❌ Error loading trades:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user, databaseConnected]);

  const saveTrade = useCallback(async (tradeData: Partial<TradeRecord>) => {
    if (!user || !databaseConnected) return null;

    // Skip database operations for test users
    if (!isValidUUID(user.id)) {
      console.log('⚠️ Skipping database operation for test user:', user.id);
      return null;
    }

    try {
      const trade = await saveTradeRecord({
        ...tradeData,
        user_id: user.id,
      });
      
      // Add to local state
      setTrades(prev => [trade, ...prev]);
      return trade;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save trade';
      setError(errorMessage);
      console.error('❌ Error saving trade:', err);
      return null;
    }
  }, [user, databaseConnected]);

  const updateTrade = useCallback(async (tradeId: string, updates: Partial<TradeRecord>) => {
    // Update local state optimistically
    setTrades(prev => prev.map(trade => 
      trade.id === tradeId ? { ...trade, ...updates } : trade
    ));

    // In a real implementation, you'd update the database here
    // For now, we'll just update the local state
  }, []);

  useEffect(() => {
    loadTrades();
  }, [loadTrades]);

  return {
    trades,
    isLoading,
    error,
    saveTrade,
    updateTrade,
    refreshTrades: loadTrades
  };
};

// Hook for journal entries
export const useJournalEntries = () => {
  const { user, databaseConnected } = useAuth();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    if (!user || !databaseConnected) return;

    // Skip database operations for test users
    if (!isValidUUID(user.id)) {
      console.log('⚠️ Skipping database operation for test user:', user.id);
      setEntries([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await getJournalEntries(user.id);
      setEntries(data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load journal entries';
      setError(errorMessage);
      console.error('❌ Error loading journal entries:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user, databaseConnected]);

  const saveEntry = useCallback(async (entryData: Partial<JournalEntry>) => {
    if (!user || !databaseConnected) return null;

    // Skip database operations for test users
    if (!isValidUUID(user.id)) {
      console.log('⚠️ Skipping database operation for test user:', user.id);
      return null;
    }

    try {
      const entry = await saveJournalEntry({
        ...entryData,
        user_id: user.id,
      });
      
      // Add to local state
      setEntries(prev => [entry, ...prev]);
      return entry;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save journal entry';
      setError(errorMessage);
      console.error('❌ Error saving journal entry:', err);
      return null;
    }
  }, [user, databaseConnected]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  return {
    entries,
    isLoading,
    error,
    saveEntry,
    refreshEntries: loadEntries
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
      await joinWaitlist(email, planType);
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
      // Set default stats for non-connected users
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
        
        // Different stats for admin vs regular test users
        const isAdmin = user.email?.includes('admin');
        const accountBalance = profile?.account_balance || (isAdmin ? 50000 : 10000);
        const tradeCount = isAdmin ? 32 : 8;
        const winRate = isAdmin ? 78.5 : 75.0;
        const pnl = isAdmin ? accountBalance * 0.15 : accountBalance * 0.05; // 15% or 5% profit
        
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
        // Load all user data to calculate stats
        const [prompts, trades, entries] = await Promise.all([
          getTradingPrompts(user.id),
          getTradeRecords(user.id),
          getJournalEntries(user.id)
        ]);

        // Calculate statistics
        const closedTrades = trades.filter(t => t.status === 'closed');
        const winningTrades = closedTrades.filter(t => (t.pnl || 0) > 0);
        const totalPnL = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
        const winRate = closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0;
        const accountBalance = profile?.account_balance || 10000;

        setStats({
          totalPrompts: prompts.length,
          totalTrades: trades.length,
          totalJournalEntries: entries.length,
          accountValue: accountBalance + totalPnL, // Starting balance + PnL
          winRate: Math.round(winRate * 10) / 10, // Round to 1 decimal place
          totalPnL: Math.round(totalPnL * 100) / 100 // Round to 2 decimal places
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
    
    // Refresh stats every 60 seconds
    const interval = setInterval(loadStats, 60000);
    return () => clearInterval(interval);
  }, [loadStats]);

  return {
    stats,
    isLoading,
    refreshStats: loadStats
  };
};
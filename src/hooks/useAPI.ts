import { useState, useEffect, useCallback } from 'react';
import { pipnosisAPI } from '../services/api';
import { getUserKPIs, getActiveTrades, getTradeHistory, getJournalEntries } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export const useBackendConnection = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const checkConnection = useCallback(async () => {
    setIsChecking(true);
    try {
      const connected = await pipnosisAPI.testConnection();
      setIsConnected(connected);
      setLastChecked(new Date());
    } catch (error) {
      setIsConnected(false);
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    checkConnection();
    const interval = setInterval(checkConnection, 30000);
    return () => clearInterval(interval);
  }, [checkConnection]);

  return { isConnected, isChecking, lastChecked, checkConnection };
};

export const useMarketData = (refreshInterval: number = 5000) => {
  const [marketData, setMarketData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchMarketData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await pipnosisAPI.getMarketData();
      setMarketData(data);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch market data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMarketData();
    const interval = setInterval(fetchMarketData, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchMarketData, refreshInterval]);

  return { marketData, isLoading, error, lastUpdated, refetch: fetchMarketData };
};

export const usePromptAnalysis = () => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyzePrompt = useCallback(async (
    prompt: string,
    accountBalance: number,
    marketData?: any[]
  ): Promise<any | null> => {
    setIsAnalyzing(true);
    setError(null);

    try {
      const analysis = await pipnosisAPI.analyzePrompt(prompt, accountBalance, marketData);
      return analysis;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to analyze prompt';
      setError(errorMessage);
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  return { analyzePrompt, isAnalyzing, error };
};

export const useTradeExecution = () => {
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const executeTrade = useCallback(async (strategy: any): Promise<any> => {
    setIsExecuting(true);
    setError(null);

    try {
      const result = await pipnosisAPI.executeTrade(strategy);
      if (!result.success && result.error) {
        setError(result.error);
      }
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to execute trade';
      setError(errorMessage);
      return { success: false, message: errorMessage };
    } finally {
      setIsExecuting(false);
    }
  }, []);

  return { executeTrade, isExecuting, error };
};

export const useTradingKPIs = (userId?: string) => {
  const [kpis, setKpis] = useState<any>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  const actualUserId = userId || user?.id;

  const fetchKPIs = useCallback(async () => {
    if (!actualUserId) {
      setIsLoading(false);
      return;
    }
    
    try {
      setIsLoading(true);
      setError(null);
      const { data, error: kpisError } = await getUserKPIs(actualUserId);
      
      if (kpisError) {
        setError(kpisError.message);
      } else {
        setKpis(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch KPIs');
    } finally {
      setIsLoading(false);
    }
  }, [actualUserId]);

  useEffect(() => {
    fetchKPIs();
  }, [fetchKPIs]);

  return { kpis, isLoading, error, refetch: fetchKPIs };
};

export const useActiveTrades = (userId?: string) => {
  const [trades, setTrades] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  const actualUserId = userId || user?.id;

  const fetchTrades = useCallback(async () => {
    if (!actualUserId) {
      setTrades([]);
      setIsLoading(false);
      return;
    }
    
    try {
      setIsLoading(true);
      setError(null);
      const { data, error: tradesError } = await getActiveTrades(actualUserId);
      
      if (tradesError) {
        setError(tradesError.message);
        setTrades([]);
      } else {
        setTrades(data || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch active trades');
      setTrades([]);
    } finally {
      setIsLoading(false);
    }
  }, [actualUserId]);

  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);

  return { trades, isLoading, error, refetch: fetchTrades };
};

export const useTradeHistory = (userId?: string, limit: number = 50) => {
  const [trades, setTrades] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  const actualUserId = userId || user?.id;

  const fetchTradeHistory = useCallback(async () => {
    if (!actualUserId) {
      setTrades([]);
      setIsLoading(false);
      return;
    }
    
    try {
      setIsLoading(true);
      setError(null);
      const { data, error: historyError } = await getTradeHistory(actualUserId, limit);
      
      if (historyError) {
        setError(historyError.message);
        setTrades([]);
      } else {
        setTrades(data || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch trade history');
      setTrades([]);
    } finally {
      setIsLoading(false);
    }
  }, [actualUserId, limit]);

  useEffect(() => {
    fetchTradeHistory();
  }, [fetchTradeHistory]);

  return { trades, isLoading, error, refetch: fetchTradeHistory };
};

export const useJournalEntries = (userId?: string, limit: number = 20) => {
  const [entries, setEntries] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  const actualUserId = userId || user?.id;

  const fetchEntries = useCallback(async () => {
    if (!actualUserId) {
      setEntries([]);
      setIsLoading(false);
      return;
    }
    
    try {
      setIsLoading(true);
      setError(null);
      const { data, error: entriesError } = await getJournalEntries(actualUserId, limit);
      
      if (entriesError) {
        setError(entriesError.message);
        setEntries([]);
      } else {
        setEntries(data || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch journal entries');
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  }, [actualUserId, limit]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  return { entries, isLoading, error, refetch: fetchEntries };
};

export const useTradeSessionManagement = () => {
  const [isStarting, setIsStarting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startSession = useCallback(async (userId: string, symbol: string, accountBalance?: number) => {
    setIsStarting(true);
    setError(null);

    try {
      const result = await pipnosisAPI.startTradeSession(userId, symbol, accountBalance);
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to start trade session';
      setError(errorMessage);
      throw err;
    } finally {
      setIsStarting(false);
    }
  }, []);

  const closeSession = useCallback(async (sessionId: string, reason?: string) => {
    setIsClosing(true);
    setError(null);

    try {
      const result = await pipnosisAPI.closeTradeSession(sessionId, reason);
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to close trade session';
      setError(errorMessage);
      throw err;
    } finally {
      setIsClosing(false);
    }
  }, []);

  return { startSession, closeSession, isStarting, isClosing, error };
};

export const useAdminDashboard = () => {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [todayActivity, activeUsers, costTracker, usageTrends] = await Promise.all([
        pipnosisAPI.getAdminTodayActivity(),
        pipnosisAPI.getAdminActiveUsers(),
        pipnosisAPI.getAdminCostTracker(),
        pipnosisAPI.getAdminUsageTrends(7)
      ]);

      setData({
        todayActivity,
        activeUsers,
        costTracker,
        usageTrends
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch dashboard data';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  return { data, isLoading, error, refetch: fetchDashboardData };
};
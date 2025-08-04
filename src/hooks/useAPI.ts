import { useState, useEffect, useCallback } from 'react';
import { pipnosisAPI } from '../services/api';
import { getUserKPIs, getActiveTrades, getTradeHistory, getJournalEntries } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

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
      setError('Market data temporarily unavailable');
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
      return result;
    } catch (err) {
      const errorMessage = 'Trade execution temporarily unavailable';
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

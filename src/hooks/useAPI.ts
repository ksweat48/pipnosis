import { useState, useEffect, useCallback } from 'react';
import { pipnosisAPI } from '../services/api';
import { simulatedTradingService } from '../services/simulated-trading';
import { supabase } from '@/lib/supabase';

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
    } catch (error) {
      console.error('Trade execution failed:', error);
      
      const notification = {
        id: Date.now().toString(),
        type: 'error',
        title: 'Trade Execution Error',
        message: 'Failed to execute trade. Please try again.',
        timestamp: 'Just now',
        read: false
      };
      
      return { success: false, message: 'Trade execution temporarily unavailable' };
    } finally {
      setIsExecuting(false);
    }
  }, []);

  return { executeTrade, isExecuting, error };
};

// Mock data hooks - no longer connected to Supabase
export const useTradingKPIs = () => {
  const [kpis] = useState({
    winRate: 75.5,
    averageRRR: 2.1,
    maxDrawdown: 8.2,
    totalPnL: 1250.75,
    winningTrades: 15,
    losingTrades: 5,
    totalTrades: 20
  });
  const [isLoading] = useState(false);
  const [error] = useState<string | null>(null);

  const refetch = useCallback(() => {
    // Mock refetch - no actual data fetching
    console.log('Mock KPIs refetch');
  }, []);

  return { kpis, isLoading, error, refetch };
};

export const useActiveTrades = (userId?: string) => {
  const [trades, setTrades] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTrades = useCallback(async () => {
    if (!userId) {
      setTrades([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const positions = await simulatedTradingService.getOpenPositions(userId);
      setTrades(positions.map(p => ({
        id: p.id,
        symbol: p.symbol,
        trade_type: p.tradeType,
        lot_size: p.lotSize,
        entry_price: p.entryPrice,
        current_price: p.currentPrice || p.entryPrice,
        pnl: p.pnl,
        opened_at: p.openedAt,
        status: p.status
      })));
    } catch (err) {
      console.error('Failed to fetch active trades:', err);
      setError('Failed to load active trades');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);

  return { trades, isLoading, error, refetch: fetchTrades };
};

export const useTradeHistory = (userId?: string, limit: number = 50) => {
  const [trades, setTrades] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    if (!userId) {
      setTrades([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const history = await simulatedTradingService.getTradeHistory(userId, limit);
      setTrades(history.map(t => ({
        id: t.id,
        symbol: t.symbol,
        trade_type: t.tradeType,
        lot_size: t.lotSize,
        entry_price: t.entryPrice,
        current_price: t.currentPrice || t.entryPrice,
        pnl: t.pnl,
        opened_at: t.openedAt,
        closed_at: t.closedAt,
        status: t.status
      })));
    } catch (err) {
      console.error('Failed to fetch trade history:', err);
      setError('Failed to load trade history');
    } finally {
      setIsLoading(false);
    }
  }, [userId, limit]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return { trades, isLoading, error, refetch: fetchHistory };
};

export const useJournalEntries = (userId?: string, limit: number = 20) => {
  const [entries, setEntries] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    if (!userId) {
      setEntries([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('journal_entries')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (fetchError) throw fetchError;
      setEntries(data || []);
    } catch (err) {
      console.error('Failed to fetch journal entries:', err);
      setError('Failed to load journal entries');
    } finally {
      setIsLoading(false);
    }
  }, [userId, limit]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  return { entries, isLoading, error, refetch: fetchEntries };
};
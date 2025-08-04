import { useState, useEffect, useCallback } from 'react';
import { pipnosisAPI } from '../services/api';

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

export const useActiveTrades = () => {
  const [trades] = useState([
    {
      id: 'demo-1',
      symbol: 'EURUSD',
      trade_type: 'buy',
      lot_size: 0.3,
      entry_price: 1.1425,
      current_price: 1.1445,
      pnl: 60.00,
      opened_at: new Date().toISOString(),
      status: 'open'
    }
  ]);
  const [isLoading] = useState(false);
  const [error] = useState<string | null>(null);

  const refetch = useCallback(() => {
    console.log('Mock active trades refetch');
  }, []);

  return { trades, isLoading, error, refetch };
};

export const useTradeHistory = (userId?: string, limit: number = 50) => {
  const [trades] = useState([
    {
      id: 'demo-history-1',
      symbol: 'GBPUSD',
      trade_type: 'sell',
      lot_size: 0.5,
      entry_price: 1.2735,
      current_price: 1.2685,
      pnl: 250.00,
      opened_at: new Date(Date.now() - 3600000).toISOString(),
      closed_at: new Date().toISOString(),
      status: 'closed'
    }
  ]);
  const [isLoading] = useState(false);
  const [error] = useState<string | null>(null);

  const refetch = useCallback(() => {
    console.log('Mock trade history refetch');
  }, []);

  return { trades, isLoading, error, refetch };
};

export const useJournalEntries = () => {
  const [entries] = useState([
    {
      id: 'demo-journal-1',
      entry_type: 'trade_entry',
      title: 'EURUSD Buy Signal Detected',
      content: 'AI detected strong bullish momentum on EURUSD with multiple confirmations. Entry at 1.1425 with 2:1 risk-reward ratio.',
      confidence_level: 'high',
      metadata: {
        symbol: 'EURUSD',
        pnl: null,
        userReaction: null
      },
      created_at: new Date().toISOString(),
      trade_id: 'demo-1'
    },
    {
      id: 'demo-journal-2',
      entry_type: 'ai_decision',
      title: 'Risk Management Update',
      content: 'Following Immutable Law #1 (Capital Preservation), adjusting position size to maintain 2% account risk.',
      confidence_level: 'high',
      metadata: {
        userReaction: null
      },
      created_at: new Date(Date.now() - 300000).toISOString(),
      trade_id: null
    }
  ]);
  const [isLoading] = useState(false);
  const [error] = useState<string | null>(null);

  const refetch = useCallback(() => {
    console.log('Mock journal entries refetch');
  }, []);

  return { entries, isLoading, error, refetch };
};
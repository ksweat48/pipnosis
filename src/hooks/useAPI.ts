import { useState, useEffect, useCallback } from 'react';
import { pipnosisAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

// Hook for backend connection status
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

  return {
    isConnected,
    isChecking,
    lastChecked,
    checkConnection
  };
};

// Hook for market data
export const useMarketData = (refreshInterval: number = 5000) => {
  const [marketData, setMarketData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const { user } = useAuth();

  const fetchMarketData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Use the correct API method for market analysis
      const data = await backendAPI.getMarketAnalysis();
      
      if (data && data.symbols) {
        const formattedData: MarketDataPoint[] = data.symbols.map(symbol => ({
          symbol: symbol.symbol,
          price: symbol.bid && symbol.ask ? (symbol.bid + symbol.ask) / 2 : 1.1425,
          change: symbol.change,
          changePercent: symbol.changePercent,
          trend: symbol.trend === 'bullish' ? 'up' : symbol.trend === 'bearish' ? 'down' : 'sideways',
          signal: symbol.signals.includes('Buy Signal') ? 'buy' : 
                 symbol.signals.includes('Sell Signal') ? 'sell' : 'hold'
        }));
        
        setMarketData(formattedData);
      } else {
        const fallbackData = await pipnosisAPI.getMarketData();
        setMarketData(fallbackData);
      }
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to fetch market data:', err);
      try {
        // Fallback to original API if backend fails
        const fallbackData = await pipnosisAPI.getMarketData();
        setMarketData(fallbackData);
        setLastUpdated(new Date());
      } catch (fallbackErr) {
        setError(err instanceof Error ? err.message : 'Failed to fetch market data');
      }
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchMarketData();
    const interval = setInterval(fetchMarketData, user ? 10000 : refreshInterval);
    return () => clearInterval(interval);
  }, [fetchMarketData, refreshInterval, user]);

  return {
    marketData,
    isLoading,
    error,
    lastUpdated,
    refetch: fetchMarketData
  };
};

// Hook for AI prompt analysis
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

  return {
    analyzePrompt,
    isAnalyzing,
    error
  };
};

// Hook for trade execution
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
      return {
        success: false,
        message: errorMessage
      };
    } finally {
      setIsExecuting(false);
    }
  }, []);

  return {
    executeTrade,
    isExecuting,
    error
  };
};

// Hook for MT5 status
export const useMT5Status = (refreshInterval: number = 10000) => {
  const [status, setStatus] = useState<any>({
    connected: false,
    status: 'disconnected',
    message: 'Checking connection...'
  });
  const [isLoading, setIsLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const mt5Status = await pipnosisAPI.getMT5Status();
      setStatus(mt5Status);
    } catch (error) {
      setStatus({
        connected: false,
        status: 'error',
        message: 'Failed to check MT5 status'
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchStatus, refreshInterval]);

  return {
    status,
    isLoading,
    refetch: fetchStatus
  };
};
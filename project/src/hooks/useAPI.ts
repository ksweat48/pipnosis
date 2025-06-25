import { useState, useEffect, useCallback } from 'react';
import { pipnosisAPI, MarketDataPoint, AnalysisResponse, TradingStrategy, TradeExecutionResult, MT5Status } from '../services/api';

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
    
    // Check connection every 30 seconds
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
  const [marketData, setMarketData] = useState<MarketDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchMarketData = useCallback(async () => {
    try {
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
    
    // Set up auto-refresh
    const interval = setInterval(fetchMarketData, refreshInterval);
    
    return () => clearInterval(interval);
  }, [fetchMarketData, refreshInterval]);

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
    marketData?: MarketDataPoint[]
  ): Promise<AnalysisResponse | null> => {
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

  const executeTrade = useCallback(async (strategy: TradingStrategy): Promise<TradeExecutionResult> => {
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
  const [status, setStatus] = useState<MT5Status>({
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
    
    // Set up auto-refresh
    const interval = setInterval(fetchStatus, refreshInterval);
    
    return () => clearInterval(interval);
  }, [fetchStatus, refreshInterval]);

  return {
    status,
    isLoading,
    refetch: fetchStatus
  };
};

// Hook for waitlist signup
export const useWaitlistSignup = () => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const joinWaitlist = useCallback(async (email: string, plan: 'free' | 'beta') => {
    setIsSubmitting(true);
    setError(null);
    setSuccess(false);

    try {
      await pipnosisAPI.joinWaitlist({ email, plan });
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
    joinWaitlist,
    isSubmitting,
    error,
    success,
    resetState
  };
};
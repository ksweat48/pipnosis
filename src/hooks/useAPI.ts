import { useState, useEffect, useCallback } from 'react';
import { pipnosisAPI } from '../services/api';

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
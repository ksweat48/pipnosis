import { useState, useEffect, useCallback } from 'react';
import { backendAPI } from '../services/backendAPI';
import { useAuth } from '../contexts/AuthContext';

// Hook for backend connection status
export const useBackendConnection = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const checkConnection = useCallback(async () => {
    setIsChecking(true);
    try {
      try {
        const health = await backendAPI.healthCheck();
        setIsConnected(health.online);
      } catch (error) {
        console.log('Backend health check failed, using demo mode');
        setIsConnected(false);
      }
      setLastChecked(new Date());
      
      console.log('🔄 Using demo mode - all features available');
    } catch (error) {
      setIsConnected(false);
      setLastChecked(new Date());
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    checkConnection();
    const interval = setInterval(checkConnection, 60000);
    return () => clearInterval(interval);
  }, [checkConnection]);

  return {
    isConnected,
    isChecking,
    lastChecked,
    checkConnection
  };
};

// Hook for AI prompt analysis with backend
export const useBackendPromptAnalysis = () => {
  const { user } = useAuth();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyzePrompt = useCallback(async (
    prompt: string,
    accountBalance: number,
    riskProfile: 'low' | 'medium' | 'high' | 'auto' = 'auto',
    selectedPairs?: string[],
    tradingGoal?: string
  ): Promise<any | null> => {
    setIsAnalyzing(true);
    setError(null);

    try {
      const request = {
        prompt,
        accountBalance,
        riskProfile,
        selectedPairs,
        tradingGoal,
        timeframe: 'H1',
        userId: user?.id
      };

      console.log('🤖 Processing AI prompt:', { 
        prompt: prompt.substring(0, 50) + '...', 
        riskProfile, 
        accountBalance: `$${accountBalance.toLocaleString()}` 
      });
      
      const response = await backendAPI.analyzePrompt(request);
      
      console.log('✅ AI analysis complete:', { 
        strategiesCount: response.strategies.length,
        confidence: response.confidence,
        mode: backendAPI.isFallbackMode() ? 'demo' : 'live'
      });
      
      return response;
    } catch (err) {
      if (!backendAPI.isFallbackMode()) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to analyze prompt';
        setError(errorMessage);
        console.error('❌ Prompt analysis error:', err);
      }
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  }, [user?.id]);

  return {
    analyzePrompt,
    isAnalyzing,
    error
  };
};

// Hook for trade execution with backend
export const useBackendTradeExecution = () => {
  const { user } = useAuth();
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const executeTrade = useCallback(async (
    strategyId: string,
    symbol: string,
    action: 'buy' | 'sell',
    volume: number,
    price: number,
    stopLoss: number,
    takeProfit: number,
    riskAmount: number,
    comment?: string
  ): Promise<any | null> => {
    setIsExecuting(true);
    setError(null);

    try {
      const request = {
        strategyId,
        symbol,
        action,
        volume,
        price,
        stopLoss,
        takeProfit,
        riskAmount,
        userId: user?.id,
        comment: comment || `Pipnosis AI Trade - ${strategyId}`
      };

      console.log('📤 Executing trade:', { 
        symbol, 
        action, 
        volume, 
        riskAmount: `$${riskAmount}`,
        mode: backendAPI.isFallbackMode() ? 'demo' : 'live'
      });
      
      const response = await backendAPI.executeTrade(request);
      
      console.log('✅ Trade execution result:', { 
        success: response.success,
        tradeId: response.tradeId,
        mt5Ticket: response.mt5Ticket,
        message: response.message
      });
      
      return response;
    } catch (err) {
      if (!backendAPI.isFallbackMode()) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to execute trade';
        setError(errorMessage);
        console.error('❌ Trade execution error:', err);
      }
      return null;
    } finally {
      setIsExecuting(false);
    }
  }, [user?.id]);

  return {
    executeTrade,
    isExecuting,
    error
  };
};
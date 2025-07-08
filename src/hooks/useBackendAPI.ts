import { useState, useEffect, useCallback } from 'react';
import { backendAPI } from '../services/backendAPI';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

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
        
        // Also check Supabase connection
        const { data, error } = await supabase.from('user_profiles').select('count').limit(1);
        if (!error) {
          setIsConnected(true);
        }
      } catch (error) {
        console.log('Backend health check failed, using demo mode');
        setIsConnected(false);
      }
      setLastChecked(new Date());
      
      console.log('🔄 Backend connection status:', isConnected ? 'connected' : 'disconnected');
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
  const { profile } = useAuth();

  const analyzePrompt = useCallback(async (
    prompt: string,
    accountBalance: number,
    marketData?: any[],
    selectedPairs?: string[],
    tradingGoal?: string
  ): Promise<any | null> => {
    setIsAnalyzing(true);
    setError(null);

    try {
      const request = {
        prompt,
        accountBalance,
        riskProfile: profile?.risk_profile || 'auto' as 'low' | 'medium' | 'high' | 'auto',
        selectedPairs,
        tradingGoal,
        timeframe: 'H1',
        userId: user?.id
      };

      console.log('🤖 Processing AI prompt:', { 
        prompt: prompt.substring(0, 50) + '...', 
        riskProfile: profile?.risk_profile || 'auto', 
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
      const errorMessage = err instanceof Error ? err.message : 'Failed to analyze prompt';
      setError(errorMessage);
      console.error('❌ Prompt analysis error:', err);
      throw err;
    } finally {
      setIsAnalyzing(false);
    }
  }, [user, profile]);

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

  const executeTrade = useCallback(async (strategy: any): Promise<any | null> => {
    setIsExecuting(true);
    setError(null);

    try {
      console.log('📤 Executing trade:', strategy);
      
      const response = await backendAPI.executeTrade(strategy);
      
      console.log('✅ Trade execution result:', { 
        success: response.success,
        tradeId: response.tradeId,
        message: response.message
      });
      
      return response;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to execute trade';
      setError(errorMessage);
      console.error('❌ Trade execution error:', err);
      throw err;
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
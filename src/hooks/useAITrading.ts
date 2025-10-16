import { useState, useCallback } from 'react';
import { manualTradingService, ManualTradeResponse, TradeExecutionResponse } from '@/services/manual-trading-service';
import { useAuth } from './useAuth';
import { useUserBalance } from './useUserBalance';

export const useAITrading = () => {
  const { user } = useAuth();
  const { balance } = useUserBalance();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<ManualTradeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestTradeAnalysis = useCallback(async (prompt: string) => {
    if (!user?.id) {
      setError('User not authenticated');
      return null;
    }

    setIsAnalyzing(true);
    setError(null);
    setAnalysisResult(null);

    try {
      const result = await manualTradingService.requestTradeAnalysis({
        userId: user.id,
        prompt,
        accountBalance: balance
      });

      if (result.success) {
        setAnalysisResult(result);
        return result;
      } else {
        setError(result.message);
        return null;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to analyze trade request';
      setError(errorMessage);
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  }, [user?.id, balance]);

  const executeSelectedTrade = useCallback(async (optionId: string, decisionId: string): Promise<TradeExecutionResponse | null> => {
    if (!user?.id) {
      setError('User not authenticated');
      return null;
    }

    setIsExecuting(true);
    setError(null);

    try {
      const result = await manualTradingService.executeSelectedTrade({
        userId: user.id,
        optionId,
        decisionId
      });

      if (!result.success) {
        setError(result.message);
      }

      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to execute trade';
      setError(errorMessage);
      return null;
    } finally {
      setIsExecuting(false);
    }
  }, [user?.id]);

  const clearAnalysisResult = useCallback(() => {
    setAnalysisResult(null);
    setError(null);
  }, []);

  const cancelAnalysis = useCallback(async (decisionId: string) => {
    if (!user?.id) return;

    try {
      await manualTradingService.cancelPendingDecision(decisionId, user.id);
      setAnalysisResult(null);
    } catch (err) {
      console.error('Failed to cancel analysis:', err);
    }
  }, [user?.id]);

  return {
    isAnalyzing,
    isExecuting,
    analysisResult,
    error,
    requestTradeAnalysis,
    executeSelectedTrade,
    clearAnalysisResult,
    cancelAnalysis
  };
};

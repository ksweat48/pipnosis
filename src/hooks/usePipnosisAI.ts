import { useState, useCallback } from 'react';
import { pipnosisAI, TradingGoal, TradeStrategy, PromptAnalysisResult } from '../services/pipnosisAIBrain';
import { useAuth } from '../contexts/AuthContext';

/**
 * Hook for using the Pipnosis AI Brain
 */
export const usePipnosisAI = () => {
  const { user, profile } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Configure AI with user profile data
  useEffect(() => {
    if (profile) {
      pipnosisAI.configure({
        accountBalance: profile.account_balance || 10000,
        riskProfile: profile.risk_profile || 'auto'
      });
    }
  }, [profile]);
  
  /**
   * Process a user prompt and generate trading strategies
   */
  const processPrompt = useCallback(async (
    prompt: string,
    marketData?: any[]
  ): Promise<PromptAnalysisResult | null> => {
    setIsProcessing(true);
    setError(null);
    
    try {
      // Update market data if provided
      if (marketData && marketData.length > 0) {
        pipnosisAI.updateMarketData(marketData);
      }
      
      // Update trading state (in a real implementation, this would come from the backend)
      pipnosisAI.updateTradingState({
        currentDrawdown: 1.8,
        currentDailyRisk: 2.5,
        openTrades: 1
      });
      
      // Process the prompt
      const result = await pipnosisAI.processPrompt(prompt);
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to process prompt';
      setError(errorMessage);
      console.error('❌ Pipnosis AI error:', err);
      return null;
    } finally {
      setIsProcessing(false);
    }
  }, []);
  
  /**
   * Execute a trading strategy
   */
  const executeStrategy = useCallback(async (
    strategy: TradeStrategy
  ): Promise<any> => {
    setIsProcessing(true);
    setError(null);
    
    try {
      // In a real implementation, this would call the backend API to execute the trade
      // For now, we'll just return a mock result
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      return {
        success: true,
        tradeId: `TRD-${Date.now()}`,
        symbol: strategy.symbol,
        action: strategy.action,
        entry: strategy.entry,
        stopLoss: strategy.stopLoss,
        takeProfit: strategy.takeProfit,
        lotSize: strategy.lotSize,
        timestamp: new Date().toISOString(),
        message: `${strategy.action.toUpperCase()} ${strategy.symbol} executed at ${strategy.entry}`
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to execute strategy';
      setError(errorMessage);
      console.error('❌ Strategy execution error:', err);
      return {
        success: false,
        error: errorMessage
      };
    } finally {
      setIsProcessing(false);
    }
  }, []);
  
  return {
    processPrompt,
    executeStrategy,
    isProcessing,
    error
  };
};
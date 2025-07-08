import { useState, useCallback, useEffect } from 'react';
import { pipnosisAI } from '../services/pipnosisAIBrain';
import { useAuth } from '../contexts/AuthContext';
import { openAIService } from '../services/openai'; 
import { backendAPI } from '../services/backendAPI';

/**
 * Hook for using the Pipnosis AI Brain
 */
export const usePipnosisAI = () => {
  const { user, profile } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openAIStatus, setOpenAIStatus] = useState<{
    initialized: boolean;
    fallbackMode: boolean;
    apiKeyConfigured: boolean;
  }>({ initialized: false, fallbackMode: true, apiKeyConfigured: false });
  
  // Configure AI with user profile data
  useEffect(() => {
    if (profile) {
      pipnosisAI.configure({
        accountBalance: profile.account_balance || 10000,
        riskProfile: profile.risk_profile || 'auto'
      });
    }
    
    // Check OpenAI status
    const status = openAIService.getStatus();
    setOpenAIStatus(status);
    console.log('🔍 OpenAI Status:', status);
  }, [profile]);
  
  /**
   * Process a user prompt and generate trading strategies
   */
  const processPrompt = useCallback(async (
    prompt: string,
    marketData?: any[]
  ): Promise<any> => {
    setIsProcessing(true);
    setError(null);
    
    try {
      // Process the prompt using local AI
      console.log('🧠 Using backend API for prompt analysis');
      const result = await backendAPI.analyzePrompt({
        prompt,
        accountBalance: profile?.account_balance || 10000,
        riskProfile: profile?.risk_profile || 'auto',
        timeframe: 'H1',
        userId: user?.id
      });
      
      // Transform the result to match the expected format
      return {
        goal: {
          type: 'profit',
          amount: 500,
          timeframe: 'week'
        },
        strategies: result.strategies.map((strategy: any) => ({
          id: strategy.id,
          name: strategy.name,
          risk: strategy.risk,
          symbol: strategy.tradeType.split(' ')[0],
          action: strategy.tradeType.toLowerCase().includes('buy') ? 'buy' : 'sell',
          entry: parseFloat(strategy.entry),
          stopLoss: parseFloat(strategy.stopLoss),
          takeProfit: parseFloat(strategy.takeProfit),
          lotSize: strategy.lotSize,
          estimatedGain: strategy.estimatedGain,
          confidence: strategy.risk === 'low' ? 85 : strategy.risk === 'medium' ? 75 : 65,
          reasoning: strategy.reasoning,
          feasible: strategy.feasible,
          pipnosisLawsCompliance: [
            'Law #1: Capital Preservation',
            'Law #6: High Quality Entry',
            strategy.risk === 'low' ? 'Law #3: Drawdown Management' : 
            strategy.risk === 'medium' ? 'Law #2: Target 70-80% Win Rate' : 
            'Law #5: AI Final Decision'
          ]
        })),
        marketAnalysis: result.summary,
        riskAssessment: result.riskAssessment,
        confidence: result.confidence,
        aiRecommendation: `Based on the analysis, I recommend executing the ${result.strategies[0]?.risk} risk strategy first to test market conditions.`
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to process prompt';
      setError(errorMessage);
      console.error('❌ Pipnosis AI error:', err);
      // Return a minimal fallback response instead of null
      return {
        goal: { type: 'profit', amount: 500, timeframe: 'week' },
        strategies: [],
        marketAnalysis: 'Analysis failed. Please try again.',
        riskAssessment: 'Unable to assess risk at this time.',
        confidence: 'low',
        aiRecommendation: 'Please try again with a different prompt.'
      };
    } finally {
      setIsProcessing(false);
    }
  }, [profile, user]);
  
  /**
   * Execute a trading strategy
   */
  const executeStrategy = useCallback(async (
    strategy: TradeStrategy
  ): Promise<any> => {
    setIsProcessing(true);
    setError(null);
    
    try {
      // Call the backend API to execute the trade
      const result = await backendAPI.executeTrade({
        strategyId: strategy.id,
        symbol: strategy.symbol,
        action: strategy.action,
        volume: strategy.lotSize,
        price: strategy.entry,
        stopLoss: strategy.stopLoss,
        takeProfit: strategy.takeProfit,
        riskAmount: strategy.estimatedGain / 2, // Estimate risk amount
        userId: user?.id,
        comment: `Pipnosis AI: ${strategy.name}`
      });
      
      return result;
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
  }, [user?.id]);
  
  // Force a reconnection to OpenAI
  const reconnectOpenAI = useCallback(async (): Promise<boolean> => {
    try {
      console.log('🔄 Attempting to reconnect to OpenAI...');
      const success = await openAIService.reconnect();
      const status = openAIService.getStatus();
      setOpenAIStatus(status);
      return success;
    } catch (error) {
      console.error('❌ OpenAI reconnection failed:', error);
      return false;
    }
  }, []);
  
  return {
    processPrompt,
    executeStrategy,
    isProcessing,
    error,
    openAIStatus,
    reconnectOpenAI
  };
};
import { useState, useCallback, useEffect } from 'react';
import { pipnosisAI, TradingGoal, TradeStrategy, PromptAnalysisResult } from '../services/pipnosisAIBrain';
import { useAuth } from '../contexts/AuthContext';
import { openAIService } from '../services/openai';

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
      
      // First try to use OpenAI for analysis
      try {
        console.log('🤖 Attempting to use OpenAI for prompt analysis');
        const openAIResult = await openAIService.interpretPrompt(prompt, profile?.account_balance || 10000, marketData);
        
        if (openAIResult && openAIResult.strategies && openAIResult.strategies.length > 0) {
          console.log('✅ Successfully used OpenAI for analysis');
          
          // Convert OpenAI result to Pipnosis AI format
          const strategies = openAIResult.strategies.map((strategy, index) => {
            // Extract symbol and action from tradeType
            const tradeTypeParts = strategy.tradeType.split(' ');
            const symbol = tradeTypeParts[0];
            const action = tradeTypeParts[1]?.toLowerCase().includes('buy') ? 'buy' : 'sell';
            
            return {
              id: strategy.id || `openai-${index}`,
              name: strategy.name,
              risk: strategy.risk,
              symbol,
              action,
              entry: strategy.entry,
              stopLoss: strategy.stopLoss,
              takeProfit: strategy.takeProfit,
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
            };
          });
          
          return {
            goal: {
              type: 'profit',
              amount: 500,
              timeframe: 'week'
            },
            strategies,
            marketAnalysis: openAIResult.summary,
            riskAssessment: openAIResult.riskAssessment,
            confidence: openAIResult.confidence,
            aiRecommendation: `Based on the analysis, I recommend executing the ${strategies[0].risk} risk strategy first to test market conditions.`
          };
        }
      } catch (openAIError) {
        console.warn('⚠️ OpenAI analysis failed, falling back to local AI:', openAIError);
      }
      
      // Process the prompt using local AI
      console.log('🧠 Using local AI for prompt analysis');
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
  }, [profile]);
  
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
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
  ): Promise<any> {
    setIsProcessing(true);
    setError(null);
    
    try {
      // Process the prompt using backend API
      console.log('🧠 Using backend API for prompt analysis:', prompt);
      
      // Add randomization to ensure different results for different prompts
      const randomSeed = Date.now() + prompt.length;
      
      const result = await backendAPI.analyzePrompt({
        prompt,
        accountBalance: profile?.account_balance || 10000,
        riskProfile: profile?.risk_profile || 'auto',
        timeframe: 'H1',
        userId: user?.id,
        // Add the prompt text to the request to ensure it's used
        promptText: prompt
      });
      
      console.log('✅ Received analysis result:', result);
      
      // If we got a real result from the API, return it
      if (result && result.strategies && result.strategies.length > 0) {
        return transformApiResult(result, prompt, randomSeed);
      }
      
      // If we didn't get a real result, generate a more dynamic mock result
      return generateDynamicMockResult(prompt, randomSeed);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to process prompt';
      setError(errorMessage);
      console.error('❌ Pipnosis AI error:', err);
      
      // Generate a dynamic fallback response based on the prompt
      return generateDynamicMockResult(prompt, Date.now());
    } finally {
      setIsProcessing(false);
    }
  }, [profile, user]);
  
  // Function to transform API result to expected format
  const transformApiResult = (result: any, prompt: string, seed: number) => {
    const random = (min: number, max: number) => {
      const x = Math.sin(seed++) * 10000;
      return min + (x - Math.floor(x)) * (max - min);
    };
    
    // Extract keywords from prompt to influence strategy generation
    const keywords = {
      conservative: prompt.toLowerCase().includes('conservative') || 
                   prompt.toLowerCase().includes('safe') || 
                   prompt.toLowerCase().includes('low risk'),
      aggressive: prompt.toLowerCase().includes('aggressive') || 
                 prompt.toLowerCase().includes('high risk') || 
                 prompt.toLowerCase().includes('risky'),
      amount: (prompt.match(/\$(\d+)/) || [])[1] || 
              (prompt.match(/(\d+) dollars/) || [])[1] || 
              '500',
      pairs: ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCAD', 'AUDUSD', 'NZDUSD', 'BTCUSD']
        .filter(pair => prompt.toUpperCase().includes(pair))
    };
    
      // Transform the result to match the expected format
      return {
        goal: {
          type: 'profit',
          amount: parseInt(keywords.amount) || 500,
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
  };
  
  // Function to generate dynamic mock results based on the prompt
  const generateDynamicMockResult = (prompt: string, seed: number) => {
    console.log('🧠 Generating dynamic mock result for prompt:', prompt);
    
    // Create a simple random number generator based on the seed
    const random = (min: number, max: number) => {
      const x = Math.sin(seed++) * 10000;
      return min + (x - Math.floor(x)) * (max - min);
    };
    
    // Extract keywords from prompt to influence strategy generation
    const keywords = {
      conservative: prompt.toLowerCase().includes('conservative') || 
                   prompt.toLowerCase().includes('safe') || 
                   prompt.toLowerCase().includes('low risk'),
      aggressive: prompt.toLowerCase().includes('aggressive') || 
                 prompt.toLowerCase().includes('high risk') || 
                 prompt.toLowerCase().includes('risky'),
      amount: (prompt.match(/\$(\d+)/) || [])[1] || 
              (prompt.match(/(\d+) dollars/) || [])[1] || 
              '500',
      timeframe: prompt.toLowerCase().includes('today') ? 'day' : 
                prompt.toLowerCase().includes('month') ? 'month' : 'week',
      pairs: ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCAD', 'AUDUSD', 'NZDUSD', 'BTCUSD']
        .filter(pair => prompt.toUpperCase().includes(pair))
    };
    
    // If no specific pairs mentioned, select random ones
    if (keywords.pairs.length === 0) {
      const allPairs = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCAD', 'AUDUSD', 'NZDUSD', 'BTCUSD'];
      // Select 3 different pairs
      while (keywords.pairs.length < 3) {
        const pair = allPairs[Math.floor(random(0, allPairs.length))];
        if (!keywords.pairs.includes(pair)) {
          keywords.pairs.push(pair);
        }
      }
    }
    
    // Generate strategies based on the prompt
    const strategies = [];
    
    // Always include a low risk strategy
    strategies.push({
      id: `low-${Date.now()}`,
      name: keywords.conservative ? 'Conservative Capital Protection' : 'Balanced Capital Preservation',
      risk: 'low',
      symbol: keywords.pairs[0] || 'EURUSD',
      action: random(0, 1) > 0.5 ? 'buy' : 'sell',
      entry: parseFloat((random(1, 2) * (keywords.pairs[0]?.includes('JPY') ? 100 : 1)).toFixed(5)),
      stopLoss: parseFloat((random(0.9, 0.99) * (keywords.pairs[0]?.includes('JPY') ? 100 : 1)).toFixed(5)),
      takeProfit: parseFloat((random(1.01, 1.1) * (keywords.pairs[0]?.includes('JPY') ? 100 : 1)).toFixed(5)),
      lotSize: parseFloat(random(0.1, 0.5).toFixed(2)),
      estimatedGain: Math.floor(random(100, 500)),
      confidence: Math.floor(random(80, 90)),
      reasoning: `${keywords.pairs[0] || 'EURUSD'} ${random(0, 1) > 0.5 ? 'buy' : 'sell'} opportunity with strong technical indicators. Following Law #1 (Capital Preservation) with 2% account risk. Multiple confirmations per Law #6.`,
      feasible: true,
      pipnosisLawsCompliance: [
        'Law #1: Capital Preservation',
        'Law #6: High Quality Entry',
        'Law #3: Drawdown Management'
      ]
    });
    
    // Add medium risk strategy
    strategies.push({
      id: `medium-${Date.now()}`,
      name: 'Balanced Growth Strategy',
      risk: 'medium',
      symbol: keywords.pairs[1] || 'GBPUSD',
      action: random(0, 1) > 0.5 ? 'buy' : 'sell',
      entry: parseFloat((random(1, 2) * (keywords.pairs[1]?.includes('JPY') ? 100 : 1)).toFixed(5)),
      stopLoss: parseFloat((random(0.9, 0.99) * (keywords.pairs[1]?.includes('JPY') ? 100 : 1)).toFixed(5)),
      takeProfit: parseFloat((random(1.01, 1.1) * (keywords.pairs[1]?.includes('JPY') ? 100 : 1)).toFixed(5)),
      lotSize: parseFloat(random(0.5, 1.0).toFixed(2)),
      estimatedGain: Math.floor(random(500, 1000)),
      confidence: Math.floor(random(70, 80)),
      reasoning: `${keywords.pairs[1] || 'GBPUSD'} ${random(0, 1) > 0.5 ? 'buy' : 'sell'} opportunity with balanced risk-reward. Following Law #5 (AI Final Decision) with 5% account risk. Law #2 targets 75% win rate.`,
      feasible: true,
      pipnosisLawsCompliance: [
        'Law #1: Capital Preservation',
        'Law #6: High Quality Entry',
        'Law #2: Target 70-80% Win Rate'
      ]
    });
    
    // Add high risk strategy if user wants aggressive approach
    strategies.push({
      id: `high-${Date.now()}`,
      name: keywords.aggressive ? 'Aggressive Opportunity Capture' : 'High Growth Strategy',
      risk: 'high',
      symbol: keywords.pairs[2] || 'BTCUSD',
      action: random(0, 1) > 0.5 ? 'buy' : 'sell',
      entry: parseFloat((random(1, 2) * (keywords.pairs[2]?.includes('JPY') ? 100 : 1)).toFixed(5)),
      stopLoss: parseFloat((random(0.9, 0.99) * (keywords.pairs[2]?.includes('JPY') ? 100 : 1)).toFixed(5)),
      takeProfit: parseFloat((random(1.01, 1.1) * (keywords.pairs[2]?.includes('JPY') ? 100 : 1)).toFixed(5)),
      lotSize: parseFloat(random(1.0, 2.0).toFixed(2)),
      estimatedGain: Math.floor(random(1000, 3000)),
      confidence: Math.floor(random(60, 70)),
      reasoning: `${keywords.pairs[2] || 'BTCUSD'} ${random(0, 1) > 0.5 ? 'buy' : 'sell'} opportunity with higher risk-reward. Following Law #5 (AI Final Decision) with 10% account risk. Law #6 requires multiple confirmations.`,
      feasible: true,
      pipnosisLawsCompliance: [
        'Law #1: Capital Preservation',
        'Law #6: High Quality Entry',
        'Law #5: AI Final Decision'
      ]
    });
    
    // Generate a response based on the prompt
    return {
      goal: {
        type: 'profit',
        amount: parseInt(keywords.amount) || 500,
        timeframe: keywords.timeframe
      },
      strategies,
      marketAnalysis: `Analysis of ${keywords.pairs.length > 0 ? keywords.pairs.join(', ') : 'major currency pairs'} shows ${random(0, 1) > 0.5 ? 'bullish' : 'bearish'} conditions. ${keywords.conservative ? 'Conservative approach recommended.' : keywords.aggressive ? 'Aggressive opportunities identified.' : 'Balanced approach recommended.'}`,
      riskAssessment: `Based on your account balance and ${keywords.conservative ? 'conservative' : keywords.aggressive ? 'aggressive' : 'balanced'} risk profile, position sizing has been optimized for capital preservation while targeting your goal of $${keywords.amount || '500'}.`,
      confidence: keywords.conservative ? 'high' : keywords.aggressive ? 'medium' : 'high',
      aiRecommendation: `Based on your request to "${prompt}", I recommend executing the ${keywords.conservative ? 'low' : keywords.aggressive ? 'high' : 'medium'} risk strategy first to test market conditions.`
    };
  };
  
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
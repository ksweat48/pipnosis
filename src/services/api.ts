// Mock market data for frontend-only mode
const getMockMarketData = () => {
  return [
    { symbol: 'EURUSD', price: 1.1425 + (Math.random() - 0.5) * 0.02, change: (Math.random() - 0.5) * 0.01, changePercent: (Math.random() - 0.5) * 1, trend: Math.random() > 0.5 ? 'up' : 'down', signal: ['buy', 'sell', 'hold'][Math.floor(Math.random() * 3)] },
    { symbol: 'GBPUSD', price: 1.2735 + (Math.random() - 0.5) * 0.02, change: (Math.random() - 0.5) * 0.01, changePercent: (Math.random() - 0.5) * 1, trend: Math.random() > 0.5 ? 'up' : 'down', signal: ['buy', 'sell', 'hold'][Math.floor(Math.random() * 3)] },
    { symbol: 'USDJPY', price: 149.85 + (Math.random() - 0.5) * 2.0, change: (Math.random() - 0.5) * 1.0, changePercent: (Math.random() - 0.5) * 1, trend: Math.random() > 0.5 ? 'up' : 'down', signal: ['buy', 'sell', 'hold'][Math.floor(Math.random() * 3)] },
    { symbol: 'USDCHF', price: 0.8945 + (Math.random() - 0.5) * 0.02, change: (Math.random() - 0.5) * 0.01, changePercent: (Math.random() - 0.5) * 1, trend: Math.random() > 0.5 ? 'up' : 'down', signal: ['buy', 'sell', 'hold'][Math.floor(Math.random() * 3)] },
    { symbol: 'AUDUSD', price: 0.6785 + (Math.random() - 0.5) * 0.02, change: (Math.random() - 0.5) * 0.01, changePercent: (Math.random() - 0.5) * 1, trend: Math.random() > 0.5 ? 'up' : 'down', signal: ['buy', 'sell', 'hold'][Math.floor(Math.random() * 3)] },
    { symbol: 'USDCAD', price: 1.3625 + (Math.random() - 0.5) * 0.02, change: (Math.random() - 0.5) * 0.01, changePercent: (Math.random() - 0.5) * 1, trend: Math.random() > 0.5 ? 'up' : 'down', signal: ['buy', 'sell', 'hold'][Math.floor(Math.random() * 3)] },
    { symbol: 'NZDUSD', price: 0.6245 + (Math.random() - 0.5) * 0.02, change: (Math.random() - 0.5) * 0.01, changePercent: (Math.random() - 0.5) * 1, trend: Math.random() > 0.5 ? 'up' : 'down', signal: ['buy', 'sell', 'hold'][Math.floor(Math.random() * 3)] },
    { symbol: 'EURJPY', price: 171.25 + (Math.random() - 0.5) * 2.0, change: (Math.random() - 0.5) * 1.0, changePercent: (Math.random() - 0.5) * 1, trend: Math.random() > 0.5 ? 'up' : 'down', signal: ['buy', 'sell', 'hold'][Math.floor(Math.random() * 3)] },
    { symbol: 'GBPJPY', price: 190.85 + (Math.random() - 0.5) * 2.0, change: (Math.random() - 0.5) * 1.0, changePercent: (Math.random() - 0.5) * 1, trend: Math.random() > 0.5 ? 'up' : 'down', signal: ['buy', 'sell', 'hold'][Math.floor(Math.random() * 3)] },
    { symbol: 'XAUUSD', price: 2045.50 + (Math.random() - 0.5) * 20, change: (Math.random() - 0.5) * 10, changePercent: (Math.random() - 0.5) * 1, trend: Math.random() > 0.5 ? 'up' : 'down', signal: ['buy', 'sell', 'hold'][Math.floor(Math.random() * 3)] }
  ];
};

// Mock AI analysis for frontend-only mode
const getMockAnalysis = () => {
  return {
    strategies: [
      {
        id: '1',
        name: 'Conservative Capital Protection',
        risk: 'low',
        symbol: 'EURUSD',
        action: 'buy',
        entry: 1.1410,
        stopLoss: 1.1380,
        takeProfit: 1.1470,
        lotSize: 0.3,
        estimatedGain: 180,
        riskRewardRatio: 2.0,
        feasible: true,
        reasoning: 'Conservative approach following Pipnosis Law #1 (Capital Preservation) with 2% account risk. Multiple technical confirmations ensure high-quality entry per Law #6.',
        confidence: 'high'
      },
      {
        id: '2',
        name: 'Balanced Growth Strategy',
        risk: 'medium',
        symbol: 'GBPUSD',
        action: 'sell',
        entry: 1.2735,
        stopLoss: 1.2785,
        takeProfit: 1.2635,
        lotSize: 0.5,
        estimatedGain: 350,
        riskRewardRatio: 2.0,
        feasible: true,
        reasoning: 'Balanced approach per Law #5 (AI Final Decision) with 4% account risk. Maintains target win rate while optimizing for growth.',
        confidence: 'high'
      }
    ],
    summary: 'Market analysis shows clear opportunities across multiple pairs. All strategies comply with Pipnosis Immutable Laws.',
    confidence: 'high',
    riskAssessment: 'Risk management follows Law #1 (Capital Preservation) and Law #3 (Drawdown Management).'
  };
};

class PipnosisAPI {
  static async getMarketData(): Promise<any[]> {
    // Return mock data for frontend-only mode
    return getMockMarketData();
  }

  static async analyzePrompt(
    prompt: string,
    accountBalance: number,
    marketData?: any[]
  ): Promise<any> {
    // Simulate AI analysis delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    return getMockAnalysis();
  }

  static async executeTrade(strategy: any): Promise<any> {
    // Simulate trade execution delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    return {
      success: true,
      tradeId: `DEMO-${Date.now()}`,
      symbol: strategy.symbol || 'EURUSD',
      entry: strategy.entry,
      lotSize: strategy.lotSize,
      timestamp: new Date().toISOString(),
      message: 'Demo trade executed successfully'
    };
  }

  static async testConnection(): Promise<boolean> {
    // Always return true for frontend-only mode
    return true;
  }

  // Removed all backend API calls - now using frontend-only mode
}

export const pipnosisAPI = PipnosisAPI;
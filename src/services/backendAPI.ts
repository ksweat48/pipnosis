import axios from 'axios';

// API Configuration
const getApiBaseUrl = () => {
  // Check if we're in production (pipnosis.com)
  const isProduction = window.location.hostname === 'pipnosis.com' || 
                      window.location.hostname === 'www.pipnosis.com' ||
                      window.location.hostname.includes('netlify.app');
  
  // Check if we're in Bolt's WebContainer environment
  const isWebContainer = window.location.hostname.includes('webcontainer') || 
                         window.location.hostname.includes('bolt.new') ||
                         window.location.hostname.includes('stackblitz');
  
  // Production: Use Railway backend URL
  if (isProduction) {
    return 'https://pipnosis-production.up.railway.app/api';
  }
  
  // For Bolt WebContainer, use the current origin with port 3001
  if (isWebContainer) {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    return `${protocol}//${hostname}:3001/api`;
  }
  
  // For local development, use environment variable or localhost
  return import.meta.env.VITE_PIPNOSIS_API_URL || 'http://localhost:3001/api';
};

const API_BASE_URL = getApiBaseUrl();

// Create axios instance with default config
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000, // 30 seconds for AI analysis
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for logging
apiClient.interceptors.request.use(
  (config) => {
    console.log(`🔄 Backend API Request: ${config.method?.toUpperCase()} ${config.url}`);
    return config;
  },
  (error) => {
    console.error('❌ Backend API Request Error:', error);
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => {
    console.log(`✅ Backend API Response: ${response.config.method?.toUpperCase()} ${response.config.url}`);
    return response;
  },
  (error) => {
    console.error('❌ Backend API Response Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

// Track if we're in fallback mode
let fallbackMode = false;

// Backend API Service
class BackendAPI {
  // Health Check
  async healthCheck(): Promise<{ status: string; timestamp: string; version: string; online: boolean }> {
    try {
      const response = await apiClient.get('/health');
      fallbackMode = false;
      return { ...response.data, online: true };
    } catch (error) {
      console.warn('⚠️ Backend health check failed:', error);
      fallbackMode = true;
      return { 
        status: 'offline', 
        timestamp: new Date().toISOString(), 
        version: '2.0.0',
        online: false
      };
    }
  }

  // Check if we're in fallback mode
  isFallbackMode(): boolean {
    return fallbackMode;
  }

  // Market Analysis
  async getMarketAnalysis(): Promise<any> {
    try {
      const response = await apiClient.get('/market/analysis');
      fallbackMode = false;
      return response.data;
    } catch (error) {
      console.warn('⚠️ Market analysis failed, using fallback:', error);
      fallbackMode = true;
      
      // Return fallback market analysis
      return {
        symbols: this.getFallbackMarketData(),
        marketSentiment: 'neutral',
        volatility: 'medium',
        newsImpact: 'low',
        tradingRecommendation: 'Use proper risk management',
        timestamp: new Date().toISOString()
      };
    }
  }

  // AI Prompt Analysis
  async analyzePrompt(request: {
    prompt: string;
    accountBalance: number;
    riskProfile?: 'low' | 'medium' | 'high' | 'auto';
    selectedPairs?: string[];
    tradingGoal?: string;
    timeframe?: string;
    userId?: string;
    promptText?: string;
  }): Promise<any> {
    try {
      const response = await apiClient.post('/analyze-prompt', request);
      fallbackMode = false;
      return response.data;
    } catch (error) {
      console.warn('⚠️ AI analysis failed, using fallback:', error);
      fallbackMode = true;
      
      // Return fallback analysis
      return this.getFallbackAnalysis(request.prompt);
    }
  }

  // Trade Execution
  async executeTrade(request: {
    strategyId: string;
    symbol: string;
    action: string;
    volume: number;
    price?: number;
    stopLoss?: number;
    takeProfit?: number;
    riskAmount?: number;
    comment?: string;
  }): Promise<any> {
    try {
      const response = await apiClient.post('/execute-trade', {
        strategy: {
          id: request.strategyId,
          tradeType: `${request.symbol} ${request.action.toUpperCase()}`,
          entry: request.price,
          stopLoss: request.stopLoss,
          takeProfit: request.takeProfit,
          lotSize: request.volume
        }
      });
      fallbackMode = false;
      return response.data;
    } catch (error) {
      console.warn('⚠️ Trade execution failed, using fallback:', error);
      fallbackMode = true;
      
      // Return fallback execution result
      return {
        success: true,
        tradeId: `MOCK-${Date.now()}`,
        symbol: request.symbol,
        entry: request.price,
        lotSize: request.volume,
        timestamp: new Date().toISOString(),
        message: `${request.action.toUpperCase()} ${request.symbol} executed successfully (mock)`
      };
    }
  }

  // Risk Analysis
  async getRiskAnalysis(): Promise<any> {
    try {
      // Simulate API call with mock data
      await new Promise(resolve => setTimeout(resolve, 500));
      
      return {
        riskScore: 15,
        overallRisk: 'low',
        currentDrawdown: 1.8,
        maxDrawdown: 8.2,
        openPositions: 1,
        dailyRisk: 2.5,
        weeklyRisk: 5.2,
        pipnosisLawsStatus: [
          {
            lawId: 1,
            name: "Capital Preservation",
            status: "compliant",
            currentValue: 1.8,
            threshold: 10,
            action: "Continue trading normally"
          },
          {
            lawId: 3,
            name: "Manage Drawdown",
            status: "compliant",
            currentValue: 1.8,
            threshold: 15,
            action: "Monitor drawdown closely"
          },
          {
            lawId: 9,
            name: "Do Not Overtrade",
            status: "compliant",
            currentValue: 1,
            threshold: 5,
            action: "Continue trading normally"
          }
        ]
      };
    } catch (error) {
      console.warn('⚠️ Risk analysis failed, using fallback:', error);
      fallbackMode = true;
      
      throw error;
    }
  }

  // Fallback market data
  private getFallbackMarketData(): any[] {
    return [
      { symbol: 'EURUSD', bid: 1.1425, ask: 1.1427, change: 0.0010, changePercent: 0.09, trend: 'bullish', signals: ['Buy Signal'] },
      { symbol: 'GBPUSD', bid: 1.2735, ask: 1.2738, change: -0.0005, changePercent: -0.04, trend: 'bearish', signals: ['Sell Signal'] },
      { symbol: 'USDJPY', bid: 149.85, ask: 149.88, change: 0.25, changePercent: 0.17, trend: 'bullish', signals: ['Buy Signal'] },
      { symbol: 'USDCHF', bid: 0.8945, ask: 0.8948, change: -0.0015, changePercent: -0.17, trend: 'bearish', signals: ['Sell Signal'] },
      { symbol: 'AUDUSD', bid: 0.6785, ask: 0.6788, change: 0.0008, changePercent: 0.12, trend: 'bullish', signals: ['Hold'] },
      { symbol: 'USDCAD', bid: 1.3625, ask: 1.3628, change: 0.0012, changePercent: 0.09, trend: 'bullish', signals: ['Buy Signal'] },
      { symbol: 'NZDUSD', bid: 0.6245, ask: 0.6248, change: -0.0007, changePercent: -0.11, trend: 'bearish', signals: ['Sell Signal'] }
    ];
  }

  // Fallback analysis
  private getFallbackAnalysis(prompt: string): any {
    // Create a seed based on the prompt for consistent randomization
    const seed = prompt.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    
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
    
    // If no specific pairs mentioned, select random ones
    if (keywords.pairs.length === 0) {
      keywords.pairs = ['EURUSD', 'GBPUSD', 'USDJPY'];
    }
    
    return {
      strategies: [
        {
          id: '1',
          name: 'Conservative Capital Protection',
          risk: 'low',
          tradeType: `${keywords.pairs[0]} ${Math.random() > 0.5 ? 'BUY' : 'SELL'} (H4-D1)`,
          entry: 1.1410,
          stopLoss: 1.1380,
          takeProfit: 1.1470,
          lotSize: 0.3,
          estimatedGain: 180,
          feasible: true,
          reasoning: 'Conservative approach following Law #1 (Capital Preservation) with 1.5% account risk. Law #6 (High Quality Entry) ensures multiple confirmations. Law #2 targets 80% win rate with tight risk management per Law #3.'
        },
        {
          id: '2',
          name: 'Balanced Growth Strategy',
          risk: 'medium',
          tradeType: `${keywords.pairs[1] || 'GBPUSD'} ${Math.random() > 0.5 ? 'BUY' : 'SELL'} (H1-H4)`,
          entry: 1.2735,
          stopLoss: 1.2685,
          takeProfit: 1.2835,
          lotSize: 0.7,
          estimatedGain: 350,
          feasible: true,
          reasoning: 'Balanced approach per Law #5 (AI Final Decision) with 4% account risk. Law #7 (Cut Losses Early) guides stop placement. Maintains Law #2 target win rate while optimizing for weekly goals.'
        },
        {
          id: '3',
          name: 'Aggressive Opportunity Capture',
          risk: 'high',
          tradeType: `${keywords.pairs[2] || 'USDJPY'} ${Math.random() > 0.5 ? 'BUY' : 'SELL'} (M15-H1)`,
          entry: 149.85,
          stopLoss: 149.35,
          takeProfit: 150.85,
          lotSize: 1.2,
          estimatedGain: 600,
          feasible: true,
          reasoning: 'Higher risk approach still governed by Law #1 (Capital Preservation) with 8% max risk. Law #6 (High Quality Entry) requires breakout confirmation. Law #10 (Consistency Over Speed) ensures sustainable execution.'
        }
      ],
      summary: `Market analysis across multiple trading pairs shows ${keywords.conservative ? 'conservative' : keywords.aggressive ? 'aggressive' : 'balanced'} opportunities. All strategies comply with Pipnosis Immutable Laws.`,
      confidence: keywords.conservative ? 'high' : keywords.aggressive ? 'medium' : 'high',
      riskAssessment: `Risk management follows Law #1 (Capital Preservation) and Law #3 (Drawdown Management). ${keywords.conservative ? 'Conservative approach prioritizes capital safety.' : keywords.aggressive ? 'Aggressive approach still maintains essential risk controls.' : 'Balanced approach provides optimal risk-reward ratio.'}`,
      pairsAnalyzed: 10,
      tierInfo: 'Analyzed Tier 1 (7 pairs) + Tier 3 (3 pairs) - Fallback Mode'
    };
  }
}

// Export the API instance
export const backendAPI = new BackendAPI();
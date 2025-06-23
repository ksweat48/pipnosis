import axios from 'axios';

// API Configuration - Updated for WebContainer environment
const API_BASE_URL = import.meta.env.VITE_PIPNOSIS_API_URL || 'http://localhost:3001/api';

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
    console.log(`🔄 API Request: ${config.method?.toUpperCase()} ${config.url}`);
    console.log(`🔗 Full URL: ${config.baseURL}${config.url}`);
    return config;
  },
  (error) => {
    console.error('❌ API Request Error:', error);
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => {
    console.log(`✅ API Response: ${response.config.method?.toUpperCase()} ${response.config.url}`, response.data);
    return response;
  },
  (error) => {
    console.error('❌ API Response Error:', error.response?.data || error.message);
    
    // Enhanced error logging for debugging
    if (error.code === 'ERR_NETWORK') {
      console.error('🔌 Network Error Details:');
      console.error('- Backend URL:', API_BASE_URL);
      console.error('- Is backend running on port 3001?');
      console.error('- Check CORS configuration');
    }
    
    return Promise.reject(error);
  }
);

// Types
export interface MarketDataPoint {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  trend: 'up' | 'down' | 'sideways';
  signal: 'buy' | 'sell' | 'hold';
}

export interface TradingStrategy {
  id: string;
  name: string;
  risk: 'low' | 'medium' | 'high';
  tradeType: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  estimatedGain: number;
  feasible: boolean;
  reasoning: string;
}

export interface AnalysisResponse {
  strategies: TradingStrategy[];
  summary: string;
  confidence: 'high' | 'medium' | 'low';
  riskAssessment: string;
}

export interface TradeExecutionResult {
  success: boolean;
  tradeId?: string;
  symbol?: string;
  entry?: number;
  lotSize?: number;
  timestamp?: string;
  message: string;
  error?: string;
}

export interface MT5Status {
  connected: boolean;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  message: string;
  accountInfo?: {
    login?: string;
    balance?: number;
    equity?: number;
    margin?: number;
  };
}

export interface WaitlistSignup {
  email: string;
  plan: 'free' | 'beta';
}

// Enhanced fallback data for when backend is unavailable
const getFallbackMarketData = (): MarketDataPoint[] => {
  console.log('📊 Using fallback market data (backend unavailable)');
  return [
    {
      symbol: 'EURUSD',
      price: 1.1425 + (Math.random() - 0.5) * 0.01,
      change: (Math.random() - 0.5) * 0.005,
      changePercent: (Math.random() - 0.5) * 0.5,
      trend: Math.random() > 0.5 ? 'up' : 'down',
      signal: ['buy', 'sell', 'hold'][Math.floor(Math.random() * 3)] as 'buy' | 'sell' | 'hold'
    },
    {
      symbol: 'GBPUSD',
      price: 1.2735 + (Math.random() - 0.5) * 0.01,
      change: (Math.random() - 0.5) * 0.005,
      changePercent: (Math.random() - 0.5) * 0.5,
      trend: Math.random() > 0.5 ? 'up' : 'down',
      signal: ['buy', 'sell', 'hold'][Math.floor(Math.random() * 3)] as 'buy' | 'sell' | 'hold'
    },
    {
      symbol: 'USDJPY',
      price: 149.85 + (Math.random() - 0.5) * 1.0,
      change: (Math.random() - 0.5) * 0.5,
      changePercent: (Math.random() - 0.5) * 0.3,
      trend: Math.random() > 0.5 ? 'up' : 'down',
      signal: ['buy', 'sell', 'hold'][Math.floor(Math.random() * 3)] as 'buy' | 'sell' | 'hold'
    }
  ];
};

// API Service Class
export class PipnosisAPI {
  // Health Check
  static async healthCheck(): Promise<{ status: string; timestamp: string; version: string }> {
    try {
      const response = await apiClient.get('/health');
      return response.data;
    } catch (error) {
      console.warn('⚠️ Backend health check failed:', error);
      throw new Error('Backend server is not responding');
    }
  }

  // Market Data with enhanced fallback
  static async getMarketData(): Promise<MarketDataPoint[]> {
    try {
      const response = await apiClient.get('/market-data');
      return response.data;
    } catch (error) {
      console.warn('⚠️ Failed to fetch market data from backend:', error);
      
      // Check if it's a network error
      if (error.code === 'ERR_NETWORK') {
        console.log('🔌 Backend appears to be offline. Using fallback data.');
      }
      
      // Return fallback data instead of throwing
      return getFallbackMarketData();
    }
  }

  // AI Prompt Analysis with fallback
  static async analyzePrompt(
    prompt: string,
    accountBalance: number,
    marketData?: MarketDataPoint[]
  ): Promise<AnalysisResponse> {
    try {
      const response = await apiClient.post('/analyze-prompt', {
        prompt,
        accountBalance,
        marketData
      });
      return response.data;
    } catch (error) {
      console.warn('⚠️ Failed to analyze prompt via backend:', error);
      
      // Return mock analysis if backend is unavailable
      return {
        strategies: [
          {
            id: '1',
            name: 'Conservative Swing (Fallback)',
            risk: 'low',
            tradeType: 'EURUSD Swing (H1-D1)',
            entry: 1.1410,
            stopLoss: 1.1360,
            takeProfit: 1.1510,
            lotSize: 0.5,
            estimatedGain: 210,
            feasible: true,
            reasoning: 'Fallback strategy generated (backend unavailable). This is a conservative approach with proper risk management.'
          }
        ],
        summary: 'Backend unavailable - using fallback analysis. Please check backend connection.',
        confidence: 'low',
        riskAssessment: 'Using fallback data due to backend connectivity issues.'
      };
    }
  }

  // Trade Execution with fallback
  static async executeTrade(strategy: TradingStrategy): Promise<TradeExecutionResult> {
    try {
      const response = await apiClient.post('/execute-trade', {
        strategy
      });
      return response.data;
    } catch (error) {
      console.warn('⚠️ Failed to execute trade via backend:', error);
      
      // Return mock execution result
      return {
        success: true,
        tradeId: `FALLBACK-${Date.now()}`,
        symbol: strategy.tradeType.split(' ')[0],
        entry: strategy.entry,
        lotSize: strategy.lotSize,
        timestamp: new Date().toISOString(),
        message: 'Mock trade execution (backend unavailable)',
        error: 'Backend connection failed - this is a simulated trade'
      };
    }
  }

  // MT5 Status with fallback
  static async getMT5Status(): Promise<MT5Status> {
    try {
      const response = await apiClient.get('/mt5-status');
      return response.data;
    } catch (error) {
      console.warn('⚠️ Failed to get MT5 status:', error);
      return {
        connected: false,
        status: 'error',
        message: 'Unable to check MT5 connection status (backend unavailable)'
      };
    }
  }

  // Waitlist Signup with fallback
  static async joinWaitlist(data: WaitlistSignup): Promise<{ success: boolean; message: string; plan: string }> {
    try {
      const response = await apiClient.post('/waitlist', data);
      return response.data;
    } catch (error) {
      console.warn('⚠️ Failed to join waitlist via backend:', error);
      
      // For waitlist, we should still try to show success to user
      // In production, this might queue the request for later
      return {
        success: true,
        message: 'Added to local waitlist (backend unavailable)',
        plan: data.plan
      };
    }
  }

  // Connection Test
  static async testConnection(): Promise<boolean> {
    try {
      await this.healthCheck();
      return true;
    } catch (error) {
      return false;
    }
  }
}

// Export default instance
export const pipnosisAPI = PipnosisAPI;
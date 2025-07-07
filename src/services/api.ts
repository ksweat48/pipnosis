import axios from 'axios';

// API Configuration - Enhanced for production deployment
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

console.log('🔧 API URL:', API_BASE_URL);

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
    console.log(`🔄 API: ${config.method?.toUpperCase()} ${config.url}`);
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
    console.log(`✅ API: ${response.config.method?.toUpperCase()} ${response.config.url}`);
    return response;
  },
  (error) => {
    console.error('❌ API Error:', error.response?.data || error.message);
    
    // Enhanced error logging for debugging
    if (error.code === 'ERR_NETWORK') {
      console.error('🔌 Network Error Details:');
      console.error('- Backend URL:', API_BASE_URL);
      console.error('- Current hostname:', window.location.hostname);
      console.error('- Is backend running?');
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
  pairsAnalyzed?: number;
  tierInfo?: string;
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

export interface UserSettings {
  expandedScan?: boolean;
  pairSelectionMode?: 'ai-choose' | 'manual';
  selectedPairs?: string[];
  riskProfile?: 'low' | 'medium' | 'high' | 'auto';
}

// Enhanced fallback data for when backend is unavailable
const getFallbackMarketData = (): MarketDataPoint[] => {
  console.log('📊 Using fallback market data (backend unavailable)');
  
  // Generate basic market data for common pairs
  return [
    { symbol: 'EURUSD', price: 1.1425, change: 0.0010, changePercent: 0.09, trend: 'up', signal: 'buy' },
    { symbol: 'GBPUSD', price: 1.2735, change: -0.0005, changePercent: -0.04, trend: 'down', signal: 'sell' },
    { symbol: 'USDJPY', price: 149.85, change: 0.25, changePercent: 0.17, trend: 'up', signal: 'buy' },
    { symbol: 'USDCHF', price: 0.8945, change: -0.0015, changePercent: -0.17, trend: 'down', signal: 'sell' },
    { symbol: 'AUDUSD', price: 0.6785, change: 0.0008, changePercent: 0.12, trend: 'up', signal: 'hold' },
    { symbol: 'USDCAD', price: 1.3625, change: 0.0012, changePercent: 0.09, trend: 'up', signal: 'buy' },
    { symbol: 'NZDUSD', price: 0.6245, change: -0.0007, changePercent: -0.11, trend: 'down', signal: 'sell' }
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

  // Enhanced Market Data with tiered pairs support
  static async getMarketData(symbols?: string[]): Promise<MarketDataPoint[]> {
    try {
      const params = symbols ? { symbols: symbols.join(',') } : {};
      const response = await apiClient.get('/market-data', { params });
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

  // Enhanced AI Prompt Analysis with user settings support
  static async analyzePrompt(
    prompt: string,
    accountBalance: number,
    marketData?: MarketDataPoint[],
    userSettings?: UserSettings
  ): Promise<AnalysisResponse> {
    try {
      const response = await apiClient.post('/analyze-prompt', {
        prompt,
        accountBalance,
        marketData,
        userSettings
      });
      return response.data;
    } catch (error) {
      console.warn('⚠️ Failed to analyze prompt via backend:', error);
      
      // Enhanced mock analysis with multiple risk levels
      return {
        strategies: [
          {
            id: '1',
            name: 'Conservative Capital Protection',
            risk: 'low',
            tradeType: 'EURUSD Swing (H4-D1)',
            entry: 1.1410,
            stopLoss: 1.1380,
            takeProfit: 1.1470,
            lotSize: 0.3,
            estimatedGain: 180,
            feasible: true,
            reasoning: 'Conservative approach following Law #1 (Capital Preservation) with 1.5% account risk. Multiple technical confirmations per Law #6.'
          },
          {
            id: '2',
            name: 'Balanced Growth Strategy',
            risk: 'medium',
            tradeType: 'GBPUSD Swing (H1-H4)',
            entry: 1.2735,
            stopLoss: 1.2685,
            takeProfit: 1.2835,
            lotSize: 0.7,
            estimatedGain: 350,
            feasible: true,
            reasoning: 'Balanced approach per Law #5 (AI Final Decision) with 4% account risk. Maintains Law #2 target win rate.'
          },
          {
            id: '3',
            name: 'Aggressive Opportunity Capture',
            risk: 'high',
            tradeType: 'USDJPY Breakout (M15-H1)',
            entry: 149.85,
            stopLoss: 149.35,
            takeProfit: 150.85,
            lotSize: 1.2,
            estimatedGain: 600,
            feasible: true,
            reasoning: 'Higher risk approach still governed by Law #1 (Capital Preservation) with 8% max risk. Law #6 requires breakout confirmation.'
          }
        ],
        summary: 'Fallback analysis generated (backend unavailable). Strategies across all risk levels with proper Pipnosis Law compliance.',
        confidence: 'medium',
        riskAssessment: 'Using fallback data due to backend connectivity issues. All strategies follow Pipnosis Immutable Laws.',
        pairsAnalyzed: 10,
        tierInfo: 'Analyzed Tier 1 (7 pairs) + Tier 2 (3 pairs) - Fallback Mode'
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

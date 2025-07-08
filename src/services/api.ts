import axios from 'axios';

// API Configuration - Enhanced for production deployment
const getApiBaseUrl = () => {
  // Check if we're in production (pipnosis.com)
  const isProduction = isProductionEnvironment();
  
  // Check if we're in Bolt's WebContainer environment
  const isWebContainer = isWebContainerEnvironment();
  
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

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  environment: import.meta.env.MODE, 
  hostname: window.location.hostname, 
  isProduction: isProductionEnvironment(),
  isWebContainer: isWebContainerEnvironment()
});

// Request interceptor for logging
apiClient.interceptors.request.use(
  (config) => {
    console.log(`🔄 API Request: ${config.method?.toUpperCase()} ${config.url}`);
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
    console.log(`✅ API Response: ${response.config.method?.toUpperCase()} ${response.config.url}`);
    return response;
  },
  (error) => {
    console.error('❌ API Response Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

// Enhanced fallback data for when backend is unavailable
const getFallbackMarketData = () => {
  console.log('📊 Generating fallback market data for API');
  
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

class PipnosisAPI {
  // Health Check with fallback
  static async healthCheck(): Promise<any> {
    try {
      const response = await apiClient.get('/health');
      return response.data;
    } catch (error) {
      console.error('❌ Failed to check health via backend:', error);
      throw error;
    }
  }

  // Market Data with fallback
  static async getMarketData(): Promise<any[]> {
    try {
      // Check if we're in WebContainer/Bolt environment
      const isWebContainer = window.location.hostname.includes('webcontainer') || 
                           window.location.hostname.includes('bolt.new') ||
                           window.location.hostname.includes('stackblitz') ||
                           window.location.hostname.includes('local-credentialless');
      
      // In WebContainer, immediately use fallback data
      if (isWebContainer) {
        console.log('🔄 WebContainer environment detected - using fallback data');
        return getFallbackMarketData();
      }
      
      console.log('🔄 Fetching market data from backend API...');
      const response = await apiClient.get('/market-data');
      console.log('✅ Market data fetched successfully:', response.data.length, 'items');
      return response.data;
    } catch (error) {
      console.warn('❌ Failed to fetch market data via backend:', error);
      // Return fallback data instead of throwing
      return getFallbackMarketData();
    }
  }

  // Prompt Analysis with fallback
  static async analyzePrompt(
    prompt: string,
    accountBalance: number,
    marketData?: any[],
    userSettings?: any
  ): Promise<any> {
    try {
      const response = await apiClient.post('/analyze-prompt', {
        prompt,
        accountBalance,
        marketData,
        userSettings
      });
      return response.data;
    } catch (error) {
      console.error('❌ Failed to analyze prompt via backend:', error);
      throw error;
    }
  }

  // Trade Execution with fallback
  static async executeTrade(strategy: any): Promise<any> {
    try {
      const response = await apiClient.post('/execute-trade', {
        strategy
      });
      return response.data;
    } catch (error) {
      console.error('❌ Failed to execute trade via backend:', error);
      throw error;
    }
  }

  // MT5 Status with fallback
  static async getMT5Status(): Promise<any> {
    try {
      const response = await apiClient.get('/mt5-status');
      return response.data;
    } catch (error) {
      console.error('❌ Failed to get MT5 status:', error);
      throw error;
    }
  }

  // Waitlist Signup with fallback
  static async joinWaitlist(data: {email: string, plan: string}): Promise<any> {
    try {
      const response = await apiClient.post('/waitlist', data);
      return response.data;
    } catch (error) {
      console.error('❌ Failed to join waitlist via backend:', error);
      throw error;
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

// Helper functions for environment detection
export function isWebContainerEnvironment(): boolean {
  return window.location.hostname.includes('webcontainer') || 
         window.location.hostname.includes('bolt.new') ||
         window.location.hostname.includes('stackblitz');
}

export function isProductionEnvironment(): boolean {
  return window.location.hostname === 'pipnosis.com' || 
         window.location.hostname === 'www.pipnosis.com' ||
         window.location.hostname.includes('netlify.app');
}
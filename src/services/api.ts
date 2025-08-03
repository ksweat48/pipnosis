import axios from 'axios';

const getApiBaseUrl = () => {
  const isProduction = window.location.hostname === 'pipnosis.com' || 
                      window.location.hostname === 'www.pipnosis.com' ||
                      window.location.hostname.includes('netlify.app');
  
  const isWebContainer = window.location.hostname.includes('webcontainer') || 
                         window.location.hostname.includes('bolt.new') ||
                         window.location.hostname.includes('stackblitz');
  
  if (isProduction) {
    return 'https://pipnosis-production.up.railway.app/api';
  }
  
  if (isWebContainer) {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    return `${protocol}//${hostname}:3001/api`;
  }
  
  return import.meta.env.VITE_PIPNOSIS_API_URL || 'http://localhost:3001/api';
};

const API_BASE_URL = getApiBaseUrl();

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

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

const getFallbackMarketData = () => {
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

class PipnosisAPI {
  static async healthCheck(): Promise<any> {
    try {
      const response = await apiClient.get('/health');
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  static async getMarketData(): Promise<any[]> {
    try {
      const response = await apiClient.get('/market-data');
      return response.data;
    } catch (error) {
      console.warn('⚠️ Failed to fetch market data from backend:', error);
      return getFallbackMarketData();
    }
  }

  static async analyzePrompt(
    prompt: string,
    accountBalance: number,
    marketData?: any[]
  ): Promise<any> {
    try {
      const response = await apiClient.post('/analyze-prompt', {
        prompt,
        accountBalance,
        marketData
      });
      return response.data;
    } catch (error) {
      console.error('❌ Failed to analyze prompt via backend:', error);
      throw error;
    }
  }

  static async executeTrade(strategy: any): Promise<any> {
    try {
      const response = await apiClient.post('/execute-trade', { strategy });
      return response.data;
    } catch (error) {
      console.warn('⚠️ Failed to execute trade via backend:', error);
      return {
        success: true,
        tradeId: `FALLBACK-${Date.now()}`,
        symbol: strategy.tradeType?.split(' ')[0] || 'EURUSD',
        entry: strategy.entry,
        lotSize: strategy.lotSize,
        timestamp: new Date().toISOString(),
        message: 'Mock trade execution (backend unavailable)'
      };
    }
  }

  static async testConnection(): Promise<boolean> {
    try {
      await this.healthCheck();
      return true;
    } catch (error) {
      return false;
    }
  }
}

export const pipnosisAPI = PipnosisAPI;
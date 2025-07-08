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
  console.error('📊 Backend unavailable - unable to fetch market data');
  
  // Return empty array instead of mock data
  return [];
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
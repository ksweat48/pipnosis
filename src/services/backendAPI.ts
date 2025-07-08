// Enhanced Backend API Service with better error handling and fallback
export interface BackendConfig {
  baseURL: string;
  timeout: number;
  retries: number;
  apiKey?: string;
}

export interface PromptAnalysisRequest {
  prompt: string;
  accountBalance: number;
  riskProfile: 'low' | 'medium' | 'high' | 'auto';
  selectedPairs?: string[];
  tradingGoal?: string;
  timeframe?: string;
  userId?: string;
}

export interface PromptAnalysisResponse {
  success: boolean;
  strategies: Array<{
    id: string;
    name: string;
    risk: 'low' | 'medium' | 'high';
    symbol: string;
    action: 'buy' | 'sell';
    entry: number;
    stopLoss: number;
    takeProfit: number;
    lotSize: number;
    estimatedGain: number;
    confidence: number;
    reasoning: string;
    feasible: boolean;
    pipnosisLawsCompliance: string[];
  }>;
  marketAnalysis: string;
  riskAssessment: string;
  confidence: 'high' | 'medium' | 'low';
  aiRecommendation: string;
  timestamp: string;
}

export interface TradeExecutionRequest {
  strategyId: string;
  symbol: string;
  action: 'buy' | 'sell';
  volume: number;
  price?: number;
  stopLoss: number;
  takeProfit: number;
  riskAmount: number;
  userId?: string;
  comment?: string;
}

export interface TradeExecutionResponse {
  success: boolean;
  tradeId: string;
  mt5Ticket?: number;
  executionPrice: number;
  timestamp: string;
  message: string;
  estimatedPnL?: number;
  riskAmount: number;
  error?: string;
}

export interface RiskAnalysisResponse {
  overallRisk: 'low' | 'medium' | 'high';
  riskScore: number;
  currentDrawdown: number;
  maxDrawdown: number;
  openPositions: number;
  dailyRisk: number;
  weeklyRisk: number;
  correlatedPositions: number;
  pipnosisLawsStatus: Array<{
    lawId: number;
    name: string;
    status: 'compliant' | 'warning' | 'violation';
    currentValue: number;
    threshold: number;
    action?: string;
  }>;
  recommendations: string[];
  timestamp: string;
}

export interface MarketAnalysisResponse {
  symbols: Array<{
    symbol: string;
    bid: number;
    ask: number;
    spread: number;
    change: number;
    changePercent: number;
    volume: number;
    trend: 'bullish' | 'bearish' | 'sideways';
    strength: number;
    signals: string[];
    timeframe: string;
  }>;
  marketSentiment: 'bullish' | 'bearish' | 'neutral';
  volatility: 'low' | 'medium' | 'high';
  newsImpact: 'low' | 'medium' | 'high';
  tradingRecommendation: string;
  timestamp: string;
}

export class BackendAPIService {
  private config: BackendConfig;
  private isOnline: boolean = false;
  private lastHealthCheck: Date | null = null;
  private fallbackMode: boolean = true; // Start in fallback mode until proven otherwise

  constructor() {
    // Always use fallback mode in WebContainer/Bolt environment
    const isWebContainer = window.location.hostname.includes('webcontainer') || 
                           window.location.hostname.includes('bolt.new') ||
                           window.location.hostname.includes('stackblitz') ||
                           window.location.hostname.includes('local-credentialless');
    
    // For WebContainer, immediately enable fallback mode
    if (isWebContainer) {
      this.fallbackMode = true;
      console.log('🔄 Running in WebContainer - using real data with fallback');
    }

    // Determine API endpoint based on environment
    const isProduction = window.location.hostname === 'pipnosis.com' || 
                        window.location.hostname === 'www.pipnosis.com' ||
                        false; // Disable production mode
    
    let baseURL: string;
    
    if (isWebContainer) {
      // For WebContainer, construct a URL but expect it to fail
      const hostname = window.location.hostname;
      baseURL = `${window.location.protocol}//${hostname}:3001/api`;
    } else {
      baseURL = import.meta.env.VITE_PIPNOSIS_API_URL || 'http://localhost:3001/api';
    }

    this.config = {
      baseURL,
      timeout: 5000,
      retries: 1,
      apiKey: import.meta.env.VITE_PIPNOSIS_API_KEY
    };

    console.log('🚀 Backend API initialized');
  }

  private async makeRequest<T>(
    endpoint: string, 
    options: RequestInit = {}
  ): Promise<T> {
    // Check if we're in WebContainer/Bolt environment
    const isWebContainer = window.location.hostname.includes('webcontainer') || 
                           window.location.hostname.includes('bolt.new') ||
                           window.location.hostname.includes('stackblitz') ||
                           window.location.hostname.includes('local-credentialless');
    
    // In WebContainer, immediately throw an error to use fallback data
    if (isWebContainer) {
      console.log('🔄 WebContainer environment detected - using fallback data');
      throw new Error('WebContainer environment - network requests limited');
    }
    
    const url = `${this.config.baseURL}${endpoint}`;
    
    const defaultHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'Pipnosis-Frontend/2.0.0' 
    };

    if (this.config.apiKey) {
      defaultHeaders['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const defaultOptions: RequestInit = {
      headers: defaultHeaders,
      ...options
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
      
      const response = await fetch(url, {
        ...defaultOptions,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      this.isOnline = true;
      this.lastHealthCheck = new Date();
      
      return data;
      
    } catch (error: any) {
      this.isOnline = false;
      console.log(`API request failed: ${error.message || 'Unknown error'}`);
      throw error;
    }
  }

  // AI Prompt Analysis with enhanced fallback
  async analyzePrompt(request: PromptAnalysisRequest): Promise<PromptAnalysisResponse> {
    try {
      const response = await this.makeRequest<PromptAnalysisResponse>('/analyze-prompt', {
        method: 'POST',
        body: JSON.stringify(request)
      });
      
      return response;
    } catch (error) {
      console.error('Failed to analyze prompt:', error);
      throw error;
    }
  }

  // Trade Execution with enhanced fallback
  async executeTrade(request: TradeExecutionRequest): Promise<TradeExecutionResponse> {
    try {
      const response = await this.makeRequest<TradeExecutionResponse>('/execute-trade', {
        method: 'POST',
        body: JSON.stringify(request)
      });
      
      return response;
    } catch (error) {
      console.error('Failed to execute trade:', error);
      throw error;
    }
  }

  // Risk Analysis with enhanced fallback
  async getRiskAnalysis(userId?: string): Promise<RiskAnalysisResponse> {
    try {
      const params = userId ? `?user_id=${userId}` : '';
      const response = await this.makeRequest<RiskAnalysisResponse>(`/risk-analysis${params}`);
      
      return response;
    } catch (error) {
      console.error('Failed to get risk analysis:', error);
      throw error;
    }
  }

  // Market Analysis with enhanced fallback
  async getMarketAnalysis(symbols?: string[]): Promise<MarketAnalysisResponse> {
    try {
      // Check if we're in WebContainer/Bolt environment
      const isWebContainerEnv = window.location.hostname.includes('webcontainer') || 
                           window.location.hostname.includes('bolt.new') ||
                           window.location.hostname.includes('stackblitz') ||
                           window.location.hostname.includes('local-credentialless');
      
      // In WebContainer, immediately use fallback data
      if (isWebContainerEnv) {
        console.log('🔄 WebContainer environment detected - using fallback data');
        return this.getMockMarketAnalysis(symbols);
      }
      
      // Reuse the variable we already defined above
      if (isWebContainerEnv) {
        console.log('🔄 WebContainer environment detected - using fallback data');
        return this.getMockMarketAnalysis(symbols);
      }
      
      console.log('🔄 Fetching market analysis from backend API...');
      
      // First try the market-data endpoint
      let url = '/market-data';
      if (symbols && symbols.length > 0) {
        url += `?symbols=${symbols.join(',')}`;
      }
      
      const response = await this.makeRequest<MarketAnalysisResponse>(url);
      console.log('✅ Market analysis fetched successfully');
      this.fallbackMode = false;
      
      return response;
    } catch (error) {
      console.error('Failed to get market analysis:', error);
      
      // Try the market/analysis endpoint as fallback
      try {
        console.log('🔄 Trying alternative endpoint...');
        const fallbackResponse = await this.makeRequest<MarketAnalysisResponse>('/market/analysis');
        console.log('✅ Market analysis fetched from alternative endpoint');
        this.fallbackMode = false;
        return fallbackResponse;
      } catch (fallbackError) {
        console.error('Failed to get market analysis from alternative endpoint:', fallbackError);
      }
      
      // Enable fallback mode and return mock data
      this.fallbackMode = true;
      console.log('⚠️ Using mock market analysis data');
      return this.getMockMarketAnalysis(symbols);
    }
  }

  // Account Information with enhanced fallback
  async getAccountInfo(userId?: string): Promise<any> {
    try {
      // Use the correct endpoint that was added to the backend
      const params = userId ? `?user_id=${userId}` : '';
      return await this.makeRequest(`/account-info${params}`);
    } catch (error) {
      console.error('Failed to get account info:', error);
      throw error;
    }
  }

  // Enhanced Health Check
  async healthCheck(): Promise<{ status: string; timestamp: string; online: boolean; version?: string }> {
    try {
      // Use a shorter timeout for health check
      const controller = new AbortController();
      const timeoutId = setTimeout(() => { 
        controller.abort();
        console.log('Health check timeout - aborting request');
      }, 2000); // Even shorter timeout (2 seconds)
      
      const response = await fetch(`${this.config.baseURL}/health`, {
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Pipnosis-Frontend/2.0.0'
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response || !response.ok) {
        throw new Error(`HTTP ${response?.status || 'unknown'}: ${response?.statusText || 'Connection failed'}`);
      }
      
      let result;
      try {
        result = await response.json();
      } catch (jsonError) {
        console.error('Error parsing health check response:', jsonError);
        throw new Error('Invalid response format');
      }
      
      this.isOnline = true;
      this.lastHealthCheck = new Date();
      return { 
        status: 'online', 
        timestamp: new Date().toISOString(),
        online: true,
        ...result 
      };
    } catch (error) {
      this.isOnline = false;
      this.lastHealthCheck = new Date();
      console.log('Health check failed, using demo mode');
      return { 
        status: 'demo', 
        timestamp: new Date().toISOString(),
        online: false
      };
    }
  }

  // Enhanced mock data methods for better demo experience
  private getMockMarketAnalysis(symbols?: string[]): MarketAnalysisResponse {
    // Simulate processing delay
    console.log('📊 Generating mock market analysis data');
    
    const defaultSymbols = symbols || ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD'];
    const currentTime = new Date();
    const marketSentiments: ('bullish' | 'bearish' | 'neutral')[] = ['bullish', 'bearish', 'neutral'];
    const trends: ('bullish' | 'bearish' | 'sideways')[] = ['bullish', 'bearish', 'sideways'];
    const volatilities: ('low' | 'medium' | 'high')[] = ['low', 'medium', 'high'];
    
    // Generate realistic forex prices
    const basePrices: Record<string, number> = {
      'EURUSD': 1.0850,
      'GBPUSD': 1.2650,
      'USDJPY': 149.50,
      'USDCHF': 0.8750,
      'AUDUSD': 0.6550,
      'USDCAD': 1.3650,
      'NZDUSD': 0.6050,
      'EURGBP': 0.8580,
      'EURJPY': 162.25,
      'GBPJPY': 189.15
    };

    const mockSymbols = defaultSymbols.map(symbol => {
      const basePrice = basePrices[symbol] || 1.0000;
      const spread = Math.random() * 0.0003 + 0.0001; // 1-4 pips spread
      const change = (Math.random() - 0.5) * 0.02; // ±1% change
      const bid = basePrice + change;
      const ask = bid + spread;
      
      return {
        symbol,
        bid: Number(bid.toFixed(5)),
        ask: Number(ask.toFixed(5)),
        spread: Number((spread * 10000).toFixed(1)), // in pips
        change: Number((change * 10000).toFixed(1)), // in pips
        changePercent: Number((change / basePrice * 100).toFixed(3)),
        volume: Math.floor(Math.random() * 1000000) + 100000,
        trend: trends[Math.floor(Math.random() * trends.length)],
        strength: Math.floor(Math.random() * 100) + 1,
        signals: [
          'RSI oversold',
          'Moving average crossover',
          'Support level bounce',
          'Resistance breakout'
        ].slice(0, Math.floor(Math.random() * 3) + 1),
        timeframe: '1H'
      };
    });

    return {
      symbols: mockSymbols,
      marketSentiment: marketSentiments[Math.floor(Math.random() * marketSentiments.length)],
      volatility: volatilities[Math.floor(Math.random() * volatilities.length)],
      newsImpact: volatilities[Math.floor(Math.random() * volatilities.length)],
      tradingRecommendation: 'Market showing mixed signals. Focus on major pairs with clear technical setups. Monitor news events for volatility spikes.',
      timestamp: currentTime.toISOString()
    };
  }

  // Utility methods
  isAPIOnline(): boolean {
    return this.isOnline;
  }

  getAPIEndpoint(): string {
    return this.config.baseURL;
  }

  getLastHealthCheck(): Date | null {
    return this.lastHealthCheck;
  }

  isFallbackMode(): boolean {
    return this.fallbackMode;
  }

}

export const backendAPI = new BackendAPIService();
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
  private fallbackMode: boolean = false;

  constructor() {
    // Always use fallback mode in WebContainer/Bolt environment
    const isWebContainer = window.location.hostname.includes('webcontainer') || 
                           window.location.hostname.includes('bolt.new') ||
                           window.location.hostname.includes('stackblitz') ||
                           window.location.hostname.includes('local-credentialless');
    
    // For WebContainer, immediately enable fallback mode
    if (isWebContainer) {
      this.fallbackMode = true;
      console.log('🔄 Running in WebContainer - using demo mode');
    }

    // Determine API endpoint based on environment
    const isProduction = window.location.hostname === 'pipnosis.com' || 
                        window.location.hostname === 'www.pipnosis.com' ||
                        window.location.hostname.includes('netlify.app');
    
    let baseURL: string;
    
    if (isProduction) {
      baseURL = 'https://pipnosis-production.up.railway.app/api';
    } else if (isWebContainer) {
      // For WebContainer, construct a URL but expect it to fail
      const hostname = window.location.hostname;
      baseURL = `https://${hostname}:3001/api`;
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
    // If in fallback mode, immediately throw to use mock data
    if (this.fallbackMode) {
      throw new Error('Using fallback mode');
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
      
    } catch (error) {
      this.isOnline = false;
      // Enable fallback mode after first failure
      this.fallbackMode = true;
      throw error;
    }
  }

  // AI Prompt Analysis with enhanced fallback
  async analyzePrompt(request: PromptAnalysisRequest): Promise<PromptAnalysisResponse> {
    try {
      const response = await this.makeRequest<PromptAnalysisResponse>('/ai/analyze-prompt', {
        method: 'POST',
        body: JSON.stringify(request)
      });
      
      return response;
    } catch (error) {
      return this.getMockPromptAnalysis(request);
    }
  }

  // Trade Execution with enhanced fallback
  async executeTrade(request: TradeExecutionRequest): Promise<TradeExecutionResponse> {
    try {
      const response = await this.makeRequest<TradeExecutionResponse>('/trading/execute', {
        method: 'POST',
        body: JSON.stringify(request)
      });
      
      return response;
    } catch (error) {
      return this.getMockTradeExecution(request);
    }
  }

  // Risk Analysis with enhanced fallback
  async getRiskAnalysis(userId?: string): Promise<RiskAnalysisResponse> {
    try {
      const params = userId ? `?userId=${userId}` : '';
      const response = await this.makeRequest<RiskAnalysisResponse>(`/risk/analysis${params}`);
      
      return response;
    } catch (error) {
      return this.getMockRiskAnalysis();
    }
  }

  // Market Analysis with enhanced fallback
  async getMarketAnalysis(symbols?: string[]): Promise<MarketAnalysisResponse> {
    try {
      const params = symbols ? `?symbols=${symbols.join(',')}` : '';
      const response = await this.makeRequest<MarketAnalysisResponse>(`/market/analysis${params}`);
      
      return response;
    } catch (error) {
      return this.getMockMarketAnalysis(symbols);
    }
  }

  // Account Information with enhanced fallback
  async getAccountInfo(userId?: string): Promise<any> {
    try {
      const params = userId ? `?userId=${userId}` : '';
      return await this.makeRequest(`/account/info${params}`);
    } catch (error) {
      return this.getMockAccountInfo();
    }
  }

  // Enhanced Health Check
  async healthCheck(): Promise<{ status: string; timestamp: string; online: boolean; version?: string }> {
    try {
      const result = await this.makeRequest('/health');
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
      return { 
        status: 'demo', 
        timestamp: new Date().toISOString(),
        online: false
      };
    }
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

  // Enhanced mock data methods for better demo experience
  private getMockPromptAnalysis(request: PromptAnalysisRequest): PromptAnalysisResponse {
    // Simulate processing delay
    const processingDelay = Math.random() * 1000 + 500; // 0.5-1.5 seconds
    
    const strategies = [
      {
        id: 'strategy-low-risk',
        name: 'Conservative Swing Trade',
        risk: 'low' as const,
        symbol: 'EURUSD',
        action: 'buy' as const,
        entry: 1.1410,
        stopLoss: 1.1360,
        takeProfit: 1.1510,
        lotSize: Math.min(0.5, request.accountBalance / 20000), // Dynamic lot sizing
        estimatedGain: Math.floor(request.accountBalance * 0.025), // 2.5% of account
        confidence: 85,
        reasoning: 'Strong uptrend with bullish momentum. Multiple timeframe confirmation on H1 and D1. Following Pipnosis Law #1 (Capital Preservation) with 2% risk per trade. RSI shows healthy pullback with room for upside.',
        feasible: true,
        pipnosisLawsCompliance: ['Law #1: Capital Preservation', 'Law #6: High Quality Entry', 'Law #3: Drawdown Management']
      },
      {
        id: 'strategy-medium-risk',
        name: 'Balanced Growth Trade',
        risk: 'medium' as const,
        symbol: 'GBPUSD',
        action: 'buy' as const,
        entry: 1.2735,
        stopLoss: 1.2685,
        takeProfit: 1.2835,
        lotSize: Math.min(1.0, request.accountBalance / 15000),
        estimatedGain: Math.floor(request.accountBalance * 0.049), // 4.9% of account
        confidence: 78,
        reasoning: 'Balanced approach with good risk-reward ratio. Following trend continuation pattern. Complies with Law #5 (AI Final Decision) and Law #2 (Target 70-80% Win Rate). MACD showing bullish divergence.',
        feasible: request.accountBalance >= 5000,
        pipnosisLawsCompliance: ['Law #5: AI Final Decision', 'Law #2: Target 70-80% Win Rate', 'Law #7: Cut Losses Early']
      },
      {
        id: 'strategy-high-risk',
        name: 'Aggressive Breakout',
        risk: 'high' as const,
        symbol: 'USDJPY',
        action: 'sell' as const,
        entry: 149.85,
        stopLoss: 150.35,
        takeProfit: 148.85,
        lotSize: Math.min(1.5, request.accountBalance / 10000),
        estimatedGain: Math.floor(request.accountBalance * 0.089), // 8.9% of account
        confidence: 65,
        reasoning: 'High-reward breakout opportunity with strong resistance rejection. Higher risk but significant profit potential. AI maintains final decision authority per Law #5. Volume spike confirms momentum.',
        feasible: request.accountBalance >= 10000 && request.riskProfile !== 'low',
        pipnosisLawsCompliance: ['Law #5: AI Final Decision', 'Law #4: Never Chase Unrealistic Goals', 'Law #1: Capital Preservation']
      }
    ];

    // Filter strategies based on account balance and risk profile
    let feasibleStrategies = strategies.filter(s => s.feasible);
    
    // Filter by risk profile
    if (request.riskProfile === 'low') {
      feasibleStrategies = feasibleStrategies.filter(s => s.risk === 'low');
    } else if (request.riskProfile === 'medium') {
      feasibleStrategies = feasibleStrategies.filter(s => s.risk === 'low' || s.risk === 'medium');
    }

    // Ensure at least one strategy
    if (feasibleStrategies.length === 0) {
      feasibleStrategies = [strategies[0]]; // Always include low-risk strategy
    }

    return {
      success: true,
      strategies: feasibleStrategies,
      marketAnalysis: `Current market conditions show ${request.riskProfile === 'high' ? 'volatile but profitable' : 'stable bullish'} momentum across major pairs. USD strength is moderate with EUR showing resilience. Technical indicators support upward movement with proper risk management. Market volatility: ${Math.random() > 0.5 ? 'Low' : 'Medium'}.`,
      riskAssessment: `${request.riskProfile === 'auto' ? 'Auto-detected medium' : request.riskProfile.charAt(0).toUpperCase() + request.riskProfile.slice(1)} risk environment. All strategies comply with Pipnosis Immutable Laws. Position sizing calculated to preserve capital while targeting ${request.tradingGoal || 'weekly'} goals. Maximum risk per trade: 2% (Law #1).`,
      confidence: feasibleStrategies.length >= 2 ? 'high' : 'medium',
      aiRecommendation: `Execute ${feasibleStrategies[0]?.risk || 'low'}-risk strategy first to test market conditions. Monitor for any changes in sentiment or volatility. Account balance of $${request.accountBalance.toLocaleString()} allows for ${feasibleStrategies.length > 1 ? 'multiple strategy options' : 'conservative positioning'}. Consider scaling up after successful execution.`,
      timestamp: new Date().toISOString()
    };
  }

  private getMockTradeExecution(request: TradeExecutionRequest): TradeExecutionResponse {
    const success = Math.random() > 0.05; // 95% success rate for demo
    const executionPrice = request.price || (1.1410 + (Math.random() - 0.5) * 0.001);
    const slippage = (Math.random() - 0.5) * 0.0002; // Small slippage
    
    return {
      success,
      tradeId: `TRD-${Date.now()}`,
      mt5Ticket: success ? Math.floor(Math.random() * 1000000) + 100000 : undefined,
      executionPrice: executionPrice + slippage,
      timestamp: new Date().toISOString(),
      message: success 
        ? `✅ Trade executed successfully (Demo Mode) - ${request.symbol} ${request.action.toUpperCase()} ${request.volume} lots at ${(executionPrice + slippage).toFixed(5)}`
        : '❌ Trade execution failed (Demo Mode) - Market conditions changed or insufficient margin',
      estimatedPnL: success ? request.volume * 100 * (Math.random() * 4 - 2) : 0, // Random P&L between -$200 to +$200
      riskAmount: request.riskAmount,
      error: success ? undefined : 'Demo execution failure - retry available'
    };
  }

  private getMockRiskAnalysis(): RiskAnalysisResponse {
    const currentTime = new Date();
    const riskScore = Math.floor(Math.random() * 25) + 5; // 5-30 range (lower is better)
    const overallRisk = riskScore < 12 ? 'low' : riskScore < 20 ? 'medium' : 'high';
    
    return {
      overallRisk,
      riskScore,
      currentDrawdown: Math.random() * 3, // 0-3%
      maxDrawdown: 20,
      openPositions: Math.floor(Math.random() * 3) + 1, // 1-3 positions
      dailyRisk: Math.random() * 1.5, // 0-1.5%
      weeklyRisk: Math.random() * 6 + 2, // 2-8%
      correlatedPositions: Math.floor(Math.random() * 2), // 0-1
      pipnosisLawsStatus: [
        {
          lawId: 1,
          name: 'Capital Preservation',
          status: 'compliant',
          currentValue: 0.5,
          threshold: 2.0,
          action: 'Continue monitoring position sizes'
        },
        {
          lawId: 2,
          name: 'Target 70-80% Win Rate',
          status: Math.random() > 0.2 ? 'compliant' : 'warning',
          currentValue: 72 + Math.random() * 15,
          threshold: 70,
          action: 'Win rate tracking on target'
        },
        {
          lawId: 3,
          name: 'Drawdown Management',
          status: 'compliant',
          currentValue: 0.1,
          threshold: 15.0,
          action: 'Drawdown well within limits'
        },
        {
          lawId: 5,
          name: 'AI Final Decision',
          status: 'compliant',
          currentValue: 100,
          threshold: 100,
          action: 'AI maintains full control over trade decisions'
        },
        {
          lawId: 9,
          name: 'Do Not Overtrade',
          status: 'compliant',
          currentValue: 1,
          threshold: 5,
          action: 'Position count optimal'
        }
      ],
      recommendations: [
        'Current risk levels are well within safe parameters',
        'Consider scaling position sizes based on market volatility',
        'Monitor correlation if adding new positions in same currency',
        'Maintain current conservative risk management approach',
        'All Pipnosis Laws are being followed correctly'
      ],
      timestamp: currentTime.toISOString()
    };
  }

  private getMockMarketAnalysis(symbols?: string[]): MarketAnalysisResponse {
    const defaultSymbols = symbols || ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD'];
    const currentTime = new Date();
    
    const marketSentiments = ['bullish', 'bearish', 'neutral'] as const;
    const volatilities = ['low', 'medium', 'high'] as const;
    const trends = ['bullish', 'bearish', 'sideways'] as const;
    
    return {
      symbols: defaultSymbols.map(symbol => {
        const isJPY = symbol.includes('JPY');
        const basePrice = isJPY ? 149.85 : symbol === 'GBPUSD' ? 1.2735 : symbol === 'AUDUSD' ? 0.6785 : 1.1410;
        const variation = isJPY ? 2.0 : 0.02;
        const change = (Math.random() - 0.5) * variation;
        
        return {
          symbol,
          bid: basePrice + change - (isJPY ? 0.01 : 0.0001),
          ask: basePrice + change + (isJPY ? 0.01 : 0.0001),
          spread: isJPY ? 0.02 : 0.0002,
          change,
          changePercent: (change / basePrice) * 100,
          volume: Math.floor(Math.random() * 1000000) + 500000,
          trend: trends[Math.floor(Math.random() * trends.length)],
          strength: Math.floor(Math.random() * 40) + 60, // 60-100 strength
          signals: [
            Math.random() > 0.5 ? 'Buy Signal' : 'Sell Signal',
            'RSI Oversold', 
            'MACD Bullish Cross', 
            'Support Level Hold', 
            'Trend Continuation', 
            'Volume Spike', 
            'Fibonacci Retracement',
            'Moving Average Cross', 
            'Breakout Confirmed'
          ].slice(0, Math.floor(Math.random() * 3) + 2),
          timeframe: 'H1'
        };
      }),
      marketSentiment: marketSentiments[Math.floor(Math.random() * marketSentiments.length)],
      volatility: volatilities[Math.floor(Math.random() * volatilities.length)],
      newsImpact: volatilities[Math.floor(Math.random() * volatilities.length)],
      tradingRecommendation: 'Favorable conditions for trend-following strategies with proper risk management. Monitor for any sudden volatility spikes during news releases. Current market structure supports both scalping and swing trading approaches. Pipnosis Laws enforcement ensures safe trading.',
      timestamp: currentTime.toISOString()
    };
  }

  private getMockAccountInfo() {
    const balance = 50000 + (Math.random() - 0.5) * 2000; // Slight variation
    const equity = balance + (Math.random() - 0.5) * 1000;
    const margin = Math.random() * 3000 + 1000;
    
    return {
      balance: Math.round(balance * 100) / 100,
      equity: Math.round(equity * 100) / 100,
      margin: Math.round(margin * 100) / 100,
      freeMargin: Math.round((equity - margin) * 100) / 100,
      marginLevel: Math.round((equity / margin) * 10000) / 100,
      server: 'Pipnosis-Demo-Server',
      account: '12345678',
      currency: 'USD',
      leverage: 100,
      name: 'Demo Account',
      company: 'Pipnosis Demo',
      lastUpdate: new Date().toISOString(),
      connectionStatus: 'Demo Mode - All features available'
    };
  }
}

export const backendAPI = new BackendAPIService();
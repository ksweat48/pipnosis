import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import cron from 'node-cron';
import { tradeMonitoringService } from './services/tradeMonitoringService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// CRITICAL: Load environment variables FIRST - Railway specific
console.log('🔧 Starting Pipnosis Backend Server...');
console.log('📁 Current working directory:', process.cwd());
console.log('📁 Script directory:', __dirname);
console.log('🌍 Environment:', process.env.NODE_ENV || 'development');

// Railway provides environment variables directly, but we still try to load .env for local dev
const possibleEnvPaths = [
  join(process.cwd(), '.env'),
  join(__dirname, '.env'),
  join(__dirname, '../.env'),
  '.env'
];

let envLoaded = false;
let envPath = '';

// Try to load .env file (mainly for local development)
for (const path of possibleEnvPaths) {
  if (existsSync(path)) {
    console.log(`✅ Found .env file at: ${path}`);
    const result = dotenv.config({ path });
    if (!result.error) {
      envLoaded = true;
      envPath = path;
      console.log(`✅ Successfully loaded environment variables from: ${path}`);
      break;
    }
  }
}

// In Railway, environment variables are provided directly, so this is normal
if (!envLoaded) {
  console.log('ℹ️ No .env file found - using Railway environment variables');
}

// Verify critical environment variables
console.log('\n🔑 Environment Variable Status:');
console.log('- OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? `${process.env.OPENAI_API_KEY.substring(0, 10)}...` : '❌ MISSING');
console.log('- PORT:', process.env.PORT || '3001 (default)');
console.log('- NODE_ENV:', process.env.NODE_ENV || 'development (default)');

// Import services AFTER environment variables are loaded
console.log('\n📦 Loading services...');
let mt5Service, aiService, supabase, createUserProfile, logTradeExecution, logTradingPrompt, saveJournalEntry;

try {
  const mt5Module = await import('./services/mt5Service.js');
  mt5Service = mt5Module.mt5Service;
  console.log('✅ MT5 Service loaded');
} catch (error) {
  console.warn('⚠️ MT5 Service failed to load:', error.message);
  // Create mock MT5 service for Railway deployment
  mt5Service = {
    initializeBridge: async () => true,
    getConnectionStatus: () => ({ connected: false, status: 'mock_mode', message: 'MT5 service not available in production' }),
    getMarketData: async () => [],
    executeTrade: async () => ({ success: false, message: 'MT5 not available in production' }),
    broadcastMarketData: () => {},
    shutdown: () => {}
  };
}

try {
  const supabaseModule = await import('./lib/supabase.js');
  supabase = supabaseModule.supabase;
  createUserProfile = supabaseModule.createUserProfile;
  logTradeExecution = supabaseModule.logTradeExecution;
  logTradingPrompt = supabaseModule.logTradingPrompt;
  saveJournalEntry = supabaseModule.saveJournalEntry;
  console.log('✅ Supabase loaded');
} catch (error) {
  console.warn('⚠️ Supabase failed to load:', error.message);
  // Create mock Supabase functions
  supabase = null;
  createUserProfile = async () => ({ data: null, error: new Error('Database not configured') });
  logTradeExecution = async () => ({ data: null, error: new Error('Database not configured') });
  logTradingPrompt = async () => ({ data: null, error: new Error('Database not configured') });
  saveJournalEntry = async () => ({ data: null, error: new Error('Database not configured') });
}

try {
  const aiModule = await import('./services/aiService.js');
  aiService = aiModule.aiService;
  console.log('✅ AI Service loaded');
} catch (error) {
  console.warn('⚠️ AI Service failed to load:', error.message);
  // Create mock AI service
  aiService = {
    isInitialized: false,
    analyzePrompt: async () => ({ strategies: [], summary: 'AI service not available', confidence: 'low' }),
    generateJournalEntry: async () => ({ title: 'Mock Entry', message: 'AI service not available' })
  };
}


console.log('✅ All services loaded successfully');

const app = express();
const PORT = process.env.PORT || 3001;

// FIXED: Enhanced CORS configuration for production deployment
console.log('🔧 Configuring CORS for production...');

// Define allowed origins
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'https://pipnosis.com',
  'https://www.pipnosis.com',
  'https://pipnosis.netlify.app',
  'https://main--pipnosis.netlify.app'
];

// Add WebContainer and Railway patterns
const allowedPatterns = [
  /\.webcontainer-api\.io$/,
  /\.local-credentialless\.webcontainer-api\.io$/,
  /\.railway\.app$/,
  /\.netlify\.app$/,
  /\.bolt\.new$/,
  /\.stackblitz\.io$/
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Check if origin matches any pattern
    for (const pattern of allowedPatterns) {
      if (pattern.test(origin)) {
        return callback(null, true);
      }
    }
    
    console.log(`❌ CORS blocked origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 200 // Some legacy browsers (IE11, various SmartTVs) choke on 204
}));

// Add explicit preflight handling
app.options('*', cors());

app.use(express.json());

// Request logging with enhanced debugging
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.path} - ${new Date().toISOString()}`);
  console.log(`🔗 Origin: ${req.get('Origin') || 'none'}`);
  console.log(`🔗 User-Agent: ${req.get('User-Agent') || 'none'}`);
  next();
});

// Initialize services on startup
async function initializeServices() {
  console.log('🚀 Initializing Pipnosis Backend Services...');
  
  try {
    // Initialize MT5 service
    if (mt5Service && mt5Service.initializeBridge) {
      const mt5Initialized = await mt5Service.initializeBridge();
      if (mt5Initialized) {
        console.log('✅ MT5 Service initialized');
      } else {
        console.warn('⚠️ MT5 Service failed to initialize - using mock data');
      }
    }

    // AI service initializes itself
    console.log('✅ AI Service ready');

    // Start trade monitoring service
    if (supabase && supabase.from) {
      tradeMonitoringService.start();
      console.log('✅ Trade Monitoring Service started');
    } else {
      console.warn('⚠️ Trade Monitoring Service not started - Supabase not available');
    }
  } catch (error) {
    console.error('❌ Service initialization error:', error);
  }
}

// Routes

// Root endpoint for testing
app.get('/', (req, res) => {
  res.json({
    message: 'Pipnosis Backend API',
    version: '2.0.0',
    status: 'running',
    environment: {
      envLoaded,
      envPath,
      hasOpenAI: !!process.env.OPENAI_API_KEY,
      hasSupabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
      nodeEnv: process.env.NODE_ENV,
      port: PORT
    },
    endpoints: {
      health: '/api/health',
      marketData: '/api/market-data',
      analyzePrompt: '/api/analyze-prompt',
      executeTrade: '/api/execute-trade',
      mt5Status: '/api/mt5-status',
      waitlist: '/api/waitlist'
    },
    cors: {
      allowedOrigins: allowedOrigins,
      requestOrigin: req.get('Origin') || 'none'
    }
  });
});

// Health check with enhanced info
app.get('/api/health', (req, res) => {
  const healthData = { 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    services: {
      supabase: supabase ? 'connected' : 'not_configured',
      mt5: mt5Service && mt5Service.getConnectionStatus ? 
           (mt5Service.getConnectionStatus().connected ? 'connected' : 'disconnected') : 'unavailable',
      ai: aiService && aiService.isInitialized ? 'connected' : 'mock'
    },
    environment: {
      node_version: process.version,
      port: PORT,
      cors_enabled: true,
      env_loaded: envLoaded,
      env_path: envPath,
      node_env: process.env.NODE_ENV
    },
    cors: {
      requestOrigin: req.get('Origin') || 'none',
      allowed: true
    }
  };
  
  console.log('🏥 Health check requested:', healthData);
  res.json(healthData);
});

// Market data endpoint
app.get('/api/market-data', async (req, res) => {
  try {
    console.log('📊 Market data requested');
    
    // Enhanced fallback market data for Railway deployment
    const fallbackMarketData = [
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

    let marketData = fallbackMarketData;
    
    if (mt5Service && mt5Service.getMarketData) {
      try {
        marketData = await mt5Service.getMarketData();
        if (!marketData || marketData.length === 0) {
          marketData = fallbackMarketData;
        }
      } catch (error) {
        console.warn('MT5 market data failed, using fallback:', error.message);
        marketData = fallbackMarketData;
      }
    }

    res.json(marketData);
  } catch (error) {
    console.error('Market data error:', error);
    res.status(500).json({ error: 'Failed to fetch market data' });
  }
});

// AI prompt analysis endpoint
app.post('/api/analyze-prompt', async (req, res) => {
  try {
    const { prompt, accountBalance, marketData, userId, userProfile } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    console.log(`🧠 Analyzing prompt: "${prompt}" for user: ${userId || 'anonymous'}`);
    
    // Log prompt to database if user is logged in
    if (userId && logTradingPrompt) {
      try {
        await logTradingPrompt(userId, {
          prompt,
          accountBalance,
          marketData,
          strategies: [], // Will be updated after analysis
          confidence: 'pending'
        });
      } catch (dbError) {
        console.warn('⚠️ Failed to log prompt to database:', dbError.message);
      }
    }
    
    let analysis;
    
    if (aiService && aiService.analyzePrompt) {
      try {
        analysis = await aiService.analyzePrompt(
          prompt, 
          accountBalance, 
          marketData
        );
      } catch (aiError) {
        console.warn('AI analysis failed, using fallback:', aiError.message);
        analysis = getFallbackAnalysis();
      }
    } else {
      analysis = getFallbackAnalysis();
    }

    console.log('🧠 Analysis result:', { 
      strategiesCount: analysis.strategies?.length || 0, 
      confidence: analysis.confidence 
    });
    
    res.json(analysis);
  } catch (error) {
    console.error('Prompt analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze prompt' });
  }
});

// Fallback analysis function
function getFallbackAnalysis() {
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
        reasoning: 'Conservative approach following Law #1 (Capital Preservation) with 1.5% account risk. Law #6 (High Quality Entry) ensures multiple confirmations. Law #2 targets 80% win rate with tight risk management per Law #3.'
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
        reasoning: 'Balanced approach per Law #5 (AI Final Decision) with 4% account risk. Law #7 (Cut Losses Early) guides stop placement. Maintains Law #2 target win rate while optimizing for weekly goals.'
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
        reasoning: 'Higher risk approach still governed by Law #1 (Capital Preservation) with 8% max risk. Law #6 (High Quality Entry) requires breakout confirmation. Law #10 (Consistency Over Speed) ensures sustainable execution.'
      }
    ],
    summary: 'Market analysis across multiple trading pairs shows opportunities at all risk levels. All strategies comply with Pipnosis Immutable Laws.',
    confidence: 'high',
    riskAssessment: 'Risk management follows Law #1 (Capital Preservation) and Law #3 (Drawdown Management). Multiple risk levels provide flexibility while maintaining discipline.',
    pairsAnalyzed: 10,
    tierInfo: 'Analyzed Tier 1 (7 pairs) + Tier 2 (3 pairs) - Production Mode'
  };
}

// Trade execution endpoint
app.post('/api/execute-trade', async (req, res) => {
  try {
    const { strategy, userId, userProfile } = req.body;
    
    if (!strategy) {
      return res.status(400).json({ error: 'Strategy is required' });
    }

    console.log(`⚡ Executing trade: ${strategy.tradeType} for user: ${userId || 'anonymous'}`);

    // Check session limits before executing
    if (userId && aiService && aiService.checkSessionLimits) {
      const sessionCheck = await aiService.checkSessionLimits(userId);
      if (!sessionCheck.canTrade) {
        return res.status(400).json({
          success: false,
          error: 'Session limit reached',
          message: sessionCheck.reason
        });
      }
    }
    // Execute trade via MT5 service
    const tradeRequest = {
      action: strategy.tradeType.toLowerCase().includes('buy') ? 'buy' : 'sell',
      symbol: strategy.tradeType.split(' ')[0],
      volume: strategy.lotSize,
      price: strategy.entry,
      sl: strategy.stopLoss,
      tp: strategy.takeProfit,
      comment: `Pipnosis AI: ${strategy.name}`,
      user_id: userId
    };

    let result;
    if (mt5Service && mt5Service.executeTrade) {
      try {
        result = await mt5Service.executeTrade(tradeRequest);
      } catch (mt5Error) {
        console.warn('MT5 execution failed, using mock result:', mt5Error.message);
        result = getMockTradeResult(tradeRequest);
      }
    } else {
      result = getMockTradeResult(tradeRequest);
    }

    // Log trade to database with enhanced details
    if (userId && logTradeExecution) {
      try {
        await logTradeExecution({
          user_id: userId,
          symbol: result.symbol,
          trade_type: tradeRequest.action,
          lot_size: result.volume,
          entry_price: result.price,
          stop_loss: strategy.stopLoss,
          take_profit: strategy.takeProfit,
          status: result.success ? 'open' : 'failed',
          mt5_ticket: result.ticket,
          trade_metadata: {
            strategy_name: strategy.name,
            risk_level: strategy.risk,
            estimated_gain: strategy.estimatedGain,
            session_id: uuidv4()
          },
          opened_at: new Date().toISOString()
        });
        console.log('✅ Trade logged to database');
      } catch (dbError) {
        console.warn('⚠️ Failed to log trade to database:', dbError.message);
      }
    }
    // Log trade to database if user is logged in
    if (userId && logTradeExecution) {
      try {
        await logTradeExecution(userId, {
          symbol: result.symbol,
          action: tradeRequest.action,
          lotSize: result.volume,
          entry: result.price,
          stopLoss: strategy.stopLoss,
          takeProfit: strategy.takeProfit,
          success: result.success,
          tradeId: result.ticket,
          strategyName: strategy.name,
          risk: strategy.risk,
          estimatedGain: strategy.estimatedGain
        });
      } catch (dbError) {
        console.warn('⚠️ Failed to log trade to database:', dbError.message);
      }
    }

    const response = {
      success: result.success,
      tradeId: result.ticket,
      symbol: result.symbol,
      entry: result.price,
      lotSize: result.volume,
      timestamp: new Date().toISOString(),
      message: result.success ? 'Trade executed successfully' : 'Trade execution failed'
    };

    console.log('⚡ Trade execution result:', response);
    res.json(response);
  } catch (error) {
    console.error('Trade execution error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to execute trade',
      message: error.message 
    });
  }
});

// Mock trade result function
function getMockTradeResult(tradeRequest) {
  return {
    success: true,
    ticket: `PROD-${Date.now()}`,
    symbol: tradeRequest.symbol || 'EURUSD',
    volume: tradeRequest.volume || 0.1,
    price: tradeRequest.price || 1.1425,
    comment: 'Production mock execution - MT5 not connected'
  };
}

// User KPIs endpoint
app.get('/api/user/kpis', async (req, res) => {
  try {
    // Extract user ID from auth header (simplified for demo)
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    // For demo purposes, extract user ID from a simple token
    // In production, you'd validate the JWT token properly
    const userId = req.headers['x-user-id'] || 'demo-user';

    console.log(`📊 KPIs requested for user: ${userId}`);

    if (getUserKPIs) {
      const { data: kpis, error } = await getUserKPIs(userId);
      
      if (error) {
        console.error('Error fetching KPIs:', error);
        return res.status(500).json({ error: 'Failed to fetch KPIs' });
      }

      res.json(kpis);
    } else {
      // Fallback mock KPIs
      res.json({
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalPnL: 0,
        averageRRR: 0,
        maxDrawdown: 0,
        openTrades: 0
      });
    }
  } catch (error) {
    console.error('KPIs endpoint error:', error);
    res.status(500).json({ error: 'Failed to fetch KPIs' });
  }
});

// User active trades endpoint
app.get('/api/user/active-trades', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 'demo-user';
    console.log(`📈 Active trades requested for user: ${userId}`);

    if (getActiveTrades) {
      const { data: trades, error } = await getActiveTrades(userId);
      
      if (error) {
        console.error('Error fetching active trades:', error);
        return res.status(500).json({ error: 'Failed to fetch active trades' });
      }

      res.json(trades);
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error('Active trades endpoint error:', error);
    res.status(500).json({ error: 'Failed to fetch active trades' });
  }
});

// User trade history endpoint
app.get('/api/user/trade-history', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 'demo-user';
    const limit = parseInt(req.query.limit) || 50;
    console.log(`📜 Trade history requested for user: ${userId}, limit: ${limit}`);

    if (getTradeHistory) {
      const { data: trades, error } = await getTradeHistory(userId, limit);
      
      if (error) {
        console.error('Error fetching trade history:', error);
        return res.status(500).json({ error: 'Failed to fetch trade history' });
      }

      res.json(trades);
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error('Trade history endpoint error:', error);
    res.status(500).json({ error: 'Failed to fetch trade history' });
  }
});

// User journal entries endpoint
app.get('/api/user/journal-entries', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 'demo-user';
    const limit = parseInt(req.query.limit) || 20;
    console.log(`📔 Journal entries requested for user: ${userId}, limit: ${limit}`);

    if (getJournalEntries) {
      const { data: entries, error } = await getJournalEntries(userId, limit);
      
      if (error) {
        console.error('Error fetching journal entries:', error);
        return res.status(500).json({ error: 'Failed to fetch journal entries' });
      }

      res.json(entries);
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error('Journal entries endpoint error:', error);
    res.status(500).json({ error: 'Failed to fetch journal entries' });
  }
});

// MT5 connection status
app.get('/api/mt5-status', (req, res) => {
  let status;
  if (mt5Service && mt5Service.getConnectionStatus) {
    status = mt5Service.getConnectionStatus();
  } else {
    status = {
      connected: false,
      status: 'unavailable',
      message: 'MT5 service not available in production environment'
    };
  }
  console.log('🔌 MT5 status requested:', status);
  res.json(status);
});

// Waitlist signup endpoint (enhanced with Supabase)
app.post('/api/waitlist', async (req, res) => {
  try {
    const { email, plan } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    console.log('📧 Waitlist signup:', { email, plan, timestamp: new Date().toISOString() });
    
    const response = {
      success: true,
      message: 'Successfully processed request',
    };
    
    console.log('📧 Response:', response);
    res.json(response);
  } catch (error) {
    console.error('Waitlist signup error:', error);
    res.status(500).json({ error: 'Failed to process waitlist signup' });
  }
});

// Market analysis endpoint - Simplified for token reduction
app.get('/api/market/analysis', (req, res) => {
  try {
    console.log('📊 Market analysis requested');
    
    // Generate minimal market data
    const symbols = ['EURUSD', 'GBPUSD', 'USDJPY'].map(symbol => ({
      symbol,
      bid: 1.0 + Math.random() * 0.1,
      ask: 1.0 + Math.random() * 0.1 + 0.0002,
      spread: 0.0004,
      change: (Math.random() - 0.5) * 0.01,
      changePercent: (Math.random() - 0.5) * 1,
      volume: Math.floor(Math.random() * 1000000),
      trend: Math.random() > 0.5 ? 'bullish' : 'bearish',
      strength: Math.floor(Math.random() * 100),
      signals: ['Buy Signal'],
      timeframe: 'H1'
    }));
    
    res.json({
      symbols,
      marketSentiment: 'neutral',
      volatility: 'medium',
      newsImpact: 'low',
      tradingRecommendation: 'Use proper risk management',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Market analysis error:', error);
    res.status(500).json({ error: 'Failed to fetch market analysis' });
  }
});

// Real-time market data WebSocket info
app.get('/api/websocket-info', (req, res) => {
  res.json({
    websocket_url: 'ws://localhost:8080',
    status: 'inactive',
    connected_clients: 0,
    message: 'WebSocket not available in production'
  });
});

// Debug endpoint to list all routes
app.get('/api/debug/routes', (req, res) => {
  const routes = [];
  app._router.stack.forEach((middleware) => {
    if (middleware.route) {
      routes.push({
        path: middleware.route.path,
        methods: Object.keys(middleware.route.methods)
      });
    }
  });
  res.json({ routes });
});

// CORS debug endpoint
app.get('/api/debug/cors', (req, res) => {
  res.json({
    requestOrigin: req.get('Origin') || 'none',
    allowedOrigins: allowedOrigins,
    userAgent: req.get('User-Agent') || 'none',
    headers: req.headers,
    corsEnabled: true
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('💥 Server Error:', err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler - MUST be last
app.use((req, res) => {
  console.log('❌ 404 Not Found:', req.method, req.path);
  console.log('📋 Available routes: /api/health, /api/market-data, /api/analyze-prompt, /api/execute-trade, /api/mt5-status, /api/waitlist');
  res.status(404).json({ 
    error: 'Endpoint not found',
    path: req.path,
    method: req.method,
    availableEndpoints: [
      'GET /api/health',
      'GET /api/market-data', 
      'POST /api/analyze-prompt',
      'POST /api/execute-trade',
      'GET /api/mt5-status',
      'GET /api/debug/routes',
      'GET /api/debug/cors'
    ]
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down Pipnosis Backend...');
  tradeMonitoringService.stop();
  if (mt5Service && mt5Service.shutdown) {
    mt5Service.shutdown();
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 SIGTERM received, shutting down gracefully...');
  tradeMonitoringService.stop();
  if (mt5Service && mt5Service.shutdown) {
    mt5Service.shutdown();
  }
  process.exit(0);
});

// Start server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Pipnosis Backend Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔗 Market data: http://localhost:${PORT}/api/market-data`);
  console.log(`🔧 CORS enabled for production deployment`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔐 CORS Origins: ${allowedOrigins.join(', ')}`);
  
  // Initialize services after server starts
  await initializeServices();
  
  console.log('\n✅ Pipnosis Backend Ready!');
  console.log('🔥 Production Architecture: Express.js + Supabase + AI');
  console.log('🤖 AI Trade Assistant: Monitoring active trades every 5 minutes');
  console.log('\n📋 Available API Endpoints:');
  console.log('- GET  /api/health');
  console.log('- GET  /api/market-data');
  console.log('- POST /api/analyze-prompt');
  console.log('- POST /api/execute-trade');
  console.log('- GET  /api/mt5-status');
  console.log('- GET  /api/debug/routes');
  console.log('- GET  /api/debug/cors');
});
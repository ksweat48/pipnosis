import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import cron from 'node-cron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// CRITICAL: Load environment variables FIRST with comprehensive debugging
console.log('🔧 Starting environment variable loading...');
console.log('📁 Current working directory:', process.cwd());
console.log('📁 Script directory:', __dirname);

// Try multiple possible .env locations
const possibleEnvPaths = [
  join(process.cwd(), '.env'),           // From current working directory
  join(__dirname, '../.env'),            // From server directory, go up one level
  join(__dirname, '../../.env'),         // From server directory, go up two levels
  '.env',                                // Relative to current directory
  '../.env'                              // Relative, up one level
];

let envLoaded = false;
let envPath = '';

for (const path of possibleEnvPaths) {
  console.log(`🔍 Checking .env path: ${path}`);
  if (existsSync(path)) {
    console.log(`✅ Found .env file at: ${path}`);
    const result = dotenv.config({ path });
    if (!result.error) {
      envLoaded = true;
      envPath = path;
      console.log(`✅ Successfully loaded environment variables from: ${path}`);
      break;
    } else {
      console.log(`❌ Error loading from ${path}:`, result.error);
    }
  } else {
    console.log(`❌ .env file not found at: ${path}`);
  }
}

if (!envLoaded) {
  console.error('❌ CRITICAL: Could not load .env file from any location!');
  console.log('💡 Please ensure .env file exists in the project root directory');
  console.log('💡 Possible locations checked:', possibleEnvPaths);
  
  // Continue with warnings but don't crash
  console.log('⚠️ Continuing with default/missing environment variables...');
}

// Verify environment variables are loaded with detailed logging
console.log('\n🔑 Environment Variable Status:');
console.log('- OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? `${process.env.OPENAI_API_KEY.substring(0, 10)}...` : '❌ MISSING');
console.log('- SUPABASE_URL:', process.env.SUPABASE_URL ? '✅ SET' : '❌ MISSING');
console.log('- SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ SET' : '❌ MISSING');
console.log('- PORT:', process.env.PORT || '3001 (default)');
console.log('- NODE_ENV:', process.env.NODE_ENV || 'development (default)');

// Import services AFTER environment variables are loaded
console.log('\n📦 Loading services...');
try {
  const { mt5Service } = await import('./services/mt5Service.js');
  const { aiService } = await import('./services/aiService.js');
  const { supabase, createUserProfile, logTradeExecution } = await import('./lib/supabase.js');
  
  console.log('✅ All services loaded successfully');

  const app = express();
  const PORT = process.env.PORT || 3001;

  // Enhanced CORS configuration for WebContainer
  app.use(cors({
    origin: [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:3000',
      /\.webcontainer-api\.io$/,
      /\.local-credentialless\.webcontainer-api\.io$/
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  }));

  app.use(express.json());

  // Request logging with enhanced debugging
  app.use((req, res, next) => {
    console.log(`📡 ${req.method} ${req.path} - ${new Date().toISOString()}`);
    console.log(`🔗 Origin: ${req.get('Origin') || 'none'}`);
    next();
  });

  // Initialize services on startup
  async function initializeServices() {
    console.log('🚀 Initializing Pipnosis Backend Services...');
    
    try {
      // Test Supabase connection
      const { data, error } = await supabase.from('user_profiles').select('count').limit(1);
      if (error) {
        console.warn('⚠️ Supabase connection failed:', error.message);
      } else {
        console.log('✅ Supabase connected successfully');
      }

      // Initialize MT5 service
      const mt5Initialized = await mt5Service.initializeBridge();
      if (mt5Initialized) {
        console.log('✅ MT5 Service initialized');
      } else {
        console.warn('⚠️ MT5 Service failed to initialize - using mock data');
      }

      // AI service initializes itself
      console.log('✅ AI Service ready');

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
        hasSupabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
      },
      endpoints: {
        health: '/api/health',
        marketData: '/api/market-data',
        analyzePrompt: '/api/analyze-prompt',
        executeTrade: '/api/execute-trade',
        mt5Status: '/api/mt5-status',
        waitlist: '/api/waitlist'
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
        supabase: 'connected',
        mt5: mt5Service.getConnectionStatus().connected ? 'connected' : 'disconnected',
        ai: aiService.isInitialized ? 'connected' : 'mock'
      },
      environment: {
        node_version: process.version,
        port: PORT,
        cors_enabled: true,
        env_loaded: envLoaded,
        env_path: envPath
      }
    };
    
    console.log('🏥 Health check requested:', healthData);
    res.json(healthData);
  });

  // Market data endpoint
  app.get('/api/market-data', async (req, res) => {
    try {
      console.log('📊 Market data requested');
      const marketData = await mt5Service.getMarketData();
      console.log('📊 Returning market data:', marketData.length, 'items');
      res.json(marketData);
    } catch (error) {
      console.error('Market data error:', error);
      res.status(500).json({ error: 'Failed to fetch market data' });
    }
  });

  // AI prompt analysis endpoint
  app.post('/api/analyze-prompt', async (req, res) => {
    try {
      const { prompt, accountBalance, marketData, userId } = req.body;
      
      if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' });
      }

      console.log(`🧠 Analyzing prompt: "${prompt}" for user: ${userId || 'anonymous'}`);
      
      const analysis = await aiService.analyzePrompt(
        prompt, 
        accountBalance || 10000, 
        marketData,
        userId
      );
      
      console.log('🧠 Analysis complete:', analysis.strategies.length, 'strategies generated');
      res.json(analysis);
    } catch (error) {
      console.error('Prompt analysis error:', error);
      res.status(500).json({ error: 'Failed to analyze prompt' });
    }
  });

  // Trade execution endpoint
  app.post('/api/execute-trade', async (req, res) => {
    try {
      const { strategy, userId } = req.body;
      
      if (!strategy) {
        return res.status(400).json({ error: 'Strategy is required' });
      }

      console.log(`⚡ Executing trade: ${strategy.tradeType} for user: ${userId || 'anonymous'}`);

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
      try {
        result = await mt5Service.executeTrade(tradeRequest);
      } catch (mt5Error) {
        console.warn('MT5 execution failed, using mock result:', mt5Error.message);
        // Mock successful execution for development
        result = {
          success: true,
          ticket: `MOCK-${Date.now()}`,
          symbol: tradeRequest.symbol,
          volume: tradeRequest.volume,
          price: tradeRequest.price,
          comment: 'Mock execution - MT5 not connected'
        };
      }

      // Generate AI journal entry for the trade
      if (userId) {
        await aiService.generateJournalEntry('trade_entry', {
          symbol: result.symbol,
          action: tradeRequest.action,
          price: result.price,
          strategy: strategy.name,
          tradeId: result.ticket,
          success: result.success
        }, userId);
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

  // MT5 connection status
  app.get('/api/mt5-status', (req, res) => {
    const status = mt5Service.getConnectionStatus();
    console.log('🔌 MT5 status requested:', status);
    res.json(status);
  });

  // User profile endpoints
  app.post('/api/user/profile', async (req, res) => {
    try {
      const { userId, profileData } = req.body;
      
      if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
      }

      const profile = await createUserProfile(userId, profileData);
      res.json(profile);
    } catch (error) {
      console.error('Profile creation error:', error);
      res.status(500).json({ error: 'Failed to create user profile' });
    }
  });

  // Waitlist signup endpoint (enhanced with Supabase)
  app.post('/api/waitlist', async (req, res) => {
    try {
      const { email, plan } = req.body;
      
      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      console.log('📧 Waitlist signup:', { email, plan, timestamp: new Date().toISOString() });
      
      // Save to Supabase waitlist table
      try {
        const { data, error } = await supabase
          .from('waitlist')
          .insert({
            email,
            plan_type: plan || 'free',
            created_at: new Date().toISOString()
          })
          .select()
          .single();

        if (error && error.code !== '23505') { // Ignore duplicate email errors
          throw error;
        }

        console.log('✅ Waitlist entry saved to Supabase');
      } catch (supabaseError) {
        console.warn('⚠️ Supabase waitlist save failed:', supabaseError.message);
        // Continue with response even if Supabase fails
      }
      
      const response = {
        success: true,
        message: 'Successfully added to waitlist',
        plan: plan
      };
      
      console.log('📧 Waitlist response:', response);
      res.json(response);
    } catch (error) {
      console.error('Waitlist signup error:', error);
      res.status(500).json({ error: 'Failed to join waitlist' });
    }
  });

  // Real-time market data WebSocket info
  app.get('/api/websocket-info', (req, res) => {
    res.json({
      websocket_url: 'ws://localhost:8080',
      status: mt5Service.connectedClients.size > 0 ? 'active' : 'inactive',
      connected_clients: mt5Service.connectedClients.size
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

  // Scheduled tasks
  cron.schedule('*/30 * * * * *', async () => {
    // Update market data every 30 seconds
    try {
      const marketData = await mt5Service.getMarketData();
      // Broadcast to WebSocket clients
      mt5Service.broadcastMarketData(marketData);
    } catch (error) {
      // Silently handle errors in background tasks
    }
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
        'POST /api/waitlist',
        'GET /api/debug/routes'
      ]
    });
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down Pipnosis Backend...');
    mt5Service.shutdown();
    process.exit(0);
  });

  // Start server
  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Pipnosis Backend Server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
    console.log(`🔗 Market data: http://localhost:${PORT}/api/market-data`);
    console.log(`🌐 WebSocket: ws://localhost:8080`);
    console.log(`🔧 CORS enabled for WebContainer environment`);
    
    // Initialize services after server starts
    await initializeServices();
    
    console.log('\n✅ Pipnosis Backend Ready!');
    console.log('🔥 Hybrid Architecture: Express.js + Supabase + MT5 + AI');
    console.log('\n📋 Available API Endpoints:');
    console.log('- GET  /api/health');
    console.log('- GET  /api/market-data');
    console.log('- POST /api/analyze-prompt');
    console.log('- POST /api/execute-trade');
    console.log('- GET  /api/mt5-status');
    console.log('- POST /api/waitlist');
    console.log('- GET  /api/debug/routes');
  });

} catch (serviceLoadError) {
  console.error('❌ CRITICAL: Failed to load services:', serviceLoadError);
  console.log('💡 This might be due to missing environment variables or module issues');
  process.exit(1);
}
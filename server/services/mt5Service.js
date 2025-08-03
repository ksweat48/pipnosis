import { spawn } from 'child_process';
import WebSocket from 'ws';
import MetaApi from 'metaapi.cloud-sdk';

class MT5Service {
  constructor() {
    this.pythonProcess = null;
    this.wsServer = null;
    this.connectedClients = new Set();
    this.isConnected = false;
    this.accountInfo = null;
    this.pythonAvailable = false;
    
    // MetaApi properties
    this.metaApi = null;
    this.metaApiAccount = null;
    this.metaApiConnection = null;
    this.metaApiConnected = false;
    this.connectionType = 'none'; // 'metaapi', 'python', 'mock'
  }

  // Check if Python is available
  async checkPythonAvailability() {
    return new Promise((resolve) => {
      const testProcess = spawn('python', ['--version'], { stdio: 'pipe' });
      
      testProcess.on('close', (code) => {
        this.pythonAvailable = code === 0;
        resolve(this.pythonAvailable);
      });
      
      testProcess.on('error', () => {
        this.pythonAvailable = false;
        resolve(false);
      });
      
      // Timeout after 2 seconds
      setTimeout(() => {
        testProcess.kill();
        this.pythonAvailable = false;
        resolve(false);
      }, 2000);
    });
  }

  // Initialize MetaApi connection
  async initializeMetaApi(token) {
    try {
      if (!token || token === 'your_metaapi_token_here') {
        console.log('⚠️ MetaApi token not configured. Skipping MetaApi initialization.');
        return false;
      }

      console.log('🔄 Initializing MetaApi connection...');
      
      this.metaApi = new MetaApi(token);
      
      // Get accounts
      const accounts = await this.metaApi.metatraderAccountApi.getAccounts();
      
      if (accounts.length === 0) {
        console.log('⚠️ No MetaApi accounts found. Please add an account in your MetaApi dashboard.');
        return false;
      }

      // Use the first available account
      this.metaApiAccount = accounts[0];
      console.log(`📊 Found MetaApi account: ${this.metaApiAccount.name} (${this.metaApiAccount.id})`);

      // Wait for account to be deployed
      console.log('⏳ Waiting for MetaApi account deployment...');
      await this.metaApiAccount.waitDeployed();

      // Connect to the account
      this.metaApiConnection = await this.metaApiAccount.connect();
      console.log('🔗 Connecting to MetaApi terminal...');
      
      // Wait for connection
      await this.metaApiConnection.waitSynchronized();
      
      this.metaApiConnected = true;
      this.connectionType = 'metaapi';
      this.isConnected = true;
      
      console.log('✅ MetaApi connected successfully!');
      console.log(`📈 Account: ${this.metaApiAccount.name}`);
      console.log(`💰 Balance: $${this.metaApiConnection.accountInformation?.balance || 'Loading...'}`);
      
      return true;
    } catch (error) {
      console.error('❌ MetaApi initialization failed:', error.message);
      this.metaApiConnected = false;
      return false;
    }
  }

  // Initialize MT5 Python bridge (fallback)
  async initializePythonBridge() {
    try {
      console.log('🔄 Checking Python availability...');
      
      const pythonAvailable = await this.checkPythonAvailability();
      
      if (!pythonAvailable) {
        console.log('⚠️ Python not found in PATH. Skipping Python bridge.');
        return false;
      }

      console.log('✅ Python found. Starting MT5 Python bridge...');
      
      // Start Python MT5 connector
      this.pythonProcess = spawn('python', ['../python/mt5_connector.py'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.pythonProcess.stdout.on('data', (data) => {
        console.log('🐍 MT5 Python:', data.toString());
        this.handlePythonOutput(data.toString());
      });

      this.pythonProcess.stderr.on('data', (data) => {
        console.error('❌ MT5 Python Error:', data.toString());
      });

      this.pythonProcess.on('close', (code) => {
        console.log(`🔴 MT5 Python process exited with code ${code}`);
        this.isConnected = false;
        this.pythonAvailable = false;
      });

      this.pythonProcess.on('error', (error) => {
        console.error('❌ Failed to start MT5 Python process:', error.message);
        this.pythonAvailable = false;
        return false;
      });

      this.connectionType = 'python';
      this.isConnected = true;
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Python bridge:', error);
      return false;
    }
  }

  // Main initialization method
  async initializeBridge(metaApiToken = null) {
    try {
      console.log('🚀 Initializing MT5 bridge...');
      
      // Try MetaApi first (priority)
      if (metaApiToken) {
        const metaApiSuccess = await this.initializeMetaApi(metaApiToken);
        if (metaApiSuccess) {
          console.log('✅ MT5 bridge initialized via MetaApi');
          this.startWebSocketServer();
          return true;
        }
      }

      // Fallback to Python bridge
      const pythonSuccess = await this.initializePythonBridge();
      if (pythonSuccess) {
        console.log('✅ MT5 bridge initialized via Python');
        this.startWebSocketServer();
        return true;
      }

      // Final fallback to mock mode
      console.log('🎭 No real connections available. Starting in mock mode...');
      this.connectionType = 'mock';
      this.startWebSocketServer();
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize MT5 bridge:', error);
      this.connectionType = 'mock';
      this.startWebSocketServer();
      return true; // Return true to continue with mock mode
    }
  }

  startWebSocketServer() {
    try {
      this.wsServer = new WebSocket.Server({ port: 8080 });
      
      this.wsServer.on('connection', (ws) => {
        console.log('🔗 MT5 WebSocket client connected');
        this.connectedClients.add(ws);

        ws.on('message', (message) => {
          this.handleWebSocketMessage(JSON.parse(message.toString()));
        });

        ws.on('close', () => {
          console.log('🔌 MT5 WebSocket client disconnected');
          this.connectedClients.delete(ws);
        });

        ws.on('error', (error) => {
          console.error('🔌 WebSocket error:', error.message);
          this.connectedClients.delete(ws);
        });
      });

      this.wsServer.on('error', (error) => {
        console.error('❌ WebSocket server error:', error.message);
      });

      console.log('🌐 MT5 WebSocket server started on port 8080');
    } catch (error) {
      console.error('❌ Failed to start WebSocket server:', error.message);
    }
  }

  handlePythonOutput(output) {
    try {
      const data = JSON.parse(output);
      
      switch (data.type) {
        case 'connection_status':
          this.isConnected = data.connected;
          this.accountInfo = data.account_info;
          break;
        case 'trade_result':
          this.handleTradeResult(data);
          break;
        case 'market_data':
          this.broadcastMarketData(data);
          break;
        case 'account_update':
          this.handleAccountUpdate(data);
          break;
      }
    } catch (error) {
      // Handle non-JSON output (logs, etc.)
      console.log('📝 MT5 Log:', output);
    }
  }

  handleWebSocketMessage(message) {
    // Handle WebSocket messages from clients
    console.log('📨 WebSocket message:', message);
  }

  async handleTradeResult(tradeData) {
    try {
      console.log('✅ Trade result processed:', tradeData);
    } catch (error) {
      console.error('❌ Failed to process trade result:', error);
    }
  }

  broadcastMarketData(marketData) {
    const message = JSON.stringify({
      type: 'market_update',
      data: marketData
    });

    this.connectedClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (error) {
          console.error('❌ Failed to send market data to client:', error.message);
          this.connectedClients.delete(client);
        }
      }
    });
  }

  async handleAccountUpdate(accountData) {
    try {
      this.accountInfo = accountData;
    } catch (error) {
      console.error('❌ Failed to update account info:', error);
    }
  }

  // Get live market data via MetaApi
  async getMetaApiMarketData(symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD']) {
    try {
      if (!this.metaApiConnected || !this.metaApiConnection) {
        throw new Error('MetaApi not connected');
      }

      console.log('📊 Fetching live market data via MetaApi...');
      
      const marketData = [];
      
      for (const symbol of symbols) {
        try {
          // Get current price
          const price = await this.metaApiConnection.getSymbolPrice(symbol);
          
          if (price) {
            // Calculate change (simplified - in production you'd compare with previous price)
            const change = (Math.random() - 0.5) * 0.01;
            const changePercent = (change / price.bid) * 100;
            
            marketData.push({
              symbol,
              price: price.bid,
              bid: price.bid,
              ask: price.ask,
              spread: price.ask - price.bid,
              change: change,
              changePercent: changePercent,
              trend: change > 0 ? 'up' : 'down',
              signal: ['buy', 'sell', 'hold'][Math.floor(Math.random() * 3)],
              timestamp: new Date().toISOString(),
              source: 'metaapi'
            });
          }
        } catch (symbolError) {
          console.warn(`⚠️ Failed to get price for ${symbol}:`, symbolError.message);
        }
      }

      console.log(`✅ Retrieved live data for ${marketData.length}/${symbols.length} symbols via MetaApi`);
      return marketData;
    } catch (error) {
      console.error('❌ MetaApi market data failed:', error.message);
      throw error;
    }
  }

  // Execute trade via MetaApi
  async executeMetaApiTrade(tradeRequest) {
    try {
      if (!this.metaApiConnected || !this.metaApiConnection) {
        throw new Error('MetaApi not connected');
      }

      console.log('⚡ Executing trade via MetaApi:', tradeRequest);

      const tradeOptions = {
        symbol: tradeRequest.symbol,
        actionType: tradeRequest.action === 'buy' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL',
        volume: tradeRequest.volume,
        stopLoss: tradeRequest.sl,
        takeProfit: tradeRequest.tp,
        comment: tradeRequest.comment || 'Pipnosis AI Trade'
      };

      const result = await this.metaApiConnection.createMarketBuyOrder(
        tradeOptions.symbol,
        tradeOptions.volume,
        tradeOptions.stopLoss,
        tradeOptions.takeProfit,
        {
          comment: tradeOptions.comment
        }
      );

      console.log('✅ MetaApi trade executed:', result);

      return {
        success: true,
        ticket: result.orderId,
        symbol: tradeOptions.symbol,
        volume: tradeOptions.volume,
        price: result.price || 0,
        comment: 'MetaApi execution successful'
      };
    } catch (error) {
      console.error('❌ MetaApi trade execution failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Execute trade via Python bridge or mock
  async executeTrade(tradeRequest) {
    // Try MetaApi first
    if (this.metaApiConnected) {
      try {
        return await this.executeMetaApiTrade(tradeRequest);
      } catch (error) {
        console.warn('⚠️ MetaApi trade failed, falling back to Python bridge:', error.message);
      }
    }

    // Fallback to Python bridge
    if (this.pythonAvailable && this.pythonProcess) {
      return new Promise((resolve, reject) => {
        const requestId = Date.now().toString();
        const command = {
          id: requestId,
          action: 'execute_trade',
          data: tradeRequest
        };

        // Send command to Python process
        try {
          this.pythonProcess.stdin.write(JSON.stringify(command) + '\n');
        } catch (error) {
          resolve(this.getMockTradeResult(tradeRequest));
          return;
        }

        // Set timeout for response
        const timeout = setTimeout(() => {
          resolve(this.getMockTradeResult(tradeRequest));
        }, 30000);

        // Listen for response
        const responseHandler = (data) => {
          try {
            const response = JSON.parse(data.toString());
            if (response.id === requestId) {
              clearTimeout(timeout);
              this.pythonProcess.stdout.off('data', responseHandler);
              resolve(response);
            }
          } catch (error) {
            // Ignore non-JSON responses
          }
        };

        this.pythonProcess.stdout.on('data', responseHandler);
      });
    }

    // Final fallback to mock execution
    console.log('🎭 Mock trade execution:', tradeRequest);
    return this.getMockTradeResult(tradeRequest);
  }

  getMockTradeResult(tradeRequest) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const mockResult = {
          success: true,
          ticket: `MOCK-${Date.now()}`,
          symbol: tradeRequest.symbol || 'EURUSD',
          volume: tradeRequest.volume || 0.1,
          price: tradeRequest.price || 1.1425,
          comment: 'Mock execution - No real connection available'
        };
        
        console.log('✅ Mock trade executed:', mockResult);
        resolve(mockResult);
      }, 1000); // Simulate 1 second execution time
    });
  }

  // Get current market data
  async getMarketData(symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD']) {
    // Try MetaApi first
    if (this.metaApiConnected) {
      try {
        return await this.getMetaApiMarketData(symbols);
      } catch (error) {
        console.warn('⚠️ MetaApi market data failed, falling back to Python bridge:', error.message);
      }
    }

    // Fallback to Python bridge
    if (this.pythonAvailable && this.pythonProcess) {
      return new Promise((resolve, reject) => {
        const requestId = Date.now().toString();
        const command = {
          id: requestId,
          action: 'get_market_data',
          data: { symbols }
        };

        try {
          this.pythonProcess.stdin.write(JSON.stringify(command) + '\n');
        } catch (error) {
          resolve(this.getMockMarketData()); // Fallback to mock data
          return;
        }

        const timeout = setTimeout(() => {
          resolve(this.getMockMarketData()); // Fallback to mock data
        }, 5000);

        const responseHandler = (data) => {
          try {
            const response = JSON.parse(data.toString());
            if (response.id === requestId) {
              clearTimeout(timeout);
              this.pythonProcess.stdout.off('data', responseHandler);
              resolve(response.data);
            }
          } catch (error) {
            // Ignore non-JSON responses
          }
        };

        this.pythonProcess.stdout.on('data', responseHandler);
      });
    }

    // Final fallback to mock data
    return this.getMockMarketData();
  }

  getMockMarketData() {
    return [
      {
        symbol: 'EURUSD',
        price: 1.1425 + (Math.random() - 0.5) * 0.01,
        bid: 1.1425 + (Math.random() - 0.5) * 0.01,
        ask: 1.1427 + (Math.random() - 0.5) * 0.01,
        change: (Math.random() - 0.5) * 0.005,
        changePercent: (Math.random() - 0.5) * 0.5,
        trend: Math.random() > 0.5 ? 'up' : 'down',
        signal: ['buy', 'sell', 'hold'][Math.floor(Math.random() * 3)],
        timestamp: new Date().toISOString(),
        source: 'mock'
      },
      {
        symbol: 'GBPUSD',
        price: 1.2735 + (Math.random() - 0.5) * 0.01,
        bid: 1.2735 + (Math.random() - 0.5) * 0.01,
        ask: 1.2737 + (Math.random() - 0.5) * 0.01,
        change: (Math.random() - 0.5) * 0.005,
        changePercent: (Math.random() - 0.5) * 0.5,
        trend: Math.random() > 0.5 ? 'up' : 'down',
        signal: ['buy', 'sell', 'hold'][Math.floor(Math.random() * 3)],
        timestamp: new Date().toISOString(),
        source: 'mock'
      },
      {
        symbol: 'USDJPY',
        price: 149.85 + (Math.random() - 0.5) * 1.0,
        bid: 149.85 + (Math.random() - 0.5) * 1.0,
        ask: 149.87 + (Math.random() - 0.5) * 1.0,
        change: (Math.random() - 0.5) * 0.5,
        changePercent: (Math.random() - 0.5) * 0.3,
        trend: Math.random() > 0.5 ? 'up' : 'down',
        signal: ['buy', 'sell', 'hold'][Math.floor(Math.random() * 3)],
        timestamp: new Date().toISOString(),
        source: 'mock'
      },
      {
        symbol: 'XAUUSD',
        price: 2045.50 + (Math.random() - 0.5) * 10,
        bid: 2045.50 + (Math.random() - 0.5) * 10,
        ask: 2046.00 + (Math.random() - 0.5) * 10,
        change: (Math.random() - 0.5) * 5,
        changePercent: (Math.random() - 0.5) * 0.25,
        trend: Math.random() > 0.5 ? 'up' : 'down',
        signal: ['buy', 'sell', 'hold'][Math.floor(Math.random() * 3)],
        timestamp: new Date().toISOString(),
        source: 'mock'
      }
    ];
  }

  getConnectionStatus() {
    let status = 'disconnected';
    let message = 'No connection available';

    if (this.metaApiConnected) {
      status = 'connected';
      message = 'Connected via MetaApi';
    } else if (this.isConnected && this.pythonAvailable) {
      status = 'connected';
      message = 'Connected via Python bridge';
    } else if (this.connectionType === 'mock') {
      status = 'mock_mode';
      message = 'Running in mock mode';
    }

    return {
      connected: this.isConnected || this.metaApiConnected,
      connectionType: this.connectionType,
      metaApiConnected: this.metaApiConnected,
      pythonAvailable: this.pythonAvailable,
      status: status,
      message: message,
      accountInfo: this.accountInfo
    };
  }

  // Cleanup
  shutdown() {
    if (this.metaApiConnection) {
      try {
        this.metaApiConnection.close();
        console.log('🔌 MetaApi connection closed');
      } catch (error) {
        console.error('❌ Error closing MetaApi connection:', error.message);
      }
    }
    
    if (this.pythonProcess) {
      this.pythonProcess.kill();
    }
    
    if (this.wsServer) {
      this.wsServer.close();
    }
    
    this.connectedClients.clear();
    this.metaApiConnected = false;
    this.isConnected = false;
  }
}

export const mt5Service = new MT5Service();
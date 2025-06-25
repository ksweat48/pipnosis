import { spawn } from 'child_process';
import WebSocket from 'ws';
import { logTradeExecution, saveAIJournalEntry } from '../lib/supabase.js';

class MT5Service {
  constructor() {
    this.pythonProcess = null;
    this.wsServer = null;
    this.connectedClients = new Set();
    this.isConnected = false;
    this.accountInfo = null;
    this.pythonAvailable = false;
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

  // Initialize MT5 Python bridge
  async initializeBridge() {
    try {
      console.log('🔄 Checking Python availability...');
      
      const pythonAvailable = await this.checkPythonAvailability();
      
      if (!pythonAvailable) {
        console.log('⚠️ Python not found in PATH. MT5 connector will use mock mode.');
        console.log('💡 To enable real MT5 trading:');
        console.log('   1. Install Python 3.8+ and add to PATH');
        console.log('   2. Install requirements: pip install -r python/requirements.txt');
        console.log('   3. Restart the server');
        
        // Start WebSocket server for mock mode
        this.startWebSocketServer();
        return true;
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
        // Continue with mock mode
      });

      // Start WebSocket server for real-time communication
      this.startWebSocketServer();

      return true;
    } catch (error) {
      console.error('❌ Failed to initialize MT5 bridge:', error);
      console.log('🔄 Falling back to mock mode...');
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
      // Save trade to Supabase
      await logTradeExecution({
        user_id: tradeData.user_id,
        symbol: tradeData.symbol,
        trade_type: tradeData.action,
        lot_size: tradeData.volume,
        entry_price: tradeData.price,
        stop_loss: tradeData.sl,
        take_profit: tradeData.tp,
        status: tradeData.success ? 'open' : 'failed',
        mt5_ticket: tradeData.ticket,
        opened_at: new Date().toISOString()
      });

      // Generate AI journal entry
      await saveAIJournalEntry({
        user_id: tradeData.user_id,
        entry_type: 'trade_entry',
        title: `${tradeData.symbol} ${tradeData.action.toUpperCase()} Trade ${tradeData.success ? 'Executed' : 'Failed'}`,
        content: `Trade ${tradeData.success ? 'successfully executed' : 'failed'} via MT5. ${tradeData.comment || ''}`,
        confidence_level: 'high'
      });

      console.log('✅ Trade result processed and saved to Supabase');
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
      
      // Update account balance in Supabase if user_id is available
      if (accountData.user_id) {
        // Note: updateAccountBalance function would need to be imported
        // await updateAccountBalance(accountData.user_id, accountData.balance);
      }
    } catch (error) {
      console.error('❌ Failed to update account info:', error);
    }
  }

  // Execute trade via Python bridge or mock
  async executeTrade(tradeRequest) {
    if (!this.pythonAvailable || !this.pythonProcess) {
      // Mock trade execution for development
      console.log('🎭 Mock trade execution:', tradeRequest);
      
      return new Promise((resolve) => {
        setTimeout(() => {
          const mockResult = {
            success: true,
            ticket: `MOCK-${Date.now()}`,
            symbol: tradeRequest.symbol || 'EURUSD',
            volume: tradeRequest.volume || 0.1,
            price: tradeRequest.price || 1.1425,
            comment: 'Mock execution - Python/MT5 not available'
          };
          
          console.log('✅ Mock trade executed:', mockResult);
          resolve(mockResult);
        }, 1000); // Simulate 1 second execution time
      });
    }

    // Real Python bridge execution
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
        reject(new Error('Failed to send command to Python process'));
        return;
      }

      // Set timeout for response
      const timeout = setTimeout(() => {
        reject(new Error('Trade execution timeout'));
      }, 30000);

      // Listen for response (simplified - in production, use proper request/response mapping)
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

  // Enhanced market data with tiered pairs support
  async getMarketData(symbols = null) {
    // If no symbols specified, use Tier 1 pairs by default
    const defaultSymbols = [
      'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 
      'AUDUSD', 'USDCAD', 'NZDUSD'
    ];
    
    const targetSymbols = symbols || defaultSymbols;

    if (!this.pythonAvailable || !this.pythonProcess) {
      // Return enhanced mock data for all requested symbols
      return this.getMockMarketData(targetSymbols);
    }

    return new Promise((resolve, reject) => {
      const requestId = Date.now().toString();
      const command = {
        id: requestId,
        action: 'get_market_data',
        data: { symbols: targetSymbols }
      };

      try {
        this.pythonProcess.stdin.write(JSON.stringify(command) + '\n');
      } catch (error) {
        resolve(this.getMockMarketData(targetSymbols)); // Fallback to mock data
        return;
      }

      const timeout = setTimeout(() => {
        resolve(this.getMockMarketData(targetSymbols)); // Fallback to mock data
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

  getMockMarketData(symbols = ['EURUSD', 'GBPUSD', 'USDJPY']) {
    const basePrices = {
      'EURUSD': 1.1425,
      'GBPUSD': 1.2735,
      'USDJPY': 149.85,
      'USDCHF': 0.8945,
      'AUDUSD': 0.6785,
      'USDCAD': 1.3625,
      'NZDUSD': 0.6245,
      'EURJPY': 171.25,
      'GBPJPY': 190.85,
      'EURGBP': 0.8975,
      'XAUUSD': 2045.50,
      'USDMXN': 17.85,
      'USDZAR': 18.75,
      'BTCUSD': 43250.00
    };

    return symbols.map(symbol => {
      const basePrice = basePrices[symbol] || 1.0000;
      const isJPY = symbol.includes('JPY');
      const isGold = symbol.includes('XAU');
      const isCrypto = symbol.includes('BTC');
      
      let priceVariation, changeVariation;
      
      if (isCrypto) {
        priceVariation = (Math.random() - 0.5) * 1000; // ±500 for crypto
        changeVariation = (Math.random() - 0.5) * 500;
      } else if (isGold) {
        priceVariation = (Math.random() - 0.5) * 20; // ±10 for gold
        changeVariation = (Math.random() - 0.5) * 10;
      } else if (isJPY) {
        priceVariation = (Math.random() - 0.5) * 2.0; // ±1.0 for JPY pairs
        changeVariation = (Math.random() - 0.5) * 1.0;
      } else {
        priceVariation = (Math.random() - 0.5) * 0.02; // ±0.01 for major pairs
        changeVariation = (Math.random() - 0.5) * 0.01;
      }

      return {
        symbol,
        price: basePrice + priceVariation,
        change: changeVariation,
        changePercent: (changeVariation / basePrice) * 100,
        trend: Math.random() > 0.5 ? 'up' : 'down',
        signal: ['buy', 'sell', 'hold'][Math.floor(Math.random() * 3)]
      };
    });
  }

  getConnectionStatus() {
    return {
      connected: this.isConnected,
      pythonAvailable: this.pythonAvailable,
      status: this.isConnected ? 'connected' : this.pythonAvailable ? 'disconnected' : 'mock_mode',
      message: this.isConnected 
        ? 'MT5 bridge active' 
        : this.pythonAvailable 
        ? 'MT5 bridge not connected' 
        : 'Running in mock mode (Python not available)',
      accountInfo: this.accountInfo
    };
  }

  // Cleanup
  shutdown() {
    if (this.pythonProcess) {
      this.pythonProcess.kill();
    }
    if (this.wsServer) {
      this.wsServer.close();
    }
    this.connectedClients.clear();
  }
}

export const mt5Service = new MT5Service();
import TinyEmitter from 'tiny-emitter';

export interface MT5AccountData {
  login: number;
  server: string;
  name: string;
  company: string;
  currency: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  profit: number;
  credit: number;
  leverage: number;
  tradeAllowed: boolean;
  tradeExpert: boolean;
  lastUpdate: string;
}

export interface MT5Position {
  ticket: string;
  symbol: string;
  type: 'buy' | 'sell';
  volume: number;
  openPrice: number;
  currentPrice: number;
  sl: number;
  tp: number;
  profit: number;
  swap: number;
  commission: number;
  comment: string;
  timeOpen: string;
}

export interface MT5Data {
  type: string;
  timestamp: string;
  account: MT5AccountData;
  positions: MT5Position[];
  connectionStatus: 'connected' | 'disconnected';
}

export interface MT5OrderRequest {
  symbol: string;
  orderType: 'buy' | 'sell';
  volume: number;
  price?: number;
  sl?: number;
  tp?: number;
  comment?: string;
}

export interface MT5OrderResponse {
  success: boolean;
  ticket?: string;
  price?: number;
  volume?: number;
  comment?: string;
  error?: string;
}

export class MT5WebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectDelay = 1000; // Start with 1 second
  private isConnecting = false;
  private emitter = new TinyEmitter();
  private pingInterval: NodeJS.Timeout | null = null;
  private pendingRequests: Map<string, { resolve: Function, reject: Function, timeout: NodeJS.Timeout }> = new Map();
  private lastConnectionAttempt = 0;
  private connectionAttemptThreshold = 5000; // 5 seconds between connection attempts
  private error: string | null = null;
  private defaultHost = 'localhost';
  private defaultPort = 8765;
  
  constructor(private host: string = 'localhost', private port: number = 8765) {
    // Try to get host and port from localStorage first
    const savedHost = localStorage.getItem('pipnosis_mt5_bridge_host');
    const savedPort = localStorage.getItem('pipnosis_mt5_bridge_port');
    const envHost = import.meta.env.VITE_MT5_BRIDGE_HOST;
    const envPort = import.meta.env.VITE_MT5_BRIDGE_PORT;
    
    // Priority: localStorage > environment variables > constructor defaults
    if (savedHost) {
      this.host = savedHost;
    } else if (envHost) {
      this.host = envHost;
    }
    
    if (savedPort) {
      this.port = parseInt(savedPort, 10);
    } else if (envPort) {
      this.port = parseInt(envPort, 10) || 8765;
    }
    
    console.log('🔌 MT5 WebSocket Client initialized for', `${this.host}:${this.port}`);
    this.discoverPort();
  }

  /**
   * Configure the WebSocket client with new host and port
   */
  configure(host: string, port: number): void {
    if (this.host !== host || this.port !== port) {
      console.log(`🔧 Reconfiguring MT5 WebSocket client: ${this.host}:${this.port} -> ${host}:${port}`);
      this.host = host;
      this.port = port;
      
      // Disconnect if already connected
      if (this.isConnected()) {
        this.disconnect();
      }
      
      // Reset error state
      this.error = null;
      
      // Save to localStorage for persistence across page reloads
      try {
        localStorage.setItem('pipnosis_mt5_bridge_host', host);
        localStorage.setItem('pipnosis_mt5_bridge_port', port.toString());
      } catch (error) {
        console.error('Error saving MT5 bridge config to localStorage:', error);
      }
    }
  }

  /**
   * Discover the port from the port file if available
   */
  private async discoverPort() {
    try {
      // Try to fetch the port file from the server
      const response = await fetch('/mt5-bridge/mt5_bridge_port.txt');
      if (response.ok) {
        const portText = await response.text();
        const discoveredPort = parseInt(portText.trim(), 10);
        if (!isNaN(discoveredPort) && discoveredPort > 0) {
          console.log(`🔍 Discovered MT5 bridge port: ${discoveredPort}`);
          this.port = discoveredPort;
        }
      }
    } catch (error) {
      console.log('ℹ️ Could not discover MT5 bridge port, using default:', this.port);
    }
  }

  /**
   * Connect to the MT5 bridge WebSocket server
   */
  async connect(): Promise<boolean> {
    // Prevent connection attempts too close together
    const now = Date.now();
    if (now - this.lastConnectionAttempt < this.connectionAttemptThreshold) {
      console.log('🔄 Connection attempt throttled - too many attempts');
      return false;
    }
    this.lastConnectionAttempt = now;

    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      console.log('🔌 Already connected or connecting...');
      return true;
    }

    this.isConnecting = true;
    
    // Try multiple connection methods and ports
    const portsToTry = [this.port, 8766, 8767, 8768, 8769, 8770];
    const connectionMethods = [
      (port: number) => `ws://localhost:${port}`,
      (port: number) => `ws://127.0.0.1:${port}`
    ];
    
    for (const port of portsToTry) {
      for (const getUrl of connectionMethods) {
        const wsUrl = getUrl(port);
        try {
          console.log(`🔌 Attempting to connect to MT5 bridge at ${wsUrl}...`);
          
          const connected = await this.attemptConnection(wsUrl);
          if (connected) {
            console.log(`✅ Successfully connected to MT5 bridge at ${wsUrl}`);
            this.isConnecting = false;
            this.port = port; // Update the port to the one that worked
            return true;
          }
        } catch (error) {
          console.log(`❌ Failed to connect to ${wsUrl}:`, error);
          continue;
        }
      }
    }
    
    this.isConnecting = false;
    console.error('❌ Failed to connect to MT5 bridge on all attempted URLs and ports');
    return false;
  }

  /**
   * Attempt connection to a specific WebSocket URL
   */
  private attemptConnection(wsUrl: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      try {
        // Close any existing connection
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }
        
        this.ws = new WebSocket(wsUrl);
        
        const timeout = setTimeout(() => {
          if (this.ws) {
            this.ws.close();
            this.ws = null;
          }
          reject(new Error('Connection timeout'));
        }, 5000);

        this.ws.onopen = () => {
          clearTimeout(timeout);
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;
          
          console.log('✅ Connected to MT5 bridge');
          this.emit('connected');
          this.startPingInterval();
          
          // Store connection status
          localStorage.setItem('pipnosis_mt5_connected', 'true');
          localStorage.setItem('pipnosis_mt5_bridge_url', wsUrl);
          
          // Send an initial ping to verify connection is working
          this.sendPing().then(() => {
            console.log('✅ Initial ping successful');
          }).catch(err => {
            console.warn('⚠️ Initial ping failed:', err);
          });
          
          resolve(true);
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
          } catch (error) {
            console.error('❌ Error parsing WebSocket message:', error);
          }
        };

        this.ws.onclose = (event) => {
          clearTimeout(timeout);
          this.isConnecting = false;
          this.stopPingInterval();
          
          console.log(`🔌 MT5 bridge connection closed: ${event.code} - ${event.reason}`);
          this.emit('disconnected');
          
          // Update connection status
          localStorage.setItem('pipnosis_mt5_connected', 'false');
          
          // Don't attempt to reconnect if it was a clean close
          if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            // Don't schedule reconnect here - let the caller handle it
            console.log('🔄 Connection closed, but not scheduling automatic reconnect');
          }
          
          if (event.code === 1000) {
            resolve(false);
          } else {
            reject(new Error(`Connection closed: ${event.code}`));
          }
        };

        this.ws.onerror = (error) => {
          clearTimeout(timeout);
          this.isConnecting = false;
          console.error('❌ MT5 bridge WebSocket error:', error);
          
          // Provide detailed error information
          if (error instanceof Event) {
            console.error('❌ WebSocket Error Details:');
            console.error('   - URL:', wsUrl);
            console.error('   - ReadyState:', this.ws?.readyState);
            console.error('   - Error Type:', error.type);
            
            // Check if it's a connection refused error
            if (this.ws?.readyState === WebSocket.CLOSED) {
              console.error('💡 Connection was refused. Possible causes:');
              console.error('   1. MT5 bridge is not running');
              console.error('   2. Bridge is running on a different port');
              console.error('   3. Firewall is blocking the connection');
              console.error('   4. Bridge crashed or stopped');
            }
          }
          
          this.emit('error', error);
          reject(error);
        };
        
      } catch (error) {
        console.error('❌ Failed to create WebSocket connection:', error);
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the MT5 bridge
   */
  disconnect(): void {
    this.stopPingInterval();
    
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    
    localStorage.setItem('pipnosis_mt5_connected', 'false');
    console.log('🔌 Disconnected from MT5 bridge');
  }

  /**
   * Check if connected to MT5 bridge
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Send a message to the MT5 bridge
   */
  private send(data: any): void {
    if (!this.isConnected()) {
      throw new Error('Not connected to MT5 bridge');
    }

    this.ws!.send(JSON.stringify(data));
  }

  /**
   * Place a trading order
   */
  placeOrder(order: MT5OrderRequest): Promise<MT5OrderResponse> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('Not connected to MT5 bridge'));
        return;
      }

      // Format symbol to remove slashes (e.g., GBP/JPY -> GBPJPY)
      const formattedSymbol = order.symbol.replace('/', '').toUpperCase();
      
      // Limit comment to 31 characters (MT5 requirement)
      const limitedComment = order.comment ? order.comment.substring(0, 31) : 'Pipnosis AI Trade';

      const requestId = Date.now().toString();
      
      // Create the order request
      const orderRequest = {
        type: 'place_order',
        requestId,
        symbol: formattedSymbol,
        order_type: order.orderType,
        volume: order.volume,
        price: order.price,
        sl: order.sl,
        tp: order.tp,
        comment: limitedComment
      };
      
      console.log('📤 Sending MT5 order:', orderRequest);
      
      // Set up timeout for the request - INCREASED TIMEOUT HERE
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Order request timeout - MT5 bridge did not respond in time (60s). Check if MT5 terminal is running and logged in, and that automated trading is enabled.'));
      }, 60000); // Increased to 60 seconds for very slow systems
      
      // Store the pending request
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout
      });
      
      // Set up one-time listener for the response
      const responseHandler = (data: any) => {
        if (data.type === 'order_response' && data.requestId === requestId) {
          this.off('message', responseHandler);
          
          const pendingRequest = this.pendingRequests.get(requestId);
          if (pendingRequest) {
            clearTimeout(pendingRequest.timeout);
            this.pendingRequests.delete(requestId);
            
            if (data.result && data.result.success) {
              resolve(data.result);
            } else {
              reject(new Error(data.result?.error || 'Unknown error'));
            }
          }
        }
      };
      
      this.on('message', responseHandler);
      
      // Send the order request
      try {
        this.send(orderRequest);
      } catch (error) {
        // Clean up if sending fails
        this.off('message', responseHandler);
        const pendingRequest = this.pendingRequests.get(requestId);
        if (pendingRequest) {
          clearTimeout(pendingRequest.timeout);
          this.pendingRequests.delete(requestId);
        }
        reject(error);
      }
    });
  }

  /**
   * Get symbol information
   */
  getSymbolInfo(symbol: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('Not connected to MT5 bridge'));
        return;
      }

      const requestId = Date.now().toString();
      
      // Set up timeout for the request
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Symbol info request timeout'));
      }, 10000); // Increased from 5000 to 10000 (10 seconds)
      
      // Store the pending request
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout
      });
      
      // Set up one-time listener for the response
      const responseHandler = (data: any) => {
        if (data.type === 'symbol_info' && data.requestId === requestId) {
          this.off('message', responseHandler);
          
          const pendingRequest = this.pendingRequests.get(requestId);
          if (pendingRequest) {
            clearTimeout(pendingRequest.timeout);
            this.pendingRequests.delete(requestId);
            resolve(data.data);
          }
        }
      };
      
      this.on('message', responseHandler);
      
      // Send the symbol info request
      try {
        this.send({
          type: 'get_symbol_info',
          requestId,
          symbol
        });
      } catch (error) {
        // Clean up if sending fails
        this.off('message', responseHandler);
        const pendingRequest = this.pendingRequests.get(requestId);
        if (pendingRequest) {
          clearTimeout(pendingRequest.timeout);
          this.pendingRequests.delete(requestId);
        }
        reject(error);
      }
    });
  }

  /**
   * Test connection to MT5 bridge
   */
  async testConnection(): Promise<{ success: boolean; error?: string; details?: any }> {
    // Reset error state
    this.error = null;
    console.log(`🧪 Testing MT5 bridge connection to ${this.host}:${this.port}...`);
    
    try {
      // Check if we're in WebContainer environment
      if (window.location.hostname.includes('webcontainer-api.io') || 
          window.location.hostname.includes('local-credentialless') ||
          window.location.hostname.includes('bolt.new') ||
          window.location.hostname.includes('stackblitz')) {
        this.error = 'MT5 connection is not available in this preview environment. Please run the application locally to connect to MT5.';
        return {
          success: false,
          error: this.error,
          details: { environment: 'webcontainer' }
        };
      }
      
      // Create a test WebSocket connection
      const wsUrl = `ws://${this.host}:${this.port}`;
      console.log(`🔌 Testing connection to ${wsUrl}...`);

      // Log detailed connection attempt
      console.log(`🔍 Connection details:
- Host: ${this.host}
- Port: ${this.port}
- URL: ${wsUrl}
- Current time: ${new Date().toISOString()}
      `);
      
      // Set a timeout for the connection test
      const timeoutPromise = new Promise<{ success: false, error: string }>((_, reject) => {
        setTimeout(() => {
          reject({ 
            success: false, 
            error: `Connection timeout. Could not connect to ${this.host}:${this.port} within 5 seconds.` 
          });
        }, 5000);
      });
      
      // Create a connection promise
      const connectionPromise = new Promise<{ success: boolean, error?: string }>((resolve) => {
        try {
          const testWs = new WebSocket(wsUrl);
          
          testWs.onopen = () => {
            console.log('✅ Test connection successful');
            testWs.close();
            resolve({ success: true });
          };
          
          testWs.onerror = (event) => {
            console.error('❌ Test connection failed:', event);
            this.error = `Failed to connect to MT5 bridge at ${wsUrl}`;
            resolve({ 
              success: false, 
              error: this.error
            });
          };
        } catch (error) {
          console.error('❌ Test connection error:', error);
          this.error = error instanceof Error ? error.message : 'Unknown connection error';
          resolve({ 
            success: false, 
            error: this.error
          });
        }
      });
      
      // Race the connection and timeout
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      
      return result;
    } catch (error) {
      console.error('❌ Connection test failed:', error);
      this.error = error instanceof Error ? error.message : 'Unknown connection error';
      return {
        success: false,
        error: this.error,
        details: { 
          testFailed: true,
          host: this.host,
          port: this.port
        }
      };
    }
  }

  /**
   * Send a ping to the MT5 bridge to verify it's responsive
   */
  private sendPing(): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('Not connected to MT5 bridge'));
        return;
      }

      const requestId = Date.now().toString();
      
      // Set up timeout for the ping
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Ping timeout'));
      }, 5000);
      
      // Store the pending request
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout
      });
      
      // Set up one-time listener for the response
      const responseHandler = (data: any) => {
        if (data.type === 'pong' && data.requestId === requestId) {
          this.off('message', responseHandler);
          
          const pendingRequest = this.pendingRequests.get(requestId);
          if (pendingRequest) {
            clearTimeout(pendingRequest.timeout);
            this.pendingRequests.delete(requestId);
            resolve(data);
          }
        }
      };
      
      this.on('message', responseHandler);
      
      // Send the ping request
      try {
        this.send({
          type: 'ping',
          requestId,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        // Clean up if sending fails
        this.off('message', responseHandler);
        const pendingRequest = this.pendingRequests.get(requestId);
        if (pendingRequest) {
          clearTimeout(pendingRequest.timeout);
          this.pendingRequests.delete(requestId);
        }
        reject(error);
      }
    });
  }

  /**
   * Handle incoming messages from MT5 bridge
   */
  private handleMessage(data: any): void {
    console.log('📡 Received MT5 data:', data.type);
    
    // Log detailed message for debugging
    if (data.type === 'error') {
      console.error('❌ MT5 bridge error:', data.error);
    } else if (data.type === 'order_response') {
      console.log('📊 Order response:', data.result);
    }
    
    switch (data.type) {
      case 'initial_data':
      case 'account_update':
        this.handleAccountUpdate(data);
        break;
        
      case 'order_response':
        this.emit('order_response', data);
        break;
        
      case 'symbol_info':
        this.emit('symbol_info', data);
        break;
        
      case 'pong':
        this.emit('pong', data);
        break;
        
      case 'error':
        console.error('❌ MT5 bridge error:', data.error);
        this.emit('error', new Error(data.error));
        break;
        
      default:
        console.log('📡 Unknown message type:', data.type);
    }
    
    // Emit generic message event
    this.emit('message', data);
  }

  /**
   * Handle account data updates
   */
  private handleAccountUpdate(data: MT5Data): void {
    // Store the account data in localStorage for other components
    try {
      // Ensure all required properties exist before creating the object
      if (data && data.account) {
        const accountData = {
          login: data.account.login || 0,
          server: data.account.server || 'Unknown',
          balance: typeof data.account.balance === 'number' ? data.account.balance : 0,
          equity: typeof data.account.equity === 'number' ? data.account.equity : 0,
          margin: typeof data.account.margin === 'number' ? data.account.margin : 0,
          freeMargin: typeof data.account.freeMargin === 'number' ? data.account.freeMargin : 0,
          marginLevel: typeof data.account.marginLevel === 'number' ? data.account.marginLevel : 0,
          openPositions: Array.isArray(data.positions) ? data.positions : [],
          lastUpdate: data.timestamp || new Date().toISOString(),
          connectionStatus: data.connectionStatus || 'connected',
          tradeExpert: data.account.tradeExpert || false
        };
        
        localStorage.setItem('pipnosis_mt5_account', JSON.stringify(accountData));
        
        // Emit the update event
        this.emit('account_update', data);
        
        console.log(`💰 Account Update: Balance $${accountData.balance?.toLocaleString() || 'N/A'}, Equity $${accountData.equity?.toLocaleString() || 'N/A'}, Positions: ${data.positions.length}`);
      } else {
        console.warn('❌ Invalid account data received:', data);
      }
    } catch (error) {
      console.error('❌ Error handling account update:', error);
    }
  }

  /**
   * Start ping interval to keep connection alive
   */
  private startPingInterval(): void {
    // Clear any existing interval
    this.stopPingInterval();
    
    this.pingInterval = setInterval(() => {
      if (this.isConnected()) {
        try {
          this.send({ type: 'ping', timestamp: new Date().toISOString() });
          console.log('📡 Sent ping to MT5 bridge');
        } catch (error) {
          console.error('❌ Failed to send ping:', error);
          // Don't try to reconnect here - let the onclose handler do it
        }
      } else {
        console.warn('⚠️ Cannot send ping - not connected');
        this.stopPingInterval();
      }
    }, 30000); // Ping every 30 seconds
  }

  /**
   * Stop ping interval
   */
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Add event listener
   */
  on(event: string, listener: Function): void {
    this.emitter.on(event, listener);
  }

  /**
   * Remove event listener
   */
  off(event: string, listener: Function): void {
    this.emitter.off(event, listener);
  }

  /**
   * Emit event to listeners
   */
  private emit(event: string, data?: any): void {
    this.emitter.emit(event, data);
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): any {
    const host = this.host || localStorage.getItem('pipnosis_mt5_bridge_host') || this.defaultHost;
    const port = this.port || parseInt(localStorage.getItem('pipnosis_mt5_bridge_port') || '', 10) || this.defaultPort;
    
    return {
      connected: this.isConnected() || localStorage.getItem('pipnosis_mt5_connected') === 'true',
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      host,
      port,
      error: this.error,
      lastConnected: localStorage.getItem('pipnosis_mt5_last_connected'),
      bridgeUrl: localStorage.getItem('pipnosis_mt5_bridge_url')
    };
  }
}

// Create singleton instance
export const mt5Client = new MT5WebSocketClient('localhost', 8765);

// Auto-connect on module load if previously connected
if (typeof window !== 'undefined') {
  const wasConnected = localStorage.getItem('pipnosis_mt5_connected') === 'true';
  
  // Get saved bridge host and port
  try {
    const accountData = localStorage.getItem('pipnosis_mt5_account');
    if (accountData) {
      const data = JSON.parse(accountData);
      if (data.bridgeHost && data.bridgePort) {
        mt5Client.configure(data.bridgeHost, parseInt(data.bridgePort, 10));
      }
    }
    
    // Auto-connect if previously connected
    if (wasConnected) {
      console.log('🔄 Auto-connecting to MT5 bridge...');
      
      // Only auto-connect if we have a host
      if (mt5Client.getConnectionStats().host) {
        mt5Client.connect().catch(error => {
          console.log('ℹ️ Auto-connect failed (bridge may not be running):', error.message);
        });
      } else {
        console.log('ℹ️ Auto-connect skipped (no host configured)');
        
        // If on production, prompt for host
        if (window.location.hostname === 'pipnosis.com') {
          console.log('🌐 Production environment detected - will prompt for MT5 bridge host');
          
          // Only prompt if no host is configured
          if (!localStorage.getItem('pipnosis_mt5_bridge_host')) {
            // Dispatch event to open MT5 modal
            setTimeout(() => {
              const event = new CustomEvent('openMT5Modal');
              window.dispatchEvent(event);
            }, 2000);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error loading MT5 account data:', error);
  }
}
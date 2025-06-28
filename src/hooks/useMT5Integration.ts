/**
 * React hook for MT5 integration - ENHANCED VERSION
 * Manages connection state and provides real-time data
 */

import { useState, useEffect, useCallback } from 'react';
import { mt5Client, MT5Data, MT5OrderRequest, MT5OrderResponse } from '../services/mt5WebSocketClient';

export interface MT5ConnectionState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  accountData: any | null;
  positions: any[];
  lastUpdate: string | null;
}

export const useMT5Integration = () => {
  const [connectionState, setConnectionState] = useState<MT5ConnectionState>({
    connected: false,
    connecting: false,
    error: null,
    accountData: null,
    positions: [],
    lastUpdate: null
  });

  // Connect to MT5 bridge
  const connect = useCallback(async (): Promise<boolean> => {
    setConnectionState(prev => ({ ...prev, connecting: true, error: null }));
    
    try {
      console.log('🔌 Starting MT5 connection process...');
      
      // First, test the connection
      const testResult = await mt5Client.testConnection();
      console.log('🧪 Connection test result:', testResult);
      
      if (testResult.success) {
        setConnectionState(prev => ({ 
          ...prev, 
          connected: true, 
          connecting: false,
          error: null 
        }));
        
        console.log('✅ MT5 integration connected successfully');
        return true;
      } else {
        const errorMessage = testResult.error || 'Failed to connect to MT5 bridge';
        setConnectionState(prev => ({ 
          ...prev, 
          connected: false, 
          connecting: false,
          error: errorMessage 
        }));
        
        console.error('❌ MT5 connection test failed:', errorMessage);
        console.error('🔍 Test details:', testResult.details);
        
        // Provide helpful troubleshooting information
        console.log('💡 Troubleshooting steps:');
        console.log('   1. Make sure the MT5 bridge is running (python mt5_connector.py)');
        console.log('   2. Check that the bridge shows "server listening on 127.0.0.1:8765"');
        console.log('   3. Verify no firewall is blocking port 8765');
        console.log('   4. Try restarting the bridge if it was running for a long time');
        
        return false;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown connection error';
      setConnectionState(prev => ({ 
        ...prev, 
        connected: false, 
        connecting: false,
        error: errorMessage 
      }));
      
      console.error('❌ MT5 integration connection failed:', errorMessage);
      return false;
    }
  }, []);

  // Disconnect from MT5 bridge
  const disconnect = useCallback(() => {
    mt5Client.disconnect();
    setConnectionState({
      connected: false,
      connecting: false,
      error: null,
      accountData: null,
      positions: [],
      lastUpdate: null
    });
    
    console.log('🔌 MT5 integration disconnected');
  }, []);

  // Place a trading order
  const placeOrder = useCallback(async (order: MT5OrderRequest): Promise<MT5OrderResponse> => {
    if (!connectionState.connected) {
      throw new Error('MT5 not connected');
    }

    try {
      console.log('📤 Placing MT5 order:', order);
      const result = await mt5Client.placeOrder(order);
      console.log('✅ MT5 order result:', result);
      return result;
    } catch (error) {
      console.error('❌ MT5 order failed:', error);
      throw error;
    }
  }, [connectionState.connected]);

  // Get symbol information
  const getSymbolInfo = useCallback(async (symbol: string) => {
    if (!connectionState.connected) {
      throw new Error('MT5 not connected');
    }

    try {
      return await mt5Client.getSymbolInfo(symbol);
    } catch (error) {
      console.error('❌ Failed to get symbol info:', error);
      throw error;
    }
  }, [connectionState.connected]);

  // Check if MT5 bridge is available
  const checkBridgeAvailability = useCallback(async (): Promise<boolean> => {
    try {
      console.log('🔍 Checking MT5 bridge availability...');
      
      // Test connection to the bridge
      const testResult = await mt5Client.testConnection();
      console.log('🧪 Bridge availability test:', testResult);
      
      return testResult.success;
    } catch (error) {
      console.error('❌ Bridge availability check failed:', error);
      return false;
    }
  }, []);

  // Set up event listeners
  useEffect(() => {
    const handleConnected = () => {
      console.log('🎉 MT5 WebSocket connected event received');
      setConnectionState(prev => ({ 
        ...prev, 
        connected: true, 
        connecting: false,
        error: null 
      }));
    };

    const handleDisconnected = () => {
      console.log('🔌 MT5 WebSocket disconnected event received');
      setConnectionState(prev => ({ 
        ...prev, 
        connected: false, 
        connecting: false 
      }));
    };

    const handleError = (error: any) => {
      const errorMessage = error instanceof Error ? error.message : 'Connection error';
      console.error('❌ MT5 WebSocket error event:', errorMessage);
      setConnectionState(prev => ({ 
        ...prev, 
        connected: false, 
        connecting: false,
        error: errorMessage 
      }));
    };

    const handleAccountUpdate = (data: MT5Data) => {
      console.log('📊 MT5 account update received');
      setConnectionState(prev => ({ 
        ...prev, 
        accountData: data.account,
        positions: data.positions,
        lastUpdate: data.timestamp 
      }));
    };

    const handleMaxReconnects = () => {
      console.error('❌ MT5 max reconnection attempts reached');
      setConnectionState(prev => ({ 
        ...prev, 
        connected: false, 
        connecting: false,
        error: 'Maximum reconnection attempts reached. Please restart the MT5 bridge.' 
      }));
    };

    // Add event listeners
    mt5Client.on('connected', handleConnected);
    mt5Client.on('disconnected', handleDisconnected);
    mt5Client.on('error', handleError);
    mt5Client.on('account_update', handleAccountUpdate);
    mt5Client.on('max_reconnects_reached', handleMaxReconnects);

    // Check initial connection state
    const isConnected = mt5Client.isConnected();
    if (isConnected) {
      setConnectionState(prev => ({ ...prev, connected: true }));
    }

    // Cleanup
    return () => {
      mt5Client.off('connected', handleConnected);
      mt5Client.off('disconnected', handleDisconnected);
      mt5Client.off('error', handleError);
      mt5Client.off('account_update', handleAccountUpdate);
      mt5Client.off('max_reconnects_reached', handleMaxReconnects);
    };
  }, []);

  return {
    connectionState,
    connect,
    disconnect,
    placeOrder,
    getSymbolInfo,
    checkBridgeAvailability,
    isConnected: connectionState.connected,
    isConnecting: connectionState.connecting,
    error: connectionState.error,
    accountData: connectionState.accountData,
    positions: connectionState.positions,
    lastUpdate: connectionState.lastUpdate
  };
};
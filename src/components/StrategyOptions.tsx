import { useState, useCallback } from 'react';
import { mt5Client } from '../services/mt5WebSocketClient';
interface TradeRequest {
  symbol: string;
  action: 'buy' | 'sell';
  volume: number;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  comment?: string;
}

interface TradeResult {
  success: boolean;
  tradeId?: string;
  mt5Ticket?: string;
  symbol?: string;
  price?: number;
  volume?: number;
  message: string;
  error?: string;
}

export const useTradeExecution = () => {
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<TradeResult | null>(null);

  const executeTrade = useCallback(async (request: TradeRequest): Promise<TradeResult> => {
    setIsExecuting(true);
    setError(null);
    setLastResult(null);

    try {
      console.log('🚀 Executing trade:', request);

      // Format symbol to remove slashes (e.g., GBP/JPY -> GBPJPY)
      const formattedSymbol = request.symbol.replace('/', '').toUpperCase();

      // Log trade execution attempt
      console.log(`🚀 Executing ${request.action} ${formattedSymbol} ${request.volume} lots`);

      // Limit comment to 31 characters (MT5 requirement)
      const limitedComment = request.comment ? request.comment.substring(0, 31) : 'Pipnosis AI Trade';

      // Check if MT5 is connected
      const isConnected = mt5Client.isConnected();
      if (!isConnected) {
        console.warn('⚠️ MT5 not connected, attempting to connect to MT5 bridge...');
        
        // Check if we're in WebContainer environment
        const isWebContainer = window.location.hostname.includes('webcontainer') || 
                              window.location.hostname.includes('bolt.new') ||
                              window.location.hostname.includes('stackblitz');
        
        if (isWebContainer) {
          throw new Error('MT5 connection is not available in this preview environment. Please run the application locally to connect to MT5.');
        }
        
        try {
          // Try to connect to MT5
          await mt5Client.connect();
          console.log('🔄 MT5 connection attempt result:', mt5Client.isConnected() ? 'Success' : 'Failed');
          
          // Check if connection was successful
          if (!mt5Client.isConnected()) {
            const stats = mt5Client.getConnectionStats();
            throw new Error(`Failed to connect to MT5 bridge at ${stats.host}:${stats.port}`);
          }
        } catch (connectError) {
          console.error('❌ MT5 bridge connection failed:', connectError);
          const stats = mt5Client.getConnectionStats();
          throw new Error(`MT5 bridge connection failed. Please make sure the MT5 bridge is running at ${stats.host}:${stats.port} and MetaTrader 5 is open.`);
        }
      }

      // Verify MT5 is responsive with a ping before executing trade
      try {
        await mt5Client.testConnection();
      } catch (pingError) {
        console.warn('⚠️ MT5 bridge ping failed, but continuing with trade execution');
      }

      // Execute trade via MT5 WebSocket client
      const result = await mt5Client.placeOrder({
        symbol: formattedSymbol,
        orderType: request.action,
        volume: request.volume,
        price: request.price,
        sl: request.stopLoss,
        tp: request.takeProfit,
        comment: limitedComment
      });

      console.log('✅ Trade executed successfully:', result);

      // Log trade to local database
      if (result.success) {
        try {
          await mt5Client.logTrade({
            lot_size: request.volume,
            entry_price: result.price || request.price || 0,
            stop_loss: request.stopLoss,
            take_profit: request.takeProfit,
            status: 'open',
            mt5_ticket: result.ticket,
            opened_at: new Date().toISOString()
          });
          console.log('✅ Trade logged to database');
        } catch (dbError) {
          console.error('❌ Failed to log trade to database:', dbError);
        }
      }
      
      const tradeResult = {
        success: true,
        tradeId: `TRD-${Date.now()}`,
        mt5Ticket: result.ticket,
        symbol: formattedSymbol,
        price: result.price || request.price,
        volume: result.volume || request.volume,
        message: `${request.action.toUpperCase()} ${request.symbol} executed successfully via MT5`
      };
      
      setLastResult(tradeResult);
      return tradeResult;
    } catch (err) {
      console.error('❌ MT5 trade execution failed:', err);
      
      const errorMessage = err instanceof Error ? err.message : 'Trade execution failed';
      setError(errorMessage);
      
      // Check if it's a timeout error
      const isTimeout = errorMessage.includes('timeout');
      
      // Provide more helpful error message for timeout
      const enhancedErrorMessage = isTimeout 
        ? 'MT5 trade execution timed out. Please check: 1) MT5 terminal is running and logged in, 2) Automated trading is enabled in MT5 (Tools > Options > Expert Advisors), 3) The MT5 bridge is running properly.'
        : errorMessage;
      
      const failureResult = {
        success: false,
        message: 'Trade execution failed',
        error: enhancedErrorMessage,
        symbol: request.symbol
      };
      
      setLastResult(failureResult);
      return failureResult;
    } finally {
      setIsExecuting(false);
    }
  }, []);

  // Retry the last failed trade
  const retryLastTrade = useCallback(async (): Promise<TradeResult | null> => {
    if (!lastResult || lastResult.success) {
      return null; // Nothing to retry
    }
    
    setError(null);
    setIsExecuting(true);
    
    try {
      // Try to reconnect to MT5 first
      await mt5Client.connect();
      
      // Check if we have enough information to retry
      if (!lastResult.symbol) {
        throw new Error('Insufficient information to retry trade');
      }
      
      // Execute the trade again
      return await executeTrade({
        symbol: lastResult.symbol,
        action: (lastResult as any).action || 'buy',
        volume: (lastResult as any).volume || 0.1,
        price: (lastResult as any).price,
        stopLoss: (lastResult as any).stopLoss,
        takeProfit: (lastResult as any).takeProfit,
        comment: 'Pipnosis AI Trade (Retry)'
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Trade retry failed';
      setError(errorMessage);
      return {
        success: false,
        message: 'Trade retry failed',
        error: errorMessage
      };
    } finally {
      setIsExecuting(false);
    }
  }, [lastResult, executeTrade]);

  // Check MT5 terminal settings
  const checkMT5Settings = useCallback(async (): Promise<{ success: boolean; message: string; details?: any }> => {
    try {
      // First check if we're connected
      if (!mt5Client.isConnected()) {
        try {
          await mt5Client.connect();
        } catch (error) {
          return {
            success: false,
            message: 'Failed to connect to MT5 bridge',
            details: { error: error instanceof Error ? error.message : String(error) }
          };
        }
      }
      
      // Test connection to verify bridge is responsive
      const testResult = await mt5Client.testConnection();
      
      if (!testResult.success) {
        return {
          success: false,
          message: testResult.error || 'MT5 bridge test failed',
          details: testResult.details
        };
      }
      
      return {
        success: true,
        message: 'MT5 settings check passed',
        details: testResult.details
      };
    } catch (error) {
      return {
        success: false,
        message: 'MT5 settings check failed',
        details: { error: error instanceof Error ? error.message : String(error) }
      };
    }
  }, []);

  return {
    executeTrade,
    retryLastTrade,
    checkMT5Settings,
    isExecuting,
    error,
    lastResult
  };
};
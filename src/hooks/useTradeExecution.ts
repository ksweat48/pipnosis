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

  const executeTrade = useCallback(async (request: TradeRequest): Promise<TradeResult> => {
    setIsExecuting(true);
    setError(null);

    try {
      console.log('🚀 Executing trade:', request);

      // Check if MT5 is connected
      const isConnected = mt5Client.isConnected();
      if (!isConnected) {
        console.warn('⚠️ MT5 not connected, attempting to connect...');
        
        try {
          // Try to connect to MT5
          await mt5Client.connect();
          
          // Check if connection was successful
          if (!mt5Client.isConnected()) {
            throw new Error('Failed to connect to MT5');
          }
        } catch (connectError) {
          console.error('❌ MT5 connection failed:', connectError);
          throw new Error('MT5 connection failed. Please make sure the MT5 bridge is running.');
        }
      }

      // Execute trade via MT5 WebSocket client
      const result = await mt5Client.placeOrder({
        symbol: request.symbol,
        orderType: request.action,
        volume: request.volume,
        price: request.price,
        sl: request.stopLoss,
        tp: request.takeProfit,
        comment: request.comment || 'Pipnosis AI Trade'
      });

      if (result.success) {
        console.log('✅ Trade executed successfully:', result);
        return {
          success: true,
          tradeId: `TRD-${Date.now()}`,
          mt5Ticket: result.ticket,
          symbol: request.symbol,
          price: result.price || request.price,
          volume: result.volume || request.volume,
          message: `${request.action.toUpperCase()} ${request.symbol} executed successfully via MT5`
        };
      } else {
        console.error('❌ MT5 trade execution failed:', result.error);
        throw new Error(result.error || 'MT5 trade execution failed');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to execute trade';
      setError(errorMessage);
      console.error('❌ Trade execution error:', err);
      
      return {
        success: false,
        message: 'Trade execution failed',
        error: errorMessage
      };
    } finally {
      setIsExecuting(false);
    }
  }, []);

  return {
    executeTrade,
    isExecuting,
    error
  };
};
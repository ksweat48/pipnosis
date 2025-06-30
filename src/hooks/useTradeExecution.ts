import { useState, useCallback } from 'react';
import { useMT5Integration } from './useMT5Integration';

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
  const { isConnected, placeOrder } = useMT5Integration();

  const executeTrade = useCallback(async (request: TradeRequest): Promise<TradeResult> => {
    setIsExecuting(true);
    setError(null);

    try {
      console.log('🚀 Executing trade:', request);

      if (!isConnected) {
        console.warn('⚠️ MT5 not connected, using mock execution');
        
        // Simulate execution delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        return {
          success: true,
          tradeId: `MOCK-${Date.now()}`,
          symbol: request.symbol,
          price: request.price,
          volume: request.volume,
          message: `${request.action.toUpperCase()} ${request.symbol} executed at ${request.price} (MOCK MODE)`
        };
      }

      // Execute trade via MT5 WebSocket client
      const result = await placeOrder({
        symbol: request.symbol,
        orderType: request.action,
        volume: request.volume,
        price: request.price,
        sl: request.stopLoss,
        tp: request.takeProfit,
        comment: request.comment || 'Pipnosis AI Trade'
      });

      if (result.success) {
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
  }, [isConnected, placeOrder]);

  return {
    executeTrade,
    isExecuting,
    error
  };
};
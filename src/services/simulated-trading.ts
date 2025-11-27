import { supabase } from '@/lib/supabase';
import { StrategyOption } from '@/types/strategy';

interface TradeParams {
  symbol: string;
  action: 'buy' | 'sell';
  lotSize: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  strategy: StrategyOption;
  // AI Learning metadata
  confidence?: number;
  setupType?: string;
  marketConditions?: any;
  aiDecisionId?: string;
}

interface Position {
  id: string;
  user_id: string;
  symbol: string;
  position_type: 'buy' | 'sell';
  order_type: 'market' | 'limit';
  lot_size: number;
  entry_price: number | null;
  limit_price: number | null;
  stop_loss: number;
  take_profit: number;
  status: 'pending' | 'open' | 'closed';
  current_price: number | null;
  current_pnl: number;
  opened_at: string;
  closed_at: string | null;
  close_reason: string | null;
}

class SimulatedTradingService {
  async executeTrade(params: TradeParams, userId: string) {
    try {
      const { data, error } = await supabase
        .from('simulated_positions')
        .insert({
          user_id: userId,
          symbol: params.symbol,
          position_type: params.action,
          order_type: 'market',
          lot_size: params.lotSize,
          entry_price: params.entry,
          stop_loss: params.stopLoss,
          take_profit: params.takeProfit,
          status: 'open',
          current_price: params.entry,
          current_pnl: 0
        })
        .select()
        .single();

      if (error) throw error;

      return {
        success: true,
        message: `Demo ${params.action.toUpperCase()} trade executed for ${params.symbol}`,
        position: data
      };
    } catch (error) {
      console.error('Trade execution failed:', error);
      return {
        success: false,
        message: 'Failed to execute demo trade',
        error
      };
    }
  }

  async getOpenPositions(userId: string): Promise<Position[]> {
    try {
      const { data, error } = await supabase
        .from('simulated_positions')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'open')
        .order('opened_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Failed to fetch open positions:', error);
      return [];
    }
  }

  async getPendingOrders(userId: string): Promise<Position[]> {
    try {
      const { data, error } = await supabase
        .from('simulated_positions')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Failed to fetch pending orders:', error);
      return [];
    }
  }

  async closePosition(positionId: string, currentPrice: number, userId: string): Promise<{ success: boolean; message: string }> {
    try {
      // Use secure RPC function to close position with proper RLS handling
      const { data, error } = await supabase
        .rpc('close_simulated_position_secure', {
          p_position_id: positionId,
          p_close_price: currentPrice,
          p_close_reason: 'manual'
        });

      if (error) {
        console.error('Failed to close position:', error);
        return {
          success: false,
          message: error.message || 'Failed to close position'
        };
      }

      return {
        success: true,
        message: `Position closed with P&L: $${data.pnl.toFixed(2)}`
      };
    } catch (error) {
      console.error('Failed to close position:', error);
      return {
        success: false,
        message: 'Failed to close position'
      };
    }
  }

  async cancelPendingOrder(orderId: string, userId: string): Promise<{ success: boolean; message: string }> {
    try {
      const { error } = await supabase
        .from('simulated_positions')
        .delete()
        .eq('id', orderId)
        .eq('user_id', userId)
        .eq('status', 'pending');

      if (error) throw error;

      return {
        success: true,
        message: 'Pending order cancelled'
      };
    } catch (error) {
      console.error('Failed to cancel order:', error);
      return {
        success: false,
        message: 'Failed to cancel order'
      };
    }
  }

  calculatePnL(
    positionType: 'buy' | 'sell',
    entryPrice: number,
    currentPrice: number,
    lotSize: number,
    symbol: string
  ): number {
    const contractSize = 100000;
    const pointSize = symbol.includes('JPY') ? 0.01 : 0.0001;

    let priceDifference: number;
    if (positionType === 'buy') {
      priceDifference = currentPrice - entryPrice;
    } else {
      priceDifference = entryPrice - currentPrice;
    }

    const pnl = (priceDifference / pointSize) * (lotSize * contractSize / 10000);
    return parseFloat(pnl.toFixed(2));
  }

  async updatePositionPrice(positionId: string, currentPrice: number): Promise<void> {
    try {
      const { data: position } = await supabase
        .from('simulated_positions')
        .select('*')
        .eq('id', positionId)
        .single();

      if (!position || !position.entry_price) return;

      const pnl = this.calculatePnL(
        position.position_type,
        position.entry_price,
        currentPrice,
        position.lot_size,
        position.symbol
      );

      // Use secure RPC function to update position
      const { error } = await supabase
        .rpc('update_simulated_position_secure', {
          p_position_id: positionId,
          p_current_price: currentPrice,
          p_current_pnl: pnl
        });

      if (error) {
        console.error('Failed to update position price:', error);
      }
    } catch (error) {
      console.error('Failed to update position price:', error);
    }
  }
}

export const simulatedTradingService = new SimulatedTradingService();

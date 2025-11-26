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
      const { data: position, error: fetchError } = await supabase
        .from('simulated_positions')
        .select('*')
        .eq('id', positionId)
        .eq('user_id', userId)
        .single();

      if (fetchError || !position) {
        return { success: false, message: 'Position not found' };
      }

      const pnl = this.calculatePnL(
        position.position_type,
        position.entry_price,
        currentPrice,
        position.lot_size,
        position.symbol
      );

      const closedAt = new Date().toISOString();

      const { error: updateError } = await supabase
        .from('simulated_positions')
        .update({
          status: 'closed',
          current_price: currentPrice,
          current_pnl: pnl,
          closed_at: closedAt,
          close_reason: 'manual'
        })
        .eq('id', positionId);

      if (updateError) throw updateError;

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('demo_balance')
        .eq('id', userId)
        .single();

      const currentBalance = parseFloat(profile?.demo_balance || '10000');
      const newBalance = currentBalance + pnl;

      await supabase
        .from('user_profiles')
        .update({ demo_balance: newBalance })
        .eq('id', userId);

      await supabase
        .from('balance_transactions')
        .insert({
          user_id: userId,
          transaction_type: 'trade_pnl',
          amount: pnl,
          balance_before: currentBalance,
          balance_after: newBalance,
          position_id: positionId,
          description: `Position closed: ${position.symbol} ${position.position_type} ${position.lot_size} lots`
        });

      await supabase
        .from('trade_history')
        .insert({
          user_id: userId,
          position_id: positionId,
          symbol: position.symbol,
          position_type: position.position_type,
          lot_size: position.lot_size,
          entry_price: position.entry_price,
          exit_price: currentPrice,
          stop_loss: position.stop_loss,
          take_profit: position.take_profit,
          profit_loss: pnl,
          opened_at: position.opened_at,
          closed_at: closedAt,
          close_reason: 'manual',
          strategy_name: null,
          confidence_score: position.confidence_score || 75,
          setup_type: position.setup_type || 'Manual Trade',
          market_conditions: position.market_conditions || {},
          ai_decision_id: position.ai_decision_id || null,
          ai_analyzed: false,
          trade_source: 'live_demo'  // Mark as live demo trade
        });

      return {
        success: true,
        message: `Position closed with P&L: $${pnl.toFixed(2)}`
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

      await supabase
        .from('simulated_positions')
        .update({
          current_price: currentPrice,
          current_pnl: pnl
        })
        .eq('id', positionId);
    } catch (error) {
      console.error('Failed to update position price:', error);
    }
  }
}

export const simulatedTradingService = new SimulatedTradingService();

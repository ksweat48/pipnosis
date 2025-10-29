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
}

export const simulatedTradingService = new SimulatedTradingService();

/**
 * Position Service - Type-safe position management
 *
 * This service replaces simulated-trading.ts with a type-safe implementation
 * that uses goal_session_trades as the single source of truth.
 */

import { supabase } from '@/lib/supabase';
import {
  GoalSessionTrade,
  GoalSessionTradeInsert,
  GoalSessionTradeUpdate,
  Position,
  PositionDirection,
  CloseReason,
  dbToPosition,
  calculatePnL
} from '@/types/position';
import { getCurrencyPipInfo } from '@/utils/currencyHelpers';

export interface OpenPositionParams {
  goalSessionId: string;
  userId: string;
  symbol: string;
  direction: PositionDirection;
  lotSize: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  strategy?: string;
  playbookId?: string | null;
  regimeBucket?: string | null;
}

export interface ClosePositionResult {
  success: boolean;
  message: string;
  position?: GoalSessionTrade;
  pnl?: number;
}

class PositionService {
  /**
   * Open a new position in a goal session
   */
  async openPosition(params: OpenPositionParams): Promise<{ success: boolean; message: string; position?: GoalSessionTrade }> {
    try {
      // Calculate risk dollars
      const pipInfo = getCurrencyPipInfo(params.symbol);
      const riskPips = Math.abs(params.entryPrice - params.stopLoss) / pipInfo.pipValue;
      const dollarPerPip = params.lotSize * 10;
      const riskDollars = riskPips * dollarPerPip;

      const insert: GoalSessionTradeInsert = {
        goal_session_id: params.goalSessionId,
        user_id: params.userId,
        symbol: params.symbol,
        direction: params.direction,
        entry_price: params.entryPrice,
        stop_loss: params.stopLoss,
        take_profit: params.takeProfit,
        position_size: params.lotSize,
        status: 'open',
        order_type: 'market',
        current_price: params.entryPrice,
        strategy_used: params.strategy || 'ai_goal_session',
        playbook_id: params.playbookId,
        regime_bucket: params.regimeBucket,
        risk_dollars: riskDollars
      };

      const { data, error } = await supabase
        .from('goal_session_trades')
        .insert(insert)
        .select()
        .single();

      if (error) throw error;

      return {
        success: true,
        message: `${params.direction.toUpperCase()} position opened for ${params.symbol}`,
        position: data
      };
    } catch (error) {
      console.error('[PositionService] Failed to open position:', error);
      return {
        success: false,
        message: 'Failed to open position',
      };
    }
  }

  /**
   * Get all open positions for a user
   */
  async getOpenPositions(userId: string): Promise<Position[]> {
    try {
      const { data, error } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'open')
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (data || []).map(dbToPosition);
    } catch (error) {
      console.error('[PositionService] Failed to fetch open positions:', error);
      return [];
    }
  }

  /**
   * Get all pending orders for a user
   */
  async getPendingOrders(userId: string): Promise<Position[]> {
    try {
      const { data, error } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (data || []).map(dbToPosition);
    } catch (error) {
      console.error('[PositionService] Failed to fetch pending orders:', error);
      return [];
    }
  }

  /**
   * Get all positions (open, pending, closed) for a user
   */
  async getAllPositions(userId: string, limit = 100): Promise<Position[]> {
    try {
      const { data, error } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return (data || []).map(dbToPosition);
    } catch (error) {
      console.error('[PositionService] Failed to fetch all positions:', error);
      return [];
    }
  }

  /**
   * Get open positions for a specific symbol
   */
  async getOpenPositionsForSymbol(userId: string, symbol: string): Promise<Position[]> {
    try {
      const { data, error } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .eq('status', 'open')
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (data || []).map(dbToPosition);
    } catch (error) {
      console.error('[PositionService] Failed to fetch positions for symbol:', error);
      return [];
    }
  }

  /**
   * Update position with current price and P&L
   */
  async updatePositionPrice(positionId: string, currentPrice: number): Promise<boolean> {
    try {
      // Get the position first to calculate P&L
      const { data: position, error: fetchError } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('id', positionId)
        .single();

      if (fetchError || !position) {
        console.error('[PositionService] Position not found:', positionId);
        return false;
      }

      // Calculate current P&L
      const currentPnl = calculatePnL(
        position.direction,
        position.entry_price,
        currentPrice,
        position.lot_size || position.position_size
      );

      // Update MAE and MFE
      const mae = Math.min(position.mae || 0, currentPnl);
      const mfe = Math.max(position.mfe || 0, currentPnl);

      const update: GoalSessionTradeUpdate = {
        current_price: currentPrice,
        current_pnl: currentPnl,
        mae: mae,
        mfe: mfe
      };

      const { error: updateError } = await supabase
        .from('goal_session_trades')
        .update(update)
        .eq('id', positionId);

      if (updateError) throw updateError;

      return true;
    } catch (error) {
      console.error('[PositionService] Failed to update position price:', error);
      return false;
    }
  }

  /**
   * Close a position using the secure RPC function
   */
  async closePosition(
    positionId: string,
    closePrice: number,
    closeReason: CloseReason = 'manual',
    userId?: string
  ): Promise<ClosePositionResult> {
    try {
      // Use the secure RPC function
      const { data, error } = await supabase
        .rpc('close_goal_session_trade', {
          p_trade_id: positionId,
          p_close_price: closePrice,
          p_close_reason: closeReason
        });

      if (error) {
        console.error('[PositionService] Failed to close position:', error);
        return {
          success: false,
          message: error.message || 'Failed to close position'
        };
      }

      return {
        success: true,
        message: `Position closed with P&L: $${data.profit_loss?.toFixed(2) || '0.00'}`,
        position: data,
        pnl: data.profit_loss
      };
    } catch (error: any) {
      console.error('[PositionService] Failed to close position:', error);
      return {
        success: false,
        message: error.message || 'Failed to close position'
      };
    }
  }

  /**
   * Check if position has hit SL or TP and auto-close
   */
  async checkAndAutoClosePosition(position: GoalSessionTrade, currentPrice: number): Promise<boolean> {
    const isBuy = position.direction === 'buy';
    const hitStopLoss = isBuy
      ? currentPrice <= position.stop_loss
      : currentPrice >= position.stop_loss;
    const hitTakeProfit = isBuy
      ? currentPrice >= position.take_profit
      : currentPrice <= position.take_profit;

    if (hitStopLoss) {
      await this.closePosition(position.id, currentPrice, 'stop_loss');
      return true;
    }

    if (hitTakeProfit) {
      await this.closePosition(position.id, currentPrice, 'take_profit');
      return true;
    }

    return false;
  }

  /**
   * Get position by ID
   */
  async getPositionById(positionId: string): Promise<Position | null> {
    try {
      const { data, error } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('id', positionId)
        .single();

      if (error) throw error;

      return data ? dbToPosition(data) : null;
    } catch (error) {
      console.error('[PositionService] Failed to fetch position by ID:', error);
      return null;
    }
  }

  /**
   * Get positions for a specific goal session
   */
  async getPositionsForGoalSession(goalSessionId: string): Promise<Position[]> {
    try {
      const { data, error } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('goal_session_id', goalSessionId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (data || []).map(dbToPosition);
    } catch (error) {
      console.error('[PositionService] Failed to fetch positions for goal session:', error);
      return [];
    }
  }
}

export const positionService = new PositionService();

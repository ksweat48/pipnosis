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
import { getCurrencyPipInfo, roundLotSize, roundPnL } from '@/utils/currencyHelpers';
import { llmReasoningLogger } from './llm-reasoning-logger';
import { tradeValidationService } from './trade-validation-service';

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
  reasoning?: string;
  marketAnalysis?: string;
  expectedOutcome?: string;
  patternIdentified?: string;
  confidence?: number;
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
      // CRITICAL: Validate trade parameters BEFORE executing
      try {
        tradeValidationService.validateOrThrow({
          symbol: params.symbol,
          direction: params.direction,
          entryPrice: params.entryPrice,
          stopLoss: params.stopLoss,
          takeProfit: params.takeProfit,
          lotSize: params.lotSize
        });
      } catch (validationError) {
        console.error('[PositionService] ❌ Trade validation failed:', validationError);
        return {
          success: false,
          message: `Trade validation failed: ${validationError instanceof Error ? validationError.message : 'Unknown error'}`
        };
      }

      console.log(`[PositionService] ✅ Trade validation passed for ${params.symbol}`);

      // Round lot size to broker standard precision (0.01 lots)
      const roundedLotSize = roundLotSize(params.lotSize);

      // Calculate risk dollars with rounded values using SSOT
      const pipInfo = getCurrencyPipInfo(params.symbol);
      const riskPips = Math.abs(params.entryPrice - params.stopLoss) / pipInfo.pipValue;
      const dollarPerPip = roundedLotSize * pipInfo.dollarPerPipPerLot;
      const riskDollars = roundPnL(riskPips * dollarPerPip);

      const insert: GoalSessionTradeInsert = {
        goal_session_id: params.goalSessionId,
        user_id: params.userId,
        symbol: params.symbol,
        direction: params.direction,
        entry_price: params.entryPrice,
        stop_loss: params.stopLoss,
        take_profit: params.takeProfit,
        position_size: roundedLotSize,
        status: 'open',
        order_type: 'market',
        current_price: params.entryPrice,
        strategy_used: params.strategy || 'ai_goal_session',
        playbook_id: params.playbookId,
        regime_bucket: params.regimeBucket,
        risk_dollars: riskDollars
      };

      console.log('[PositionService] Opening position with lot_size:', {
        symbol: params.symbol,
        lotSize: roundedLotSize,
        riskDollars: riskDollars
      });

      const { data, error } = await supabase
        .from('goal_session_trades')
        .insert(insert)
        .select()
        .single();

      if (error) throw error;

      // Create journal entry for this trade
      const journalEntryId = await llmReasoningLogger.logTradeEntry({
        userId: params.userId,
        tradeId: data.id,
        sessionId: params.goalSessionId,
        symbol: params.symbol,
        direction: params.direction,
        entryTime: new Date(),
        entryPrice: params.entryPrice,
        stopLoss: params.stopLoss,
        takeProfit: params.takeProfit,
        llmReasoning: params.reasoning || null,
        marketRead: params.marketAnalysis || null,
        expectedOutcome: params.expectedOutcome || null,
        patternIdentified: params.patternIdentified || params.strategy || null,
        convictionLevel: params.confidence || null,
        rankAtTime: 'Active Trader'
      });

      if (journalEntryId) {
        console.log(`[PositionService] ✅ Journal entry created: ${journalEntryId}`);
      }

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
      console.log('[PositionService] Fetching open positions for user:', userId);

      const { data, error } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'open')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[PositionService] ❌ Database error fetching positions:', error);
        throw error;
      }

      if (!data) {
        console.log('[PositionService] No data returned from query');
        return [];
      }

      console.log(`[PositionService] ✅ Fetched ${data.length} raw position(s) from database`);

      // Log raw data for first position if exists
      if (data.length > 0) {
        console.log('[PositionService] First position raw data:', {
          id: data[0].id,
          symbol: data[0].symbol,
          direction: data[0].direction,
          entry_price: data[0].entry_price,
          stop_loss: data[0].stop_loss,
          take_profit: data[0].take_profit,
          position_size: data[0].position_size,
          lot_size: data[0].lot_size,
          status: data[0].status,
          current_price: data[0].current_price,
          current_pnl: data[0].current_pnl
        });
      }

      // Filter out any positions with null/invalid required fields
      const validPositions = data.filter(pos => {
        const isValid = !!(
          pos.id &&
          pos.symbol &&
          pos.entry_price !== null &&
          pos.entry_price > 0 &&
          (pos.position_size > 0 || pos.lot_size > 0) &&
          pos.stop_loss > 0 &&
          pos.take_profit > 0
        );

        if (!isValid) {
          console.warn('[PositionService] ⚠️ Filtering out invalid position:', {
            id: pos.id,
            symbol: pos.symbol,
            entry_price: pos.entry_price,
            position_size: pos.position_size,
            lot_size: pos.lot_size,
            stop_loss: pos.stop_loss,
            take_profit: pos.take_profit,
            issues: [
              !pos.id && 'missing id',
              !pos.symbol && 'missing symbol',
              (pos.entry_price === null || pos.entry_price <= 0) && 'invalid entry_price',
              (pos.position_size <= 0 && pos.lot_size <= 0) && 'invalid position_size',
              pos.stop_loss <= 0 && 'invalid stop_loss',
              pos.take_profit <= 0 && 'invalid take_profit'
            ].filter(Boolean).join(', ')
          });
        }

        return isValid;
      });

      console.log(`[PositionService] ✅ ${validPositions.length} valid position(s) after filtering`);

      const positions = validPositions.map(dbToPosition);

      if (positions.length > 0) {
        console.log('[PositionService] First converted position:', {
          id: positions[0].id,
          symbol: positions[0].symbol,
          positionType: positions[0].positionType,
          entryPrice: positions[0].entryPrice,
          lotSize: positions[0].lotSize,
          currentPnl: positions[0].currentPnl
        });
      }

      return positions;
    } catch (error) {
      console.error('[PositionService] ❌ Failed to fetch open positions:', error);
      return [];
    }
  }

  /**
   * Get all pending orders for a user
   */
  async getPendingOrders(userId: string): Promise<Position[]> {
    try {
      console.log('[PositionService] Fetching pending orders for user:', userId);

      const { data, error } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[PositionService] ❌ Database error fetching pending orders:', error);
        throw error;
      }

      console.log(`[PositionService] ✅ Fetched ${data?.length || 0} pending order(s)`);

      return (data || []).map(dbToPosition);
    } catch (error) {
      console.error('[PositionService] ❌ Failed to fetch pending orders:', error);
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

      // Calculate current P&L (already rounded by calculatePnL function)
      const currentPnl = calculatePnL(
        position.direction,
        position.entry_price,
        currentPrice,
        position.lot_size || position.position_size,
        position.symbol
      );

      // Update MAE and MFE (round to 2 decimals)
      const mae = roundPnL(Math.min(position.mae || 0, currentPnl));
      const mfe = roundPnL(Math.max(position.mfe || 0, currentPnl));

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
    userId?: string,
    goalSessionId?: string,
    forceClose: boolean = false
  ): Promise<ClosePositionResult> {
    try {
      console.log('[PositionService] Closing position:', {
        positionId,
        closePrice,
        closeReason,
        goalSessionId,
        forceClose
      });

      // Use the secure RPC function with session verification
      // Note: Function returns SETOF so data will be an array
      const { data, error } = await supabase
        .rpc('close_goal_session_trade', {
          p_trade_id: positionId,
          p_close_price: closePrice,
          p_close_reason: closeReason,
          p_goal_session_id: goalSessionId || null,
          p_force_close: forceClose
        });

      if (error) {
        console.error('[PositionService] Failed to close position:', error);

        // Parse error message to provide more helpful feedback
        let userMessage = error.message || 'Failed to close position';

        // Check for specific error patterns
        if (error.message?.includes('status')) {
          userMessage = `Cannot close: ${error.message}. Try force-close if position is stuck.`;
        } else if (error.message?.includes('not found')) {
          userMessage = 'Position not found or already closed.';
        } else if (error.message?.includes('Access denied')) {
          userMessage = 'You do not have permission to close this position.';
        }

        return {
          success: false,
          message: userMessage
        };
      }

      // Extract first record from array (SETOF returns array)
      const closedTrade = Array.isArray(data) ? data[0] : data;

      if (!closedTrade) {
        console.error('[PositionService] No trade data returned after close');
        return {
          success: false,
          message: 'Position closed but no data returned'
        };
      }

      console.log('[PositionService] Position closed successfully:', closedTrade);

      return {
        success: true,
        message: forceClose
          ? `Position force-closed with P&L: $${closedTrade.profit_loss?.toFixed(2) || '0.00'}`
          : `Position closed with P&L: $${closedTrade.profit_loss?.toFixed(2) || '0.00'}`,
        position: closedTrade,
        pnl: closedTrade.profit_loss
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
   * Force-close a stuck position (bypasses status validation)
   */
  async forceClosePosition(
    positionId: string,
    closePrice: number,
    userId?: string,
    goalSessionId?: string
  ): Promise<ClosePositionResult> {
    console.log('[PositionService] FORCE CLOSING stuck position:', positionId);
    return this.closePosition(
      positionId,
      closePrice,
      'manual',
      userId,
      goalSessionId,
      true // force close enabled
    );
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

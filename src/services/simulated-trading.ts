import { supabase } from '@/lib/supabase';
import { marketDataService } from './market-data';

export interface SimulatedTrade {
  id: string;
  userId: string;
  symbol: string;
  tradeType: 'buy' | 'sell';
  lotSize: number;
  entryPrice: number;
  currentPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  status: 'pending' | 'open' | 'closed' | 'cancelled';
  pnl: number;
  openedAt: string;
  closedAt?: string;
  metadata?: any;
}

export interface TradeExecutionParams {
  symbol: string;
  action: 'buy' | 'sell';
  lotSize: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  strategy: any;
}

export interface PositionUpdate {
  currentPrice: number;
  pnl: number;
  status: 'open' | 'closed';
}

class SimulatedTradingService {
  private readonly STANDARD_LOT = 100000;
  private readonly GOLD_LOT = 100;

  private getContractSize(symbol: string): number {
    if (symbol.includes('XAU') || symbol.includes('GOLD')) {
      return this.GOLD_LOT;
    }
    if (symbol === 'US30' || symbol.includes('US30')) {
      return 10;
    }
    return this.STANDARD_LOT;
  }

  private calculatePipValue(symbol: string, lotSize: number): number {
    const contractSize = this.getContractSize(symbol);
    const isJPY = symbol.includes('JPY');
    const isIndex = symbol === 'US30' || symbol.includes('US30');
    const pipSize = isJPY || isIndex ? 0.01 : 0.0001;

    return (contractSize * lotSize * pipSize);
  }

  calculatePnL(
    tradeType: 'buy' | 'sell',
    entryPrice: number,
    currentPrice: number,
    lotSize: number,
    symbol: string
  ): number {
    const priceDiff = tradeType === 'buy'
      ? currentPrice - entryPrice
      : entryPrice - currentPrice;

    const isJPY = symbol.includes('JPY');
    const isIndex = symbol === 'US30' || symbol.includes('US30');
    const pipSize = isJPY || isIndex ? 0.01 : 0.0001;
    const pips = priceDiff / pipSize;
    const pipValue = this.calculatePipValue(symbol, lotSize);

    return parseFloat((pips * pipValue / (isJPY || isIndex ? 1 : 10)).toFixed(2));
  }

  async executeTrade(params: TradeExecutionParams, userId: string): Promise<{
    success: boolean;
    trade?: SimulatedTrade;
    message: string;
  }> {
    try {
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('account_balance')
        .eq('id', userId)
        .maybeSingle();

      if (profileError) throw profileError;
      if (!profile) throw new Error('User profile not found');

      const accountBalance = parseFloat(profile.account_balance || '10000');
      const requiredMargin = this.calculateRequiredMargin(
        params.symbol,
        params.lotSize,
        params.entry
      );

      if (requiredMargin > accountBalance) {
        return {
          success: false,
          message: `Insufficient balance. Required: $${requiredMargin.toFixed(2)}, Available: $${accountBalance.toFixed(2)}`
        };
      }

      const currentPrice = await this.getCurrentPrice(params.symbol);

      const { data: trade, error: tradeError } = await supabase
        .from('trade_records')
        .insert({
          user_id: userId,
          symbol: params.symbol,
          trade_type: params.action,
          lot_size: params.lotSize,
          entry_price: params.entry,
          current_price: currentPrice,
          stop_loss: params.stopLoss,
          take_profit: params.takeProfit,
          status: 'open',
          pnl: 0,
          opened_at: new Date().toISOString(),
          trade_metadata: {
            strategy: params.strategy,
            execution_type: 'simulated'
          }
        })
        .select()
        .single();

      if (tradeError) throw tradeError;

      await this.createJournalEntry(userId, trade.id, {
        type: 'trade_entry',
        title: `${params.action.toUpperCase()} ${params.symbol}`,
        content: `Opened ${params.action} position: ${params.lotSize} lots at ${params.entry}`,
        tradeData: params
      });

      return {
        success: true,
        trade: this.mapToSimulatedTrade(trade),
        message: `Demo trade executed: ${params.action.toUpperCase()} ${params.symbol} ${params.lotSize} lots`
      };
    } catch (error) {
      console.error('Trade execution failed:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Trade execution failed'
      };
    }
  }

  async getOpenPositions(userId: string): Promise<SimulatedTrade[]> {
    try {
      const { data: trades, error } = await supabase
        .from('trade_records')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'open')
        .order('opened_at', { ascending: false });

      if (error) throw error;

      return (trades || []).map(this.mapToSimulatedTrade);
    } catch (error) {
      console.error('Failed to fetch open positions:', error);
      return [];
    }
  }

  async updatePosition(tradeId: string, userId: string): Promise<PositionUpdate | null> {
    try {
      const { data: trade, error } = await supabase
        .from('trade_records')
        .select('*')
        .eq('id', tradeId)
        .eq('user_id', userId)
        .eq('status', 'open')
        .maybeSingle();

      if (error || !trade) return null;

      const currentPrice = await this.getCurrentPrice(trade.symbol);
      const pnl = this.calculatePnL(
        trade.trade_type,
        parseFloat(trade.entry_price),
        currentPrice,
        parseFloat(trade.lot_size),
        trade.symbol
      );

      let status: 'open' | 'closed' = 'open';
      let closedAt: string | null = null;

      if (trade.stop_loss && this.isStopLossHit(trade.trade_type, currentPrice, parseFloat(trade.stop_loss))) {
        status = 'closed';
        closedAt = new Date().toISOString();
        await this.closePosition(tradeId, userId, currentPrice, 'stop_loss');
      } else if (trade.take_profit && this.isTakeProfitHit(trade.trade_type, currentPrice, parseFloat(trade.take_profit))) {
        status = 'closed';
        closedAt = new Date().toISOString();
        await this.closePosition(tradeId, userId, currentPrice, 'take_profit');
      } else {
        await supabase
          .from('trade_records')
          .update({
            current_price: currentPrice,
            pnl: pnl
          })
          .eq('id', tradeId)
          .eq('user_id', userId);
      }

      return { currentPrice, pnl, status };
    } catch (error) {
      console.error('Failed to update position:', error);
      return null;
    }
  }

  async closePosition(
    tradeId: string,
    userId: string,
    exitPrice?: number,
    reason: 'manual' | 'stop_loss' | 'take_profit' = 'manual'
  ): Promise<{
    success: boolean;
    pnl?: number;
    message: string;
  }> {
    try {
      const { data: trade, error } = await supabase
        .from('trade_records')
        .select('*')
        .eq('id', tradeId)
        .eq('user_id', userId)
        .eq('status', 'open')
        .maybeSingle();

      if (error) throw error;
      if (!trade) throw new Error('Trade not found or already closed');

      const closePrice = exitPrice || await this.getCurrentPrice(trade.symbol);
      const finalPnL = this.calculatePnL(
        trade.trade_type,
        parseFloat(trade.entry_price),
        closePrice,
        parseFloat(trade.lot_size),
        trade.symbol
      );

      await supabase
        .from('trade_records')
        .update({
          status: 'closed',
          current_price: closePrice,
          pnl: finalPnL,
          closed_at: new Date().toISOString()
        })
        .eq('id', tradeId)
        .eq('user_id', userId);

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('account_balance')
        .eq('id', userId)
        .maybeSingle();

      if (profile) {
        const newBalance = parseFloat(profile.account_balance || '10000') + finalPnL;
        await supabase
          .from('user_profiles')
          .update({ account_balance: newBalance })
          .eq('id', userId);
      }

      await this.createJournalEntry(userId, tradeId, {
        type: 'trade_exit',
        title: `Closed ${trade.symbol} Position`,
        content: `Position closed at ${closePrice}. P&L: $${finalPnL.toFixed(2)}. Reason: ${reason}`,
        tradeData: { closePrice, finalPnL, reason }
      });

      return {
        success: true,
        pnl: finalPnL,
        message: `Position closed. P&L: $${finalPnL.toFixed(2)}`
      };
    } catch (error) {
      console.error('Failed to close position:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to close position'
      };
    }
  }

  async modifyPosition(
    tradeId: string,
    userId: string,
    updates: { stopLoss?: number; takeProfit?: number }
  ): Promise<{ success: boolean; message: string }> {
    try {
      const updateData: any = {};
      if (updates.stopLoss !== undefined) updateData.stop_loss = updates.stopLoss;
      if (updates.takeProfit !== undefined) updateData.take_profit = updates.takeProfit;

      const { error } = await supabase
        .from('trade_records')
        .update(updateData)
        .eq('id', tradeId)
        .eq('user_id', userId)
        .eq('status', 'open');

      if (error) throw error;

      await this.createJournalEntry(userId, tradeId, {
        type: 'modification',
        title: 'Position Modified',
        content: `Updated SL/TP levels`,
        tradeData: updates
      });

      return {
        success: true,
        message: 'Position updated successfully'
      };
    } catch (error) {
      console.error('Failed to modify position:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to modify position'
      };
    }
  }

  async getTradeHistory(userId: string, limit: number = 50): Promise<SimulatedTrade[]> {
    try {
      const { data: trades, error } = await supabase
        .from('trade_records')
        .select('*')
        .eq('user_id', userId)
        .order('opened_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return (trades || []).map(this.mapToSimulatedTrade);
    } catch (error) {
      console.error('Failed to fetch trade history:', error);
      return [];
    }
  }

  private async getCurrentPrice(symbol: string): Promise<number> {
    try {
      const price = await marketDataService.getCurrentPrice(symbol);
      return (price.bid + price.ask) / 2;
    } catch (error) {
      console.error(`Failed to get current price for ${symbol}:`, error);
      throw new Error('Unable to fetch current market price');
    }
  }

  private calculateRequiredMargin(symbol: string, lotSize: number, price: number): number {
    const leverage = 100;
    const contractSize = this.getContractSize(symbol);
    const notionalValue = contractSize * lotSize * price;
    return notionalValue / leverage;
  }

  private isStopLossHit(tradeType: 'buy' | 'sell', currentPrice: number, stopLoss: number): boolean {
    if (tradeType === 'buy') {
      return currentPrice <= stopLoss;
    }
    return currentPrice >= stopLoss;
  }

  private isTakeProfitHit(tradeType: 'buy' | 'sell', currentPrice: number, takeProfit: number): boolean {
    if (tradeType === 'buy') {
      return currentPrice >= takeProfit;
    }
    return currentPrice <= takeProfit;
  }

  private async createJournalEntry(
    userId: string,
    tradeId: string,
    params: { type: string; title: string; content: string; tradeData: any }
  ): Promise<void> {
    try {
      await supabase
        .from('journal_entries')
        .insert({
          user_id: userId,
          trade_id: tradeId,
          entry_type: params.type,
          title: params.title,
          content: params.content,
          metadata: params.tradeData
        });
    } catch (error) {
      console.error('Failed to create journal entry:', error);
    }
  }

  private mapToSimulatedTrade(dbTrade: any): SimulatedTrade {
    return {
      id: dbTrade.id,
      userId: dbTrade.user_id,
      symbol: dbTrade.symbol,
      tradeType: dbTrade.trade_type,
      lotSize: parseFloat(dbTrade.lot_size),
      entryPrice: parseFloat(dbTrade.entry_price),
      currentPrice: dbTrade.current_price ? parseFloat(dbTrade.current_price) : undefined,
      stopLoss: dbTrade.stop_loss ? parseFloat(dbTrade.stop_loss) : undefined,
      takeProfit: dbTrade.take_profit ? parseFloat(dbTrade.take_profit) : undefined,
      status: dbTrade.status,
      pnl: parseFloat(dbTrade.pnl || '0'),
      openedAt: dbTrade.opened_at,
      closedAt: dbTrade.closed_at || undefined,
      metadata: dbTrade.trade_metadata
    };
  }
}

export const simulatedTradingService = new SimulatedTradingService();

export interface TradePosition {
  id: string;
  symbol: string;
  type: 'buy' | 'sell';
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  openTime: Date;
  pnl: number;
  status: 'open' | 'closed' | 'pending';
}

export interface TradeHistory {
  id: string;
  symbol: string;
  type: 'buy' | 'sell';
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  openTime: Date;
  closeTime: Date;
  pnl: number;
  exitReason: string;
}

export interface TradingSession {
  id: string;
  userId: string;
  startTime: Date;
  endTime?: Date;
  totalPnL: number;
  winRate: number;
  totalTrades: number;
}

export interface RiskConfig {
  maxLotSize: number;
  maxDailyLoss: number;
  maxOpenPositions: number;
  riskPerTrade: number;
}

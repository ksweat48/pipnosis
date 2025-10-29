export interface StrategyOption {
  id: string;
  name: string;
  risk: 'low' | 'medium' | 'high';
  symbol: string;
  action: 'buy' | 'sell';
  entry: string;
  stopLoss: string;
  takeProfit: string;
  lotSize: number;
  estimatedGain: string;
  riskRewardRatio: number;
  feasible: boolean;
  reasoning: string;
  confidence: string;
}

export interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

export interface TradeSignal {
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  confidence: number;
  reasoning: string | string[];
}

export interface MarketOpportunity {
  signal: TradeSignal;
  symbol: string;
  score: number;
}

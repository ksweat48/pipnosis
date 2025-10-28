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
  riskRewardRatio?: number;
  feasible: boolean;
  reasoning: string;
  confidence?: string;
  tradeType?: string;
}

export interface Notification {
  id: string;
  type: 'info' | 'success' | 'error' | 'warning';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

export interface AIAnalysis {
  confidence: number;
  direction: 'long' | 'short' | 'neutral';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  reasoning: string;
  timestamp: Date;
}

export interface LearningMetrics {
  totalTrades: number;
  winRate: number;
  averageReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
}

export interface SkillLevel {
  category: string;
  level: number;
  experience: number;
  nextLevelAt: number;
}

export interface BacktestConfig {
  symbol: string;
  startDate: Date;
  endDate: Date;
  initialBalance: number;
  strategy: string;
}

export interface BacktestResult {
  totalReturn: number;
  winRate: number;
  totalTrades: number;
  maxDrawdown: number;
  sharpeRatio: number;
  equity: number[];
}

export const STRATEGY_VERSION = "Fx Flow Scalper v2.0";

export interface TimeframeData {
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  trend?: 'UP' | 'DOWN' | 'SIDEWAYS';
  rsi?: number;
  signalLine?: 'above' | 'below' | 'at';
  candleColor?: 'green' | 'red';
  halfTrend?: 'GREEN' | 'RED';
  stochRSI?: {
    k: number;
    d: number;
    status: 'oversold' | 'overbought' | 'neutral';
    crossing: 'up' | 'down' | 'none';
  };
}

export interface Phase1MacroBias {
  passed: boolean;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  h1CandleType: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  reason: string;
}

export interface Phase2TacticalSetup {
  passed: boolean;
  halfTrendAligned: boolean;
  stochRSIAligned: boolean;
  signalLineAligned: boolean;
  confidence: number;
  reason: string;
  details: {
    halfTrend: 'GREEN' | 'RED' | null;
    stochRSI: {
      value: number;
      zone: 'oversold' | 'overbought' | 'neutral';
      crossing: 'up' | 'down' | 'none';
    } | null;
    signalLinePosition: 'above' | 'below' | null;
  };
}

export interface Phase3PrecisionEntry {
  passed: boolean;
  haCandleShifted: boolean;
  rsiMomentumAligned: boolean;
  signalLineConfirmed: boolean;
  confidence: number;
  reason: string;
  details: {
    haCandleColor: 'green' | 'red' | null;
    rsiValue: number | null;
    rsiCrossing: 'up' | 'down' | 'none';
    signalLinePosition: 'above' | 'below' | null;
  };
}

export interface RiskManagement {
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  stopLossPips: number;
  takeProfitPips: number;
  riskRewardRatio: number;
  breakEvenPrice: number;
  partialClosePrice: number;
}

export interface TradeSignal {
  approved: boolean;
  direction: 'BUY' | 'SELL';
  confidence: number;
  symbol: string;
  timeframe: '1M' | '5M' | '1H';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  reasoning: string[];
  conditions: {
    macro: boolean;
    tactical: boolean;
    entry: boolean;
  };
  phases: {
    phase1: Phase1MacroBias;
    phase2: Phase2TacticalSetup;
    phase3: Phase3PrecisionEntry;
  };
  timestamp: Date;
  version: string;
  notes: string;
}

export interface StrategyEvaluation {
  timestamp: Date;
  version: string;
  symbol: string;
  timeframes: {
    h1: TimeframeData;
    m5: TimeframeData;
    m1: TimeframeData;
  };
  conditions: {
    macro: boolean;
    tactical: boolean;
    entry: boolean;
  };
  trade: TradeSignal | null;
  notes: string;
}

export interface AutoTradingConfig {
  enabled: boolean;
  maxDailyTrades: number;
  minConfidence: number;
  symbols: string[];
  tradingHours: {
    start: string;
    end: string;
  };
  riskPercentage: number;
}

export interface DemoTradeRecord {
  id: string;
  signalId: string;
  userId: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  entryTime: Date;
  exitTime: Date | null;
  exitPrice: number | null;
  pnl: number | null;
  pnlPips: number | null;
  status: 'open' | 'closed' | 'stopped' | 'target_hit';
  isAITrade: boolean;
  confidence: number;
  strategyVersion: string;
}

export interface PerformanceMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  averageRR: number;
  profitFactor: number;
  totalPnL: number;
  averageWin: number;
  averageLoss: number;
  maxDrawdown: number;
  strategyVersion: string;
  period: 'daily' | 'weekly' | 'monthly' | 'all-time';
}

export interface PromptAnalysis {
  intent: 'find_trade' | 'analyze_market' | 'check_signal';
  bias?: 'bullish' | 'bearish' | 'any';
  symbols?: string[];
  timeframe?: '1M' | '5M' | '1H';
  riskTolerance?: 'low' | 'medium' | 'high';
  timeWindow: number;
}

export interface OpportunityRanking {
  symbol: string;
  signal: TradeSignal;
  score: number;
  reasons: string[];
  rank: number;
}

import type { OmegaSensors } from '../services/omega-sensors';

export interface TrendIntelligence {
  emaAlignment: 'bull' | 'bear' | 'mixed';
  momentum: 'strong_bull' | 'bull' | 'neutral' | 'bear' | 'strong_bear';
  bos: 'bull' | 'bear' | 'none';
  choch: 'bull' | 'bear' | 'none';
  atrTrend: 'up' | 'down' | 'flat';
}

export interface ScalpIntelligence {
  vwapDistance: number;
  rsiLevel: number;
  stochLevel: number;
  microSR: 'above' | 'below' | 'at';
  pullbackDepth: number;
}

export interface ConfirmationIntelligence {
  bosDirection: 'bull' | 'bear' | 'none';
  equalHighs: boolean;
  equalLows: boolean;
  volumeSpike: boolean;
}

export interface ReversalIntelligence {
  rsiDivergence: 'bull' | 'bear' | 'none';
  macdDivergence: 'bull' | 'bear' | 'none';
  engulfingBull: boolean;
  engulfingSell: boolean;
  pinBarBull: boolean;
  pinBarSell: boolean;
  doji: boolean;
}

export interface VolatilityIntelligence {
  regime: 'low' | 'mid' | 'high';
  atrTrend: 'up' | 'down' | 'flat';
  volumeSpike: boolean;
}

export interface OrderFlowIntelligence {
  bias: 'buy' | 'sell' | 'neutral';
  liquidityBias: string;
  confidence: number;
}

export interface MarketIntelligence {
  symbol: string;
  price: number;
  atr: number;
  atrPercent: number;
  trend: TrendIntelligence;
  scalp: ScalpIntelligence;
  confirmation: ConfirmationIntelligence;
  reversal: ReversalIntelligence;
  volatility: VolatilityIntelligence;
  orderFlow: OrderFlowIntelligence;
  sensors: OmegaSensors;
  rawIndicators: {
    ema20: number;
    ema50: number;
    ema200: number;
    rsi: number;
    momentum: number;
    stochastic: number;
    macd: number;
    macdSignal: number;
    vwap: number;
  };
  support: number[];
  resistance: number[];
  swingHigh: number;
  swingLow: number;
  regime: string;
  volatilityState: string;
  session: string;
}

export interface MarketBriefing {
  intelligence: MarketIntelligence;
  briefingText: string;
  timestamp: number;
}

export interface MarketSnapshotInput {
  symbol: string;
  price: number;
  ema20: number;
  ema50: number;
  ema200: number;
  rsi: number;
  momentum: number;
  stochastic: number;
  macd: number;
  macdSignal: number;
  vwap: number;
  atr: number;
  support: number[];
  resistance: number[];
  swingHigh: number;
  swingLow: number;
  trend: string;
  volatility: string;
  regime?: string;
  session?: string;
  sensors: OmegaSensors;
  candles: Array<{ open: number; high: number; low: number; close: number; volume?: number }>;
}

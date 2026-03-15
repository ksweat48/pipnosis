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

/**
 * CCIP-2026-03-12: OrderFlowIntelligence replaced with Omega8PatternIntelligence.
 * No pre-scored bias or confidence — raw computed pattern facts only.
 * Alpha reasons about these facts independently.
 */
export interface Omega8PatternIntelligence {
  sweptHighs: number;
  sweptLows: number;
  fvgBullish: number;
  fvgBearish: number;
  equalHighs: number;
  equalLows: number;
  volSpikeBullish: boolean;
  volSpikeBearish: boolean;
  absorptionBullish: boolean;
  absorptionBearish: boolean;
  accumulationZone: boolean;
  distributionZone: boolean;
  confluenceScore: number;
  liquidityBias: string;
  sweepType?: 'high' | 'low' | 'none';
  sweepCandlesAgo?: number;
  sweepHasBOS?: boolean;
  sweepExtremePrice?: number;
  nearestClusterPrice?: number;
  signals: string[];
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
  orderFlow: Omega8PatternIntelligence;
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
  spreadPips?: number;
  sessionName?: string;
  sessionMinutesRemaining?: number;
  nextSessionName?: string;
  minutesUntilNextSession?: number;
  marketPhase?: string;
  marketPhaseConfidence?: number;
  previousDayHigh?: number;
  previousDayLow?: number;
  previousDayClose?: number;
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
  spreadPips?: number;
  sessionName?: string;
  sessionMinutesRemaining?: number;
  nextSessionName?: string;
  minutesUntilNextSession?: number;
  marketPhase?: string;
  marketPhaseConfidence?: number;
  previousDayHigh?: number;
  previousDayLow?: number;
  previousDayClose?: number;
  sensors: OmegaSensors;
  candles: Array<{ open: number; high: number; low: number; close: number; volume?: number }>;
}

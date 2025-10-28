export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1';

export interface CandleData {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tickVolume?: number;
}

export interface TickData {
  symbol: string;
  bid: number;
  ask: number;
  time: Date;
  brokerTime: string;
}

export interface MarketDataListener {
  id: string;
  onCandleUpdate?: (candle: CandleData) => void;
  onTick?: (tick: TickData) => void;
  onError?: (error: Error) => void;
}

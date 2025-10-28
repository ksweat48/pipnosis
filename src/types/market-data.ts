export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'W1' | 'MN1';

export interface CandleData {
  time: Date | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tickVolume?: number;
  spread?: number;
  symbol?: string;
  timeframe?: Timeframe;
  brokerTime?: string;
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

export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface RealtimePrice {
  symbol: string;
  bid: number;
  ask: number;
  timestamp: Date;
}

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w';

export interface ChartConfig {
  symbol: string;
  timeframe: Timeframe;
  candleCount: number;
}

export interface IndicatorConfig {
  type: 'ema' | 'sma' | 'rsi' | 'macd' | 'bollinger';
  period: number;
  enabled: boolean;
}

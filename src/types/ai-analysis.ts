export interface MarketSentiment {
  bias: 'bullish' | 'bearish' | 'neutral';
  strength: number;
  confidence: number;
  description: string;
}

export interface OverboughtOversold {
  rsi: number;
  status: 'overbought' | 'oversold' | 'neutral';
  signal: string;
}

export interface VolumeAnalysis {
  currentVolume: number;
  averageVolume: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  strength: number;
  description: string;
}

export interface FearGreedIndex {
  value: number;
  level: 'extreme-fear' | 'fear' | 'neutral' | 'greed' | 'extreme-greed';
  description: string;
}

export interface TrendLine {
  startTime: number;
  startPrice: number;
  endTime: number;
  endPrice: number;
  type: 'bullish' | 'bearish';
  confidence: number;
}

export interface ChartPattern {
  type: 'head-shoulders' | 'triangle' | 'double-top' | 'double-bottom' | 'flag' | 'wedge';
  startTime: number;
  endTime: number;
  points: { time: number; price: number }[];
  direction: 'bullish' | 'bearish';
  confidence: number;
}

export interface SessionMarker {
  time: number;
  type: 'high' | 'low';
  price: number;
  session: 'asian' | 'london' | 'newyork';
}

export interface AIAnalysisData {
  marketSentiment?: MarketSentiment;
  overboughtOversold?: OverboughtOversold;
  volumeAnalysis?: VolumeAnalysis;
  fearGreedIndex?: FearGreedIndex;
  trendLines?: TrendLine[];
  patterns?: ChartPattern[];
  sessionMarkers?: SessionMarker[];
  vwap?: number;
  aiConfidence?: number;
  analysisTimestamp?: Date;
}

export interface SupportResistanceLevel {
  price: number;
  type: 'support' | 'resistance';
  strength: number;
  confidence: number;
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

export interface MarketZone {
  startPrice: number;
  endPrice: number;
  type: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
}

export interface SessionMarker {
  time: number;
  type: 'high' | 'low';
  price: number;
  session: 'asian' | 'london' | 'newyork';
}

export interface AIAnalysisData {
  supportResistanceLevels?: SupportResistanceLevel[];
  trendLines?: TrendLine[];
  patterns?: ChartPattern[];
  zones?: MarketZone[];
  sessionMarkers?: SessionMarker[];
  vwap?: number;
  aiConfidence?: number;
  analysisTimestamp?: Date;
}

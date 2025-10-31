import React, { useState, useEffect } from 'react';
import { Activity, TrendingUp, TrendingDown, Minus, Clock, Target, BarChart3, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface MarketSnapshot {
  symbol: string;
  currentPrice: number;
  trend: 'bullish' | 'bearish' | 'sideways';
  volatility: 'low' | 'medium' | 'high';
  ema20: number;
  ema50: number;
  vwap: number;
  atr: number;
  distanceFromVWAP: number;
  setupConfidence: number;
  waitingFor: string[];
  lastUpdate: string;
}

interface AnalysisStreamProps {
  sessionId: string;
  watchlist: string[];
}

export const MarketAnalysisStream: React.FC<AnalysisStreamProps> = ({ sessionId, watchlist }) => {
  const [marketData, setMarketData] = useState<MarketSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextScanTime, setNextScanTime] = useState<Date | null>(null);

  useEffect(() => {
    loadMarketData();
    loadSessionInfo();

    const interval = setInterval(() => {
      loadMarketData();
      loadSessionInfo();
    }, 30000);

    return () => clearInterval(interval);
  }, [sessionId, watchlist]);

  const loadSessionInfo = async () => {
    const { data } = await supabase
      .from('goal_sessions')
      .select('next_scan_time')
      .eq('id', sessionId)
      .maybeSingle();

    if (data?.next_scan_time) {
      setNextScanTime(new Date(data.next_scan_time));
    }
  };

  const loadMarketData = async () => {
    try {
      const snapshots: MarketSnapshot[] = [];

      for (const symbol of watchlist) {
        const { data: candles } = await supabase
          .from('market_data')
          .select('*')
          .eq('symbol', symbol)
          .eq('timeframe', '15m')
          .order('timestamp', { ascending: false })
          .limit(100);

        if (candles && candles.length >= 50) {
          const snapshot = analyzeSymbol(symbol, candles);
          snapshots.push(snapshot);
        }
      }

      setMarketData(snapshots);
    } catch (error) {
      console.error('Error loading market data:', error);
    } finally {
      setLoading(false);
    }
  };

  const analyzeSymbol = (symbol: string, candles: any[]): MarketSnapshot => {
    const recentCandles = candles.slice(0, 50).reverse();
    const prices = recentCandles.map(c => c.close);
    const currentPrice = prices[prices.length - 1];

    const ema20 = calculateEMA(prices, 20);
    const ema50 = calculateEMA(prices, 50);
    const vwap = calculateVWAP(recentCandles.slice(-20));
    const atr = calculateATR(recentCandles.slice(-14));

    const distanceFromVWAP = ((currentPrice - vwap) / currentPrice) * 100;
    const priceToEma20 = ((currentPrice - ema20) / currentPrice) * 100;

    const trend = determineTrend(recentCandles);
    const volatility = determineVolatility(atr, currentPrice);

    const waitingFor: string[] = [];
    let setupConfidence = 0;

    if (Math.abs(distanceFromVWAP) > 0.1) {
      waitingFor.push(`Price to reach VWAP (${Math.abs(distanceFromVWAP).toFixed(2)}% away)`);
    } else {
      setupConfidence += 30;
    }

    if (Math.abs(priceToEma20) > 0.3) {
      waitingFor.push(`Price alignment with EMA20 (${Math.abs(priceToEma20).toFixed(2)}% away)`);
    } else {
      setupConfidence += 25;
    }

    if (ema20 === ema50) {
      waitingFor.push('Clear EMA crossover signal');
    } else {
      setupConfidence += 20;
    }

    if (volatility === 'low') {
      waitingFor.push('Volatility to increase for better opportunity');
    } else {
      setupConfidence += 15;
    }

    if (trend === 'sideways') {
      waitingFor.push('Directional trend formation');
    } else {
      setupConfidence += 10;
    }

    if (waitingFor.length === 0) {
      waitingFor.push('Confidence threshold met - setup ready');
    }

    return {
      symbol,
      currentPrice,
      trend,
      volatility,
      ema20,
      ema50,
      vwap,
      atr,
      distanceFromVWAP,
      setupConfidence,
      waitingFor,
      lastUpdate: new Date().toISOString(),
    };
  };

  const calculateEMA = (prices: number[], period: number): number => {
    if (prices.length < period) return prices[prices.length - 1] || 0;
    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }
    return ema;
  };

  const calculateVWAP = (candles: any[]): number => {
    let totalVolume = 0;
    let totalPV = 0;
    for (const candle of candles) {
      const typical = (candle.high + candle.low + candle.close) / 3;
      const volume = candle.volume || 1;
      totalPV += typical * volume;
      totalVolume += volume;
    }
    return totalVolume > 0 ? totalPV / totalVolume : 0;
  };

  const calculateATR = (candles: any[]): number => {
    if (candles.length < 2) return 0.001;
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      const tr = Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      );
      trs.push(tr);
    }
    return trs.reduce((sum, tr) => sum + tr, 0) / trs.length;
  };

  const determineTrend = (candles: any[]): 'bullish' | 'bearish' | 'sideways' => {
    const prices = candles.map(c => c.close);
    const change = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
    if (change > 0.5) return 'bullish';
    if (change < -0.5) return 'bearish';
    return 'sideways';
  };

  const determineVolatility = (atr: number, price: number): 'low' | 'medium' | 'high' => {
    const atrPercent = (atr / price) * 100;
    if (atrPercent < 0.1) return 'low';
    if (atrPercent > 0.3) return 'high';
    return 'medium';
  };

  const getTrendIcon = (trend: string) => {
    if (trend === 'bullish') return <TrendingUp className="w-4 h-4 text-green-400" />;
    if (trend === 'bearish') return <TrendingDown className="w-4 h-4 text-red-400" />;
    return <Minus className="w-4 h-4 text-gray-400" />;
  };

  const getVolatilityColor = (volatility: string) => {
    if (volatility === 'high') return 'text-orange-400';
    if (volatility === 'medium') return 'text-yellow-400';
    return 'text-blue-400';
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 75) return 'from-green-500 to-emerald-500';
    if (confidence >= 50) return 'from-yellow-500 to-orange-500';
    return 'from-gray-500 to-gray-600';
  };

  const formatTimeUntilScan = () => {
    if (!nextScanTime) return 'Calculating...';
    const now = Date.now();
    const remaining = nextScanTime.getTime() - now;
    if (remaining <= 0) return 'Scanning now...';
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  };

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <div className="animate-pulse text-gray-400 text-center">Loading market analysis...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-400 animate-pulse" />
            <h4 className="text-lg font-bold text-white">Live Market Analysis</h4>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Clock className="w-4 h-4 text-gray-400" />
            <span className="text-gray-400">Next scan in:</span>
            <span className="text-blue-400 font-mono font-semibold">{formatTimeUntilScan()}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {marketData.map((snapshot) => (
            <div
              key={snapshot.symbol}
              className="bg-gray-700/50 rounded-lg p-4 border border-gray-600 hover:border-gray-500 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="text-xl font-bold text-white">{snapshot.symbol}</div>
                  {getTrendIcon(snapshot.trend)}
                  <div className="text-2xl font-mono font-bold text-blue-400">
                    {snapshot.currentPrice.toFixed(5)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-500 mb-1">Setup Confidence</div>
                  <div className="text-lg font-bold text-white">{snapshot.setupConfidence}%</div>
                </div>
              </div>

              <div className="mb-3">
                <div className="w-full bg-gray-600 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full bg-gradient-to-r ${getConfidenceColor(snapshot.setupConfidence)} transition-all duration-500`}
                    style={{ width: `${snapshot.setupConfidence}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <div className="bg-gray-800/50 rounded p-2">
                  <div className="text-xs text-gray-400 mb-1">Trend</div>
                  <div className="text-sm font-semibold text-white capitalize">{snapshot.trend}</div>
                </div>
                <div className="bg-gray-800/50 rounded p-2">
                  <div className="text-xs text-gray-400 mb-1">Volatility</div>
                  <div className={`text-sm font-semibold capitalize ${getVolatilityColor(snapshot.volatility)}`}>
                    {snapshot.volatility}
                  </div>
                </div>
                <div className="bg-gray-800/50 rounded p-2">
                  <div className="text-xs text-gray-400 mb-1">From VWAP</div>
                  <div className="text-sm font-mono font-semibold text-white">
                    {snapshot.distanceFromVWAP > 0 ? '+' : ''}{snapshot.distanceFromVWAP.toFixed(2)}%
                  </div>
                </div>
                <div className="bg-gray-800/50 rounded p-2">
                  <div className="text-xs text-gray-400 mb-1">ATR</div>
                  <div className="text-sm font-mono font-semibold text-white">
                    {snapshot.atr.toFixed(5)}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <BarChart3 className="w-3 h-3" />
                  <span>Technical Levels:</span>
                  <span className="text-gray-300">
                    EMA20: {snapshot.ema20.toFixed(5)} | EMA50: {snapshot.ema50.toFixed(5)} | VWAP: {snapshot.vwap.toFixed(5)}
                  </span>
                </div>

                {snapshot.waitingFor.length > 0 && (
                  <div className="bg-blue-900/20 border border-blue-700/50 rounded p-2">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <div className="text-xs font-semibold text-blue-300 mb-1">
                          {snapshot.setupConfidence >= 75 ? 'Setup Ready!' : 'Waiting For:'}
                        </div>
                        <ul className="text-xs text-gray-300 space-y-0.5">
                          {snapshot.waitingFor.map((condition, idx) => (
                            <li key={idx} className="flex items-start gap-1">
                              <span className="text-blue-400 mt-0.5">•</span>
                              <span>{condition}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {marketData.length === 0 && (
          <div className="text-center py-8 text-gray-400">
            <Target className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>Waiting for market data...</p>
          </div>
        )}
      </div>
    </div>
  );
};

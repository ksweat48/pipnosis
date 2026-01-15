import React, { useState, useEffect } from 'react';
import { Activity, TrendingUp, TrendingDown, Minus, Clock, Target, BarChart3, AlertCircle, CheckCircle, Brain, Shield } from 'lucide-react';
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

interface WellnessMessage {
  id: string;
  content: string;
  trade_id: string;
  symbol: string;
  created_at: string;
  metadata: {
    action?: string;
    confidence?: number;
    current_pnl?: number;
    risk_ratio?: string;
    minutes_in_trade?: number;
  };
}

interface AnalysisStreamProps {
  sessionId: string;
  watchlist: string[];
}

export const MarketAnalysisStream: React.FC<AnalysisStreamProps> = ({ sessionId, watchlist }) => {
  const [marketData, setMarketData] = useState<MarketSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextScanTime, setNextScanTime] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState<string>('Calculating...');
  const [hasOpenTrades, setHasOpenTrades] = useState(false);
  const [hasActiveIntent, setHasActiveIntent] = useState(false);
  const [activeIntentSymbol, setActiveIntentSymbol] = useState<string | null>(null);
  const [wellnessMessages, setWellnessMessages] = useState<WellnessMessage[]>([]);

  useEffect(() => {
    loadMarketData();
    loadSessionInfo();
    checkOpenTrades();
    checkActiveIntent();
    loadWellnessMessages();

    const interval = setInterval(() => {
      loadMarketData();
      loadSessionInfo();
      checkOpenTrades();
      checkActiveIntent();
      loadWellnessMessages();
    }, 10000); // Check more frequently for wellness updates

    // Subscribe to realtime wellness check updates
    const wellnessChannel = supabase
      .channel('wellness-updates')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'goal_ai_conversations',
          filter: `goal_session_id=eq.${sessionId}`
        },
        (payload) => {
          if (payload.new.conversation_type === 'periodic_wellness') {
            console.log('[MarketAnalysisStream] New wellness check received:', payload.new);
            loadWellnessMessages();
          }
        }
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(wellnessChannel);
    };
  }, [sessionId, watchlist]);

  // Update countdown every second
  useEffect(() => {
    const countdownInterval = setInterval(() => {
      if (nextScanTime) {
        const now = Date.now();
        const remaining = nextScanTime.getTime() - now;

        if (remaining <= 0) {
          setCountdown('Scanning now...');
        } else {
          const totalSeconds = Math.floor(remaining / 1000);
          const minutes = Math.floor(totalSeconds / 60);
          const seconds = totalSeconds % 60;
          setCountdown(`${minutes}m ${seconds}s`);
        }
      }
    }, 1000);

    return () => clearInterval(countdownInterval);
  }, [nextScanTime]);

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

  const checkOpenTrades = async () => {
    try {
      const { data: openTrades } = await supabase
        .from('goal_session_trades')
        .select('id')
        .eq('goal_session_id', sessionId)
        .eq('status', 'open');

      setHasOpenTrades((openTrades?.length || 0) > 0);
    } catch (error) {
      console.error('Error checking open trades:', error);
      setHasOpenTrades(false);
    }
  };

  const checkActiveIntent = async () => {
    try {
      const { data: activeIntents } = await supabase
        .from('entry_intents')
        .select('id, symbol')
        .eq('session_id', sessionId)
        .eq('status', 'monitoring')
        .order('created_at', { ascending: false })
        .limit(1);

      if (activeIntents && activeIntents.length > 0) {
        setHasActiveIntent(true);
        setActiveIntentSymbol(activeIntents[0].symbol);
      } else {
        setHasActiveIntent(false);
        setActiveIntentSymbol(null);
      }
    } catch (error) {
      console.error('Error checking active intent:', error);
      setHasActiveIntent(false);
      setActiveIntentSymbol(null);
    }
  };

  const loadWellnessMessages = async () => {
    try {
      // Get all open trades for this session
      const { data: openTrades } = await supabase
        .from('goal_session_trades')
        .select('id, symbol')
        .eq('goal_session_id', sessionId)
        .eq('status', 'open');

      if (!openTrades || openTrades.length === 0) {
        setWellnessMessages([]);
        return;
      }

      // Get latest wellness check for each open trade
      const tradeIds = openTrades.map(t => t.id);
      const { data: conversations } = await supabase
        .from('goal_ai_conversations')
        .select('*')
        .eq('goal_session_id', sessionId)
        .eq('conversation_type', 'periodic_wellness')
        .in('trade_id', tradeIds)
        .order('created_at', { ascending: false });

      if (conversations && conversations.length > 0) {
        // Get most recent wellness check per trade
        const latestByTrade = new Map<string, any>();
        conversations.forEach(conv => {
          if (conv.trade_id && !latestByTrade.has(conv.trade_id)) {
            latestByTrade.set(conv.trade_id, conv);
          }
        });

        const messages: WellnessMessage[] = Array.from(latestByTrade.values()).map(conv => {
          const trade = openTrades.find(t => t.id === conv.trade_id);
          return {
            id: conv.id,
            content: conv.content,
            trade_id: conv.trade_id,
            symbol: trade?.symbol || 'UNKNOWN',
            created_at: conv.created_at,
            metadata: conv.metadata || {}
          };
        });

        setWellnessMessages(messages);
      } else {
        setWellnessMessages([]);
      }
    } catch (error) {
      console.error('[MarketAnalysisStream] Error loading wellness messages:', error);
      setWellnessMessages([]);
    }
  };

  const loadMarketData = async () => {
    try {
      const snapshots: MarketSnapshot[] = [];

      for (const symbol of watchlist) {
        const { data: candles } = await supabase
          .from('forex_candles')
          .select('*')
          .eq('symbol', symbol)
          .eq('timeframe', '15m')
          .order('open_time', { ascending: false })
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
    const vwapResults = calculateVWAP(recentCandles.slice(-20), 20);
    const vwap = vwapResults.length > 0 ? vwapResults[vwapResults.length - 1].value : currentPrice;
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

  const getActionColor = (action: string) => {
    switch (action?.toUpperCase()) {
      case 'HOLD':
        return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
      case 'CLOSE':
      case 'EXIT_NOW':
        return 'text-red-400 bg-red-500/10 border-red-500/30';
      case 'CONSIDER_EXIT':
      case 'CONSIDER_CLOSING':
        return 'text-orange-400 bg-orange-500/10 border-orange-500/30';
      default:
        return 'text-gray-400 bg-gray-500/10 border-gray-500/30';
    }
  };

  const getActionIcon = (action: string) => {
    switch (action?.toUpperCase()) {
      case 'HOLD':
        return <Shield className="w-4 h-4" />;
      case 'CLOSE':
      case 'EXIT_NOW':
        return <AlertCircle className="w-4 h-4" />;
      case 'CONSIDER_EXIT':
      case 'CONSIDER_CLOSING':
        return <Clock className="w-4 h-4" />;
      default:
        return <Activity className="w-4 h-4" />;
    }
  };

  const formatTimeSince = (timestamp: string): string => {
    const now = new Date().getTime();
    const then = new Date(timestamp).getTime();
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins === 1) return '1m ago';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    return `${diffHours}h ago`;
  };


  if (loading) {
    return (
      <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg p-3 border border-gray-700">
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-700/30 rounded border border-gray-600/50">
          <Clock className="w-3 h-3 text-gray-500 animate-pulse" />
          <span className="text-xs text-gray-500">Loading market analysis...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg p-3 border border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {hasOpenTrades ? (
              <>
                <Brain className="w-4 h-4 text-purple-400 animate-pulse" />
                <h4 className="text-base font-bold text-white">Alpha Trade Monitor</h4>
              </>
            ) : hasActiveIntent ? (
              <>
                <Target className="w-4 h-4 text-orange-400 animate-pulse" />
                <h4 className="text-base font-bold text-white">Entry Monitor</h4>
              </>
            ) : (
              <>
                <Activity className="w-4 h-4 text-blue-400 animate-pulse" />
                <h4 className="text-base font-bold text-white">Live Market Analysis</h4>
              </>
            )}
          </div>
          {hasOpenTrades ? (
            <div className="flex items-center gap-2 px-2 py-1 bg-blue-500/20 rounded border border-blue-500/50">
              <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
              <span className="text-xs font-semibold text-blue-300">MONITORING</span>
            </div>
          ) : hasActiveIntent ? (
            <div className="flex items-center gap-2 px-2 py-1 bg-orange-500/20 rounded border border-orange-500/50">
              <div className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-pulse" />
              <span className="text-xs font-semibold text-orange-300">WAITING FOR ENTRY</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs">
              <Clock className="w-3 h-3 text-gray-400" />
              <span className="text-gray-400">Next:</span>
              <span className="text-blue-400 font-mono font-semibold">{countdown}</span>
            </div>
          )}
        </div>

        {/* Show wellness messages when trades are open */}
        {hasOpenTrades && wellnessMessages.length > 0 ? (
          <div className="space-y-2">
            {wellnessMessages.map((message) => {
              const action = message.metadata.action || 'HOLD';
              const confidence = message.metadata.confidence || 0;
              const pnl = message.metadata.current_pnl || 0;
              const riskRatio = message.metadata.risk_ratio || '0.0';
              const minutesInTrade = message.metadata.minutes_in_trade || 0;

              return (
                <div
                  key={message.id}
                  className={`rounded-lg p-3 border ${getActionColor(action)}`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {getActionIcon(action)}
                      <div>
                        <div className="text-sm font-bold">{message.symbol}</div>
                        <div className="text-xs opacity-70">Analysis from {formatTimeSince(message.created_at)}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className={`text-sm font-bold ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                        </div>
                        <div className="text-xs text-gray-400">
                          at analysis time
                        </div>
                      </div>
                      <div className="flex flex-col items-end">
                        <div className="text-sm font-bold">{action}</div>
                        <div className="text-xs opacity-70">{confidence}%</div>
                      </div>
                    </div>
                  </div>

                  <div className="text-sm leading-relaxed whitespace-pre-line text-gray-100">
                    {message.content}
                  </div>
                </div>
              );
            })}
          </div>
        ) : hasOpenTrades ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-700/30 rounded border border-gray-600/50">
            <Clock className="w-3 h-3 text-gray-500 animate-pulse" />
            <span className="text-xs text-gray-500">Waiting for wellness check...</span>
          </div>
        ) : hasActiveIntent ? (
          <div className="bg-orange-900/20 border border-orange-700/50 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <Target className="w-5 h-5 text-orange-400 mt-0.5 flex-shrink-0 animate-pulse" />
              <div className="flex-1">
                <div className="font-bold text-orange-300 mb-1">
                  Waiting for Entry Zone - {activeIntentSymbol}
                </div>
                <div className="text-sm text-gray-300">
                  Price must pull back to entry zone for optimal entry. Alpha is monitoring price movement and will execute automatically when conditions are met.
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {marketData.map((snapshot) => (
            <div
              key={snapshot.symbol}
              className="bg-gray-700/50 rounded-lg p-3 border border-gray-600 hover:border-gray-500 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="text-base font-bold text-white">{snapshot.symbol}</div>
                  {getTrendIcon(snapshot.trend)}
                  <div className="text-lg font-mono font-bold text-blue-400">
                    {snapshot.currentPrice.toFixed(5)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-xs text-gray-500">Setup</div>
                  <div className="text-sm font-bold text-white">{snapshot.setupConfidence}%</div>
                </div>
              </div>

              <div className="mb-2">
                <div className="w-full bg-gray-600 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full bg-gradient-to-r ${getConfidenceColor(snapshot.setupConfidence)} transition-all duration-500`}
                    style={{ width: `${snapshot.setupConfidence}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 text-xs">
                <div>
                  <div className="text-gray-500">Trend</div>
                  <div className="text-white font-medium capitalize">{snapshot.trend}</div>
                </div>
                <div>
                  <div className="text-gray-500">Vol</div>
                  <div className={`font-medium capitalize ${getVolatilityColor(snapshot.volatility)}`}>
                    {snapshot.volatility}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">VWAP</div>
                  <div className="text-white font-mono">
                    {snapshot.distanceFromVWAP > 0 ? '+' : ''}{snapshot.distanceFromVWAP.toFixed(2)}%
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">ATR</div>
                  <div className="text-white font-mono">
                    {snapshot.atr.value.toFixed(5)}
                  </div>
                </div>
              </div>

              {snapshot.waitingFor.length > 0 && snapshot.setupConfidence < 75 && (
                <div className="mt-2 bg-blue-900/20 border border-blue-700/50 rounded p-2">
                  <div className="flex items-start gap-1.5">
                    <AlertCircle className="w-3 h-3 text-blue-400 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <div className="text-xs font-medium text-blue-300 mb-0.5">
                        Waiting for setup
                      </div>
                      <div className="text-xs text-gray-400">
                        {snapshot.waitingFor.slice(0, 2).join(', ')}
                        {snapshot.waitingFor.length > 2 && ` +${snapshot.waitingFor.length - 2} more`}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {snapshot.setupConfidence >= 75 && (
                <div className="mt-2 bg-green-900/20 border border-green-700/50 rounded p-2">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle className="w-3 h-3 text-green-400" />
                    <div className="text-xs font-medium text-green-300">Setup Ready</div>
                  </div>
                </div>
              )}
            </div>
          ))}
          </div>
        )}

        {!hasOpenTrades && marketData.length === 0 && (
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-700/30 rounded border border-gray-600/50">
            <Clock className="w-3 h-3 text-gray-500 animate-pulse" />
            <span className="text-xs text-gray-500">Waiting for market data...</span>
          </div>
        )}
      </div>
    </div>
  );
};

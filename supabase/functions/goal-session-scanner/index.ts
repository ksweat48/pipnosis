import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ScanResult {
  symbol: string;
  hasValidSetup: boolean;
  setupType?: string;
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
  confidence?: number;
  reasoning?: string;
  ema20?: number;
  ema50?: number;
  vwap?: number;
  atr?: number;
  currentPrice?: number;
  trend?: string;
  volatility?: string;
  distanceFromVWAP?: number;
  direction?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const now = new Date().toISOString();

    const { data: activeSessions, error: sessionsError } = await supabase
      .from('goal_sessions')
      .select('*')
      .in('status', ['scanning', 'trade_pending', 'in_trade'])
      .lte('next_scan_time', now);

    if (sessionsError) {
      throw new Error(`Error fetching sessions: ${sessionsError.message}`);
    }

    if (!activeSessions || activeSessions.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No sessions due for scanning', scanned: 0 }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const results = [];

    for (const session of activeSessions) {
      try {
        const { data: expiredCheck } = await supabase
          .from('goal_sessions')
          .select('end_time')
          .eq('id', session.id)
          .single();

        if (expiredCheck && new Date(expiredCheck.end_time) < new Date()) {
          await supabase
            .from('goal_sessions')
            .update({ status: 'expired', updated_at: now })
            .eq('id', session.id);

          await supabase.from('goal_ai_conversations').insert({
            goal_session_id: session.id,
            user_id: session.user_id,
            role: 'ai',
            message: 'Session time expired. Generating final summary...',
            context: {},
            sentiment: 'neutral',
          });

          continue;
        }

        const scanResults = await scanSession(supabase, session);

        const lastScanTime = new Date();
        const nextScanTime = new Date(lastScanTime.getTime() + session.scan_interval_minutes * 60 * 1000);

        await supabase
          .from('goal_sessions')
          .update({
            last_scan_time: lastScanTime.toISOString(),
            next_scan_time: nextScanTime.toISOString(),
            updated_at: now,
          })
          .eq('id', session.id);

        results.push({
          sessionId: session.id,
          scanResults,
          nextScanTime: nextScanTime.toISOString(),
        });

      } catch (sessionError) {
        console.error(`Error scanning session ${session.id}:`, sessionError);
        results.push({
          sessionId: session.id,
          error: sessionError instanceof Error ? sessionError.message : 'Unknown error',
        });
      }
    }

    return new Response(
      JSON.stringify({
        message: 'Scan completed',
        scanned: activeSessions.length,
        results,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in goal-session-scanner:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

async function scanSession(supabase: any, session: any): Promise<ScanResult[]> {
  const watchlist = session.watchlist || ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD'];
  const results: ScanResult[] = [];

  console.log(`[Goal Scanner] 🔍 Analyzing ${watchlist.length} symbols for session ${session.id}`);

  for (const symbol of watchlist) {
    const { data: candles } = await supabase
      .from('forex_candles')
      .select('*')
      .eq('symbol', symbol)
      .eq('timeframe', '15m')
      .order('open_time', { ascending: false })
      .limit(100);

    if (!candles || candles.length < 50) {
      results.push({
        symbol,
        hasValidSetup: false,
        reasoning: 'Insufficient market data',
      });
      continue;
    }

    const setup = analyzeSetup(symbol, candles, session);
    results.push(setup);

    const technicalData = {
      ema20: setup.ema20,
      ema50: setup.ema50,
      vwap: setup.vwap,
      atr: setup.atr,
      currentPrice: setup.currentPrice,
    };

    const marketSnapshot = {
      trend: setup.trend,
      volatility: setup.volatility,
      confidence: setup.confidence,
      distanceFromVWAP: setup.distanceFromVWAP,
    };

    if (setup.hasValidSetup) {
      console.log(`[Goal Scanner] ✅ Valid setup found: ${setup.setupType} on ${symbol} (${setup.confidence}% confidence)`);

      const riskAmount = calculateRiskAmount(session);
      const stopDistance = Math.abs(setup.entry - setup.stopLoss);
      const positionSize = stopDistance > 0 ? riskAmount / stopDistance : 0.01;
      const riskReward = Math.abs(setup.takeProfit - setup.entry) / stopDistance;
      const expectedProfit = Math.abs((setup.takeProfit - setup.entry) * positionSize);

      const tradeResult = await supabase.from('goal_session_trades').insert({
        goal_session_id: session.id,
        symbol,
        direction: setup.direction || 'buy',
        entry_price: setup.entry,
        stop_loss: setup.stopLoss,
        take_profit: setup.takeProfit,
        position_size: positionSize,
        status: session.auto_execute ? 'open' : 'pending',
        opened_at: session.auto_execute ? new Date().toISOString() : null,
      }).select().single();

      const tradeMessage = session.auto_execute
        ? `Trade executed on ${symbol}! ${setup.direction?.toUpperCase()} at ${setup.entry.toFixed(5)}. ${setup.setupType} with ${setup.confidence}% confidence. Stop Loss: ${setup.stopLoss.toFixed(5)}, Take Profit: ${setup.takeProfit.toFixed(5)}. R:R = ${riskReward.toFixed(2)}`
        : `Trade signal detected on ${symbol}! ${setup.setupType} setup with ${setup.confidence}% confidence. ${setup.reasoning}. Awaiting your confirmation to execute.`;

      await supabase.from('goal_ai_conversations').insert({
        goal_session_id: session.id,
        user_id: session.user_id,
        role: 'ai',
        message: tradeMessage,
        context: { setup, trade: tradeResult.data },
        sentiment: 'encouraging',
        technical_data: technicalData,
        market_snapshot: marketSnapshot,
      });

      const notificationResult = await supabase.from('goal_notifications').insert({
        goal_session_id: session.id,
        user_id: session.user_id,
        notification_type: 'signal',
        priority: 'urgent',
        title: `${session.auto_execute ? 'Trade Executed' : 'Trade Signal'}: ${symbol}`,
        message: `${setup.setupType}: Entry ${setup.entry.toFixed(5)}, SL ${setup.stopLoss.toFixed(5)}, TP ${setup.takeProfit.toFixed(5)}`,
        data: { setup, trade: tradeResult.data, riskReward, expectedProfit },
        channels: ['in_app', 'email'],
      }).select().single();

      await supabase
        .from('goal_sessions')
        .update({ status: session.auto_execute ? 'in_trade' : 'trade_pending' })
        .eq('id', session.id);
    }
  }

  const validSetups = results.filter(r => r.hasValidSetup);
  const summaryMessage = validSetups.length > 0
    ? `Found ${validSetups.length} valid setup(s). ${session.auto_execute ? 'Trades executed.' : 'Review signals to proceed.'}`
    : 'No valid setups found. Continuing scheduled scans...';

  const overallMarketSnapshot = {
    totalSymbols: results.length,
    validSetups: validSetups.length,
    avgConfidence: results.reduce((sum, r) => sum + (r.confidence || 0), 0) / results.length,
    marketConditions: results.map(r => ({
      symbol: r.symbol,
      trend: r.trend,
      volatility: r.volatility,
    })),
  };

  await supabase.from('goal_ai_conversations').insert({
    goal_session_id: session.id,
    user_id: session.user_id,
    role: 'ai',
    message: summaryMessage,
    context: { scanResults: results },
    sentiment: 'neutral',
    market_snapshot: overallMarketSnapshot,
  });

  return results;
}

function analyzeSetup(symbol: string, candles: any[], session: any): ScanResult {
  const recentCandles = candles.slice(0, 50).reverse();
  const prices = recentCandles.map((c: any) => c.close);
  const currentPrice = prices[prices.length - 1];

  const ema20 = calculateEMA(prices, 20);
  const ema50 = calculateEMA(prices, 50);
  const vwap = calculateVWAP(recentCandles.slice(-20));
  const atr = calculateATR(recentCandles.slice(-14));

  const priceToVwap = ((currentPrice - vwap) / currentPrice) * 100;

  const trend = determineTrend(recentCandles);
  const volatility = determineVolatility(atr, currentPrice);

  let hasValidSetup = false;
  let setupType = '';
  let entry = currentPrice;
  let stopLoss = 0;
  let takeProfit = 0;
  let confidence = 0;
  let reasoning = '';
  let direction = 'buy';

  if (Math.abs(priceToVwap) < 0.1 && ema20 > ema50) {
    hasValidSetup = true;
    setupType = 'VWAP Bounce Long';
    direction = 'buy';
    entry = currentPrice;
    stopLoss = currentPrice - (atr * 1.5);
    takeProfit = currentPrice + (atr * 2.5);
    confidence = 75;
    reasoning = `Bullish setup on ${symbol}. Price at VWAP with EMA alignment. Entry: ${entry.toFixed(5)}, SL: ${stopLoss.toFixed(5)}, TP: ${takeProfit.toFixed(5)}`;
  } else if (Math.abs(priceToVwap) < 0.1 && ema20 < ema50) {
    hasValidSetup = true;
    setupType = 'VWAP Rejection Short';
    direction = 'sell';
    entry = currentPrice;
    stopLoss = currentPrice + (atr * 1.5);
    takeProfit = currentPrice - (atr * 2.5);
    confidence = 75;
    reasoning = `Bearish setup on ${symbol}. Price rejecting VWAP with EMA alignment. Entry: ${entry.toFixed(5)}, SL: ${stopLoss.toFixed(5)}, TP: ${takeProfit.toFixed(5)}`;
  }

  const riskThreshold = session.risk_mode === 'low' ? 80 : session.risk_mode === 'high' ? 60 : 70;
  if (hasValidSetup && confidence < riskThreshold) {
    hasValidSetup = false;
    reasoning = `Setup confidence below threshold for ${session.risk_mode} mode`;
  }

  return {
    symbol,
    hasValidSetup,
    setupType,
    entry,
    stopLoss,
    takeProfit,
    confidence,
    reasoning,
    ema20,
    ema50,
    vwap,
    atr,
    currentPrice,
    trend,
    volatility,
    distanceFromVWAP: priceToVwap,
    direction,
  };
}

function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;

  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;

  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }

  return ema;
}

function calculateVWAP(candles: any[]): number {
  let totalVolume = 0;
  let totalPV = 0;

  for (const candle of candles) {
    const typical = (candle.high + candle.low + candle.close) / 3;
    const volume = candle.volume || 1;
    totalPV += typical * volume;
    totalVolume += volume;
  }

  return totalVolume > 0 ? totalPV / totalVolume : 0;
}

function calculateATR(candles: any[], period: number = 14): number {
  if (candles.length < period) return 0.001;

  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trs.push(tr);
  }

  return trs.slice(-period).reduce((sum, tr) => sum + tr, 0) / period;
}

function determineTrend(candles: any[]): string {
  if (!candles || candles.length < 20) return 'sideways';
  const prices = candles.map((c: any) => c.close);
  const change = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
  if (change > 0.5) return 'bullish';
  if (change < -0.5) return 'bearish';
  return 'sideways';
}

function determineVolatility(atr: number, price: number): string {
  const atrPercent = (atr / price) * 100;
  if (atrPercent < 0.1) return 'low';
  if (atrPercent > 0.3) return 'high';
  return 'medium';
}

function calculateRiskAmount(session: any): number {
  const balance = session.starting_balance || 10000;
  const riskPercentages: Record<string, number> = {
    low: 0.01,
    medium: 0.02,
    high: 0.03,
  };
  const riskPercent = riskPercentages[session.risk_mode] || 0.02;
  return balance * riskPercent;
}
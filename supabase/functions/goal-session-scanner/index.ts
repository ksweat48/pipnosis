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

    // Only scan sessions actively looking for trades, NOT those with open positions
    // Sessions with status 'in_trade' use position monitoring instead to save credits
    const { data: activeSessions, error: sessionsError } = await supabase
      .from('goal_sessions')
      .select('*')
      .in('status', ['scanning', 'trade_pending'])
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
          const { data: openTrades } = await supabase
            .from('goal_session_trades')
            .select('id')
            .eq('goal_session_id', session.id)
            .eq('status', 'open');

          const tradesCount = openTrades?.length || 0;

          if (tradesCount > 0) {
            await supabase
              .from('goal_sessions')
              .update({
                status: 'soft_closing',
                timeframe_expired_at: now,
                trades_open_at_expiration: tradesCount,
                updated_at: now
              })
              .eq('id', session.id);

            await supabase.from('goal_ai_conversations').insert({
              goal_session_id: session.id,
              user_id: session.user_id,
              role: 'ai',
              message: `🏁 Session timeframe expired with ${tradesCount} trade${tradesCount > 1 ? 's' : ''} still open. No new trades will be opened. Monitoring active positions until they close naturally...`,
              context: { timeframe_expired: true, trades_open: tradesCount },
              sentiment: 'neutral',
            });

            console.log(`[Goal Scanner] Session ${session.id} moved to soft_closing (${tradesCount} trades open)`);
          } else {
            await supabase
              .from('goal_sessions')
              .update({ status: 'expired', updated_at: now })
              .eq('id', session.id);

            await supabase.from('goal_ai_conversations').insert({
              goal_session_id: session.id,
              user_id: session.user_id,
              role: 'ai',
              message: 'Session timeframe expired. All trades closed. Generating final summary...',
              context: { timeframe_expired: true, trades_open: 0 },
              sentiment: 'neutral',
            });

            console.log(`[Goal Scanner] Session ${session.id} expired (no open trades)`);
          }

          continue;
        }

        if (session.status === 'soft_closing') {
          const { data: openTrades } = await supabase
            .from('goal_session_trades')
            .select('id')
            .eq('goal_session_id', session.id)
            .eq('status', 'open');

          if (!openTrades || openTrades.length === 0) {
            const softCloseStart = session.timeframe_expired_at ? new Date(session.timeframe_expired_at) : null;
            const softCloseDuration = softCloseStart
              ? Math.floor((new Date().getTime() - softCloseStart.getTime()) / 60000)
              : 0;

            await supabase
              .from('goal_sessions')
              .update({
                status: 'expired',
                soft_close_duration_minutes: softCloseDuration,
                updated_at: now
              })
              .eq('id', session.id);

            await supabase.from('goal_ai_conversations').insert({
              goal_session_id: session.id,
              user_id: session.user_id,
              role: 'ai',
              message: `✅ All trades closed after timeframe expiration. Soft close took ${softCloseDuration} minutes. Generating final session summary...`,
              context: {
                soft_close_complete: true,
                soft_close_duration_minutes: softCloseDuration,
                trades_at_expiration: session.trades_open_at_expiration || 0
              },
              sentiment: 'neutral',
            });

            console.log(`[Goal Scanner] Session ${session.id} soft close complete (${softCloseDuration}m)`);
            continue;
          }

          console.log(`[Goal Scanner] Session ${session.id} still in soft_closing (${openTrades.length} trades open)`);
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

      const stopDistance = Math.abs(setup.entry - setup.stopLoss);
      const tpDistance = Math.abs(setup.takeProfit - setup.entry);

      // Use goal-aware position sizing
      const positionSize = calculateGoalAwarePositionSize(session, tpDistance, stopDistance);

      const riskReward = tpDistance / stopDistance;
      const expectedProfit = tpDistance * positionSize;
      const expectedLoss = stopDistance * positionSize;

      const tradeResult = await supabase.from('goal_session_trades').insert({
        goal_session_id: session.id,
        symbol,
        direction: setup.direction || 'buy',
        entry_price: setup.entry,
        stop_loss: setup.stopLoss,
        take_profit: setup.takeProfit,
        position_size: positionSize,
        expected_profit_at_entry: expectedProfit,
        status: session.auto_execute ? 'open' : 'pending',
        opened_at: session.auto_execute ? new Date().toISOString() : null,
      }).select().single();

      // Create journal entry for this trade
      if (tradeResult.data && session.auto_execute) {
        try {
          await supabase.from('ai_trade_journal').insert({
            user_id: session.user_id,
            trade_id: tradeResult.data.id,
            session_id: session.id,
            symbol,
            direction: setup.direction || 'buy',
            entry_time: new Date().toISOString(),
            entry_price: setup.entry,
            stop_loss: setup.stopLoss,
            take_profit: setup.takeProfit,
            llm_reasoning: `I took this trade because I identified a ${setup.setupType} pattern on ${symbol}. ${setup.reasoning}`,
            market_read: `Market analysis: ${setup.trend} trend with ${setup.volatility} volatility. Current price is ${setup.currentPrice.toFixed(5)}, EMA20: ${setup.ema20?.toFixed(5)}, EMA50: ${setup.ema50?.toFixed(5)}, VWAP: ${setup.vwap?.toFixed(5)}. Distance from VWAP: ${(setup.distanceFromVWAP * 100).toFixed(2)}%.`,
            expected_outcome: `I expect ${symbol} to move ${setup.direction === 'buy' ? 'upward' : 'downward'} to hit my take profit at ${setup.takeProfit.toFixed(5)}. Risk/Reward ratio is ${riskReward.toFixed(2)}:1. Expected profit: $${expectedProfit.toFixed(2)} if TP hit, expected loss: $${expectedLoss.toFixed(2)} if SL hit.`,
            pattern_identified: setup.setupType,
            conviction_level: setup.confidence || 70,
            rank_at_time: 'AI Goal Scanner',
            outcome: 'open',
            journal_entry_type: 'trade'
          });
          console.log(`[Goal Scanner] ✅ Journal entry created for trade ${tradeResult.data.id}`);
        } catch (journalError) {
          console.error('[Goal Scanner] Failed to create journal entry:', journalError);
        }
      }

      const tradeMessage = session.auto_execute
        ? `Trade executed on ${symbol}! ${setup.direction?.toUpperCase()} at ${setup.entry.toFixed(5)}. ${setup.setupType} with ${setup.confidence}% confidence. Stop Loss: ${setup.stopLoss.toFixed(5)}, Take Profit: ${setup.takeProfit.toFixed(5)}. R:R = ${riskReward.toFixed(2)}. Expected profit: $${expectedProfit.toFixed(2)} (targeting your $${session.target_value} goal).`
        : `Trade signal detected on ${symbol}! ${setup.setupType} setup with ${setup.confidence}% confidence. ${setup.reasoning}. Expected profit if TP hit: $${expectedProfit.toFixed(2)} (your goal: $${session.target_value}). Awaiting your confirmation to execute.`;

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
        type: 'signal',
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

/**
 * Calculate position size that is goal-aware
 * Primary consideration: Goal amount (not just account risk)
 * This prevents oversized positions that could turn $200 goals into $5000 profits
 */
function calculateGoalAwarePositionSize(
  session: any,
  tpDistance: number,
  slDistance: number
): number {
  const balance = session.starting_balance || 10000;
  const goalAmount = session.target_value || 200;

  // STEP 1: Calculate position size based on goal amount
  // We want TP profit to be approximately 1.15x the goal (15% buffer for spread/slippage)
  const idealTPProfit = goalAmount * 1.15;
  const goalBasedPosition = tpDistance > 0 ? idealTPProfit / tpDistance : 0.01;

  // STEP 2: Calculate max position size based on account risk
  const riskPercentages: Record<string, number> = {
    low: 0.01,
    medium: 0.02,
    high: 0.03,
  };
  const riskPercent = riskPercentages[session.risk_mode] || 0.02;
  const maxRiskAmount = balance * riskPercent;
  const riskBasedPosition = slDistance > 0 ? maxRiskAmount / slDistance : 0.01;

  // STEP 3: Use the SMALLER of the two (more conservative)
  const finalPosition = Math.min(goalBasedPosition, riskBasedPosition);

  // STEP 4: Safety cap - prevent position from being too small
  const minPosition = 0.01;
  const cappedPosition = Math.max(finalPosition, minPosition);

  // Log the calculation for transparency
  const expectedTPProfit = tpDistance * cappedPosition;
  const expectedSLLoss = slDistance * cappedPosition;

  console.log(`[Position Sizing] Goal: $${goalAmount}, Balance: $${balance}`);
  console.log(`[Position Sizing] Goal-based: ${goalBasedPosition.toFixed(2)}, Risk-based: ${riskBasedPosition.toFixed(2)}`);
  console.log(`[Position Sizing] Final: ${cappedPosition.toFixed(2)} (Expected TP: $${expectedTPProfit.toFixed(2)}, Expected SL: $${expectedSLLoss.toFixed(2)})`);

  return cappedPosition;
}
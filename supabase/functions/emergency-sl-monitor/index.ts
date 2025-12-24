import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

/**
 * EMERGENCY STOP LOSS MONITOR
 *
 * Critical server-side monitoring that runs independently of client browsers.
 * This ensures stop losses NEVER get ignored, even if:
 * - User closes browser
 * - Network connection fails
 * - Client-side monitor crashes
 * - Price data is stale in realtime_prices table
 *
 * Runs every 60 seconds via cron job (optimized from 30s due to database trigger providing instant coverage)
 */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    console.log('[Emergency SL Monitor] Starting critical position check...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get all open positions
    const { data: openPositions, error: positionsError } = await supabase
      .from('goal_session_trades')
      .select('*')
      .eq('status', 'open')
      .not('stop_loss', 'is', null)
      .not('take_profit', 'is', null);

    if (positionsError) {
      throw new Error(`Failed to fetch open positions: ${positionsError.message}`);
    }

    if (!openPositions || openPositions.length === 0) {
      console.log('[Emergency SL Monitor] No open positions to monitor');
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No open positions',
          checked: 0,
          closed: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Emergency SL Monitor] Monitoring ${openPositions.length} open position(s)`);

    const closedPositions = [];
    const errors = [];

    for (const position of openPositions) {
      try {
        // Get current price from MULTIPLE sources with fallbacks
        let currentPrice: number | null = null;
        let priceSource = '';

        // SOURCE 1: realtime_prices table (most recent)
        const { data: realtimePrice } = await supabase
          .from('realtime_prices')
          .select('bid, ask, created_at')
          .eq('symbol', position.symbol)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (realtimePrice) {
          const ageMinutes = (Date.now() - new Date(realtimePrice.created_at).getTime()) / 1000 / 60;

          // Only use if less than 5 minutes old
          if (ageMinutes < 5) {
            const bid = parseFloat(realtimePrice.bid);
            const ask = parseFloat(realtimePrice.ask);
            currentPrice = position.direction === 'buy' ? bid : ask;
            priceSource = 'realtime_prices';
            console.log(`[Emergency SL Monitor] ${position.symbol}: Got price from realtime_prices (${ageMinutes.toFixed(1)}m old)`);
          } else {
            console.warn(`[Emergency SL Monitor] ${position.symbol}: realtime_prices data is stale (${ageMinutes.toFixed(1)}m old)`);
          }
        }

        // SOURCE 2: forex_candles table (last 5m candle)
        if (!currentPrice) {
          const { data: recentCandle } = await supabase
            .from('forex_candles')
            .select('close, high, low, timestamp')
            .eq('symbol', position.symbol)
            .eq('timeframe', '5m')
            .order('timestamp', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (recentCandle) {
            currentPrice = parseFloat(recentCandle.close);
            priceSource = 'forex_candles';
            console.log(`[Emergency SL Monitor] ${position.symbol}: Got price from forex_candles`);
          }
        }

        // SOURCE 3: Use position's last known current_price (absolute fallback)
        if (!currentPrice && position.current_price) {
          currentPrice = position.current_price;
          priceSource = 'position_cache';
          console.warn(`[Emergency SL Monitor] ${position.symbol}: Using cached price from position (may be stale)`);
        }

        if (!currentPrice) {
          console.error(`[Emergency SL Monitor] ${position.symbol}: NO PRICE DATA AVAILABLE FROM ANY SOURCE!`);
          errors.push({
            position_id: position.id,
            symbol: position.symbol,
            error: 'No price data available'
          });
          continue;
        }

        // CRITICAL: Check if SL or TP should trigger
        const shouldCloseAtSL = position.direction === 'buy'
          ? currentPrice <= position.stop_loss
          : currentPrice >= position.stop_loss;

        const shouldCloseAtTP = position.direction === 'buy'
          ? currentPrice >= position.take_profit
          : currentPrice <= position.take_profit;

        if (shouldCloseAtSL) {
          console.log(`[Emergency SL Monitor] 🚨 STOP LOSS BREACH: ${position.symbol}`);
          console.log(`  Direction: ${position.direction.toUpperCase()}`);
          console.log(`  Entry: ${position.entry_price}`);
          console.log(`  SL: ${position.stop_loss}`);
          console.log(`  Current: ${currentPrice} (from ${priceSource})`);
          console.log(`  Breach: ${position.direction === 'buy' ? 'Price <= SL' : 'Price >= SL'}`);

          // Close at stop loss price
          const { data: closedTrade, error: closeError } = await supabase
            .rpc('close_goal_session_trade', {
              p_trade_id: position.id,
              p_close_price: position.stop_loss, // Close at SL price for accurate P&L
              p_close_reason: 'stop_loss',
              p_goal_session_id: position.goal_session_id
            });

          if (closeError) {
            console.error(`[Emergency SL Monitor] Failed to close position ${position.id}:`, closeError);
            errors.push({
              position_id: position.id,
              symbol: position.symbol,
              error: closeError.message
            });
          } else {
            console.log(`[Emergency SL Monitor] ✅ Position closed at SL: ${position.symbol}`);
            closedPositions.push({
              position_id: position.id,
              symbol: position.symbol,
              direction: position.direction,
              entry_price: position.entry_price,
              close_price: position.stop_loss,
              close_reason: 'stop_loss',
              price_source: priceSource
            });

            // Send emergency notification
            await supabase.from('goal_notifications').insert({
              goal_session_id: position.goal_session_id,
              user_id: position.user_id,
              type: 'trade_closed',
              priority: 'urgent',
              title: '⚠️ Stop Loss Hit (Server Monitor)',
              message: `Emergency monitor closed ${position.symbol} at stop loss. Price: ${position.stop_loss.toFixed(5)}`,
              metadata: {
                trade_id: position.id,
                symbol: position.symbol,
                close_price: position.stop_loss,
                current_price: currentPrice,
                price_source: priceSource,
                closed_by: 'emergency_sl_monitor'
              },
              channels: ['in_app', 'push']
            });
          }

        } else if (shouldCloseAtTP) {
          console.log(`[Emergency SL Monitor] 🎯 TAKE PROFIT HIT: ${position.symbol}`);
          console.log(`  Direction: ${position.direction.toUpperCase()}`);
          console.log(`  Entry: ${position.entry_price}`);
          console.log(`  TP: ${position.take_profit}`);
          console.log(`  Current: ${currentPrice} (from ${priceSource})`);

          // Close at take profit price
          const { data: closedTrade, error: closeError } = await supabase
            .rpc('close_goal_session_trade', {
              p_trade_id: position.id,
              p_close_price: position.take_profit, // Close at TP price for accurate P&L
              p_close_reason: 'take_profit',
              p_goal_session_id: position.goal_session_id
            });

          if (closeError) {
            console.error(`[Emergency SL Monitor] Failed to close position ${position.id}:`, closeError);
            errors.push({
              position_id: position.id,
              symbol: position.symbol,
              error: closeError.message
            });
          } else {
            console.log(`[Emergency SL Monitor] ✅ Position closed at TP: ${position.symbol}`);
            closedPositions.push({
              position_id: position.id,
              symbol: position.symbol,
              direction: position.direction,
              entry_price: position.entry_price,
              close_price: position.take_profit,
              close_reason: 'take_profit',
              price_source: priceSource
            });

            // Send success notification
            await supabase.from('goal_notifications').insert({
              goal_session_id: position.goal_session_id,
              user_id: position.user_id,
              type: 'trade_closed',
              priority: 'high',
              title: '✅ Take Profit Hit (Server Monitor)',
              message: `Emergency monitor closed ${position.symbol} at take profit. Price: ${position.take_profit.toFixed(5)}`,
              metadata: {
                trade_id: position.id,
                symbol: position.symbol,
                close_price: position.take_profit,
                current_price: currentPrice,
                price_source: priceSource,
                closed_by: 'emergency_sl_monitor'
              },
              channels: ['in_app', 'push']
            });
          }
        } else {
          // Position still valid, no action needed
          const slDistance = Math.abs(currentPrice - position.stop_loss);
          const tpDistance = Math.abs(currentPrice - position.take_profit);
          console.log(`[Emergency SL Monitor] ${position.symbol}: OK (SL: ${slDistance.toFixed(5)} away, TP: ${tpDistance.toFixed(5)} away)`);
        }

      } catch (error) {
        console.error(`[Emergency SL Monitor] Error checking position ${position.id}:`, error);
        errors.push({
          position_id: position.id,
          symbol: position.symbol,
          error: error.message
        });
      }
    }

    const summary = {
      success: true,
      timestamp: new Date().toISOString(),
      checked: openPositions.length,
      closed: closedPositions.length,
      errors: errors.length,
      closedPositions,
      errors: errors.length > 0 ? errors : undefined
    };

    console.log(`[Emergency SL Monitor] Complete: ${closedPositions.length} closed, ${errors.length} errors`);

    return new Response(
      JSON.stringify(summary),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Emergency SL Monitor] Fatal error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
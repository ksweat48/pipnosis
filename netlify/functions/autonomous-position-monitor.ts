/**
 * Autonomous Position Monitor - CRITICAL CAPITAL PROTECTION
 *
 * SSOT Authority for Position SL/TP/TP1/TP2 Monitoring
 *
 * Runs every 5 seconds via Netlify scheduled function.
 * Monitors ALL open positions across ALL users for SL/TP hits.
 * Operates independently of browser - positions close even if browser is offline.
 *
 * CRITICAL: This is the PRIMARY position monitoring system.
 * Browser-based monitoring is view-only and secondary.
 *
 * Architecture:
 * 1. Fetch all open positions from database
 * 2. Get current price for each symbol (via price-coordinator SSOT)
 * 3. Check if SL/TP/TP1/TP2 has been hit
 * 4. Delegate closure to trade-closure-coordinator (SSOT)
 * 5. Log all checks to position_monitoring_logs
 *
 * Response Time: Sub-10-second from SL/TP hit to closure execution
 */

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const MAX_EXECUTION_TIME_MS = 9000; // Must complete within 9s

interface OpenPosition {
  id: string;
  user_id: string;
  goal_session_id: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  tp1_price: number | null;
  tp2_price: number | null;
  tp1_hit: boolean;
  tp2_hit: boolean;
  position_size: number;
  status: string;
  created_at: string;
}

interface PriceData {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  created_at: string;
}

interface MonitoringResult {
  positionId: string;
  symbol: string;
  checkType: 'sl' | 'tp' | 'tp1' | 'tp2';
  triggered: boolean;
  currentPrice: number;
  triggerPrice: number;
  action?: 'close_full' | 'close_partial_50';
}

/**
 * Get current price for a symbol from realtime_prices table
 * Uses most recent price within last 2 minutes
 */
async function getCurrentPrice(symbol: string): Promise<PriceData | null> {
  try {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('realtime_prices')
      .select('symbol, bid, ask, mid, created_at')
      .eq('symbol', symbol)
      .gte('created_at', twoMinutesAgo)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      console.error(`[AutonomousMonitor] No recent price for ${symbol}`);
      return null;
    }

    return data as PriceData;
  } catch (error) {
    console.error(`[AutonomousMonitor] Error fetching price for ${symbol}:`, error);
    return null;
  }
}

/**
 * Check if SL/TP/TP1/TP2 has been hit for a position
 */
function checkPositionTriggers(position: OpenPosition, price: PriceData): MonitoringResult[] {
  const results: MonitoringResult[] = [];
  const executionPrice = position.direction === 'buy' ? price.bid : price.ask;

  // Check TP1 (partial close 50%)
  if (position.tp1_price && !position.tp1_hit) {
    const tp1Hit = position.direction === 'buy'
      ? executionPrice >= position.tp1_price
      : executionPrice <= position.tp1_price;

    if (tp1Hit) {
      results.push({
        positionId: position.id,
        symbol: position.symbol,
        checkType: 'tp1',
        triggered: true,
        currentPrice: executionPrice,
        triggerPrice: position.tp1_price,
        action: 'close_partial_50'
      });
    }
  }

  // Check TP2 (if TP1 already hit)
  if (position.tp2_price && position.tp1_hit && !position.tp2_hit) {
    const tp2Hit = position.direction === 'buy'
      ? executionPrice >= position.tp2_price
      : executionPrice <= position.tp2_price;

    if (tp2Hit) {
      results.push({
        positionId: position.id,
        symbol: position.symbol,
        checkType: 'tp2',
        triggered: true,
        currentPrice: executionPrice,
        triggerPrice: position.tp2_price,
        action: 'close_full'
      });
    }
  }

  // Check main TP (full close)
  const tpHit = position.direction === 'buy'
    ? executionPrice >= position.take_profit
    : executionPrice <= position.take_profit;

  if (tpHit) {
    results.push({
      positionId: position.id,
      symbol: position.symbol,
      checkType: 'tp',
      triggered: true,
      currentPrice: executionPrice,
      triggerPrice: position.take_profit,
      action: 'close_full'
    });
  }

  // Check SL (full close) - HIGHEST PRIORITY
  const slHit = position.direction === 'buy'
    ? executionPrice <= position.stop_loss
    : executionPrice >= position.stop_loss;

  if (slHit) {
    results.push({
      positionId: position.id,
      symbol: position.symbol,
      checkType: 'sl',
      triggered: true,
      currentPrice: executionPrice,
      triggerPrice: position.stop_loss,
      action: 'close_full'
    });
  }

  return results;
}

/**
 * Execute position closure via database function
 * Delegates to close_goal_session_trade (SSOT)
 */
async function executePositionClosure(
  result: MonitoringResult,
  position: OpenPosition
): Promise<boolean> {
  try {
    if (result.action === 'close_partial_50') {
      // TP1 hit - Mark milestone flag ONLY (no position_size change)
      // ✅ SSOT COMPLIANCE: Use mark_tp1_milestone RPC for all TP1 updates
      // Position continues to TP2 for full closure
      console.log(`[AutonomousMonitor] TP1 HIT for ${position.symbol}: Marking milestone (no partial close)`);

      const { data: result, error: updateError } = await supabase
        .rpc('mark_tp1_milestone', { trade_id: position.id });

      if (updateError || !result?.success) {
        console.error(`[AutonomousMonitor] Failed to mark TP1 for ${position.id}:`, updateError || result?.error);
        return false;
      }

      console.log(`[AutonomousMonitor] ✅ TP1 milestone marked via RPC: Position ${position.id} continues to TP2`);
      return true;

    } else {
      // SL/TP/TP2 hit - full close
      // Map to valid close_reason values per database constraint
      const closeReason = result.checkType === 'sl' ? 'stop_loss'
        : result.checkType === 'tp2' ? 'take_profit_2'
        : 'take_profit';

      console.log(`[AutonomousMonitor] ${result.checkType.toUpperCase()} HIT for ${position.symbol}: Executing full close`);

      // Use SSOT close_goal_session_trade function
      const { data, error } = await supabase.rpc('close_goal_session_trade', {
        p_trade_id: position.id,
        p_close_price: result.currentPrice,
        p_close_reason: closeReason,
        p_goal_session_id: position.goal_session_id,
        p_force_close: false
      });

      if (error) {
        console.error(`[AutonomousMonitor] Failed to close position ${position.id}:`, error);
        return false;
      }

      console.log(`[AutonomousMonitor] ✅ Position closed: ${position.id} at ${result.currentPrice}`);
      return true;
    }
  } catch (error) {
    console.error(`[AutonomousMonitor] Exception executing closure for ${position.id}:`, error);
    return false;
  }
}

/**
 * Log monitoring check to database
 */
async function logMonitoringCheck(
  executionId: string,
  position: OpenPosition,
  price: PriceData | null,
  results: MonitoringResult[],
  closureExecuted: boolean
): Promise<void> {
  try {
    await supabase.from('position_monitoring_logs').insert({
      execution_id: executionId,
      position_id: position.id,
      user_id: position.user_id,
      symbol: position.symbol,
      current_price: price?.mid,
      price_age_seconds: price ? Math.floor((Date.now() - new Date(price.created_at).getTime()) / 1000) : null,
      sl_checked: true,
      sl_triggered: results.some(r => r.checkType === 'sl'),
      tp_triggered: results.some(r => r.checkType === 'tp'),
      tp1_triggered: results.some(r => r.checkType === 'tp1'),
      tp2_triggered: results.some(r => r.checkType === 'tp2'),
      action_taken: closureExecuted,
      created_at: new Date().toISOString()
    });
  } catch (error) {
    console.error(`[AutonomousMonitor] Failed to log monitoring check:`, error);
  }
}

export const handler: Handler = async (event, context) => {
  const executionId = `pos_monitor_${Date.now()}`;
  const startTime = Date.now();

  console.log(`[AutonomousMonitor:${executionId}] Starting position monitoring...`);

  try {
    // Fetch ALL open positions across ALL users
    const { data: positions, error: fetchError } = await supabase
      .from('goal_session_trades')
      .select('*')
      .eq('status', 'open')
      .not('entry_price', 'is', null)
      .order('created_at', { ascending: true });

    if (fetchError) {
      console.error(`[AutonomousMonitor:${executionId}] Failed to fetch positions:`, fetchError);
      return {
        statusCode: 500,
        body: JSON.stringify({
          success: false,
          error: 'Failed to fetch positions',
          executionId
        })
      };
    }

    if (!positions || positions.length === 0) {
      console.log(`[AutonomousMonitor:${executionId}] No open positions to monitor`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'No open positions',
          executionId,
          positionsMonitored: 0,
          triggersDetected: 0,
          closuresExecuted: 0
        })
      };
    }

    console.log(`[AutonomousMonitor:${executionId}] Monitoring ${positions.length} open positions`);

    let triggersDetected = 0;
    let closuresExecuted = 0;
    const symbolsMonitored = new Set<string>();

    // Group positions by symbol to batch price fetches
    const positionsBySymbol = new Map<string, OpenPosition[]>();
    for (const position of positions) {
      if (!positionsBySymbol.has(position.symbol)) {
        positionsBySymbol.set(position.symbol, []);
      }
      positionsBySymbol.get(position.symbol)!.push(position);
    }

    // Process each symbol's positions
    for (const [symbol, symbolPositions] of positionsBySymbol) {
      // Check if approaching timeout
      if (Date.now() - startTime > MAX_EXECUTION_TIME_MS) {
        console.warn(`[AutonomousMonitor:${executionId}] ⏱️ Approaching timeout, stopping early`);
        break;
      }

      symbolsMonitored.add(symbol);

      // Get current price for this symbol
      const price = await getCurrentPrice(symbol);
      if (!price) {
        console.warn(`[AutonomousMonitor:${executionId}] Skipping ${symbol}: No price data`);
        continue;
      }

      // Check each position for this symbol
      for (const position of symbolPositions) {
        const results = checkPositionTriggers(position, price);

        if (results.length > 0) {
          triggersDetected += results.length;

          // Execute closures (SL has priority)
          const slTrigger = results.find(r => r.checkType === 'sl');
          const triggerToExecute = slTrigger || results[0];

          const executed = await executePositionClosure(triggerToExecute, position);
          if (executed) {
            closuresExecuted++;
          }

          // Log monitoring check
          await logMonitoringCheck(executionId, position, price, results, executed);
        } else {
          // Log normal check (no trigger)
          await logMonitoringCheck(executionId, position, price, [], false);
        }
      }
    }

    const duration = Date.now() - startTime;

    console.log(`[AutonomousMonitor:${executionId}] ✅ Completed in ${duration}ms`);
    console.log(`[AutonomousMonitor:${executionId}] Positions: ${positions.length}, Triggers: ${triggersDetected}, Closures: ${closuresExecuted}`);
    console.log(`[AutonomousMonitor:${executionId}] Symbols monitored: ${Array.from(symbolsMonitored).join(', ')}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        executionId,
        positionsMonitored: positions.length,
        symbolsMonitored: symbolsMonitored.size,
        triggersDetected,
        closuresExecuted,
        durationMs: duration,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error(`[AutonomousMonitor:${executionId}] ❌ Critical error:`, error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        executionId,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      })
    };
  }
};

/**
 * Autonomous Position Monitor - CRITICAL CAPITAL PROTECTION
 *
 * SSOT Authority for Position SL/TP/TP1/TP2 Monitoring + Market-Close Enforcement
 *
 * Runs every 5 seconds via Netlify scheduled function.
 * Monitors ALL open positions across ALL users for SL/TP hits.
 * Operates independently of browser - positions close even if browser is offline.
 *
 * CRITICAL: This is the PRIMARY position monitoring system.
 * Browser-based monitoring is view-only and secondary.
 *
 * Architecture:
 * 1. Check if forex market is closed (via market-hours-checker SSOT)
 * 2. If closed + 5min grace period elapsed: auto-close all non-crypto positions
 * 3. Fetch all open positions from database
 * 4. Get current price for each symbol (via price-coordinator SSOT)
 * 5. Check if SL/TP/TP1/TP2 has been hit
 * 6. Delegate closure to trade-closure-coordinator (SSOT)
 * 7. Log all checks to position_monitoring_logs
 *
 * Market-Close Protocol (CCIP Governance):
 * - 5-minute grace period after market close for final price settlement
 * - Non-crypto positions auto-closed with close_reason='market_closed'
 * - Crypto (24/7) positions continue normal SL/TP monitoring
 * - Uses last known price from realtime_prices as exit price
 *
 * Response Time: Sub-10-second from SL/TP hit to closure execution
 */

import type { Handler } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase-admin';
import { isForexMarketOpen } from './_shared/market-hours-checker';
import { isCryptoSymbol } from './_shared/crypto-symbol-checker';

const supabase = getSupabaseAdmin();

const MARKET_CLOSE_GRACE_PERIOD_MS = 5 * 60 * 1000;

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

  // Check TP1 (advisory milestone only - NO partial close)
  // TP1 is now used ONLY for Alpha learning and progress tracking
  // Position stays 100% open and continues to TP2
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
        action: 'mark_milestone_only' // Changed from 'close_partial_50' to advisory-only
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
  position: OpenPosition,
  price: PriceData
): Promise<boolean> {
  try {
    if (result.action === 'mark_milestone_only') {
      // TP1 hit - Advisory milestone ONLY (no position close, no position_size change)
      // ✅ SSOT COMPLIANCE: Use mark_tp1_milestone RPC for all TP1 updates
      // Position continues 100% open to TP2 for full closure
      // Data logged for Alpha learning only
      console.log(`[AutonomousMonitor] TP1 ADVISORY MILESTONE for ${position.symbol}: Logging for Alpha learning (position stays 100% open)`);

      const { data: rpcResult, error: updateError } = await supabase
        .rpc('mark_tp1_milestone', { trade_id: position.id });

      if (updateError || !rpcResult?.success) {
        console.error(`[AutonomousMonitor] Failed to mark TP1 milestone for ${position.id}:`, updateError || rpcResult?.error);
        return false;
      }

      console.log(`[AutonomousMonitor] ✅ TP1 advisory milestone logged: Position ${position.id} continues 100% open to TP2`);
      return true;

    } else {
      // SL/TP/TP2 hit - full close
      // Map to valid close_reason values per database constraint
      const closeReason = result.checkType === 'sl' ? 'stop_loss'
        : result.checkType === 'tp2' ? 'take_profit_2'
        : 'take_profit';

      console.log(`[AutonomousMonitor] ${result.checkType.toUpperCase()} HIT for ${position.symbol}: Executing full close`);

      const { data, error } = await supabase.rpc('close_goal_session_trade', {
        p_trade_id: position.id,
        p_close_price: result.currentPrice,
        p_close_reason: closeReason,
        p_goal_session_id: position.goal_session_id,
        p_closed_at: price.created_at
      });

      if (error) {
        console.error(`[AutonomousMonitor] RPC error closing position ${position.id}:`, error);
        return false;
      }

      if (!data || !data.id) {
        console.error(`[AutonomousMonitor] RPC returned invalid result for ${position.id}:`, JSON.stringify(data));
        return false;
      }

      console.log(`[AutonomousMonitor] Position closed: ${position.id} at ${result.currentPrice}, PnL: ${data.profit_loss}`);

      // GOVERNANCE (2026-02-18): After any trade closes, check if session should stop.
      // No auto-scanning is allowed after trade closure. User must start new session.
      const { count: remainingOpenTrades } = await supabase
        .from('goal_session_trades')
        .select('id', { count: 'exact', head: true })
        .eq('goal_session_id', position.goal_session_id)
        .eq('status', 'open');

      if (!remainingOpenTrades || remainingOpenTrades === 0) {
        console.log(`[AutonomousMonitor] GOVERNANCE: No remaining open trades - stopping session ${position.goal_session_id}`);
        await supabase
          .from('goal_sessions')
          .update({ status: 'user_stopped', completed_at: new Date().toISOString() })
          .eq('id', position.goal_session_id)
          .in('status', ['scanning', 'active', 'initializing', 'in_trade', 'trade_pending', 'soft_closing']);
      }

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

/**
 * Auto-close non-crypto positions when forex market is closed.
 * Uses 5-minute grace period after market close for price settlement.
 * Returns count of positions closed.
 */
async function enforceMarketCloseClosure(
  executionId: string,
  positions: OpenPosition[]
): Promise<{ marketClosuresExecuted: number; nonCryptoOpen: number }> {
  const nonCryptoPositions = positions.filter(p => !isCryptoSymbol(p.symbol));

  if (nonCryptoPositions.length === 0) {
    return { marketClosuresExecuted: 0, nonCryptoOpen: 0 };
  }

  console.log(`[AutonomousMonitor:${executionId}] MARKET CLOSED: Found ${nonCryptoPositions.length} non-crypto position(s) to auto-close`);

  let closed = 0;

  for (const position of nonCryptoPositions) {
    try {
      const price = await getLastKnownPrice(position.symbol);
      if (!price) {
        console.error(`[AutonomousMonitor:${executionId}] No price for ${position.symbol} - cannot market-close position ${position.id}`);
        continue;
      }

      const executionPrice = position.direction === 'buy' ? price.bid : price.ask;

      console.log(`[AutonomousMonitor:${executionId}] Market-close: ${position.symbol} ${position.direction} @ ${executionPrice} (position ${position.id})`);

      const { data, error } = await supabase.rpc('close_goal_session_trade', {
        p_trade_id: position.id,
        p_close_price: executionPrice,
        p_close_reason: 'market_closed',
        p_goal_session_id: position.goal_session_id,
        p_force_close: true
      });

      if (error) {
        console.error(`[AutonomousMonitor:${executionId}] RPC error market-closing ${position.id}:`, error);
        continue;
      }

      if (!data || !data.id) {
        console.error(`[AutonomousMonitor:${executionId}] RPC invalid result for market-close ${position.id}:`, JSON.stringify(data));
        continue;
      }

      console.log(`[AutonomousMonitor:${executionId}] Market-closed: ${position.symbol} PnL: ${data.profit_loss}`);
      closed++;

      // GOVERNANCE (2026-02-18): Stop session after market-close trade closure
      const { count: remainingOpen } = await supabase
        .from('goal_session_trades')
        .select('id', { count: 'exact', head: true })
        .eq('goal_session_id', position.goal_session_id)
        .eq('status', 'open');

      if (!remainingOpen || remainingOpen === 0) {
        console.log(`[AutonomousMonitor:${executionId}] GOVERNANCE: Stopping session ${position.goal_session_id} after market-close`);
        await supabase
          .from('goal_sessions')
          .update({ status: 'user_stopped', completed_at: new Date().toISOString() })
          .eq('id', position.goal_session_id)
          .in('status', ['scanning', 'active', 'initializing', 'in_trade', 'trade_pending', 'soft_closing']);
      }

      await logMonitoringCheck(executionId, position, price, [], true);
    } catch (err) {
      console.error(`[AutonomousMonitor:${executionId}] Exception market-closing ${position.id}:`, err);
    }
  }

  return { marketClosuresExecuted: closed, nonCryptoOpen: nonCryptoPositions.length };
}

/**
 * Get last known price for a symbol (relaxed staleness for market-close scenarios).
 * During market close, prices may be up to 30 minutes old (last traded price).
 */
async function getLastKnownPrice(symbol: string): Promise<PriceData | null> {
  try {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('realtime_prices')
      .select('symbol, bid, ask, mid, created_at')
      .eq('symbol', symbol)
      .gte('created_at', thirtyMinutesAgo)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      console.warn(`[AutonomousMonitor] No recent price for ${symbol} within 30min window`);
      return null;
    }

    return data as PriceData;
  } catch (error) {
    console.error(`[AutonomousMonitor] Error fetching last known price for ${symbol}:`, error);
    return null;
  }
}

/**
 * Check if we are past the 5-minute grace period after market close.
 * Returns true if market is closed AND at least 5 minutes have elapsed since close.
 */
function isPastMarketCloseGracePeriod(): boolean {
  const now = new Date();
  const estString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const estTime = new Date(estString);
  const dayOfWeek = estTime.getDay();
  const hours = estTime.getHours();
  const minutes = estTime.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  const fridayCloseMinutes = 17 * 60;
  const gracePeriodMinutes = 5;

  if (dayOfWeek === 6) return true;
  if (dayOfWeek === 5 && totalMinutes >= fridayCloseMinutes + gracePeriodMinutes) return true;
  if (dayOfWeek === 0 && totalMinutes < 17 * 60) return true;

  return false;
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
          closuresExecuted: 0,
          marketClosuresExecuted: 0
        })
      };
    }

    console.log(`[AutonomousMonitor:${executionId}] Monitoring ${positions.length} open positions`);

    // MARKET-CLOSE ENFORCEMENT: Check if forex market is closed (with 5min grace)
    const forexMarketOpen = await isForexMarketOpen();
    let marketClosuresExecuted = 0;

    if (!forexMarketOpen && isPastMarketCloseGracePeriod()) {
      console.log(`[AutonomousMonitor:${executionId}] Forex market CLOSED + grace period elapsed - enforcing market-close protocol`);

      const result = await enforceMarketCloseClosure(executionId, positions as OpenPosition[]);
      marketClosuresExecuted = result.marketClosuresExecuted;

      if (result.marketClosuresExecuted > 0) {
        console.log(`[AutonomousMonitor:${executionId}] Market-close enforcement: ${result.marketClosuresExecuted}/${result.nonCryptoOpen} positions closed`);
      }

      // Re-fetch positions (some may have been closed by market-close enforcement)
      const { data: remainingPositions } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('status', 'open')
        .not('entry_price', 'is', null)
        .order('created_at', { ascending: true });

      if (!remainingPositions || remainingPositions.length === 0) {
        const duration = Date.now() - startTime;
        return {
          statusCode: 200,
          body: JSON.stringify({
            success: true,
            executionId,
            positionsMonitored: positions.length,
            marketClosuresExecuted,
            triggersDetected: 0,
            closuresExecuted: 0,
            durationMs: duration,
            timestamp: new Date().toISOString()
          })
        };
      }

      // Continue with remaining (crypto) positions for SL/TP monitoring
      positions.length = 0;
      positions.push(...remainingPositions);
    }

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
      if (Date.now() - startTime > MAX_EXECUTION_TIME_MS) {
        console.warn(`[AutonomousMonitor:${executionId}] Approaching timeout, stopping early`);
        break;
      }

      symbolsMonitored.add(symbol);

      const price = await getCurrentPrice(symbol);
      if (!price) {
        console.warn(`[AutonomousMonitor:${executionId}] Skipping ${symbol}: No price data`);
        continue;
      }

      for (const position of symbolPositions) {
        const results = checkPositionTriggers(position, price);

        if (results.length > 0) {
          triggersDetected += results.length;

          const slTrigger = results.find(r => r.checkType === 'sl');
          const triggerToExecute = slTrigger || results[0];

          const executed = await executePositionClosure(triggerToExecute, position, price);
          if (executed) {
            closuresExecuted++;
          }

          await logMonitoringCheck(executionId, position, price, results, executed);
        } else {
          await logMonitoringCheck(executionId, position, price, [], false);
        }
      }
    }

    const duration = Date.now() - startTime;

    console.log(`[AutonomousMonitor:${executionId}] Completed in ${duration}ms`);
    console.log(`[AutonomousMonitor:${executionId}] Positions: ${positions.length}, Triggers: ${triggersDetected}, Closures: ${closuresExecuted}, MarketClose: ${marketClosuresExecuted}`);
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
        marketClosuresExecuted,
        forexMarketOpen,
        durationMs: duration,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error(`[AutonomousMonitor:${executionId}] Critical error:`, error);
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

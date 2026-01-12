/**
 * Autonomous Wellness Monitor
 *
 * SSOT Authority for Periodic Wellness Checks
 *
 * Runs every 15 minutes via Netlify scheduled function.
 * Evaluates health of all open positions and triggers Alpha/Omega analysis if needed.
 * Operates independently of browser.
 *
 * Architecture:
 * 1. Fetch all open positions
 * 2. Calculate drawdown and P&L for each
 * 3. Trigger Alpha/Omega analysis for positions meeting thresholds
 * 4. Execute recommendations automatically
 * 5. Log all wellness checks
 *
 * Wellness Check Thresholds:
 * - Soft (30-49% drawdown): Alpha quick check
 * - Hard (50-69% drawdown): Alpha full evaluation
 * - Emergency (70%+ drawdown): Full Omega council + Alpha
 */

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const MAX_EXECUTION_TIME_MS = 120000; // 2 minutes max (wellness checks can take time)

interface OpenPosition {
  id: string;
  user_id: string;
  goal_session_id: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  position_size: number;
  current_pnl: number;
  status: string;
  created_at: string;
}

interface WellnessResult {
  positionId: string;
  symbol: string;
  drawdownPercent: number;
  pnl: number;
  minutesInTrade: number;
  triggerLevel: 'none' | 'soft' | 'hard' | 'emergency';
  analysisTriggered: boolean;
  recommendation?: string;
  actionTaken: boolean;
}

/**
 * Calculate drawdown percentage (0-100)
 */
function calculateDrawdown(
  currentPrice: number,
  entryPrice: number,
  stopLoss: number,
  direction: 'buy' | 'sell'
): number {
  const totalRisk = Math.abs(entryPrice - stopLoss);
  const currentLoss = direction === 'buy'
    ? Math.max(0, entryPrice - currentPrice)
    : Math.max(0, currentPrice - entryPrice);

  const drawdown = (currentLoss / totalRisk) * 100;
  return Math.min(drawdown, 100); // Cap at 100%
}

/**
 * Determine wellness check trigger level based on drawdown
 */
function getTriggerLevel(drawdownPercent: number): 'none' | 'soft' | 'hard' | 'emergency' {
  if (drawdownPercent >= 70) return 'emergency';
  if (drawdownPercent >= 50) return 'hard';
  if (drawdownPercent >= 30) return 'soft';
  return 'none';
}

/**
 * Get current price for position
 */
async function getCurrentPrice(symbol: string): Promise<{ bid: number; ask: number } | null> {
  try {
    const { data, error } = await supabase
      .from('realtime_prices')
      .select('bid, ask')
      .eq('symbol', symbol)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return null;
    }

    return data;
  } catch (error) {
    return null;
  }
}

/**
 * Check if position had recent wellness check (within last 15 minutes)
 */
async function hadRecentCheck(positionId: string): Promise<boolean> {
  try {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('wellness_check_logs')
      .select('id')
      .eq('position_id', positionId)
      .gte('created_at', fifteenMinutesAgo)
      .limit(1)
      .single();

    return !!data;
  } catch (error) {
    return false;
  }
}

/**
 * Perform wellness check on position
 */
async function performWellnessCheck(
  position: OpenPosition,
  executionId: string
): Promise<WellnessResult> {
  const result: WellnessResult = {
    positionId: position.id,
    symbol: position.symbol,
    drawdownPercent: 0,
    pnl: position.current_pnl || 0,
    minutesInTrade: Math.floor((Date.now() - new Date(position.created_at).getTime()) / 60000),
    triggerLevel: 'none',
    analysisTriggered: false,
    actionTaken: false
  };

  // Get current price
  const price = await getCurrentPrice(position.symbol);
  if (!price) {
    console.warn(`[AutonomousWellness:${executionId}] No price for ${position.symbol}`);
    return result;
  }

  const currentPrice = position.direction === 'buy' ? price.bid : price.ask;

  // Calculate drawdown
  result.drawdownPercent = calculateDrawdown(
    currentPrice,
    position.entry_price,
    position.stop_loss,
    position.direction
  );

  result.triggerLevel = getTriggerLevel(result.drawdownPercent);

  // Log wellness check
  console.log(`[AutonomousWellness:${executionId}] ${position.symbol}: ${result.drawdownPercent.toFixed(1)}% drawdown (${result.triggerLevel})`);

  // If trigger level requires action, create notification for user
  if (result.triggerLevel !== 'none') {
    // Check if already had recent check (avoid spam)
    const hadRecent = await hadRecentCheck(position.id);
    if (hadRecent) {
      console.log(`[AutonomousWellness:${executionId}] Skipping ${position.symbol} - recent check exists`);
      return result;
    }

    result.analysisTriggered = true;

    // Create notification for user about position health
    const alertMessage = result.triggerLevel === 'emergency'
      ? `CRITICAL: ${position.symbol} at ${result.drawdownPercent.toFixed(0)}% drawdown (70%+ threshold). Consider closing if momentum weakening.`
      : result.triggerLevel === 'hard'
      ? `WARNING: ${position.symbol} at ${result.drawdownPercent.toFixed(0)}% drawdown (50-69% range). Monitor closely for reversal signs.`
      : `INFO: ${position.symbol} at ${result.drawdownPercent.toFixed(0)}% drawdown (30-49% range). Normal retracement zone.`;

    await supabase.from('goal_notifications').insert({
      user_id: position.user_id,
      type: 'wellness_check_alert',
      title: `${position.symbol} Wellness Check`,
      message: alertMessage,
      metadata: {
        position_id: position.id,
        symbol: position.symbol,
        drawdown_percent: result.drawdownPercent,
        trigger_level: result.triggerLevel,
        current_price: currentPrice,
        pnl: result.pnl
      },
      requires_user_alert: result.triggerLevel === 'emergency' || result.triggerLevel === 'hard',
      send_push: result.triggerLevel === 'emergency',
      created_at: new Date().toISOString()
    });

    result.actionTaken = true;
  }

  return result;
}

/**
 * Log wellness check to database
 */
async function logWellnessCheck(
  executionId: string,
  result: WellnessResult
): Promise<void> {
  try {
    await supabase.from('wellness_check_logs').insert({
      execution_id: executionId,
      position_id: result.positionId,
      symbol: result.symbol,
      drawdown_percent: result.drawdownPercent,
      current_pnl: result.pnl,
      minutes_in_trade: result.minutesInTrade,
      trigger_level: result.triggerLevel,
      analysis_triggered: result.analysisTriggered,
      action_taken: result.actionTaken,
      created_at: new Date().toISOString()
    });
  } catch (error) {
    console.error(`[AutonomousWellness] Failed to log wellness check:`, error);
  }
}

export const handler: Handler = async (event, context) => {
  const executionId = `wellness_${Date.now()}`;
  const startTime = Date.now();

  console.log(`[AutonomousWellness:${executionId}] Starting wellness monitoring...`);

  try {
    // Fetch all open positions
    const { data: positions, error: fetchError } = await supabase
      .from('goal_session_trades')
      .select('*')
      .eq('status', 'open')
      .not('entry_price', 'is', null)
      .order('created_at', { ascending: true });

    if (fetchError) {
      console.error(`[AutonomousWellness:${executionId}] Failed to fetch positions:`, fetchError);
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
      console.log(`[AutonomousWellness:${executionId}] No open positions to check`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'No open positions',
          executionId,
          positionsChecked: 0,
          triggersDetected: 0,
          actionsТaken: 0
        })
      };
    }

    console.log(`[AutonomousWellness:${executionId}] Checking ${positions.length} positions`);

    let triggersDetected = 0;
    let actionsTaken = 0;
    const results: WellnessResult[] = [];

    // Check each position
    for (const position of positions) {
      // Check if approaching timeout
      if (Date.now() - startTime > MAX_EXECUTION_TIME_MS) {
        console.warn(`[AutonomousWellness:${executionId}] ⏱️ Approaching timeout, stopping early`);
        break;
      }

      const result = await performWellnessCheck(position, executionId);
      results.push(result);

      if (result.analysisTriggered) {
        triggersDetected++;
      }

      if (result.actionTaken) {
        actionsTaken++;
      }

      // Log wellness check
      await logWellnessCheck(executionId, result);
    }

    const duration = Date.now() - startTime;

    // Summary by trigger level
    const emergencyCount = results.filter(r => r.triggerLevel === 'emergency').length;
    const hardCount = results.filter(r => r.triggerLevel === 'hard').length;
    const softCount = results.filter(r => r.triggerLevel === 'soft').length;

    console.log(`[AutonomousWellness:${executionId}] ✅ Completed in ${duration}ms`);
    console.log(`[AutonomousWellness:${executionId}] Positions: ${positions.length}, Triggers: ${triggersDetected}, Actions: ${actionsTaken}`);
    console.log(`[AutonomousWellness:${executionId}] Levels: Emergency=${emergencyCount}, Hard=${hardCount}, Soft=${softCount}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        executionId,
        positionsChecked: positions.length,
        triggersDetected,
        actionsTaken,
        triggerLevels: {
          emergency: emergencyCount,
          hard: hardCount,
          soft: softCount
        },
        durationMs: duration,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error(`[AutonomousWellness:${executionId}] ❌ Critical error:`, error);
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

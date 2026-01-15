/**
 * Trade Mode Manager
 *
 * SSOT for trade mode detection and configuration.
 * Determines single vs multi-trade mode behavior for scanning and TPS evaluation.
 *
 * Mode Rules:
 * - SINGLE (max_concurrent_trades = 1):
 *   - Monitoring blocks all new scans
 *   - No TPS re-evaluation during monitoring
 *   - Traditional blocking behavior
 *
 * - MULTI (max_concurrent_trades = 2-3):
 *   - Continuous scanning up to max slots
 *   - TPS re-evaluation on each scan
 *   - Can replace lower-TPS intents with higher-TPS ones
 */

import { supabase } from '../lib/supabase';
import type { TradeModeConfig, TradeMode } from '../types/tps';
import { logger } from '../lib/logger';

interface GoalSessionModeData {
  max_concurrent_trades: number;
  trade_mode: TradeMode;
}

/**
 * Fetch trade mode configuration for a goal session.
 *
 * @param sessionId - Goal session ID
 * @returns Trade mode configuration
 */
export async function getTradeModeConfig(sessionId: string): Promise<TradeModeConfig> {
  const { data, error } = await supabase
    .from('goal_sessions')
    .select('max_concurrent_trades, trade_mode')
    .eq('id', sessionId)
    .maybeSingle();

  if (error) {
    logger.error('[TradeModeManager] Failed to fetch trade mode', { sessionId, error });
    throw new Error(`Failed to fetch trade mode for session ${sessionId}: ${error.message}`);
  }

  if (!data) {
    logger.warn('[TradeModeManager] Session not found, defaulting to SINGLE mode', { sessionId });
    return {
      mode: 'SINGLE',
      maxConcurrentTrades: 1,
      allowScanning: false,
      allowTPSReEvaluation: false,
    };
  }

  const sessionData = data as GoalSessionModeData;
  const maxTrades = sessionData.max_concurrent_trades || 1;
  const mode = sessionData.trade_mode || (maxTrades === 1 ? 'SINGLE' : 'MULTI');

  const config: TradeModeConfig = {
    mode,
    maxConcurrentTrades: maxTrades,
    allowScanning: mode === 'MULTI',
    allowTPSReEvaluation: mode === 'MULTI',
  };

  logger.info('[TradeModeManager] Trade mode loaded', {
    sessionId,
    mode: config.mode,
    maxConcurrentTrades: config.maxConcurrentTrades,
  });

  return config;
}

/**
 * Check if session is in multi-trade mode.
 *
 * @param sessionId - Goal session ID
 * @returns True if multi-trade mode
 */
export async function isMultiTradeMode(sessionId: string): Promise<boolean> {
  const config = await getTradeModeConfig(sessionId);
  return config.mode === 'MULTI';
}

/**
 * Get maximum concurrent trades for session.
 *
 * @param sessionId - Goal session ID
 * @returns Maximum concurrent trades (1-3)
 */
export async function getMaxConcurrentTrades(sessionId: string): Promise<number> {
  const config = await getTradeModeConfig(sessionId);
  return config.maxConcurrentTrades;
}

/**
 * Check if scanning should be blocked based on mode and active monitors.
 *
 * Logic:
 * - SINGLE mode: Block if ANY monitoring intent exists
 * - MULTI mode: Block only if ALL slots filled with monitoring intents
 *
 * @param sessionId - Goal session ID
 * @returns True if scanning should be blocked
 */
export async function shouldBlockScanning(sessionId: string): Promise<boolean> {
  const config = await getTradeModeConfig(sessionId);

  // Count active monitoring intents
  const { count, error } = await supabase
    .from('entry_intents')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('status', 'monitoring');

  if (error) {
    logger.error('[TradeModeManager] Failed to count monitoring intents', { sessionId, error });
    return true;
  }

  const activeMonitors = count || 0;

  if (config.mode === 'SINGLE') {
    // Single mode: block if any monitoring
    const shouldBlock = activeMonitors > 0;
    logger.info('[TradeModeManager] SINGLE mode scan check', {
      sessionId,
      activeMonitors,
      shouldBlock,
    });
    return shouldBlock;
  } else {
    // Multi mode: block only if all slots filled
    const shouldBlock = activeMonitors >= config.maxConcurrentTrades;
    logger.info('[TradeModeManager] MULTI mode scan check', {
      sessionId,
      activeMonitors,
      maxSlots: config.maxConcurrentTrades,
      shouldBlock,
    });
    return shouldBlock;
  }
}

/**
 * Get available trade slot count.
 *
 * @param sessionId - Goal session ID
 * @returns Number of available slots (0 if none)
 */
export async function getAvailableSlots(sessionId: string): Promise<number> {
  const config = await getTradeModeConfig(sessionId);

  const { count, error } = await supabase
    .from('entry_intents')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('status', 'monitoring');

  if (error) {
    logger.error('[TradeModeManager] Failed to count monitoring intents', { sessionId, error });
    return 0;
  }

  const activeMonitors = count || 0;
  const available = Math.max(0, config.maxConcurrentTrades - activeMonitors);

  logger.info('[TradeModeManager] Available slots calculated', {
    sessionId,
    mode: config.mode,
    maxSlots: config.maxConcurrentTrades,
    active: activeMonitors,
    available,
  });

  return available;
}

/**
 * Set trade mode for a goal session.
 * Used when creating or updating sessions.
 *
 * @param sessionId - Goal session ID
 * @param maxConcurrentTrades - Maximum concurrent trades (1-3)
 */
export async function setTradeMode(sessionId: string, maxConcurrentTrades: number): Promise<void> {
  if (maxConcurrentTrades < 1 || maxConcurrentTrades > 3) {
    throw new Error(`Invalid maxConcurrentTrades: ${maxConcurrentTrades}, must be 1-3`);
  }

  const mode: TradeMode = maxConcurrentTrades === 1 ? 'SINGLE' : 'MULTI';

  const { error } = await supabase
    .from('goal_sessions')
    .update({
      max_concurrent_trades: maxConcurrentTrades,
      trade_mode: mode,
    })
    .eq('id', sessionId);

  if (error) {
    logger.error('[TradeModeManager] Failed to set trade mode', { sessionId, error });
    throw new Error(`Failed to set trade mode: ${error.message}`);
  }

  logger.info('[TradeModeManager] Trade mode updated', {
    sessionId,
    mode,
    maxConcurrentTrades,
  });
}

/**
 * Check if TPS re-evaluation is allowed.
 * Only allowed in multi-trade mode.
 *
 * @param sessionId - Goal session ID
 * @returns True if TPS re-evaluation allowed
 */
export async function allowTPSReEvaluation(sessionId: string): Promise<boolean> {
  const config = await getTradeModeConfig(sessionId);
  return config.allowTPSReEvaluation;
}

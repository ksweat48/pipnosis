/**
 * Clean Historical Backfill Function
 *
 * Fetches historical candles from MetaAPI and fills gaps in forex_candles table.
 *
 * Features:
 * - On-demand execution (no scheduling)
 * - Uses MetaAPI historical endpoint
 * - Idempotent (ON CONFLICT DO NOTHING)
 * - Rate limited and safe
 * - Comprehensive logging
 *
 * Usage:
 * POST /functions/historical-backfill
 * {
 *   "symbol": "EURUSD",
 *   "timeframe": "M5",
 *   "daysBack": 7,
 *   "dryRun": false
 * }
 */

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const metaApiToken = process.env.METAAPI_TOKEN!;
const metaApiRegion = process.env.METAAPI_REGION || 'london';
const metaApiAccountId = process.env.METAAPI_ACCOUNT_ID!;
const metaApiAccountIdFallback = process.env.METAAPI_ACCOUNT_ID_FALLBACK!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Supported symbols and timeframes
const VALID_SYMBOLS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];
const VALID_TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'];
const MAX_DAYS_BACK = 90;
const MAX_CANDLES_PER_REQUEST = 1000;
const RATE_LIMIT_DELAY_MS = 100;

interface BackfillRequest {
  symbol: string;
  timeframe: string;
  daysBack?: number;
  dryRun?: boolean;
}

interface MetaApiCandle {
  time: string;
  brokerTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number;
}

interface BackfillResult {
  success: boolean;
  executionId: string;
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  candlesRequested: number;
  candlesInserted: number;
  candlesSkipped: number;
  apiCallsMade: number;
  durationMs: number;
  errors: string[];
  message: string;
}

/**
 * Validate request parameters
 */
function validateRequest(req: BackfillRequest): { valid: boolean; error?: string } {
  if (!req.symbol || !VALID_SYMBOLS.includes(req.symbol)) {
    return { valid: false, error: `Invalid symbol. Must be one of: ${VALID_SYMBOLS.join(', ')}` };
  }

  if (!req.timeframe || !VALID_TIMEFRAMES.includes(req.timeframe)) {
    return { valid: false, error: `Invalid timeframe. Must be one of: ${VALID_TIMEFRAMES.join(', ')}` };
  }

  const daysBack = req.daysBack || 7;
  if (daysBack < 1 || daysBack > MAX_DAYS_BACK) {
    return { valid: false, error: `daysBack must be between 1 and ${MAX_DAYS_BACK}` };
  }

  return { valid: true };
}

/**
 * Fetch historical candles from MetaAPI with fallback account support
 */
async function fetchHistoricalCandles(
  symbol: string,
  timeframe: string,
  startTime: Date,
  endTime: Date
): Promise<{ candles: MetaApiCandle[]; apiCalls: number }> {
  const candles: MetaApiCandle[] = [];
  let apiCalls = 0;
  let currentStartTime = startTime;

  const accounts = [metaApiAccountId, metaApiAccountIdFallback];
  let lastError: Error | null = null;
  let workingAccountId: string | null = null;

  for (const accountId of accounts) {
    const url = `https://mt-client-api-v1.${metaApiRegion}.agiliumtrade.ai/users/current/accounts/${accountId}/historical-market-data/symbols/${symbol}/timeframes/${timeframe}/candles`;

    try {
      const queryParams = new URLSearchParams({
        startTime: currentStartTime.toISOString(),
        limit: '10'
      });

      const testResponse = await fetch(`${url}?${queryParams}`, {
        method: 'GET',
        headers: {
          'auth-token': metaApiToken,
          'Content-Type': 'application/json'
        }
      });

      apiCalls++;

      if (testResponse.ok) {
        workingAccountId = accountId;
        console.log(`[Backfill] Using account ${accountId} for ${symbol} ${timeframe}`);
        break;
      } else if (testResponse.status === 404) {
        console.log(`[Backfill] Account ${accountId} doesn't have ${symbol} - trying next account`);
        lastError = new Error(`Account doesn't have ${symbol} available`);
        continue;
      } else {
        throw new Error(`MetaAPI HTTP ${testResponse.status}: ${testResponse.statusText}`);
      }
    } catch (error) {
      lastError = error as Error;
      console.log(`[Backfill] Error with account ${accountId}:`, error);
      continue;
    }
  }

  if (!workingAccountId) {
    throw new Error(`No MetaAPI account has ${symbol} available. Last error: ${lastError?.message}`);
  }

  const url = `https://mt-client-api-v1.${metaApiRegion}.agiliumtrade.ai/users/current/accounts/${workingAccountId}/historical-market-data/symbols/${symbol}/timeframes/${timeframe}/candles`;

  currentStartTime = startTime;

  while (currentStartTime < endTime) {
    try {
      const queryParams = new URLSearchParams({
        startTime: currentStartTime.toISOString(),
        limit: MAX_CANDLES_PER_REQUEST.toString()
      });

      const response = await fetch(`${url}?${queryParams}`, {
        method: 'GET',
        headers: {
          'auth-token': metaApiToken,
          'Content-Type': 'application/json'
        }
      });

      apiCalls++;

      if (!response.ok) {
        throw new Error(`MetaAPI HTTP ${response.status}: ${response.statusText}`);
      }

      const batch: MetaApiCandle[] = await response.json();

      if (!batch || batch.length === 0) {
        break; // No more candles available
      }

      candles.push(...batch);

      // Update start time for next batch
      const lastCandle = batch[batch.length - 1];
      const lastCandleTime = new Date(lastCandle.time);
      currentStartTime = new Date(lastCandleTime.getTime() + 1000); // +1 second to avoid duplicates

      // Rate limiting
      if (currentStartTime < endTime) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
      }

      // If we got less than max, we're at the end
      if (batch.length < MAX_CANDLES_PER_REQUEST) {
        break;
      }
    } catch (error) {
      console.error(`[Backfill] Error fetching candles:`, error);
      throw error;
    }
  }

  return { candles, apiCalls };
}

/**
 * Validate candle data
 */
function validateCandle(candle: MetaApiCandle): { valid: boolean; error?: string } {
  if (candle.high < candle.low) {
    return { valid: false, error: 'High < Low' };
  }

  if (candle.open < candle.low || candle.open > candle.high) {
    return { valid: false, error: 'Open outside High/Low range' };
  }

  if (candle.close < candle.low || candle.close > candle.high) {
    return { valid: false, error: 'Close outside High/Low range' };
  }

  return { valid: true };
}

/**
 * Insert candles into database
 */
async function insertCandles(
  symbol: string,
  timeframe: string,
  candles: MetaApiCandle[],
  dryRun: boolean
): Promise<{ inserted: number; skipped: number; errors: string[] }> {
  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  if (dryRun) {
    console.log(`[Backfill] DRY RUN: Would insert ${candles.length} candles`);
    return { inserted: 0, skipped: candles.length, errors: [] };
  }

  // Insert in batches of 100
  const BATCH_SIZE = 100;
  for (let i = 0; i < candles.length; i += BATCH_SIZE) {
    const batch = candles.slice(i, i + BATCH_SIZE);

    const records = batch.map(candle => {
      const validation = validateCandle(candle);
      if (!validation.valid) {
        errors.push(`Invalid candle at ${candle.time}: ${validation.error}`);
        return null;
      }

      return {
        symbol,
        timeframe,
        open_time: new Date(candle.time),
        close_time: new Date(new Date(candle.time).getTime() + 60000), // Placeholder
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.tickVolume || 0,
        data_source: 'historical_backfill'
      };
    }).filter(r => r !== null);

    if (records.length === 0) continue;

    try {
      const { data, error } = await supabase
        .from('forex_candles')
        .upsert(records, {
          onConflict: 'symbol,timeframe,open_time',
          ignoreDuplicates: true
        })
        .select('id');

      if (error) {
        errors.push(`Batch insert error: ${error.message}`);
        skipped += records.length;
      } else {
        const actualInserted = data?.length || 0;
        inserted += actualInserted;
        skipped += records.length - actualInserted;
      }
    } catch (error: any) {
      errors.push(`Batch insert exception: ${error.message}`);
      skipped += records.length;
    }
  }

  return { inserted, skipped, errors };
}

/**
 * Main handler
 */
export const handler: Handler = async (event) => {
  const startTime = Date.now();
  let executionId: string | null = null;

  try {
    // Validate method
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: 'Method not allowed. Use POST.' })
      };
    }

    // Parse request
    const request: BackfillRequest = JSON.parse(event.body || '{}');

    // Validate parameters
    const validation = validateRequest(request);
    if (!validation.valid) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: validation.error })
      };
    }

    const symbol = request.symbol;
    const timeframe = request.timeframe;
    const daysBack = request.daysBack || 7;
    const dryRun = request.dryRun || false;

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - daysBack * 24 * 60 * 60 * 1000);

    console.log(`[Backfill] Starting backfill for ${symbol} ${timeframe}, ${daysBack} days back`);
    console.log(`[Backfill] Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    console.log(`[Backfill] Dry run: ${dryRun}`);

    // Create execution log
    const { data: execution, error: execError } = await supabase
      .from('backfill_executions')
      .insert({
        symbol,
        timeframe,
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
        status: 'running',
        triggered_by: 'manual_api_call'
      })
      .select('id')
      .single();

    if (execError || !execution) {
      throw new Error(`Failed to create execution log: ${execError?.message}`);
    }

    executionId = execution.id;

    // Fetch candles from MetaAPI
    console.log(`[Backfill] Fetching candles from MetaAPI...`);
    const { candles, apiCalls } = await fetchHistoricalCandles(
      symbol,
      timeframe,
      startDate,
      endDate
    );

    console.log(`[Backfill] Fetched ${candles.length} candles in ${apiCalls} API calls`);

    // Insert candles into database
    console.log(`[Backfill] Inserting candles into database...`);
    const { inserted, skipped, errors } = await insertCandles(
      symbol,
      timeframe,
      candles,
      dryRun
    );

    const durationMs = Date.now() - startTime;

    console.log(`[Backfill] Complete! Inserted: ${inserted}, Skipped: ${skipped}, Errors: ${errors.length}`);

    // Update execution log
    await supabase
      .from('backfill_executions')
      .update({
        completed_at: new Date().toISOString(),
        status: errors.length > 0 ? 'error' : 'completed',
        candles_requested: candles.length,
        candles_inserted: inserted,
        candles_skipped: skipped,
        api_calls_made: apiCalls,
        duration_ms: durationMs,
        error_message: errors.length > 0 ? errors.join('; ') : null
      })
      .eq('id', executionId);

    const result: BackfillResult = {
      success: errors.length === 0,
      executionId,
      symbol,
      timeframe,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      candlesRequested: candles.length,
      candlesInserted: inserted,
      candlesSkipped: skipped,
      apiCallsMade: apiCalls,
      durationMs,
      errors,
      message: errors.length > 0
        ? `Backfill completed with ${errors.length} errors`
        : `Successfully backfilled ${inserted} candles`
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };

  } catch (error: any) {
    console.error('[Backfill] Fatal error:', error);

    const durationMs = Date.now() - startTime;

    // Update execution log if it was created
    if (executionId) {
      await supabase
        .from('backfill_executions')
        .update({
          completed_at: new Date().toISOString(),
          status: 'error',
          duration_ms: durationMs,
          error_message: error.message,
          error_details: { stack: error.stack }
        })
        .eq('id', executionId);
    }

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error.message,
        durationMs
      })
    };
  }
};

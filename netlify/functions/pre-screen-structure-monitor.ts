/**
 * Pre-Screen Structure Monitor — Scheduled Netlify Function
 *
 * Responsibility:
 * - Runs every 5 minutes (aligns with populate-session-intelligence schedule)
 * - Checks BOS and sweep-wick structural rules for 9 symbols × 3 styles
 * - Uses ONLY pre-aggregated forex_candles (zero external API calls)
 * - Writes 27 rows to pre_screen_results via upsert (one row per symbol/style/timeframe)
 *
 * SSOT Compliance:
 * - forex_candles is the single candle data authority (MarketDataService SSOT)
 * - pre_screen_results table is the SSOT for structural pre-screen state
 * - No business logic duplication — rules mirror coordinator-alpha.ts gate logic exactly
 *
 * CCIP Governance:
 * - All writes are upserts (idempotent, no duplicate rows)
 * - Service-role client used (RLS policy: service_role can INSERT/UPDATE)
 * - Errors logged per row — one failure does not abort the entire run
 *
 * Gate Logic (mirrors coordinator-alpha.ts HTF_REGIME_CONFLICT_PRE_LLM_GATE):
 * Rule 1 (BOS): Last closed candle close > prior candle high (bull BOS) or < prior candle low (bear BOS)
 * Rule 2 (Sweep Wick): Any of last 3 candles has wick-to-body ratio >= 1.5 in counter-trend direction
 * alignment_status:
 *   ALIGNED        = both Rule1 + Rule2 met, direction confirmed
 *   BOTH_RULES_MET = synonym for ALIGNED (used for explicit output)
 *   RULE1_ONLY     = only BOS found
 *   RULE2_ONLY     = only sweep wick found
 *   BLOCKED        = neither rule met (matches coordinator-alpha NO_TRADE gate)
 */

import type { Handler } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase-admin';

const supabase = getSupabaseAdmin();

const SYMBOLS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD',
  'XAUUSD', 'BTCUSD', 'NAS100', 'US30'
];

const STYLE_TIMEFRAME_MAP: Record<string, string> = {
  SCALP: 'M15',
  MICRO_INTRADAY: 'H1',
  INTRADAY: 'H4',
};

const CANDLE_COUNT = 5;

interface CandleRow {
  open: number;
  high: number;
  low: number;
  close: number;
  time: string;
}

async function getCandlesForSymbol(symbol: string, timeframe: string): Promise<CandleRow[]> {
  const { data, error } = await supabase
    .from('forex_candles')
    .select('open, high, low, close, time')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .order('time', { ascending: false })
    .limit(CANDLE_COUNT);

  if (error || !data) return [];
  return data.reverse() as CandleRow[];
}

interface GateResult {
  rule1_met: boolean;
  rule2_met: boolean;
  rule1_detail: string;
  rule2_detail: string;
  direction_bias: 'BUY' | 'SELL' | 'NEUTRAL';
  alignment_status: 'ALIGNED' | 'RULE1_ONLY' | 'RULE2_ONLY' | 'BOTH_RULES_MET' | 'BLOCKED';
}

function evaluateGates(candles: CandleRow[]): GateResult {
  if (candles.length < 3) {
    return {
      rule1_met: false,
      rule2_met: false,
      rule1_detail: `Insufficient candle data (${candles.length} of ${CANDLE_COUNT} required)`,
      rule2_detail: '',
      direction_bias: 'NEUTRAL',
      alignment_status: 'BLOCKED',
    };
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  // Rule 1: BOS check — last closed candle closes beyond prior candle's extreme
  const bullBOS = last.close > prev.high;
  const bearBOS = last.close < prev.low;
  const rule1_met = bullBOS || bearBOS;
  const rule1Direction: 'BUY' | 'SELL' | 'NEUTRAL' = bullBOS ? 'BUY' : bearBOS ? 'SELL' : 'NEUTRAL';
  const rule1_detail = rule1_met
    ? `${rule1Direction === 'BUY' ? 'Bull' : 'Bear'} BOS: last close ${last.close.toFixed(5)} ${bullBOS ? 'above' : 'below'} prior ${bullBOS ? 'high' : 'low'} ${bullBOS ? prev.high.toFixed(5) : prev.low.toFixed(5)}`
    : `No BOS: last close ${last.close.toFixed(5)} within prior range [${prev.low.toFixed(5)} – ${prev.high.toFixed(5)}]`;

  // Rule 2: Sweep wick check — any of last 3 candles has counter-trend wick >= 1.5x body
  const recent3 = candles.slice(-3);
  let rule2_met = false;
  let rule2_detail = '';
  let sweepDir: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';

  for (const c of recent3) {
    const body = Math.abs(c.close - c.open);
    if (body === 0) continue;
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerRatio = lowerWick / body;
    const upperRatio = upperWick / body;

    if (lowerRatio >= 1.5) {
      rule2_met = true;
      sweepDir = 'BUY';
      rule2_detail = `Bull sweep wick: lower wick ${lowerWick.toFixed(5)} = ${lowerRatio.toFixed(2)}x body at candle ${c.time}`;
      break;
    }
    if (upperRatio >= 1.5) {
      rule2_met = true;
      sweepDir = 'SELL';
      rule2_detail = `Bear sweep wick: upper wick ${upperWick.toFixed(5)} = ${upperRatio.toFixed(2)}x body at candle ${c.time}`;
      break;
    }
  }

  if (!rule2_met) {
    rule2_detail = `No sweep wick >= 1.5x body ratio in last 3 candles`;
  }

  // Determine overall direction bias
  // When both rules are met, favour consistent direction; if they disagree, report NEUTRAL
  let direction_bias: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
  if (rule1_met && rule2_met) {
    direction_bias = rule1Direction === sweepDir ? rule1Direction : 'NEUTRAL';
  } else if (rule1_met) {
    direction_bias = rule1Direction;
  } else if (rule2_met) {
    direction_bias = sweepDir;
  }

  // Compute alignment status
  let alignment_status: GateResult['alignment_status'] = 'BLOCKED';
  if (rule1_met && rule2_met) {
    alignment_status = direction_bias !== 'NEUTRAL' ? 'ALIGNED' : 'BOTH_RULES_MET';
  } else if (rule1_met) {
    alignment_status = 'RULE1_ONLY';
  } else if (rule2_met) {
    alignment_status = 'RULE2_ONLY';
  }

  return {
    rule1_met,
    rule2_met,
    rule1_detail,
    rule2_detail,
    direction_bias,
    alignment_status,
  };
}

const handler: Handler = async () => {
  const startedAt = Date.now();
  let processed = 0;
  let failed = 0;

  for (const symbol of SYMBOLS) {
    for (const [style, timeframe] of Object.entries(STYLE_TIMEFRAME_MAP)) {
      try {
        const candles = await getCandlesForSymbol(symbol, timeframe);
        const result = evaluateGates(candles);

        const { error } = await supabase
          .from('pre_screen_results')
          .upsert(
            {
              symbol,
              style,
              controlling_timeframe: timeframe,
              alignment_status: result.alignment_status,
              direction_bias: result.direction_bias,
              rule1_met: result.rule1_met,
              rule2_met: result.rule2_met,
              rule1_detail: result.rule1_detail,
              rule2_detail: result.rule2_detail,
              last_checked_at: new Date().toISOString(),
            },
            { onConflict: 'symbol,style,controlling_timeframe' }
          );

        if (error) {
          console.error(`[PreScreenMonitor] Upsert failed for ${symbol}/${style}:`, error.message);
          failed++;
        } else {
          processed++;
        }
      } catch (err) {
        console.error(`[PreScreenMonitor] Error processing ${symbol}/${style}:`, err instanceof Error ? err.message : String(err));
        failed++;
      }
    }
  }

  const durationMs = Date.now() - startedAt;
  console.log(`[PreScreenMonitor] Complete: ${processed} processed, ${failed} failed in ${durationMs}ms`);

  return {
    statusCode: 200,
    body: JSON.stringify({ processed, failed, durationMs }),
  };
};

export { handler };

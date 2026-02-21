/**
 * @deprecated CCIP 2026-02-21: This endpoint is superseded by the alpha-preview-scanner
 * frontend service (src/services/alpha-preview-scanner.ts).
 *
 * The SessionIntelligenceMonitor SCAN NOW button now calls alphaPreviewScanner.scan()
 * directly in the browser using the full Alpha Omega Council pipeline, eliminating
 * the dual-system problem. This endpoint is no longer called.
 *
 * Scan Alpha Intelligence — Manual Trigger Endpoint
 *
 * SSOT Authority: Runs the full real-time intelligence pipeline across all
 * watchlist symbols and persists results to alpha_scan_signals.
 *
 * CCIP Compliance:
 * - Delegates calculation to realTimeIntelligenceCalculator (existing SSOT)
 * - Writes results to alpha_scan_signals (single write authority for that table)
 * - Enforces 60-second cooldown to prevent rapid re-triggering
 * - POST only — no scheduled invocation
 *
 * Governance:
 * - Does NOT replace or duplicate session-level scanning (goal-session-scanner)
 * - Does NOT trigger LLM calls — indicator-only pipeline
 * - Results expire after 15 minutes (enforced by DB default)
 *
 * CCIP 2026-02-20: Market Close Awareness
 * - Server independently checks forex market status (Fri 5pm – Sun 5pm EST)
 * - When forex is closed, watchlist is filtered to crypto-only (BTCUSD, ETHUSD)
 * - SSOT for crypto identification: netlify/functions/_shared/crypto-symbol-checker.ts
 * - This enforcement is SERVER-AUTHORITATIVE regardless of client payload
 */

import type { Handler } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase-admin';
import { realTimeIntelligenceCalculator } from './_shared/realtime-intelligence-calculator';
import { isCryptoSymbol } from './_shared/crypto-symbol-checker';

const supabase = getSupabaseAdmin();

/**
 * CCIP 2026-02-20: Server-side forex market close detection.
 * Mirrors the logic in src/utils/marketHours.ts (getForexMarketStatus).
 * SSOT for weekend schedule: Friday 5pm – Sunday 5pm EST.
 * XAUUSD follows this schedule (not treated as 24/7).
 */
function isForexMarketClosed(): boolean {
  const now = new Date();
  const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));

  const dayOfWeek = estTime.getDay();
  const totalMinutes = estTime.getHours() * 60 + estTime.getMinutes();
  const fridayClose = 17 * 60;
  const sundayOpen = 17 * 60;

  if (dayOfWeek === 6) return true;
  if (dayOfWeek === 5 && totalMinutes >= fridayClose) return true;
  if (dayOfWeek === 0 && totalMinutes < sundayOpen) return true;
  return false;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const COOLDOWN_SECONDS = 60;
const MIN_CONFIDENCE_TO_SAVE = 65;

async function getActiveWatchlist(): Promise<string[]> {
  const { data, error } = await supabase
    .from('trading_watchlist_configuration')
    .select('symbol')
    .eq('is_active', true)
    .order('symbol');

  if (error || !data || data.length === 0) {
    return [
      'XAUUSD', 'US30', 'NAS100', 'SPX500',
      'EURUSD', 'GBPUSD', 'USDJPY',
      'BTCUSD', 'ETHUSD',
    ];
  }

  return data.map((row: { symbol: string }) => row.symbol);
}

async function checkCooldown(): Promise<{ blocked: boolean; secondsRemaining: number }> {
  const { data, error } = await supabase.rpc('get_last_alpha_scan_time');

  if (error || !data) {
    return { blocked: false, secondsRemaining: 0 };
  }

  const lastScanTime = new Date(data).getTime();
  const now = Date.now();
  const elapsedSeconds = (now - lastScanTime) / 1000;

  if (elapsedSeconds < COOLDOWN_SECONDS) {
    return {
      blocked: true,
      secondsRemaining: Math.ceil(COOLDOWN_SECONDS - elapsedSeconds),
    };
  }

  return { blocked: false, secondsRemaining: 0 };
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const startTime = Date.now();

  try {
    const cooldown = await checkCooldown();
    if (cooldown.blocked) {
      return {
        statusCode: 429,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: `Scan too recent. Try again in ${cooldown.secondsRemaining}s.`,
          secondsRemaining: cooldown.secondsRemaining,
        }),
      };
    }

    const fullWatchlist = await getActiveWatchlist();

    // CCIP 2026-02-20: Server enforces crypto-only when forex market is closed.
    // This is authoritative — client cannot bypass by sending a full watchlist.
    const forexClosed = isForexMarketClosed();
    const watchlist = forexClosed
      ? fullWatchlist.filter(isCryptoSymbol)
      : fullWatchlist;

    if (forexClosed) {
      console.log(`[AlphaScan] Forex market closed (weekend). Restricting scan to crypto-only: [${watchlist.join(', ')}]`);
    } else {
      console.log(`[AlphaScan] Starting manual scan across ${watchlist.length} symbols...`);
    }

    const { allPairs } = await realTimeIntelligenceCalculator.calculateForAllPairsWithAllScores(watchlist);

    const signals = allPairs.filter(
      (pair) => pair.confidence >= MIN_CONFIDENCE_TO_SAVE && pair.direction !== undefined
    );

    console.log(`[AlphaScan] ${allPairs.length} pairs analyzed, ${signals.length} signals meet threshold (≥${MIN_CONFIDENCE_TO_SAVE}%)`);

    if (signals.length === 0) {
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          message: 'Scan complete — no signals meet the confidence threshold right now.',
          scanned: allPairs.length,
          signalsFound: 0,
          signals: [],
          executionMs: Date.now() - startTime,
        }),
      };
    }

    const batchId = crypto.randomUUID();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const styleMap: Record<string, string> = {
      scalper: 'scalp',
      scalp: 'scalp',
      micro: 'micro_intraday',
      intraday: 'intraday',
    };

    const rows = signals.map((pair) => ({
      symbol: pair.symbol,
      direction: pair.direction ?? 'buy',
      trade_style: styleMap[pair.tradeStyle ?? 'micro'] ?? 'micro_intraday',
      timeframe: pair.timeframe ?? 'M15',
      alpha_confidence: pair.confidence,
      reasoning: pair.reasoning.slice(0, 3).join('. '),
      scanned_at: now,
      expires_at: expiresAt,
      scan_batch_id: batchId,
    }));

    const { error: insertError } = await supabase
      .from('alpha_scan_signals')
      .insert(rows);

    if (insertError) {
      console.error('[AlphaScan] Failed to persist signals:', insertError);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: 'Scan completed but failed to save signals.',
          detail: insertError.message,
        }),
      };
    }

    const topSignals = signals
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5)
      .map((p) => ({
        symbol: p.symbol,
        direction: p.direction,
        confidence: p.confidence,
        tradeStyle: p.tradeStyle,
        timeframe: p.timeframe,
      }));

    console.log(`[AlphaScan] Persisted ${rows.length} signals to alpha_scan_signals (batch: ${batchId})`);

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: `Scan complete — ${signals.length} signal${signals.length !== 1 ? 's' : ''} found.`,
        scanned: allPairs.length,
        signalsFound: signals.length,
        batchId,
        topSignals,
        executionMs: Date.now() - startTime,
      }),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[AlphaScan] Fatal error:', message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: message }),
    };
  }
};

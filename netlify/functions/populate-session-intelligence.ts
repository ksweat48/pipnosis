/**
 * Real-Time Intelligence Populator - SSOT for Trading Probability Analysis
 *
 * Authority: Calculate real-time probability for all watchlist pairs based on
 * weighted indicator alignment RIGHT NOW (not session forecasts).
 *
 * Runs every 3 minutes to analyze current market conditions and provide
 * advisory intelligence to users. This is purely educational and does not
 * affect Alpha's autonomous trading decisions.
 *
 * CCIP Compliant (Phase 2 - Implementation):
 * - Watchlist loaded from trading_watchlist_configuration SSOT table
 * - Error aggregation with failure tracking and diagnostics
 * - Pre-insert validation gate requiring minimum data quality
 * - UPSERT instead of delete+insert (atomic, faster)
 * - Execution metrics logged for pipeline health monitoring
 * - Governance-compliant RLS policies utilized
 *
 * Architecture:
 * 1. Fetch active watchlist from trading_watchlist_configuration (SSOT)
 * 2. Calculate real-time probability using indicator alignment + intelligent weights
 * 3. Aggregate errors and track failed symbols
 * 4. Validate data quality before insertion (must have ≥3 symbols calculated)
 * 5. UPSERT into session_intelligence_data with 3-minute expiration
 * 6. Log execution metrics for pipeline monitoring
 */

import type { Handler } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase-admin';
import { realTimeIntelligenceCalculator } from './_shared/realtime-intelligence-calculator';
import { getCurrentSession } from '../../src/config/intelligent-indicator-weights';

const supabase = getSupabaseAdmin();

interface SessionInfo {
  name: string;
  startHour: number;
  endHour: number;
}

function getSessionInfo(): SessionInfo {
  const session = getCurrentSession();

  const sessionMap: Record<string, { start: number; end: number }> = {
    London: { start: 3, end: 12 },
    NewYork: { start: 8, end: 17 },
    Asian: { start: 19, end: 4 },
    Overlap: { start: 8, end: 12 },
  };

  const info = sessionMap[session];

  // Convert session name to database format (handle both NewYork and Overlap)
  let dbSessionName = session;
  if (session === 'NewYork') dbSessionName = 'New York';
  if (session === 'Overlap') dbSessionName = 'New York';

  return {
    name: dbSessionName,
    startHour: info.start,
    endHour: info.end,
  };
}

async function getActiveWatchlist(): Promise<string[]> {
  const { data, error } = await supabase
    .from('trading_watchlist_configuration')
    .select('symbol')
    .eq('is_active', true)
    .order('symbol');

  if (error) {
    console.error('[RealTimeIntelligence] Error loading watchlist from database:', error);
    throw error;
  }

  const symbols = data.map((row: { symbol: string }) => row.symbol);
  console.log(`[RealTimeIntelligence] Loaded ${symbols.length} active watchlist symbols from SSOT`);
  return symbols;
}

async function logExecutionMetrics(
  status: 'success' | 'error' | 'stale',
  symbolsAttempted: number,
  symbolsSuccessful: number,
  pairCount: number,
  executionTimeMs: number,
  errorMessage?: string
): Promise<void> {
  const { error } = await supabase
    .from('session_intelligence_logs')
    .insert({
      function_name: 'populate-session-intelligence',
      status,
      symbols_attempted: symbolsAttempted,
      symbols_successful: symbolsSuccessful,
      pair_count: pairCount,
      execution_time_ms: executionTimeMs,
      error_message: errorMessage,
    });

  if (error) {
    console.warn('[RealTimeIntelligence] Failed to log execution metrics:', error);
  }
}

export const handler: Handler = async (event) => {
  const executionStart = Date.now();
  console.log('[RealTimeIntelligence] Starting real-time probability analysis...');

  try {
    const sessionInfo = getSessionInfo();
    console.log(
      `[RealTimeIntelligence] Current session: ${sessionInfo.name} (${sessionInfo.startHour}:00 - ${sessionInfo.endHour}:00 EST)`
    );

    const watchlist = await getActiveWatchlist();
    const { allPairs, topPairs, highConfidencePairs, heatingPairs, marketCondition, calculatedAt, diagnostics } =
      await realTimeIntelligenceCalculator.calculateForAllPairsWithAllScores(watchlist);

    console.log(`[RealTimeIntelligence] Market regime: ${marketCondition}`);
    console.log(
      `[RealTimeIntelligence] Total pairs analyzed: ${allPairs.length} | Ready (≥70%): ${highConfidencePairs.length} | Heating (50-70%): ${heatingPairs.length}`
    );

    if (diagnostics && diagnostics.failureReasons && Object.keys(diagnostics.failureReasons).length > 0) {
      console.warn(
        `[RealTimeIntelligence] Symbol calculation failures:`,
        JSON.stringify(diagnostics.failureReasons, null, 2)
      );
    }

    const isTradable = highConfidencePairs.length > 0;

    const formatPairData = (pair: typeof allPairs[0], status: 'ready' | 'heating' | 'monitoring') => ({
      symbol: pair.symbol,
      confidence: pair.confidence,
      tradeConfidence: pair.confidence,
      alignedIndicators: pair.alignedIndicators,
      totalIndicators: pair.totalIndicators,
      status,
      reasoning: pair.reasoning.join('. '),
      indicatorAlignment: Object.entries(pair.indicatorBreakdown).reduce(
        (acc, [key, val]) => {
          acc[key] = val.aligned;
          return acc;
        },
        {} as Record<string, boolean>
      ),
      lastCalculated: pair.lastCalculated,
      tradeStyle: pair.tradeStyle ?? 'micro',
      timeframe: pair.timeframe ?? 'M15',
      direction: pair.direction ?? 'buy',
      constraintFeasible: pair.constraintFeasible ?? true,
      constraintWarning: pair.constraintWarning,
    });

    const bestPairs = highConfidencePairs.map((pair) => formatPairData(pair, 'ready'));

    const topPairsFormatted = topPairs.map((pair) => {
      const status = highConfidencePairs.some((p) => p.symbol === pair.symbol)
        ? 'ready'
        : heatingPairs.some((p) => p.symbol === pair.symbol)
          ? 'heating'
          : 'monitoring';
      return formatPairData(pair, status);
    });

    const allPairsFormatted = allPairs.map((pair) => {
      const status = highConfidencePairs.some((p) => p.symbol === pair.symbol)
        ? 'ready'
        : heatingPairs.some((p) => p.symbol === pair.symbol)
          ? 'heating'
          : 'monitoring';
      return formatPairData(pair, status);
    });

    const styleLabel = (s: string) => s === 'scalp' ? 'Scalp' : s === 'micro' ? 'Micro' : 'Intraday';

    let recommendationText = '';
    if (isTradable && bestPairs.length > 0) {
      const uniqueStyles = [...new Set(bestPairs.map(p => p.tradeStyle))];
      const stylesSummary = uniqueStyles.map(s => styleLabel(s)).join(', ');
      if (bestPairs.length === 1) {
        recommendationText = `${bestPairs[0].symbol} ${styleLabel(bestPairs[0].tradeStyle)} setup at ${bestPairs[0].confidence}%. Market is ${marketCondition}.`;
      } else {
        recommendationText = `${bestPairs.length} setups ≥70% across ${stylesSummary} styles. Top: ${bestPairs[0].symbol} ${styleLabel(bestPairs[0].tradeStyle)} (${bestPairs[0].confidence}%). Market is ${marketCondition}.`;
      }
    } else {
      recommendationText = `No high-probability setups detected right now. Market is ${marketCondition}. Scanning Scalp, Micro and Intraday timeframes for ≥70% alignment.`;
    }

    const expiresAt = new Date(Date.now() + 12 * 60 * 1000);

    const totalPairsAnalyzed = allPairs.length;
    const readyPairsCount = highConfidencePairs.length;
    const heatingPairsCount = heatingPairs.length;

    const hasEnoughData = totalPairsAnalyzed >= 3 && (readyPairsCount > 0 || heatingPairsCount > 0);

    if (!hasEnoughData) {
      console.warn(`[RealTimeIntelligence] Low confidence market: ${totalPairsAnalyzed} analyzed, ${readyPairsCount} ready, ${heatingPairsCount} heating - inserting advisory record`);

      const { error: lowConfUpsertError } = await supabase
        .from('session_intelligence_data')
        .upsert(
          {
            session_name: sessionInfo.name as 'London' | 'New York' | 'Asian',
            session_start_hour: sessionInfo.startHour,
            session_end_hour: sessionInfo.endHour,
            best_pairs: [],
            top_pairs: allPairsFormatted.slice(0, 3),
            all_pair_scores: allPairsFormatted,
            heating_pairs: [],
            market_condition: marketCondition,
            is_tradable: false,
            recommendation_text: `No clear setups at this moment. System continuously scanning all watchlist pairs. High probability setups appear during peak volatility and transition periods.`,
            expires_at: expiresAt.toISOString(),
          },
          { onConflict: 'session_name' }
        );

      const executionTimeMs = Date.now() - executionStart;
      await logExecutionMetrics(
        'stale',
        watchlist.length,
        totalPairsAnalyzed,
        0,
        executionTimeMs,
        lowConfUpsertError?.message
      );

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Low confidence market - advisory record inserted',
          session: sessionInfo.name,
          marketCondition,
          allPairsAnalyzed: totalPairsAnalyzed,
        }),
      };
    }

    const { error: upsertError } = await supabase
      .from('session_intelligence_data')
      .upsert(
        {
          session_name: sessionInfo.name as 'London' | 'New York' | 'Asian',
          session_start_hour: sessionInfo.startHour,
          session_end_hour: sessionInfo.endHour,
          best_pairs: bestPairs,
          top_pairs: topPairsFormatted,
          all_pair_scores: allPairsFormatted,
          heating_pairs: heatingPairs.map((pair) => formatPairData(pair, 'heating')),
          market_condition: marketCondition,
          is_tradable: isTradable,
          recommendation_text: recommendationText,
          expires_at: expiresAt.toISOString(),
        },
        { onConflict: 'session_name' }
      );

    if (upsertError) {
      const executionTimeMs = Date.now() - executionStart;
      console.error('[RealTimeIntelligence] Error upserting data:', upsertError);

      await logExecutionMetrics(
        'error',
        watchlist.length,
        totalPairsAnalyzed,
        readyPairsCount,
        executionTimeMs,
        upsertError.message
      );

      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to upsert intelligence data' }),
      };
    }

    const executionTimeMs = Date.now() - executionStart;
    await logExecutionMetrics('success', watchlist.length, totalPairsAnalyzed, readyPairsCount, executionTimeMs);

    console.log('[RealTimeIntelligence] Successfully updated real-time intelligence');
    if (topPairsFormatted.length > 0) {
      console.log(
        `[RealTimeIntelligence] Top setups: ${topPairsFormatted.map((p) => `${p.symbol} ${p.tradeStyle}/${p.timeframe}(${p.confidence}% ${p.status})`).join(', ')}`
      );
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        session: sessionInfo.name,
        marketCondition,
        readyPairs: highConfidencePairs.length,
        heatingPairs: heatingPairs.length,
        allPairsAnalyzed: allPairs.length,
        topPairs: topPairsFormatted.slice(0, 5).map((p) => ({ symbol: p.symbol, confidence: p.confidence, status: p.status, tradeStyle: p.tradeStyle, timeframe: p.timeframe })),
      }),
    };
  } catch (error) {
    console.error('[RealTimeIntelligence] Fatal error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};

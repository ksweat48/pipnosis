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
 * CCIP Compliant:
 * - Replaced hardcoded session-based probabilities with real-time calculations
 * - Uses intelligent weighting based on time, asset class, and market regime
 * - Shows only pairs ≥70% confidence
 * - Expires data in 3 minutes for freshness
 *
 * Architecture:
 * 1. Fetch all watchlist pairs
 * 2. Calculate real-time probability using indicator alignment + intelligent weights
 * 3. Filter pairs ≥70% confidence
 * 4. Insert data into session_intelligence_data with 3-minute expiration
 */

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { realTimeIntelligenceCalculator } from './_shared/realtime-intelligence-calculator';
import { getCurrentSession } from '../../src/config/intelligent-indicator-weights';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const WATCHLIST = [
  'XAUUSD',
  'US30',
  'NAS100',
  'SPX500',
  'EURUSD',
  'GBPUSD',
  'USDJPY',
  'BTCUSD',
  'ETHUSD',
];

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
  return {
    name: session === 'Overlap' ? 'New York' : session,
    startHour: info.start,
    endHour: info.end,
  };
}

export const handler: Handler = async (event) => {
  console.log('[RealTimeIntelligence] Starting real-time probability analysis...');

  try {
    const sessionInfo = getSessionInfo();
    console.log(
      `[RealTimeIntelligence] Current session: ${sessionInfo.name} (${sessionInfo.startHour}:00 - ${sessionInfo.endHour}:00 EST)`
    );

    const { allPairs, topPairs, highConfidencePairs, heatingPairs, marketCondition, calculatedAt } =
      await realTimeIntelligenceCalculator.calculateForAllPairsWithAllScores(WATCHLIST);

    console.log(`[RealTimeIntelligence] Market regime: ${marketCondition}`);
    console.log(
      `[RealTimeIntelligence] Total pairs analyzed: ${allPairs.length} | Ready (≥70%): ${highConfidencePairs.length} | Heating (50-70%): ${heatingPairs.length}`
    );

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

    let recommendationText = '';
    if (isTradable && bestPairs.length > 0) {
      if (bestPairs.length === 1) {
        recommendationText = `${bestPairs[0].symbol} showing ${bestPairs[0].confidence}% probability right now. Market is ${marketCondition}.`;
      } else if (bestPairs.length === 2) {
        recommendationText = `${bestPairs[0].symbol} and ${bestPairs[1].symbol} showing high probability setups right now. Market is ${marketCondition}.`;
      } else {
        recommendationText = `${bestPairs.length} pairs showing ≥70% probability right now. Top opportunities: ${bestPairs[0].symbol}, ${bestPairs[1].symbol}. Market is ${marketCondition}.`;
      }
    } else {
      recommendationText = `No high-probability setups detected right now. Market is ${marketCondition}. Wait for indicator alignment ≥70%.`;
    }

    const expiresAt = new Date(Date.now() + 3 * 60 * 1000);

    const { data: existingData } = await supabase
      .from('session_intelligence_data')
      .select('id')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingData) {
      await supabase
        .from('session_intelligence_data')
        .delete()
        .eq('id', existingData.id);
    }

    const { error: insertError } = await supabase
      .from('session_intelligence_data')
      .insert({
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
      });

    if (insertError) {
      console.error('[RealTimeIntelligence] Error inserting data:', insertError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to insert intelligence data' }),
      };
    }

    console.log('[RealTimeIntelligence] Successfully updated real-time intelligence');
    if (topPairsFormatted.length > 0) {
      console.log(
        `[RealTimeIntelligence] Top 3 pairs: ${topPairsFormatted.map((p) => `${p.symbol}(${p.confidence}% ${p.status})`).join(', ')}`
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
        topPairs: topPairsFormatted.slice(0, 3).map((p) => ({ symbol: p.symbol, confidence: p.confidence, status: p.status })),
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

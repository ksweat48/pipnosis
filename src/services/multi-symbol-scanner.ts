/**
 * Multi-Symbol Scanner with Ranking System
 *
 * Scans all symbols in watchlist and returns ranked opportunities with explanations.
 * Single LLM call evaluates all symbols simultaneously for efficiency.
 */

import { openAIProxyClient } from './openai-proxy-client';
import { llmSnapshotBuilder } from './llm-snapshot-builder';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';

export interface SymbolRanking {
  symbol: string;
  rank: number; // 1 = best, 2 = second best, etc.
  confidence: number; // 0-100
  reasoning: string;
  stats: {
    userWinRate?: number; // User's historical performance on this symbol
    patternDetected?: string;
    trendStrength?: number;
    volatility?: string;
    supportResistance?: string;
  };
}

export interface ScanResult {
  rankings: SymbolRanking[];
  selectedSymbol: string | null;
  selectedRanking: SymbolRanking | null;
  totalScanned: number;
  aboveThreshold: number;
  scanTimestamp: Date;
}

export class MultiSymbolScanner {
  /**
   * Scans all symbols and returns ranked list
   */
  async scanAndRank(
    userId: string,
    symbols: string[],
    minConfidence: number = 70
  ): Promise<ScanResult> {
    try {
      logger.info('Multi-Symbol Scan Started', { userId, symbols: symbols.length });

      // 1. Build market snapshots for all symbols in parallel
      const snapshotPromises = symbols.map(symbol =>
        this.buildSymbolSnapshot(userId, symbol)
      );
      const snapshots = await Promise.all(snapshotPromises);

      // 2. Single LLM call to rank all symbols
      const rankings = await this.rankSymbolsWithLLM(snapshots, minConfidence);

      // 3. Filter by confidence threshold
      const aboveThreshold = rankings.filter(r => r.confidence >= minConfidence);

      // 4. Select best symbol - ALWAYS pick best, even if below threshold
      // Alpha will make final decision with full context
      let selectedRanking = aboveThreshold.length > 0 ? aboveThreshold[0] : null;
      let belowThresholdWarning = false;

      // Fallback: if no symbols pass, select highest-ranked anyway with warning
      if (!selectedRanking && rankings.length > 0) {
        selectedRanking = rankings[0]; // Best of available, even if below threshold
        belowThresholdWarning = true;
        logger.warn('Multi-Symbol Scan: No symbols above threshold, selecting best available', {
          userId,
          selectedSymbol: selectedRanking.symbol,
          confidence: selectedRanking.confidence,
          threshold: minConfidence
        });
      }

      logger.info('Multi-Symbol Scan Complete', {
        userId,
        totalScanned: symbols.length,
        aboveThreshold: aboveThreshold.length,
        selectedSymbol: selectedRanking?.symbol,
        belowThreshold: belowThresholdWarning
      });

      return {
        rankings,
        selectedSymbol: selectedRanking?.symbol || null,
        selectedRanking,
        totalScanned: symbols.length,
        aboveThreshold: aboveThreshold.length,
        belowThresholdWarning,
        scanTimestamp: new Date()
      };

    } catch (error) {
      logger.error('Multi-Symbol Scan Failed', { error, userId, symbols });
      throw error;
    }
  }

  /**
   * Builds market snapshot + user stats for a symbol
   */
  private async buildSymbolSnapshot(userId: string, symbol: string): Promise<any> {
    // Build technical snapshot
    const technicalSnapshot = await llmSnapshotBuilder.buildSnapshot(symbol, '15m');

    // Get user's historical performance on this symbol
    const { data: strategyMemory } = await supabase
      .from('alpha_strategy_memory')
      .select('win_rate, trades_executed, total_pnl, strategy_mode')
      .eq('user_id', userId)
      .eq('symbol', symbol)
      .gte('trades_executed', 3) // Minimum sample size
      .order('planned_at', { ascending: false })
      .limit(5);

    // Calculate user's average performance on this symbol
    let userWinRate = null;
    if (strategyMemory && strategyMemory.length > 0) {
      const totalTrades = strategyMemory.reduce((sum, s) => sum + s.trades_executed, 0);
      const weightedWinRate = strategyMemory.reduce(
        (sum, s) => sum + (s.win_rate * s.trades_executed),
        0
      ) / totalTrades;
      userWinRate = Math.round(weightedWinRate);
    }

    return {
      symbol,
      technical: technicalSnapshot,
      userStats: {
        winRate: userWinRate,
        tradesCount: strategyMemory?.reduce((sum, s) => sum + s.trades_executed, 0) || 0,
        totalPnl: strategyMemory?.reduce((sum, s) => sum + s.total_pnl, 0) || 0
      }
    };
  }

  /**
   * Single LLM call to rank all symbols
   */
  private async rankSymbolsWithLLM(
    snapshots: any[],
    minConfidence: number
  ): Promise<SymbolRanking[]> {
    const prompt = this.buildRankingPrompt(snapshots, minConfidence);

    const response = await openAIProxyClient.chat({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are an expert forex trader analyzing multiple currency pairs simultaneously.

Your task: Rank all symbols from best to worst trading opportunity RIGHT NOW.

Ranking criteria:
1. Technical setup quality (trend, support/resistance, indicators)
2. User's historical performance on this symbol (win rate matters!)
3. Current market conditions (volatility, momentum)
4. Risk/reward potential

Response format (JSON array, ordered by rank):
[
  {
    "symbol": "EURUSD",
    "rank": 1,
    "confidence": 85,
    "reasoning": "Strong uptrend + support bounce + your 72% win rate on EURUSD",
    "stats": {
      "userWinRate": 72,
      "patternDetected": "trend_continuation",
      "trendStrength": 8,
      "volatility": "medium"
    }
  },
  ...
]

Be decisive. Rank ALL symbols even if some are poor. Explain differences clearly.`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.4,
      max_tokens: 1500
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No ranking response from LLM');
    }

    // Parse JSON array
    const rankings: SymbolRanking[] = JSON.parse(content);

    // Validate structure
    if (!Array.isArray(rankings) || rankings.length === 0) {
      throw new Error('Invalid ranking format from LLM');
    }

    // Ensure ranks are sequential
    rankings.forEach((r, i) => {
      r.rank = i + 1;
    });

    return rankings;
  }

  /**
   * Builds ranking prompt with all symbols
   */
  private buildRankingPrompt(snapshots: any[], minConfidence: number): string {
    const symbolSections = snapshots.map(snap => {
      const { symbol, technical, userStats } = snap;

      return `
## ${symbol}
Current Price: ${technical.currentPrice}
Trend: ${technical.trendDirection || 'unknown'}
RSI: ${technical.rsi?.toFixed(1) || 'N/A'}
Support/Resistance: ${technical.nearestSupport || 'N/A'} / ${technical.nearestResistance || 'N/A'}

**Your Historical Performance on ${symbol}:**
- Win Rate: ${userStats.winRate ? `${userStats.winRate}%` : 'No history'}
- Trades: ${userStats.tradesCount}
- Total P/L: $${userStats.totalPnl?.toFixed(2) || '0.00'}

Technical Snapshot:
${JSON.stringify(technical, null, 2)}
`;
    }).join('\n---\n');

    return `Rank these ${snapshots.length} symbols from best to worst trading opportunity:

${symbolSections}

---

Minimum confidence threshold: ${minConfidence}%

Rank all symbols and explain why #1 is better than #2, #2 better than #3, etc.
Pay special attention to the user's historical win rates on each symbol.

Respond with JSON array only (no markdown).`;
  }

  /**
   * Logs ranking to database for transparency
   */
  async logRanking(
    userId: string,
    goalSessionId: string,
    result: ScanResult
  ): Promise<void> {
    try {
      const { rankings, selectedSymbol, selectedRanking, totalScanned, aboveThreshold } = result;

      await supabase.from('goal_symbol_rankings').insert({
        user_id: userId,
        goal_session_id: goalSessionId,
        scan_time: result.scanTimestamp.toISOString(),
        rankings: rankings,
        selected_symbol: selectedSymbol,
        selected_rank: selectedRanking?.rank || null,
        selected_confidence: selectedRanking?.confidence || null,
        selected_reasoning: selectedRanking?.reasoning || null,
        total_symbols_scanned: totalScanned,
        symbols_above_threshold: aboveThreshold,
        highest_confidence: rankings[0]?.confidence || 0,
        lowest_confidence: rankings[rankings.length - 1]?.confidence || 0
      });

      logger.info('Symbol ranking logged', { userId, goalSessionId, selectedSymbol });

    } catch (error) {
      logger.error('Failed to log symbol ranking', { error, userId, goalSessionId });
    }
  }
}

export const multiSymbolScanner = new MultiSymbolScanner();

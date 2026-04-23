/**
 * Multi-Symbol Market Snapshot Builder
 *
 * ✅ SSOT COMPLIANT: Now uses MarketSnapshotCache for all snapshots
 * Previously built snapshots manually, causing price drift and cache bypassing
 *
 * REFACTOR (2026-01-06): Migrated to use shared-intelligence-coordinator-refactored
 * - Uses MarketSnapshotCache internally
 * - Shares cache with goal-scanner and alpha-omega-orchestrator
 * - 80-90% reduction in DB queries
 * - Zero price drift between components
 */

import { sharedIntelligenceCoordinator } from './shared-intelligence-coordinator';
import type { MarketSnapshotData } from './market-snapshot-cache';
import type { OmegaSensors } from './omega-sensors';
import type { RegimeSnapshot } from './regime-oracle';
import type { AdversarialSignal } from './adversarial-detector';
import { logger } from '../lib/logger';
import type { ATRValue } from '../types/atr';
import { resolveCanonicalStyle, getStyleMTFConfig } from '../config/timeframe-hierarchy';

/**
 * Market snapshot for a single symbol
 * Contains technical indicators, structure analysis, and regime detection
 */
export interface SymbolSnapshot {
  symbol: string;
  price: number;      // Last closed candle close — used for structural analysis (EMA, VWAP, regime)
  livePrice?: number; // Live market mid price at snapshot build time — Alpha uses this for entry planning
  ema20: number;
  ema50: number;
  ema200: number;
  rsi: number;
  stochRsi: number;
  /**
   * Average True Range with EXPLICIT timeframe tracking
   *
   * CRITICAL: This is now a typed ATRValue (not raw number)
   * - Contains: value (price units), timeframe, period
   * - Enforces SSOT: timeframe cannot be ambiguous
   * - Validates consistency: ATR must match candle structure
   *
   * See /src/types/atr.ts for official ATR contract
   */
  atr: ATRValue;
  vwap: number;
  trend: string;
  trendScore: number;
  volatility: string;
  momentum: number;
  support: number[];
  resistance: number[];
  swingHigh: number;
  swingLow: number;
  recentCandles: any[];
  structure: {
    hh: boolean;
    hl: boolean;
    lh: boolean;
    ll: boolean;
  };
  omegaSensors: OmegaSensors;
  regime: RegimeSnapshot;
  adversarial: AdversarialSignal;
  tradeable: boolean;
  blockReason?: string;
  fetchedAt: Date;
}

export interface MultiSymbolSnapshotResult {
  snapshots: SymbolSnapshot[];
  tradeableSymbols: string[];
  blockedSymbols: Map<string, string>;
  timestamp: Date;
}

class MultiSymbolSnapshotBuilder {
  /**
   * ✅ SSOT COMPLIANT: Build snapshots using MarketSnapshotCache
   *
   * CCIP-STYLE-TF-2026: tradeStyle is the authoritative source for entry timeframe.
   * riskMode parameter has been removed — it only controls financial exposure.
   *
   * Benefits:
   * - Shares cache with goal-scanner and alpha-omega-orchestrator
   * - 80-90% reduction in DB queries (cache hits)
   * - Zero price drift between components
   * - Consistent data across entire system
   */
  async buildSnapshots(
    symbols: string[],
    tradeStyle?: string
  ): Promise<MultiSymbolSnapshotResult> {
    const canonicalStyle = resolveCanonicalStyle(tradeStyle, 'MICRO_INTRADAY');
    const timeframe = getStyleMTFConfig(canonicalStyle).entryTimeframe;

    console.log(`[Multi-Symbol] Building snapshots for ${symbols.length} symbols using cache... Style: ${canonicalStyle} -> TF: ${timeframe}`);
    const startTime = Date.now();

    // Build snapshots in batches of 3 with a stagger between batches.
    // Prevents a thundering herd of simultaneous cold-start DB queries against
    // the forex_candles_best view when the cache is empty (session start / hard refresh).
    // Warm cache hits are near-instant so the stagger adds negligible latency in
    // steady state.
    //
    // CCIP-2026-0424A: M1 (SCALP) sessions use a 700ms inter-batch delay instead of 300ms.
    // M1 rows are dense and expensive; 3 simultaneous M1 queries at cold start were
    // sufficient to trigger PostgreSQL statement timeouts (57014). The larger delay gives
    // the DB time to drain the first batch before the next starts. Non-M1 timeframes
    // retain the original 300ms delay (fast, warm-cache-friendly).
    const BATCH_SIZE = 3;
    const BATCH_DELAY_MS = timeframe === 'M1' ? 700 : 300;
    const allResults: (SymbolSnapshot | null)[] = [];

    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
      const batch = symbols.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(symbol =>
          sharedIntelligenceCoordinator.getMarketSnapshot(symbol, timeframe)
            .then(snapshot => snapshot ? this.convertToSymbolSnapshot(snapshot) : null)
            .catch(error => {
              console.error(`[Multi-Symbol] Failed to build snapshot for ${symbol}:`, error.message);
              return null;
            })
        )
      );
      allResults.push(...batchResults);
    }

    const snapshots = allResults.filter((s): s is SymbolSnapshot => s !== null);

    const tradeableSymbols = snapshots.filter(s => s.tradeable).map(s => s.symbol);
    const blockedSymbols = new Map<string, string>();
    snapshots.filter(s => !s.tradeable).forEach(s => {
      if (s.blockReason) {
        blockedSymbols.set(s.symbol, s.blockReason);
      }
    });

    const duration = Date.now() - startTime;
    console.log(`[Multi-Symbol] ✅ Built ${snapshots.length} snapshots in ${duration}ms (cache-powered)`);
    console.log(`[Multi-Symbol] Tradeable: ${tradeableSymbols.length}, Blocked: ${blockedSymbols.size}`);

    return {
      snapshots,
      tradeableSymbols,
      blockedSymbols,
      timestamp: new Date()
    };
  }

  /**
   * Adapter: Convert MarketSnapshotData to SymbolSnapshot
   * Maintains backward compatibility with existing consumers
   */
  private convertToSymbolSnapshot(snapshot: MarketSnapshotData): SymbolSnapshot {
    return {
      symbol: snapshot.symbol,
      price: snapshot.price,
      livePrice: snapshot.livePrice,
      ema20: snapshot.ema20,
      ema50: snapshot.ema50,
      ema200: snapshot.ema200,
      rsi: snapshot.rsi,
      stochRsi: snapshot.stochRsi,
      atr: snapshot.atr, // Already typed as ATRValue
      vwap: snapshot.vwap,
      trend: snapshot.trend,
      trendScore: snapshot.trendScore,
      volatility: snapshot.volatility,
      momentum: snapshot.momentum,
      support: snapshot.support,
      resistance: snapshot.resistance,
      swingHigh: snapshot.swingHigh,
      swingLow: snapshot.swingLow,
      recentCandles: snapshot.candles,
      structure: snapshot.structure,
      omegaSensors: snapshot.omegaSensors,
      regime: snapshot.regime,
      adversarial: snapshot.adversarial,
      tradeable: snapshot.tradeable,
      blockReason: snapshot.blockReason,
      fetchedAt: snapshot.fetchedAt
    };
  }

  /**
   * REMOVED: buildSingleSnapshot and helper methods
   *
   * Now delegated to MarketSnapshotCache via sharedIntelligenceCoordinator
   * All indicator calculations, regime detection, and adversarial analysis
   * are handled by the cache layer for consistency across the system
   */
}

export const multiSymbolSnapshotBuilder = new MultiSymbolSnapshotBuilder();

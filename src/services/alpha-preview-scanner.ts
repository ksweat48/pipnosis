/**
 * Alpha Preview Scanner
 *
 * SSOT Authority: Runs the identical Alpha pipeline used by goal-session-live-engine,
 * stopping BEFORE alphaTradeExecutor.execute(). Provides a scan-only preview of
 * what Alpha would trade right now.
 *
 * CCIP Compliance:
 * - Uses multiSymbolSnapshotBuilder (same as live engine)
 * - Uses alphaOmegaOrchestrator.evaluateMultipleSymbols (same as live engine)
 * - Uses bestSymbolSelector.selectBestSymbol (same as live engine)
 * - NEVER calls alphaTradeExecutor — scan-only mode
 *
 * Governance:
 * - Eliminates the dual-system problem: IM cards now show Alpha's real %
 * - Works standalone (no active goal session required)
 * - Cooldown is enforced platform-wide via platformScanManager (database timestamp)
 *   NOT per-instance memory. SessionIntelligenceMonitor checks cooldown before
 *   calling scan(). This scanner only enforces in-flight deduplication.
 * - Market hours awareness: respects forex market schedule
 */

import { multiSymbolSnapshotBuilder } from './multi-symbol-snapshot-builder';
import { alphaOmegaOrchestrator, type FullMarketState } from './alpha-omega-orchestrator';
import { bestSymbolSelector } from './best-symbol-selector';
import { getDefaultWatchlist } from '../config/watchlist';
import type { TraderScore } from './ai-identity';
import { safeExtractATRValue } from '../types/atr';
import { isSymbolMarketOpen, getForexMarketStatus } from '../utils/marketHours';

export type PreviewCardStatus = 'ready';

export interface AlphaPreviewCard {
  symbol: string;
  direction: 'buy' | 'sell';
  confidence: number;
  tradeStyle: string;
  timeframe: string;
  reasoning: string;
  status: PreviewCardStatus;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  tp1Price?: number | null;
  tp2Price?: number;
}

export interface AlphaPreviewScanResult {
  ready: AlphaPreviewCard[];
  heatingCount: number;
  scannedCount: number;
  scannedAt: Date;
  scanDurationMs: number;
}

const SCAN_TIMEOUT_MS = 180_000;

const STYLE_TO_TIMEFRAME: Record<string, string> = {
  scalper: 'M5',
  scalp: 'M5',
  micro: 'M15',
  micro_intraday: 'M15',
  intraday: 'H1',
  SCALP: 'M5',
  MICRO_INTRADAY: 'M15',
  INTRADAY: 'H1',
};

const DEFAULT_TRADER_SCORE: TraderScore = {
  current_score: 50,
  lifetime_profit: 0,
  lifetime_loss: 0,
  streak_wins: 0,
  streak_losses: 0,
  confidence_level: 'balanced',
  risk_appetite: 3.0,
  trading_style: 'steady',
  total_trades: 0,
  win_rate: 0,
};

class AlphaPreviewScanner {
  private scanning = false;

  get isScanning(): boolean {
    return this.scanning;
  }

  async scan(): Promise<AlphaPreviewScanResult> {
    if (this.scanning) {
      throw new Error('Scan already in progress');
    }

    this.scanning = true;
    const startTime = Date.now();

    try {
      const watchlist = getDefaultWatchlist();
      const symbols = watchlist.filter((s) => isSymbolMarketOpen(s));
      const uniqueSymbols = [...new Set(symbols)];

      if (uniqueSymbols.length === 0) {
        return {
          ready: [],
          heatingCount: 0,
          scannedCount: 0,
          scannedAt: new Date(),
          scanDurationMs: Date.now() - startTime,
        };
      }

      const snapshotResult = await multiSymbolSnapshotBuilder.buildSnapshots(uniqueSymbols, 'medium');
      const tradeableSnapshots = snapshotResult.snapshots.filter((s) => s.tradeable);

      if (tradeableSnapshots.length === 0) {
        return {
          ready: [],
          heatingCount: 0,
          scannedCount: uniqueSymbols.length,
          scannedAt: new Date(),
          scanDurationMs: Date.now() - startTime,
        };
      }

      const marketStates: FullMarketState[] = tradeableSnapshots.map((snapshot) => ({
        symbol: snapshot.symbol,
        price: snapshot.price,
        ema20: snapshot.ema20,
        ema50: snapshot.ema50,
        ema200: snapshot.ema200,
        rsi: snapshot.rsi,
        stochRsi: snapshot.stochRsi,
        atr: safeExtractATRValue(snapshot.atr, `AlphaPreview.${snapshot.symbol}`),
        vwap: snapshot.vwap,
        trend: snapshot.trend,
        volatility: snapshot.volatility,
        momentum: snapshot.momentum,
        support: snapshot.support,
        resistance: snapshot.resistance,
        swingHigh: snapshot.swingHigh,
        swingLow: snapshot.swingLow,
        recentCandles: snapshot.recentCandles,
        structure: snapshot.structure,
        omegaSensors: snapshot.omegaSensors,
        regime: snapshot.regime,
        adversarial: snapshot.adversarial,
      }));

      const councilPromise = alphaOmegaOrchestrator.evaluateMultipleSymbols(
        marketStates,
        DEFAULT_TRADER_SCORE
      );

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('Alpha evaluation timed out after 3 minutes')),
          SCAN_TIMEOUT_MS
        );
      });

      const omegaDecisions = await Promise.race([councilPromise, timeoutPromise]);

      const selectorResult = bestSymbolSelector.selectBestSymbol(
        tradeableSnapshots,
        omegaDecisions
      );

      const ready: AlphaPreviewCard[] = [];
      let heatingCount = 0;

      for (const evaluation of selectorResult.allEvaluations) {
        const decision = evaluation.omegaDecision;
        const allGatesPassed = evaluation.eligibility.every((check) => check.passed);

        if (allGatesPassed && (decision.action === 'BUY' || decision.action === 'SELL')) {
          const style = (decision as any).tradeStyle ?? (decision.resolvedStyle as string) ?? 'micro';
          ready.push({
            symbol: evaluation.symbol,
            direction: decision.action === 'BUY' ? 'buy' : 'sell',
            confidence: decision.confidence,
            tradeStyle: style,
            timeframe: STYLE_TO_TIMEFRAME[style] ?? 'M15',
            reasoning: decision.reasoning ?? '',
            status: 'ready',
            entry: decision.entry,
            stopLoss: decision.stopLoss,
            takeProfit: decision.takeProfit,
            tp1Price: decision.tp1Price ?? null,
            tp2Price: decision.tp2Price,
          });
        }
      }

      for (const [symbol, decision] of omegaDecisions.entries()) {
        if (decision.action === 'BUY' || decision.action === 'SELL') {
          const alreadyReady = ready.find((r) => r.symbol === symbol);
          if (!alreadyReady) {
            heatingCount++;
          }
        }
      }

      ready.sort((a, b) => b.confidence - a.confidence);

      return {
        ready,
        heatingCount,
        scannedCount: uniqueSymbols.length,
        scannedAt: new Date(),
        scanDurationMs: Date.now() - startTime,
      };
    } finally {
      this.scanning = false;
    }
  }
}

export const alphaPreviewScanner = new AlphaPreviewScanner();

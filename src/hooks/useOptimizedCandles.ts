/**
 * React Hook for Optimized Candle Management
 *
 * Provides real-time candle data with minimal resource usage:
 * - Auto-subscribes to Realtime for completed candles
 * - Polls forming candle only
 * - Returns cached data instantly
 * - Auto-cleanup on unmount
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { optimizedCandleManager } from '@/services/optimized-candle-manager';
import { Timeframe } from '@/services/chart-preferences';
import { CandleData } from '@/services/candle-data-service';
import { logger, LogCategory } from '@/lib/logger';
import { getDisplayLimit } from '@/utils/timeframe-candle-limits';
import { candleQualityEnhancer } from '@/services/candle-quality-enhancer';

interface UseOptimizedCandlesOptions {
  symbol: string;
  timeframe: Timeframe;
  enabled?: boolean;
  onCandleUpdate?: (candle: CandleData, isComplete: boolean) => void;
}

interface UseOptimizedCandlesReturn {
  candles: CandleData[];
  formingCandle: CandleData | null;
  isLoading: boolean;
  error: string | null;
  lastUpdate: Date | null;
  refresh: () => Promise<void>;
  stats: {
    tabId: string;
    isLeaderTab: boolean;
    totalCachedCandles: number;
  };
}

export function useOptimizedCandles({
  symbol,
  timeframe,
  enabled = true,
  onCandleUpdate
}: UseOptimizedCandlesOptions): UseOptimizedCandlesReturn {
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [formingCandle, setFormingCandle] = useState<CandleData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const currentSymbolRef = useRef(symbol);
  const currentTimeframeRef = useRef(timeframe);

  // Load initial historical data
  const loadHistoricalData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Try cache first (instant)
      const cached = optimizedCandleManager.getCachedCandles(symbol, timeframe);
      if (cached.length > 0) {
        const completed = cached.filter(c => !(c as any).isComplete === false);
        const forming = cached.find(c => (c as any).isComplete === false) || null;

        // Enhance candles before displaying
        const enhanced = await candleQualityEnhancer.enhanceCandles(completed, symbol, timeframe);

        setCandles(enhanced.candles);
        setFormingCandle(forming);
        setLastUpdate(new Date());
        setIsLoading(false);
        logger.debug(LogCategory.CHART_POLLER, `Loaded ${cached.length} cached candles for ${symbol} ${timeframe} (enhanced: ${enhanced.stats.gapsFilled} gaps, ${enhanced.stats.wicksReconstructed} wicks)`);
        return;
      }

      // Fetch from database if not cached - use dynamic limit per timeframe
      const limit = getDisplayLimit(timeframe);
      const historical = await optimizedCandleManager.getHistoricalCandles(symbol, timeframe, limit);

      // Enhance candles before displaying
      const enhanced = await candleQualityEnhancer.enhanceCandles(historical, symbol, timeframe);

      setCandles(enhanced.candles);
      setLastUpdate(new Date());
      setIsLoading(false);

      logger.info(LogCategory.CHART_POLLER, `Loaded ${enhanced.candles.length}/${limit} historical candles for ${symbol} ${timeframe} (enhanced: ${enhanced.stats.gapsFilled} gaps, ${enhanced.stats.wicksReconstructed} wicks)`);
    } catch (err) {
      logger.error(LogCategory.CHART_POLLER, 'Error loading historical data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load candle data');
      setIsLoading(false);
    }
  }, [symbol, timeframe]);

  // Handle candle updates from manager
  const handleCandleUpdate = useCallback(async (update: any) => {
    const { candle, symbol: updateSymbol, timeframe: updateTimeframe } = update;
    const isComplete = (candle as any).isComplete !== false;

    if (isComplete) {
      // New completed candle - enhance before adding
      setCandles(prev => {
        // Check if candle already exists
        const exists = prev.some(c => c.time === candle.time);
        let updatedCandles: CandleData[];

        if (exists) {
          // Update existing
          updatedCandles = prev.map(c => c.time === candle.time ? candle : c);
        } else {
          // Add new
          updatedCandles = [...prev, candle].sort((a, b) => a.time - b.time);
        }

        // Enhance in background (async, won't block state update)
        candleQualityEnhancer.enhanceCandles(
          updatedCandles,
          updateSymbol || currentSymbolRef.current,
          updateTimeframe || currentTimeframeRef.current,
          { useCache: true }
        ).then(enhanced => {
          // Update with enhanced candles if they've changed
          if (enhanced.stats.gapsFilled > 0 || enhanced.stats.wicksReconstructed > 0) {
            setCandles(enhanced.candles);
            logger.debug(LogCategory.CHART_POLLER,
              `Enhanced candles after update (gaps: ${enhanced.stats.gapsFilled}, wicks: ${enhanced.stats.wicksReconstructed})`
            );
          }
        }).catch(err => {
          logger.warn(LogCategory.CHART_POLLER, 'Background enhancement failed:', err);
        });

        return updatedCandles;
      });

      // Clear forming candle if it matches
      setFormingCandle(prev => {
        if (prev && prev.time === candle.time) {
          return null;
        }
        return prev;
      });

      logger.debug(LogCategory.CHART_POLLER, `Completed candle received: ${updateSymbol} @ ${new Date(candle.time * 1000).toISOString()}`);
    } else {
      // Update forming candle (already enhanced by current-candle-reconstructor)
      setFormingCandle(candle);
    }

    setLastUpdate(new Date());

    // Call user callback
    if (onCandleUpdate) {
      onCandleUpdate(candle, isComplete);
    }
  }, [onCandleUpdate]);

  // Subscribe to candle updates
  useEffect(() => {
    if (!enabled) return;

    currentSymbolRef.current = symbol;
    currentTimeframeRef.current = timeframe;

    // Load initial data
    loadHistoricalData();

    // Subscribe to real-time updates
    optimizedCandleManager.subscribe(symbol, timeframe, handleCandleUpdate);

    logger.info(LogCategory.CHART_POLLER, `Subscribed to ${symbol} ${timeframe} via optimized manager`);

    // Cleanup
    return () => {
      optimizedCandleManager.unsubscribe(symbol, timeframe, handleCandleUpdate);
      logger.debug(LogCategory.CHART_POLLER, `Unsubscribed from ${symbol} ${timeframe}`);
    };
  }, [symbol, timeframe, enabled, loadHistoricalData, handleCandleUpdate]);

  // Manual refresh function
  const refresh = useCallback(async () => {
    await loadHistoricalData();
  }, [loadHistoricalData]);

  // Get current stats
  const stats = optimizedCandleManager.getStats();

  return {
    candles,
    formingCandle,
    isLoading,
    error,
    lastUpdate,
    refresh,
    stats
  };
}

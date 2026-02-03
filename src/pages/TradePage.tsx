import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BottomNavigation } from '@/components/BottomNavigation';
import { MarketChart } from '@/components/MarketChart';
import { supabase } from '@/lib/supabase';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { chartPreferencesService } from '@/services/chart-preferences';
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator';

export function TradePage() {
  const [searchParams] = useSearchParams();
  const [selectedSymbol, setSelectedSymbol] = useState<string>(() => chartPreferencesService.getSelectedSymbol());
  const [tradeLines, setTradeLines] = useState<{
    entry?: number;
    stopLoss?: number;
    takeProfit?: number;
    tp1?: number;
    tp2?: number;
  }>({});

  // Governance: Preserve scroll position during real-time updates to prevent UI jumping
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const previousScrollTopRef = useRef<number>(0);

  // Handle symbol change with persistence
  const handleSymbolChange = useCallback((symbol: string) => {
    setSelectedSymbol(symbol);
    chartPreferencesService.setSelectedSymbol(symbol);
  }, []);

  // Read symbol from URL query parameter on mount
  useEffect(() => {
    const symbolFromUrl = searchParams.get('symbol');
    if (symbolFromUrl) {
      handleSymbolChange(symbolFromUrl);
    }
  }, [searchParams, handleSymbolChange]);

  // Pull-to-refresh functionality
  const pullToRefresh = usePullToRefresh({
    onRefresh: async () => {
      window.location.reload();
    },
    enabled: true
  });

  // SSOT: Deep equality check to prevent unnecessary re-renders and scroll jumping
  const tradeLinesEqual = (a: typeof tradeLines, b: typeof tradeLines): boolean => {
    return a.entry === b.entry &&
           a.stopLoss === b.stopLoss &&
           a.takeProfit === b.takeProfit &&
           a.tp1 === b.tp1 &&
           a.tp2 === b.tp2;
  };

  // Governance: Preserve scroll position during state updates
  const updateTradeLinesWithScrollPreservation = useCallback((newLines: typeof tradeLines) => {
    // Only update if values actually changed (prevent unnecessary re-renders)
    setTradeLines(prevLines => {
      if (tradeLinesEqual(prevLines, newLines)) {
        return prevLines; // No change, prevent re-render
      }

      // Capture scroll position before update
      if (scrollContainerRef.current) {
        previousScrollTopRef.current = scrollContainerRef.current.scrollTop;
      }

      // Schedule scroll restoration after React's commit phase
      requestAnimationFrame(() => {
        if (scrollContainerRef.current && previousScrollTopRef.current > 0) {
          scrollContainerRef.current.scrollTop = previousScrollTopRef.current;
        }
      });

      return newLines;
    });
  }, []);

  // Fetch open trades for current symbol and display TP/SL lines on chart
  useEffect(() => {
    // Clear stale trade lines immediately when symbol changes
    updateTradeLinesWithScrollPreservation({});

    const fetchOpenTrades = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          updateTradeLinesWithScrollPreservation({});
          return;
        }

        const { data: trades, error } = await supabase
          .from('goal_session_trades')
          .select('entry_price, stop_loss, take_profit, tp1_price, tp2_price')
          .eq('user_id', user.id)
          .eq('symbol', selectedSymbol)
          .in('status', ['open', 'pending'])
          .order('opened_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          console.error('[TradePage] Error fetching open trades:', error);
          updateTradeLinesWithScrollPreservation({});
          return;
        }

        if (trades) {
          updateTradeLinesWithScrollPreservation({
            entry: parseFloat(trades.entry_price),
            stopLoss: parseFloat(trades.stop_loss),
            takeProfit: parseFloat(trades.take_profit),
            tp1: trades.tp1_price ? parseFloat(trades.tp1_price) : undefined,
            tp2: trades.tp2_price ? parseFloat(trades.tp2_price) : undefined
          });
        } else {
          updateTradeLinesWithScrollPreservation({});
        }
      } catch (error) {
        console.error('[TradePage] Error in fetchOpenTrades:', error);
        updateTradeLinesWithScrollPreservation({});
      }
    };

    fetchOpenTrades();

    // Subscribe to real-time updates for goal_session_trades (user_id filter handled by RLS)
    const channel = supabase
      .channel('goal_session_trades_updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'goal_session_trades',
          filter: `symbol=eq.${selectedSymbol}`
        },
        () => {
          fetchOpenTrades();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedSymbol, updateTradeLinesWithScrollPreservation]);

  return (
    <div
      ref={(node) => {
        // Dual ref assignment: pullToRefresh and scroll container
        if (pullToRefresh.containerRef) {
          (pullToRefresh.containerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }
        scrollContainerRef.current = node;
      }}
      className="h-screen w-screen overflow-hidden bg-gray-950 flex flex-col"
    >
      <PullToRefreshIndicator
        isPulling={pullToRefresh.isPulling}
        isRefreshing={pullToRefresh.isRefreshing}
        pullDistance={pullToRefresh.pullDistance}
        threshold={pullToRefresh.threshold}
      />

      <div className="flex-1 overflow-hidden">
        <MarketChart
          symbol={selectedSymbol}
          onSymbolChange={handleSymbolChange}
          tradeLines={tradeLines}
        />
      </div>

      <BottomNavigation />
    </div>
  );
}

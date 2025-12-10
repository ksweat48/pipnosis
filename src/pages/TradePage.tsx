import React, { useState, useEffect, useCallback } from 'react';
import { NavigationMenu } from '@/components/NavigationMenu';
import { BottomNavigation } from '@/components/BottomNavigation';
import { MarketChart } from '@/components/MarketChart';
import { supabase } from '@/lib/supabase';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { chartPreferencesService } from '@/services/chart-preferences';
import { RefreshCw } from 'lucide-react';
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator';

export function TradePage() {
  const [selectedSymbol, setSelectedSymbol] = useState<string>(() => chartPreferencesService.getSelectedSymbol());
  const [tradeLines, setTradeLines] = useState<{
    entry?: number;
    stopLoss?: number;
    takeProfit?: number;
  }>({});

  // Handle symbol change with persistence
  const handleSymbolChange = useCallback((symbol: string) => {
    setSelectedSymbol(symbol);
    chartPreferencesService.setSelectedSymbol(symbol);
  }, []);

  // Pull-to-refresh functionality
  const pullToRefresh = usePullToRefresh({
    onRefresh: async () => {
      window.location.reload();
    },
    enabled: true
  });

  // Fetch open trades for current symbol and display TP/SL lines on chart
  useEffect(() => {
    const fetchOpenTrades = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: trades, error } = await supabase
          .from('goal_session_trades')
          .select('entry_price, stop_loss, take_profit')
          .eq('symbol', selectedSymbol)
          .in('status', ['open', 'pending'])
          .order('opened_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          console.error('[TradePage] Error fetching open trades:', error);
          setTradeLines({});
          return;
        }

        if (trades) {
          setTradeLines({
            entry: parseFloat(trades.entry_price),
            stopLoss: parseFloat(trades.stop_loss),
            takeProfit: parseFloat(trades.take_profit)
          });
        } else {
          setTradeLines({});
        }
      } catch (error) {
        console.error('[TradePage] Error in fetchOpenTrades:', error);
        setTradeLines({});
      }
    };

    fetchOpenTrades();

    // Subscribe to real-time updates for goal_session_trades
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
  }, [selectedSymbol]);

  return (
    <div ref={pullToRefresh.containerRef} className="h-screen w-screen overflow-hidden bg-gray-950 flex flex-col">
      <PullToRefreshIndicator
        isPulling={pullToRefresh.isPulling}
        isRefreshing={pullToRefresh.isRefreshing}
        pullDistance={pullToRefresh.pullDistance}
        threshold={pullToRefresh.threshold}
      />

      <NavigationMenu />

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

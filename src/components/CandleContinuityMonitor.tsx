import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Activity, CheckCircle, AlertCircle, XCircle, RefreshCw, Database } from 'lucide-react';

interface GapFillStats {
  symbol: string;
  timeframe: string;
  gaps_filled: number;
  candles_created: number;
}

interface TimeframeHealth {
  timeframe: string;
  totalCandles: number;
  expectedCandles: number;
  completeness: number;
  hasGaps: boolean;
}

interface SymbolHealth {
  symbol: string;
  timeframes: TimeframeHealth[];
  overallHealth: number;
}

export default function CandleContinuityMonitor() {
  const [symbolHealth, setSymbolHealth] = useState<SymbolHealth[]>([]);
  const [recentGapFills, setRecentGapFills] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isManualFilling, setIsManualFilling] = useState(false);

  const SYMBOLS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];
  const TIMEFRAMES = ['m1', 'm5', 'm15', 'm30', 'h1', 'h4', 'd1', 'w1'];

  useEffect(() => {
    loadHealthStats();
    loadRecentGapFills();

    const interval = setInterval(() => {
      loadHealthStats();
      loadRecentGapFills();
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, []);

  const loadHealthStats = async () => {
    try {
      setIsLoading(true);

      const healthData: SymbolHealth[] = [];

      for (const symbol of SYMBOLS) {
        const timeframeData: TimeframeHealth[] = [];

        for (const timeframe of TIMEFRAMES) {
          // Get candle count for last 24 hours
          const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

          const { count, error } = await supabase
            .from('forex_candles')
            .select('*', { count: 'exact', head: true })
            .eq('symbol', symbol)
            .eq('timeframe', timeframe)
            .gte('open_time', oneDayAgo);

          if (!error) {
            // Calculate expected candles based on timeframe
            const intervalMinutes = getTimeframeMinutes(timeframe);
            const expectedCandles = Math.floor((24 * 60) / intervalMinutes);
            const actualCandles = count || 0;
            const completeness = (actualCandles / expectedCandles) * 100;

            timeframeData.push({
              timeframe,
              totalCandles: actualCandles,
              expectedCandles,
              completeness: Math.min(completeness, 100),
              hasGaps: completeness < 95
            });
          }
        }

        const overallHealth =
          timeframeData.reduce((sum, tf) => sum + tf.completeness, 0) / timeframeData.length;

        healthData.push({
          symbol,
          timeframes: timeframeData,
          overallHealth
        });
      }

      setSymbolHealth(healthData);
      setLastUpdate(new Date());
    } catch (error) {
      console.error('Error loading health stats:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadRecentGapFills = async () => {
    try {
      const { data, error } = await supabase
        .from('candle_gap_fill_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      if (!error && data) {
        setRecentGapFills(data);
      }
    } catch (error) {
      console.error('Error loading gap fills:', error);
    }
  };

  const getTimeframeMinutes = (timeframe: string): number => {
    const map: Record<string, number> = {
      m1: 1,
      m5: 5,
      m15: 15,
      m30: 30,
      h1: 60,
      h4: 240,
      d1: 1440,
      w1: 10080
    };
    return map[timeframe] || 15;
  };

  const manualFillGaps = async () => {
    setIsManualFilling(true);
    try {
      const { data, error } = await supabase.rpc('auto_fill_all_gaps', {
        p_lookback_hours: 24
      });

      if (error) {
        console.error('Error filling gaps:', error);
        alert('Failed to fill gaps. Check console for details.');
      } else {
        const results = data as GapFillStats[];
        const totalGaps = results.reduce((sum, r) => sum + r.gaps_filled, 0);
        const totalCandles = results.reduce((sum, r) => sum + r.candles_created, 0);

        if (totalCandles > 0) {
          alert(`✅ Gap fill complete!\n\n${totalGaps} gaps filled\n${totalCandles} candles created`);
        } else {
          alert('✨ No gaps found! Your data is already complete.');
        }

        await loadHealthStats();
        await loadRecentGapFills();
      }
    } catch (error) {
      console.error('Error in manual gap fill:', error);
      alert('Unexpected error during gap fill');
    } finally {
      setIsManualFilling(false);
    }
  };

  const getHealthColor = (health: number): string => {
    if (health >= 95) return 'text-green-500';
    if (health >= 85) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getHealthIcon = (health: number) => {
    if (health >= 95) return <CheckCircle className="w-5 h-5 text-green-500" />;
    if (health >= 85) return <AlertCircle className="w-5 h-5 text-yellow-500" />;
    return <XCircle className="w-5 h-5 text-red-500" />;
  };

  if (isLoading && symbolHealth.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <div className="flex items-center justify-center">
          <div className="animate-spin h-8 w-8 border-4 border-blue-500/30 border-t-blue-500 rounded-full"></div>
          <span className="ml-3 text-gray-300">Loading candle health data...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-900/50 to-purple-900/50 rounded-lg p-6 border border-blue-700/50">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <Activity className="w-6 h-6 text-blue-400" />
              Candle Continuity Monitor
            </h2>
            <p className="text-gray-300 text-sm mt-1">
              Real-time monitoring of candle data completeness and gap filling operations
            </p>
          </div>
          <button
            onClick={manualFillGaps}
            disabled={isManualFilling}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-lg font-semibold flex items-center gap-2 transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${isManualFilling ? 'animate-spin' : ''}`} />
            {isManualFilling ? 'Filling Gaps...' : 'Fill Gaps Now'}
          </button>
        </div>
        {lastUpdate && (
          <div className="mt-3 text-xs text-gray-400">
            Last updated: {lastUpdate.toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* Symbol Health Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {symbolHealth.map(sh => (
          <div key={sh.symbol} className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-white">{sh.symbol}</h3>
              <div className="flex items-center gap-2">
                {getHealthIcon(sh.overallHealth)}
                <span className={`font-bold ${getHealthColor(sh.overallHealth)}`}>
                  {sh.overallHealth.toFixed(1)}%
                </span>
              </div>
            </div>

            <div className="space-y-2">
              {sh.timeframes.map(tf => (
                <div key={tf.timeframe} className="flex items-center justify-between text-sm">
                  <span className="text-gray-400 uppercase">{tf.timeframe}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 text-xs">
                      {tf.totalCandles}/{tf.expectedCandles}
                    </span>
                    <span className={`font-semibold ${getHealthColor(tf.completeness)}`}>
                      {tf.completeness.toFixed(0)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Recent Gap Fills */}
      {recentGapFills.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Database className="w-5 h-5 text-blue-400" />
            Recent Gap Fill Operations
          </h3>

          <div className="space-y-3">
            {recentGapFills.map((fill, idx) => (
              <div key={idx} className="bg-gray-900/50 rounded-lg p-3 border border-gray-700">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-white">{fill.symbol}</span>
                      <span className="px-2 py-0.5 bg-blue-600/30 text-blue-300 text-xs rounded uppercase">
                        {fill.timeframe}
                      </span>
                      <span className="text-gray-500 text-xs">
                        {new Date(fill.created_at).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-sm text-gray-400">
                      Gap: {new Date(fill.gap_start_time).toLocaleTimeString()} →{' '}
                      {new Date(fill.gap_end_time).toLocaleTimeString()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-green-400 font-bold">{fill.candles_filled} candles</div>
                    <div className="text-xs text-gray-500">Price: {fill.fill_price}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center justify-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <span className="text-gray-400">≥95% Complete (Excellent)</span>
          </div>
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-yellow-500" />
            <span className="text-gray-400">85-95% (Good)</span>
          </div>
          <div className="flex items-center gap-2">
            <XCircle className="w-4 h-4 text-red-500" />
            <span className="text-gray-400">&lt;85% (Needs Attention)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

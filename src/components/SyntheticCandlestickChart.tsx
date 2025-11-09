import React, { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, IChartApi, ISeriesApi, CandlestickData } from 'lightweight-charts';
import { ArrowUp, ArrowDown, Circle } from 'lucide-react';

interface SyntheticCandlestickChartProps {
  candles: any[];
  trades: any[];
  symbol: string;
  timeframe: string;
}

export default function SyntheticCandlestickChart({
  candles,
  trades,
  symbol,
  timeframe
}: SyntheticCandlestickChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const [selectedTrade, setSelectedTrade] = useState<any | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    try {
      const chart = createChart(chartContainerRef.current, {
        width: chartContainerRef.current.clientWidth,
        height: 400,
        layout: {
          background: { color: '#ffffff' },
          textColor: '#333',
        },
        grid: {
          vertLines: { color: '#f0f0f0' },
          horzLines: { color: '#f0f0f0' },
        },
        timeScale: {
          borderColor: '#e0e0e0',
          timeVisible: true,
        },
        rightPriceScale: {
          borderColor: '#e0e0e0',
        },
      });

      if (!chart) {
        console.error('[SyntheticCandlestickChart] Failed to create chart');
        return;
      }

      chartRef.current = chart;

      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderUpColor: '#22c55e',
        borderDownColor: '#ef4444',
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
      });

      if (!candleSeries) {
        console.error('[SyntheticCandlestickChart] Failed to create candlestick series');
        return;
      }

      candleSeriesRef.current = candleSeries;

      const handleResize = () => {
        if (chartRef.current && chartContainerRef.current) {
          try {
            chartRef.current.applyOptions({
              width: chartContainerRef.current.clientWidth,
            });
          } catch (error) {
            console.error('[SyntheticCandlestickChart] Error resizing chart:', error);
          }
        }
      };

      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
        candleSeriesRef.current = null;
        if (chartRef.current) {
          try {
            chartRef.current.remove();
          } catch (error) {
            console.error('[SyntheticCandlestickChart] Error removing chart:', error);
          }
          chartRef.current = null;
        }
      };
    } catch (error) {
      console.error('[SyntheticCandlestickChart] Error initializing chart:', error);
    }
  }, []);

  useEffect(() => {
    if (!candleSeriesRef.current || !candles || candles.length === 0) return;

    try {
      const candleData: CandlestickData[] = candles
        .filter(candle => {
          if (!candle || !candle.open_time) return false;

          const hasValidPrices =
            typeof candle.open === 'number' && !isNaN(candle.open) && candle.open !== null &&
            typeof candle.high === 'number' && !isNaN(candle.high) && candle.high !== null &&
            typeof candle.low === 'number' && !isNaN(candle.low) && candle.low !== null &&
            typeof candle.close === 'number' && !isNaN(candle.close) && candle.close !== null;

          if (!hasValidPrices) {
            console.warn('[SyntheticCandlestickChart] Skipping candle with invalid prices:', candle);
            return false;
          }

          const timestamp = new Date(candle.open_time);
          if (isNaN(timestamp.getTime())) {
            console.warn('[SyntheticCandlestickChart] Skipping candle with invalid timestamp:', candle.open_time);
            return false;
          }

          return true;
        })
        .map(candle => ({
          time: Math.floor(new Date(candle.open_time).getTime() / 1000) as any,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        }));

      if (candleData.length === 0) {
        console.warn('[SyntheticCandlestickChart] No valid candles after filtering');
        return;
      }

      if (!candleSeriesRef.current) {
        console.warn('[SyntheticCandlestickChart] Candle series ref lost before setData');
        return;
      }

      console.log(`[SyntheticCandlestickChart] Setting ${candleData.length} valid candles`);
      candleSeriesRef.current.setData(candleData);

      if (trades && trades.length > 0) {
        const allMarkers: any[] = [];

        trades.forEach(trade => {
          try {
            // Handle both snake_case (from database) and camelCase (from in-memory objects)
            const entryTimeValue = trade.entry_time || trade.entryTime;
            const exitTimeValue = trade.exit_time || trade.exitTime;

            if (!entryTimeValue) {
              return;
            }

            const entryTime = new Date(entryTimeValue);
            if (isNaN(entryTime.getTime())) {
              return;
            }

            const entryMarker = {
              time: Math.floor(entryTime.getTime() / 1000) as any,
              position: trade.direction === 'buy' ? 'belowBar' : 'aboveBar',
              color: trade.direction === 'buy' ? '#22c55e' : '#ef4444',
              shape: trade.direction === 'buy' ? 'arrowUp' : 'arrowDown',
              text: `Entry ${trade.direction?.toUpperCase() || 'UNKNOWN'}`,
            };

            allMarkers.push(entryMarker);

            if (exitTimeValue) {
              const exitTime = new Date(exitTimeValue);
              if (!isNaN(exitTime.getTime())) {
                const exitMarker = {
                  time: Math.floor(exitTime.getTime() / 1000) as any,
                  position: trade.outcome === 'win' ? 'aboveBar' : 'belowBar',
                  color: trade.outcome === 'win' ? '#22c55e' : '#ef4444',
                  shape: 'circle',
                  text: `Exit: ${trade.outcome?.toUpperCase() || 'UNKNOWN'}`,
                };

                allMarkers.push(exitMarker);
              }
            }
          } catch (error) {
            console.error('[SyntheticCandlestickChart] Error processing trade for marker:', trade, error);
          }
        });

        if (allMarkers.length > 0) {
          try {
            if (!candleSeriesRef.current) {
              console.warn('[SyntheticCandlestickChart] Series reference lost before setting markers');
              return;
            }

            if (typeof candleSeriesRef.current.setMarkers !== 'function') {
              console.warn('[SyntheticCandlestickChart] setMarkers method not available on series');
              console.log('[SyntheticCandlestickChart] Series type:', typeof candleSeriesRef.current);
              console.log('[SyntheticCandlestickChart] Series keys:', Object.keys(candleSeriesRef.current));
              return;
            }

            console.log(`[SyntheticCandlestickChart] Attempting to set ${allMarkers.length} markers`);
            candleSeriesRef.current.setMarkers(allMarkers as any);
            console.log(`[SyntheticCandlestickChart] ✅ Successfully set ${allMarkers.length} markers`);
          } catch (error) {
            console.error('[SyntheticCandlestickChart] ❌ Error setting markers:', error);
            console.error('[SyntheticCandlestickChart] Markers that failed to set:', allMarkers.length);
            console.error('[SyntheticCandlestickChart] First marker sample:', allMarkers[0]);
          }
        }
      }

      if (chartRef.current) {
        try {
          chartRef.current.timeScale().fitContent();
        } catch (error) {
          console.error('[SyntheticCandlestickChart] Error fitting content:', error);
        }
      }
    } catch (error) {
      console.error('[SyntheticCandlestickChart] Error updating chart data:', error);
    }
  }, [candles, trades]);

  if (!candles || candles.length === 0) {
    return (
      <div className="bg-gradient-to-br from-purple-50 to-orange-50 rounded-lg p-6 border-2 border-purple-200">
        <div className="text-center py-8 text-gray-500">
          <p>No candle data available to display chart</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-purple-50 to-orange-50 rounded-lg p-6 border-2 border-purple-200">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <span className="px-3 py-1 bg-purple-600 text-white text-xs font-bold rounded-full">
            SYNTHETIC
          </span>
          {symbol} {timeframe} Chart
        </h3>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1">
            <ArrowUp className="w-4 h-4 text-green-600" />
            <span className="text-gray-600">Buy Entry</span>
          </div>
          <div className="flex items-center gap-1">
            <ArrowDown className="w-4 h-4 text-red-600" />
            <span className="text-gray-600">Sell Entry</span>
          </div>
          <div className="flex items-center gap-1">
            <Circle className="w-4 h-4 text-gray-600" />
            <span className="text-gray-600">Exit</span>
          </div>
        </div>
      </div>

      <div ref={chartContainerRef} className="rounded-lg overflow-hidden bg-white shadow-inner" />

      {trades && trades.length > 0 && (
        <div className="mt-4 bg-white rounded-lg p-4 shadow">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Recent Trades</h4>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {trades.slice(0, 10).map((trade, index) => {
              // Handle both snake_case and camelCase field names
              const tradeNumber = trade.trade_number || trade.tradeNumber || index + 1;
              const entryPrice = trade.entry_price || trade.entryPrice;
              const exitPrice = trade.exit_price || trade.exitPrice;
              const stopLoss = trade.stop_loss || trade.stopLoss;
              const takeProfit = trade.take_profit || trade.takeProfit;
              const holdingDuration = trade.holding_duration_minutes || trade.holdingDurationMinutes;
              const pipsGained = trade.pips_gained || trade.pipsGained;

              return (
                <div
                  key={index}
                  onClick={() => setSelectedTrade(selectedTrade?._tradeId === tradeNumber ? null : { ...trade, _tradeId: tradeNumber })}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                    selectedTrade?._tradeId === tradeNumber
                      ? 'border-purple-400 bg-purple-50'
                      : 'border-gray-200 hover:border-purple-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {trade.direction === 'buy' ? (
                        <ArrowUp className="w-4 h-4 text-green-600" />
                      ) : (
                        <ArrowDown className="w-4 h-4 text-red-600" />
                      )}
                      <span className="font-semibold text-gray-900">
                        Trade #{tradeNumber}
                      </span>
                      <span className="text-sm text-gray-600">
                        {trade.direction?.toUpperCase() || 'UNKNOWN'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-sm font-semibold ${
                        trade.outcome === 'win' ? 'text-green-600' :
                        trade.outcome === 'loss' ? 'text-red-600' :
                        'text-gray-600'
                      }`}>
                        {trade.outcome === 'win' ? '+' : ''}{trade.pnl?.toFixed(2)} USD
                      </span>
                      <span className={`px-2 py-1 text-xs font-semibold rounded ${
                        trade.outcome === 'win' ? 'bg-green-100 text-green-800' :
                        trade.outcome === 'loss' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {trade.outcome?.toUpperCase() || 'UNKNOWN'}
                      </span>
                    </div>
                  </div>

                  {selectedTrade?._tradeId === tradeNumber && (
                    <div className="mt-3 pt-3 border-t border-gray-200 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-gray-600">Entry:</span>
                        <span className="ml-1 font-semibold">{entryPrice?.toFixed(5) || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Exit:</span>
                        <span className="ml-1 font-semibold">{exitPrice?.toFixed(5) || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">SL:</span>
                        <span className="ml-1 font-semibold">{stopLoss?.toFixed(5) || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">TP:</span>
                        <span className="ml-1 font-semibold">{takeProfit?.toFixed(5) || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Duration:</span>
                        <span className="ml-1 font-semibold">{holdingDuration || 'N/A'} min</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Pips:</span>
                        <span className="ml-1 font-semibold">{pipsGained?.toFixed(1) || 'N/A'}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
        <p className="text-xs text-yellow-800">
          <strong>Note:</strong> This chart displays synthetic data for training purposes only.
          Trade markers show entry/exit points with win/loss outcomes.
        </p>
      </div>
    </div>
  );
}

import React, { useEffect, useRef } from 'react';
import { createChart, IChartApi, ISeriesApi, LineData } from 'lightweight-charts';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface SyntheticEquityCurveProps {
  trades: any[];
  initialBalance: number;
  finalBalance: number;
  maxDrawdown: number;
}

export default function SyntheticEquityCurve({
  trades,
  initialBalance,
  finalBalance,
  maxDrawdown
}: SyntheticEquityCurveProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    try {
      const chart = createChart(chartContainerRef.current, {
        width: chartContainerRef.current.clientWidth,
        height: 300,
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
        console.error('[SyntheticEquityCurve] Failed to create chart');
        return;
      }

      // Verify chart has required methods
      if (typeof chart.addLineSeries !== 'function') {
        console.error('[SyntheticEquityCurve] Chart instance does not have addLineSeries method. Chart API:', Object.keys(chart));
        return;
      }

      chartRef.current = chart;

      const series = chart.addLineSeries({
        color: '#2563eb',
        lineWidth: 2,
        priceFormat: {
          type: 'price',
          precision: 2,
          minMove: 0.01,
        },
      });

      if (!series) {
        console.error('[SyntheticEquityCurve] Failed to create line series');
        return;
      }

      seriesRef.current = series;

      const handleResize = () => {
        if (chartRef.current && chartContainerRef.current) {
          try {
            chartRef.current.applyOptions({
              width: chartContainerRef.current.clientWidth,
            });
          } catch (error) {
            console.error('[SyntheticEquityCurve] Error resizing chart:', error);
          }
        }
      };

      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
        seriesRef.current = null;
        if (chartRef.current) {
          try {
            chartRef.current.remove();
          } catch (error) {
            console.error('[SyntheticEquityCurve] Error removing chart:', error);
          }
          chartRef.current = null;
        }
      };
    } catch (error) {
      console.error('[SyntheticEquityCurve] Error initializing chart:', error);
    }
  }, []);

  useEffect(() => {
    if (!seriesRef.current || !trades || trades.length === 0) return;

    const equityPoints: LineData[] = [];
    let currentBalance = initialBalance;

    equityPoints.push({
      time: Math.floor(new Date(trades[0].entry_time).getTime() / 1000) as any,
      value: currentBalance,
    });

    for (const trade of trades) {
      if (trade.exit_time && trade.pnl !== undefined) {
        currentBalance += trade.pnl;
        equityPoints.push({
          time: Math.floor(new Date(trade.exit_time).getTime() / 1000) as any,
          value: currentBalance,
        });
      }
    }

    seriesRef.current.setData(equityPoints);

    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [trades, initialBalance]);

  const totalReturn = finalBalance - initialBalance;
  const totalReturnPercent = ((totalReturn / initialBalance) * 100).toFixed(2);
  const isProfit = totalReturn >= 0;

  if (!trades || trades.length === 0) {
    return (
      <div className="bg-gradient-to-br from-purple-50 to-orange-50 rounded-lg p-6 border-2 border-purple-200">
        <div className="text-center py-8 text-gray-500">
          <p>No trade data available to display equity curve</p>
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
          Equity Curve
        </h3>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-sm text-gray-600">Total Return</div>
            <div className={`text-2xl font-bold flex items-center gap-1 ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
              {isProfit ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
              {isProfit ? '+' : ''}{totalReturnPercent}%
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-600">Max Drawdown</div>
            <div className="text-xl font-bold text-orange-600">
              ${maxDrawdown.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      <div ref={chartContainerRef} className="rounded-lg overflow-hidden bg-white shadow-inner" />

      <div className="mt-4 grid grid-cols-3 gap-4 text-center">
        <div className="bg-white rounded-lg p-3 shadow">
          <div className="text-sm text-gray-600">Starting Balance</div>
          <div className="text-xl font-bold text-gray-900">${initialBalance.toFixed(2)}</div>
        </div>
        <div className="bg-white rounded-lg p-3 shadow">
          <div className="text-sm text-gray-600">Final Balance</div>
          <div className={`text-xl font-bold ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
            ${finalBalance.toFixed(2)}
          </div>
        </div>
        <div className="bg-white rounded-lg p-3 shadow">
          <div className="text-sm text-gray-600">Net P&L</div>
          <div className={`text-xl font-bold ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
            {isProfit ? '+' : ''}${totalReturn.toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
}

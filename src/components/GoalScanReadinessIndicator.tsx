import React, { useState, useEffect } from 'react';
import { Activity, CheckCircle, Clock, Database, TrendingUp } from 'lucide-react';
import { goalScannerTrigger } from '../services/goal-scanner-trigger';
import { supabase } from '../lib/supabase';

interface ReadinessIndicatorProps {
  sessionId: string;
  watchlist: string[];
  nextScanTime?: string | null;
}

interface CandleStatus {
  symbol: string;
  candleCount: number;
  required: number;
  ready: boolean;
}

export const GoalScanReadinessIndicator: React.FC<ReadinessIndicatorProps> = ({
  sessionId,
  watchlist,
  nextScanTime,
}) => {
  const [candleStatus, setCandleStatus] = useState<CandleStatus[]>([]);
  const [timeUntilScan, setTimeUntilScan] = useState<string>('');
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    checkCandleData();
    const interval = setInterval(checkCandleData, 5000);
    return () => clearInterval(interval);
  }, [watchlist]);

  useEffect(() => {
    if (nextScanTime) {
      updateTimeUntilScan();
      const interval = setInterval(updateTimeUntilScan, 1000);
      return () => clearInterval(interval);
    }
  }, [nextScanTime]);

  const checkCandleData = async () => {
    const statusResults: CandleStatus[] = [];
    const requiredCandles = 100;

    for (const symbol of watchlist) {
      try {
        const { data, error } = await supabase
          .from('forex_candles')
          .select('open_time')
          .eq('symbol', symbol)
          .eq('timeframe', '15m')
          .order('open_time', { ascending: false })
          .limit(requiredCandles);

        if (error) {
          statusResults.push({
            symbol,
            candleCount: 0,
            required: requiredCandles,
            ready: false,
          });
          continue;
        }

        const candleCount = data?.length || 0;
        statusResults.push({
          symbol,
          candleCount,
          required: requiredCandles,
          ready: candleCount >= requiredCandles,
        });
      } catch (error) {
        statusResults.push({
          symbol,
          candleCount: 0,
          required: requiredCandles,
          ready: false,
        });
      }
    }

    setCandleStatus(statusResults);
    const allReady = statusResults.every(s => s.ready);
    setIsReady(allReady);
  };

  const updateTimeUntilScan = () => {
    if (!nextScanTime) {
      setTimeUntilScan('Calculating...');
      return;
    }

    const now = Date.now();
    const scanTime = new Date(nextScanTime).getTime();
    const diff = scanTime - now;

    if (diff <= 0) {
      setTimeUntilScan('Scanning now...');
      return;
    }

    const minutes = Math.floor(diff / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    if (minutes > 0) {
      setTimeUntilScan(`${minutes}m ${seconds}s`);
    } else {
      setTimeUntilScan(`${seconds}s`);
    }
  };

  const totalCandles = candleStatus.reduce((sum, s) => sum + s.candleCount, 0);
  const requiredTotal = candleStatus.reduce((sum, s) => sum + s.required, 0);
  const overallProgress = requiredTotal > 0 ? (totalCandles / requiredTotal) * 100 : 0;

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-5 h-5 text-blue-400" />
        <h4 className="text-lg font-bold text-white">Engine Status</h4>
      </div>

      <div className="space-y-4">
        {/* Overall Progress */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-gray-400">Market Data Collection</span>
            <span className="text-sm font-medium text-white">{overallProgress.toFixed(0)}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                overallProgress >= 100 ? 'bg-green-500' : 'bg-blue-500'
              }`}
              style={{ width: `${Math.min(overallProgress, 100)}%` }}
            />
          </div>
        </div>

        {/* Checklist */}
        <div className="space-y-2">
          <ChecklistItem
            icon={<Database className="w-4 h-4" />}
            label="Market Data"
            status={isReady ? 'ready' : 'collecting'}
            detail={`${totalCandles}/${requiredTotal} candles`}
          />
          <ChecklistItem
            icon={<Clock className="w-4 h-4" />}
            label="Next Scan"
            status={timeUntilScan === 'Scanning now...' ? 'active' : 'waiting'}
            detail={timeUntilScan}
          />
          <ChecklistItem
            icon={<TrendingUp className="w-4 h-4" />}
            label="LLM Analysis"
            status={isReady && timeUntilScan === 'Scanning now...' ? 'active' : 'pending'}
            detail={isReady ? 'Ready when scan triggers' : 'Waiting for data'}
          />
        </div>

        {/* Symbol-specific progress */}
        {candleStatus.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-700">
            <div className="text-xs text-gray-400 mb-2">Symbol Data:</div>
            <div className="space-y-1">
              {candleStatus.map((status) => (
                <div key={status.symbol} className="flex items-center justify-between text-xs">
                  <span className="text-gray-300">{status.symbol}</span>
                  <div className="flex items-center gap-2">
                    <span className={status.ready ? 'text-green-400' : 'text-gray-400'}>
                      {status.candleCount}/{status.required}
                    </span>
                    {status.ready && <CheckCircle className="w-3 h-3 text-green-400" />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Waiting explanation */}
        {!isReady && (
          <div className="mt-4 p-3 bg-blue-900/20 border border-blue-700 rounded-lg">
            <p className="text-xs text-blue-300">
              <strong>Collecting historical data...</strong>
              <br />
              The engine needs {candleStatus[0]?.required || 100} candles per symbol to analyze market patterns accurately. This typically takes 2-3 minutes on first start.
            </p>
          </div>
        )}

        {isReady && timeUntilScan !== 'Scanning now...' && (
          <div className="mt-4 p-3 bg-green-900/20 border border-green-700 rounded-lg">
            <p className="text-xs text-green-300">
              <strong>✓ Ready to scan!</strong>
              <br />
              The LLM will analyze markets in {timeUntilScan}, looking for high-probability trade setups across all symbols.
            </p>
          </div>
        )}

        {isReady && timeUntilScan === 'Scanning now...' && (
          <div className="mt-4 p-3 bg-purple-900/20 border border-purple-700 rounded-lg animate-pulse">
            <p className="text-xs text-purple-300">
              <strong>🔍 AI analyzing markets...</strong>
              <br />
              The 5-layer LLM system is evaluating market conditions, technical patterns, and risk factors to identify optimal trading opportunities.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

interface ChecklistItemProps {
  icon: React.ReactNode;
  label: string;
  status: 'ready' | 'collecting' | 'waiting' | 'active' | 'pending';
  detail: string;
}

const ChecklistItem: React.FC<ChecklistItemProps> = ({ icon, label, status, detail }) => {
  const getStatusColor = () => {
    switch (status) {
      case 'ready':
        return 'text-green-400';
      case 'active':
        return 'text-purple-400 animate-pulse';
      case 'collecting':
        return 'text-blue-400';
      default:
        return 'text-gray-400';
    }
  };

  const getStatusIcon = () => {
    if (status === 'ready') {
      return <CheckCircle className="w-4 h-4 text-green-400" />;
    }
    if (status === 'active') {
      return <Activity className="w-4 h-4 text-purple-400 animate-pulse" />;
    }
    return <div className="w-4 h-4 rounded-full border-2 border-gray-600" />;
  };

  return (
    <div className="flex items-center justify-between p-2 bg-gray-700/30 rounded">
      <div className="flex items-center gap-2">
        <div className={getStatusColor()}>{icon}</div>
        <span className="text-sm text-gray-300">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">{detail}</span>
        {getStatusIcon()}
      </div>
    </div>
  );
};

import { useEffect, useState } from 'react';
import { Loader2, Search, TrendingUp } from 'lucide-react';

interface ScanProgressIndicatorProps {
  isScanning: boolean;
  currentSymbol?: string;
  currentIndex?: number;
  totalSymbols?: number;
  scanStartTime?: number;
}

export function ScanProgressIndicator({
  isScanning,
  currentSymbol,
  currentIndex = 0,
  totalSymbols = 0,
  scanStartTime
}: ScanProgressIndicatorProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!isScanning || !scanStartTime) {
      setElapsedSeconds(0);
      return;
    }

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - scanStartTime) / 1000);
      setElapsedSeconds(elapsed);
    }, 1000);

    return () => clearInterval(interval);
  }, [isScanning, scanStartTime]);

  if (!isScanning) {
    return null;
  }

  const progress = totalSymbols > 0 ? (currentIndex / totalSymbols) * 100 : 0;
  const estimatedTimeRemaining = currentIndex > 0 && totalSymbols > 0
    ? Math.ceil((elapsedSeconds / currentIndex) * (totalSymbols - currentIndex))
    : null;

  return (
    <div className="bg-gradient-to-r from-blue-900/30 to-purple-900/30 rounded-lg border border-blue-800/30 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-slate-900/50 border-b border-blue-800/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-blue-400 animate-pulse" />
            <h3 className="text-sm font-medium text-blue-300">Alpha Scanning Markets</h3>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span>{elapsedSeconds}s elapsed</span>
            {estimatedTimeRemaining && (
              <span className="text-blue-400">~{estimatedTimeRemaining}s remaining</span>
            )}
          </div>
        </div>
      </div>

      {/* Progress Content */}
      <div className="p-4 space-y-3">
        {/* Current Symbol Being Analyzed */}
        {currentSymbol && (
          <div className="flex items-center gap-3">
            <div className="relative">
              <TrendingUp className="w-5 h-5 text-blue-400" />
              <Loader2 className="w-3 h-3 text-blue-300 animate-spin absolute -bottom-1 -right-1" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-slate-200">
                Analyzing {currentSymbol}
              </div>
              <div className="text-xs text-slate-400">
                Evaluating market conditions, trend, and entry quality
              </div>
            </div>
          </div>
        )}

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-300 font-medium">
              {currentIndex} of {totalSymbols} symbols evaluated
            </span>
            <span className="text-blue-400 font-semibold">{Math.round(progress)}%</span>
          </div>

          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Scan Status Messages */}
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
            <span>Omega Council active</span>
          </div>
          <span>•</span>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-pulse" />
            <span>Multi-brain analysis</span>
          </div>
          <span>•</span>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
            <span>Real-time data</span>
          </div>
        </div>
      </div>
    </div>
  );
}

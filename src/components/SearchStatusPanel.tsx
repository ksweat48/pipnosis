import React, { useEffect, useState } from 'react';
import { Search, Clock, TrendingUp, AlertCircle, XCircle, CheckCircle, Loader2 } from 'lucide-react';
import { extendedSearchService, SearchProgress, SymbolCondition } from '../services/extended-search';

interface SearchStatusPanelProps {
  sessionId: string;
  onSearchComplete?: (opportunity: any) => void;
  onSearchTimeout?: () => void;
  onCancel?: () => void;
}

export function SearchStatusPanel({
  sessionId,
  onSearchComplete,
  onSearchTimeout,
  onCancel
}: SearchStatusPanelProps) {
  const [progress, setProgress] = useState<SearchProgress | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProgress();
    const interval = setInterval(loadProgress, 5000);

    return () => clearInterval(interval);
  }, [sessionId]);

  const loadProgress = async () => {
    try {
      const data = await extendedSearchService.getSearchProgress(sessionId);
      setProgress(data);
      setLoading(false);

      if (data?.status === 'completed' && data.bestOpportunity && onSearchComplete) {
        onSearchComplete(data.bestOpportunity);
      } else if (data?.status === 'timeout' && onSearchTimeout) {
        onSearchTimeout();
      }
    } catch (error) {
      console.error('Failed to load search progress:', error);
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (sessionId) {
      await extendedSearchService.cancelSearch(sessionId);
      if (onCancel) {
        onCancel();
      }
    }
  };

  const getProgressPercentage = (): number => {
    if (!progress) return 0;
    return Math.min(100, (progress.elapsedMinutes / 60) * 100);
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'active':
        return 'text-blue-400';
      case 'completed':
        return 'text-emerald-400';
      case 'timeout':
        return 'text-yellow-400';
      case 'cancelled':
        return 'text-red-400';
      default:
        return 'text-white/60';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />;
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-emerald-400" />;
      case 'timeout':
        return <Clock className="w-5 h-5 text-yellow-400" />;
      case 'cancelled':
        return <XCircle className="w-5 h-5 text-red-400" />;
      default:
        return <Search className="w-5 h-5 text-white/60" />;
    }
  };

  if (loading) {
    return (
      <div className="glass-card p-6">
        <div className="flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
          <span className="ml-3 text-white/70">Loading search status...</span>
        </div>
      </div>
    );
  }

  if (!progress) {
    return null;
  }

  return (
    <div className="glass-card p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {getStatusIcon(progress.status)}
          <div>
            <h3 className={`text-lg font-semibold ${getStatusColor(progress.status)}`}>
              {progress.status === 'active' && 'Searching for Trade Opportunities'}
              {progress.status === 'completed' && 'Trade Opportunity Found!'}
              {progress.status === 'timeout' && 'Search Complete'}
              {progress.status === 'cancelled' && 'Search Cancelled'}
            </h3>
            <p className="text-sm text-white/60">
              {progress.status === 'active' && `Scanning markets continuously...`}
              {progress.status === 'completed' && 'High-probability setup detected'}
              {progress.status === 'timeout' && 'No valid trades found in 1 hour'}
              {progress.status === 'cancelled' && 'Search stopped by user'}
            </p>
          </div>
        </div>

        {progress.status === 'active' && (
          <button
            onClick={handleCancel}
            className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors text-sm font-medium border border-red-500/30"
          >
            Cancel Search
          </button>
        )}
      </div>

      {progress.status === 'active' && (
        <>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/70">Search Progress</span>
              <span className="text-white font-medium">
                {progress.elapsedMinutes} / 60 minutes
              </span>
            </div>
            <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-500 ease-out"
                style={{ width: `${getProgressPercentage()}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-white/50">
              <span>Started</span>
              <span>{progress.remainingMinutes} minutes remaining</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-white/5 rounded-lg border border-white/10">
              <div className="flex items-center gap-2 mb-2">
                <Search className="w-4 h-4 text-blue-400" />
                <p className="text-xs text-white/60 uppercase tracking-wide">Scans Completed</p>
              </div>
              <p className="text-2xl font-bold text-white">{progress.scanCount}</p>
            </div>

            <div className="p-4 bg-white/5 rounded-lg border border-white/10">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-emerald-400" />
                <p className="text-xs text-white/60 uppercase tracking-wide">Next Scan In</p>
              </div>
              <p className="text-2xl font-bold text-white">~2 min</p>
            </div>
          </div>
        </>
      )}

      {progress.currentConditions && progress.currentConditions.reasonsNoTrade.length > 0 && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h4 className="font-semibold text-yellow-400 mb-2">
                {progress.status === 'active' ? 'Current Market Conditions' : 'Why No Trades Were Found'}
              </h4>
              <ul className="space-y-1 text-sm text-yellow-400/80">
                {progress.currentConditions.reasonsNoTrade.map((reason, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <span className="text-yellow-400/60 mt-0.5">•</span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {progress.currentConditions?.symbolConditions && progress.currentConditions.symbolConditions.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-white/80 uppercase tracking-wide">Symbol Status</h4>
          <div className="space-y-2">
            {progress.currentConditions.symbolConditions.slice(0, 5).map((condition: SymbolCondition, index: number) => (
              <div
                key={index}
                className={`p-3 rounded-lg border ${
                  condition.available
                    ? 'bg-emerald-500/10 border-emerald-500/30'
                    : 'bg-white/5 border-white/10'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {condition.available ? (
                      <CheckCircle className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <XCircle className="w-4 h-4 text-white/40" />
                    )}
                    <span className="font-medium text-white">{condition.symbol}</span>
                  </div>
                  <span className={`text-xs ${condition.available ? 'text-emerald-400' : 'text-white/50'}`}>
                    {condition.reason}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {progress.status === 'completed' && progress.bestOpportunity && (
        <div className="p-4 bg-emerald-500/10 border-2 border-emerald-500/30 rounded-lg">
          <div className="flex items-start gap-3">
            <TrendingUp className="w-6 h-6 text-emerald-400 mt-1" />
            <div className="flex-1">
              <h4 className="font-semibold text-emerald-400 mb-2 text-lg">Trade Signal Ready</h4>
              <div className="space-y-1 text-sm text-emerald-400/80">
                <p>
                  <span className="font-medium">{progress.bestOpportunity.symbol}</span>{' '}
                  {progress.bestOpportunity.signal.direction} signal detected
                </p>
                <p>Confidence: {progress.bestOpportunity.signal.confidence}%</p>
                <p>Entry: {progress.bestOpportunity.signal.entryPrice.toFixed(5)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {progress.status === 'timeout' && (
        <div className="p-4 bg-white/5 border border-white/20 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-white/60 mt-0.5" />
            <div>
              <p className="text-white/80 font-medium mb-2">
                Search Complete - No Valid Trades Found
              </p>
              <p className="text-sm text-white/60 mb-3">
                The AI searched for 1 hour but market conditions did not produce any high-probability setups matching your criteria.
              </p>
              <p className="text-xs text-white/50">
                Try again in 15-30 minutes when market conditions may improve, or adjust your search criteria.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

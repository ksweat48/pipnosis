import { useEffect, useState } from 'react';
import { Clock, TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { scanResultsManager, type ScanResult, type ScanResultSummary } from '@/services/scan-results-manager';

interface ScanResultsCardProps {
  sessionId: string;
  minConfidence?: number;
}

export function ScanResultsCard({ sessionId, minConfidence = 60 }: ScanResultsCardProps) {
  const [latestScan, setLatestScan] = useState<ScanResult | null>(null);
  const [scanHistory, setScanHistory] = useState<ScanResultSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadScanData();

    // Subscribe to realtime updates
    const unsubscribe = scanResultsManager.subscribeToScanResults(sessionId, (result) => {
      setLatestScan(result);
      loadScanHistory();
    });

    return () => {
      unsubscribe();
    };
  }, [sessionId]);

  const loadScanData = async () => {
    setLoading(true);
    try {
      const [latest, history] = await Promise.all([
        scanResultsManager.getLatestScanResult(sessionId),
        scanResultsManager.getScanHistory(sessionId, 5)
      ]);
      setLatestScan(latest);
      setScanHistory(history);
    } finally {
      setLoading(false);
    }
  };

  const loadScanHistory = async () => {
    const history = await scanResultsManager.getScanHistory(sessionId, 5);
    setScanHistory(history);
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'BUY':
        return <TrendingUp className="w-4 h-4 text-green-400" />;
      case 'SELL':
        return <TrendingDown className="w-4 h-4 text-red-400" />;
      case 'WAIT':
        return <Minus className="w-4 h-4 text-yellow-400" />;
      default:
        return <Minus className="w-4 h-4 text-gray-400" />;
    }
  };

  const getConfidenceColor = (confidence: number, isRejected: boolean) => {
    if (isRejected) return 'text-red-400';
    if (confidence >= 70) return 'text-green-400';
    if (confidence >= 60) return 'text-yellow-400';
    return 'text-red-400';
  };

  const formatTimeAgo = (date: Date) => {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  if (loading) {
    return (
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
        <div className="animate-pulse">
          <div className="h-4 bg-slate-700 rounded w-1/3 mb-3"></div>
          <div className="h-3 bg-slate-700 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (!latestScan) {
    return (
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
        <div className="flex items-center gap-2 text-slate-400">
          <Clock className="w-4 h-4" />
          <span className="text-sm">No scans completed yet</span>
        </div>
      </div>
    );
  }

  const topCandidate = latestScan.topCandidate;
  const isRejected = !!latestScan.rejectionReason;
  const confidenceGap = topCandidate ? minConfidence - topCandidate.confidence : 0;

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-slate-900/50 border-b border-slate-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-medium text-slate-200">Last Scan Results</h3>
          </div>
          <div className="text-xs text-slate-400">
            {formatTimeAgo(latestScan.scanTimestamp)} • {latestScan.scanDurationMs / 1000}s
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-4 space-y-4">
        {/* Top Candidate */}
        {topCandidate ? (
          <div className="space-y-3">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {getActionIcon(topCandidate.action)}
                  <span className="text-lg font-semibold text-slate-100">
                    {topCandidate.symbol}
                  </span>
                  <span className={`text-sm font-medium ${
                    topCandidate.action === 'BUY' ? 'text-green-400' :
                    topCandidate.action === 'SELL' ? 'text-red-400' :
                    'text-yellow-400'
                  }`}>
                    {topCandidate.action}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  {topCandidate.trend && (
                    <span>Trend: {topCandidate.trend}</span>
                  )}
                  {topCandidate.volatility && (
                    <span>• Vol: {topCandidate.volatility}</span>
                  )}
                  {topCandidate.session && (
                    <span>• Session: {topCandidate.session}</span>
                  )}
                </div>
              </div>

              {/* Confidence Display */}
              <div className="flex flex-col items-end">
                <div className={`text-2xl font-bold ${getConfidenceColor(topCandidate.confidence, isRejected)}`}>
                  {topCandidate.confidence}%
                </div>
                <div className="text-xs text-slate-400">confidence</div>
              </div>
            </div>

            {/* Confidence Bar */}
            <div className="space-y-1">
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    isRejected ? 'bg-red-500' :
                    topCandidate.confidence >= 70 ? 'bg-green-500' :
                    topCandidate.confidence >= 60 ? 'bg-yellow-500' :
                    'bg-red-500'
                  }`}
                  style={{ width: `${Math.min(topCandidate.confidence, 100)}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>0%</span>
                <span className="text-slate-400">{minConfidence}% min</span>
                <span>100%</span>
              </div>
            </div>

            {/* Status Message */}
            {isRejected ? (
              <div className="flex items-start gap-2 p-3 bg-red-900/20 border border-red-800/30 rounded-lg">
                <XCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <div className="text-sm font-medium text-red-400">Trade Rejected</div>
                  <div className="text-xs text-red-300/80">{latestScan.rejectionReason}</div>
                  {confidenceGap > 0 && (
                    <div className="text-xs text-red-300/60">
                      Need +{confidenceGap}% more confidence to execute
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 p-3 bg-green-900/20 border border-green-800/30 rounded-lg">
                <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <div className="text-sm font-medium text-green-400">Setup Found</div>
                  <div className="text-xs text-green-300/80">
                    Confidence meets {minConfidence}% threshold
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-start gap-2 p-3 bg-slate-700/30 border border-slate-600/30 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
            <div className="space-y-1">
              <div className="text-sm font-medium text-slate-300">No Trade Found</div>
              <div className="text-xs text-slate-400">{latestScan.rejectionReason}</div>
            </div>
          </div>
        )}

        {/* Top 3 Candidates Summary */}
        {latestScan.allCandidates && latestScan.allCandidates.length > 1 && (
          <div className="space-y-2">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="text-xs text-slate-400 hover:text-slate-300 transition-colors"
            >
              {showHistory ? 'Hide' : 'Show'} all {latestScan.allCandidates.length} symbols
            </button>

            {showHistory && (
              <div className="space-y-1.5">
                {latestScan.allCandidates.slice(0, 5).map((candidate, index) => (
                  <div
                    key={candidate.symbol}
                    className="flex items-center justify-between p-2 bg-slate-700/30 rounded"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 w-4">#{index + 1}</span>
                      {getActionIcon(candidate.action)}
                      <span className="text-sm text-slate-300">{candidate.symbol}</span>
                      <span className={`text-xs ${
                        candidate.action === 'BUY' ? 'text-green-400' :
                        candidate.action === 'SELL' ? 'text-red-400' :
                        'text-yellow-400'
                      }`}>
                        {candidate.action}
                      </span>
                    </div>
                    <div className="text-sm text-slate-400">{candidate.confidence}%</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Scan Stats */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-700">
          <div className="text-xs text-slate-400">
            Scanned {latestScan.symbolsEvaluated} symbols
          </div>
          <div className="text-xs text-slate-500">
            Score: {topCandidate?.score.toFixed(1) || 'N/A'}
          </div>
        </div>
      </div>
    </div>
  );
}

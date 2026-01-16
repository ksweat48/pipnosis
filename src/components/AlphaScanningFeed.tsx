import React, { useState, useEffect } from 'react';
import { Brain, TrendingUp, TrendingDown, Minus, Clock, Target, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface ScanCandidate {
  symbol: string;
  action: 'BUY' | 'SELL' | 'WAIT' | 'PASS' | 'NO_TRADE';
  confidence: number;
  score: number;
  reasoning: string;
  trend?: string;
  volatility?: string;
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
}

interface ScanResult {
  id: string;
  session_id: string;
  scan_timestamp: string;
  scan_duration_ms: number;
  symbols_evaluated: number;
  top_candidate_symbol: string;
  top_candidate_action: string;
  top_candidate_confidence: number;
  all_candidates: ScanCandidate[];
  rejection_reason?: string;
}

interface AlphaScanningFeedProps {
  sessionId: string;
}

export const AlphaScanningFeed: React.FC<AlphaScanningFeedProps> = ({ sessionId }) => {
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [expandedScan, setExpandedScan] = useState<string | null>(null);

  useEffect(() => {
    loadRecentScans();

    const channel = supabase
      .channel('alpha-scan-feed')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'goal_session_scan_results',
          filter: `session_id=eq.${sessionId}`
        },
        (payload) => {
          const newScan = payload.new as ScanResult;
          setScanResults(prev => [newScan, ...prev].slice(0, 5));
          setIsScanning(false);
          setExpandedScan(newScan.id);
        }
      )
      .subscribe();

    const scanningChannel = supabase
      .channel('scanning-status')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'goal_sessions',
          filter: `id=eq.${sessionId}`
        },
        (payload) => {
          const status = payload.new.status;
          setIsScanning(status === 'scanning');
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
      scanningChannel.unsubscribe();
    };
  }, [sessionId]);

  const loadRecentScans = async () => {
    const { data, error } = await supabase
      .from('goal_session_scan_results')
      .select('*')
      .eq('session_id', sessionId)
      .order('scan_timestamp', { ascending: false })
      .limit(5);

    if (!error && data) {
      setScanResults(data);
      if (data.length > 0) {
        setExpandedScan(data[0].id);
      }
    }
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'BUY':
        return <TrendingUp className="w-4 h-4 text-green-400" />;
      case 'SELL':
        return <TrendingDown className="w-4 h-4 text-red-400" />;
      case 'WAIT':
        return <Clock className="w-4 h-4 text-orange-400" />;
      default:
        return <XCircle className="w-4 h-4 text-gray-400" />;
    }
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case 'BUY':
        return 'bg-green-900/20 border-green-700/50 text-green-300';
      case 'SELL':
        return 'bg-red-900/20 border-red-700/50 text-red-300';
      case 'WAIT':
        return 'bg-orange-900/20 border-orange-700/50 text-orange-300';
      default:
        return 'bg-gray-800/50 border-gray-600/50 text-gray-400';
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'text-green-400';
    if (confidence >= 70) return 'text-blue-400';
    if (confidence >= 60) return 'text-orange-400';
    return 'text-gray-400';
  };

  const formatScanTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  if (scanResults.length === 0 && !isScanning) {
    return null;
  }

  return (
    <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Brain className="w-5 h-5 text-purple-400" />
        <h3 className="text-sm font-bold text-white">Alpha's Market Analysis</h3>
        {isScanning && (
          <div className="ml-auto flex items-center gap-2">
            <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
            <span className="text-xs text-purple-300">Scanning markets...</span>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {scanResults.map((scan) => (
          <div key={scan.id} className="bg-gray-700/30 rounded-lg border border-gray-600/50">
            <div
              className="p-3 cursor-pointer hover:bg-gray-700/50 transition-colors"
              onClick={() => setExpandedScan(expandedScan === scan.id ? null : scan.id)}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="text-xs text-gray-400 font-mono">
                    {formatScanTime(scan.scan_timestamp)}
                  </div>
                  <div className="text-xs text-gray-500">
                    {scan.scan_duration_ms}ms
                  </div>
                </div>
                <div className="text-xs text-gray-400">
                  {scan.symbols_evaluated} pairs evaluated
                </div>
              </div>

              {scan.top_candidate_symbol ? (
                <div className="flex items-center gap-3">
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded border ${getActionColor(scan.top_candidate_action)}`}>
                    {getActionIcon(scan.top_candidate_action)}
                    <span className="font-bold">{scan.top_candidate_symbol}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-400">Confidence:</span>
                    <span className={`text-sm font-bold ${getConfidenceColor(scan.top_candidate_confidence)}`}>
                      {scan.top_candidate_confidence}%
                    </span>
                  </div>
                  <div className="text-xs text-gray-400">
                    {scan.top_candidate_action === 'WAIT' ? 'Entry intent created' : scan.top_candidate_action === 'PASS' ? 'Below threshold' : 'Ready to execute'}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-gray-400">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-sm">{scan.rejection_reason || 'No valid setups found'}</span>
                </div>
              )}
            </div>

            {expandedScan === scan.id && scan.all_candidates && scan.all_candidates.length > 0 && (
              <div className="border-t border-gray-600/50 p-3 space-y-2">
                <div className="text-xs font-semibold text-gray-400 mb-2">All Symbols Analyzed:</div>
                {scan.all_candidates.map((candidate, idx) => (
                  <div
                    key={idx}
                    className={`p-2 rounded border ${getActionColor(candidate.action)} bg-opacity-50`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        {getActionIcon(candidate.action)}
                        <span className="font-bold text-sm">{candidate.symbol}</span>
                        <span className={`text-xs font-bold ${getConfidenceColor(candidate.confidence)}`}>
                          {candidate.confidence}%
                        </span>
                      </div>
                      <div className="text-xs">
                        {candidate.trend && (
                          <span className="text-gray-400">
                            {candidate.trend === 'bullish' ? '📈' : candidate.trend === 'bearish' ? '📉' : '➡️'}
                          </span>
                        )}
                      </div>
                    </div>
                    {candidate.reasoning && (
                      <div className="text-xs text-gray-300 leading-relaxed mb-1">
                        {candidate.reasoning}
                      </div>
                    )}
                    {candidate.action !== 'PASS' && candidate.action !== 'NO_TRADE' && candidate.entry && (
                      <div className="flex items-center gap-3 text-xs text-gray-400 font-mono">
                        <span>Entry: {candidate.entry.toFixed(5)}</span>
                        {candidate.stopLoss && <span>SL: {candidate.stopLoss.toFixed(5)}</span>}
                        {candidate.takeProfit && <span>TP: {candidate.takeProfit.toFixed(5)}</span>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * Alpha Execution Diagnostics Dashboard
 *
 * Non-invasive visibility into why trades aren't executing
 * Shows execution pipeline status and block reasons intelligently
 * Enables users to understand degradation without intrusive alerts
 */

import React, { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle, Clock, Zap } from 'lucide-react';

interface ExecutionBlockSummary {
  totalDecisions: number;
  successfulExecutions: number;
  blockedDecisions: number;
  topBlockReasons: Array<{ reason: string; count: number; severity: string }>;
  recoverable: number;
  lastBlockedAt: string | null;
}

interface RecentAudit {
  id: string;
  action: string;
  symbol: string;
  confidence: number;
  execution_success: boolean;
  created_at: string;
}

export function AlphaExecutionDiagnostics({ sessionId }: { sessionId: string }) {
  const [summary, setSummary] = useState<ExecutionBlockSummary | null>(null);
  const [recentAudits, setRecentAudits] = useState<RecentAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDiagnostics();
    const interval = setInterval(loadDiagnostics, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [sessionId]);

  async function loadDiagnostics() {
    try {
      const token = localStorage.getItem('supabase_token');
      if (!token) return;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/diagnose-alpha-execution`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sessionId }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        setSummary(data.summary);
        setRecentAudits(data.recentAudits || []);
        setError(null);
      } else {
        setError('Failed to load diagnostics');
      }
    } catch (err) {
      console.warn('[AlphaExecutionDiagnostics] Failed to load:', err);
      setError('Diagnostics unavailable');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="p-4 bg-slate-50 rounded-lg">
        <div className="text-sm text-slate-600">Loading diagnostics...</div>
      </div>
    );
  }

  if (!summary) {
    return null;
  }

  const executionRate = summary.totalDecisions
    ? Math.round(
        ((summary.successfulExecutions / summary.totalDecisions) * 100)
      )
    : 0;

  const hasBlockers = summary.blockedDecisions > 0;
  const hasRecoverable = summary.recoverable > 0;

  return (
    <div className="space-y-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-slate-900 flex items-center gap-2">
            <Zap className="w-5 h-5" />
            Alpha Execution Health
          </h3>
          <p className="text-sm text-slate-600 mt-1">
            {hasBlockers
              ? hasRecoverable
                ? `${summary.blockedDecisions} blocks (${summary.recoverable} recoverable)`
                : `${summary.blockedDecisions} blocking issues`
              : 'All systems operational'}
          </p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-slate-900">{executionRate}%</div>
          <div className="text-xs text-slate-600">Execution Rate</div>
        </div>
      </div>

      {/* Execution Stats */}
      <div className="grid grid-cols-3 gap-3 mt-4">
        <div className="p-3 bg-white rounded border border-slate-200">
          <div className="text-xs text-slate-600">Total Decisions</div>
          <div className="text-lg font-semibold text-slate-900">
            {summary.totalDecisions}
          </div>
        </div>
        <div className="p-3 bg-white rounded border border-green-200">
          <div className="text-xs text-green-700 flex items-center gap-1">
            <CheckCircle className="w-3 h-3" />
            Executed
          </div>
          <div className="text-lg font-semibold text-green-700">
            {summary.successfulExecutions}
          </div>
        </div>
        {hasBlockers && (
          <div className="p-3 bg-white rounded border border-amber-200">
            <div className="text-xs text-amber-700 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Blocked
            </div>
            <div className="text-lg font-semibold text-amber-700">
              {summary.blockedDecisions}
            </div>
          </div>
        )}
      </div>

      {/* Top Block Reasons */}
      {hasBlockers && summary.topBlockReasons.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-200">
          <h4 className="text-sm font-medium text-slate-900 mb-3">
            Top Block Reasons
          </h4>
          <div className="space-y-2">
            {summary.topBlockReasons.map((reason, idx) => (
              <div key={idx} className="flex items-start justify-between text-sm">
                <div className="flex-1">
                  <div className="text-slate-700">{reason.reason}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {reason.severity === 'FATAL' && (
                      <span className="text-red-600">Blocking</span>
                    )}
                    {reason.severity === 'WARNING' && (
                      <span className="text-amber-600">Warning</span>
                    )}
                    {reason.severity === 'ADVISORY' && (
                      <span className="text-blue-600">Advisory</span>
                    )}
                  </div>
                </div>
                <div className="ml-2 text-slate-600 font-medium min-w-fit">
                  ×{reason.count}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recovery Info */}
      {hasRecoverable && (
        <div className="mt-4 p-3 bg-green-50 rounded border border-green-200">
          <div className="flex items-start gap-2 text-sm">
            <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-green-900">
                {summary.recoverable} Recoverable Block{summary.recoverable !== 1 ? 's' : ''}
              </div>
              <div className="text-xs text-green-700 mt-1">
                These blocks may resolve automatically as conditions improve
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent Execution History */}
      {recentAudits.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-200">
          <h4 className="text-sm font-medium text-slate-900 mb-2">
            Recent Execution Attempts
          </h4>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {recentAudits.slice(0, 5).map((audit) => (
              <div
                key={audit.id}
                className="flex items-center justify-between p-2 bg-white rounded border border-slate-200 text-xs"
              >
                <div className="flex items-center gap-2">
                  {audit.execution_success ? (
                    <CheckCircle className="w-4 h-4 text-green-600" />
                  ) : (
                    <Clock className="w-4 h-4 text-amber-600" />
                  )}
                  <div>
                    <div className="font-medium text-slate-900">
                      {audit.action} {audit.symbol}
                    </div>
                    <div className="text-slate-500">
                      {Math.round(audit.confidence)}% confidence
                    </div>
                  </div>
                </div>
                <div className="text-slate-500 text-xs">
                  {new Date(audit.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No Issues Message */}
      {!hasBlockers && summary.totalDecisions > 0 && (
        <div className="mt-4 p-3 bg-green-50 rounded border border-green-200">
          <div className="flex items-start gap-2 text-sm">
            <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-green-900">
                Execution Pipeline Healthy
              </div>
              <div className="text-xs text-green-700 mt-1">
                No current blocks. Trades can execute when Alpha signals them.
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 p-3 bg-slate-100 rounded border border-slate-300 text-xs text-slate-600">
          {error}
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, X, RefreshCw } from 'lucide-react';

interface CircuitStatus {
  open: boolean;
  consecutiveFailures: number;
  resetInMs: number | null;
}

export function OpenAIQuotaBanner() {
  const [status, setStatus] = useState<CircuitStatus>({ open: false, consecutiveFailures: 0, resetInMs: null });
  const [dismissed, setDismissed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { getLLMCircuitStatus } = await import('../services/openai-client');
      setStatus(getLLMCircuitStatus());
    } catch {
      // ignore — module may not be loaded yet
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleReset = async () => {
    try {
      const { resetLLMCircuitBreaker } = await import('../services/openai-client');
      resetLLMCircuitBreaker();
      setDismissed(true);
    } catch {
      // ignore
    }
  };

  if (!status.open || dismissed) return null;

  const resetMinutes = status.resetInMs !== null ? Math.ceil(status.resetInMs / 60000) : 30;

  return (
    <div className="bg-red-700 border-b border-red-800 text-white px-3 py-2 shadow-md">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 text-red-200" />
          <span className="text-xs sm:text-sm font-semibold truncate">
            OpenAI quota exhausted — AI scanning paused. Add credits at{' '}
            <a
              href="https://platform.openai.com/settings/organization/billing"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-red-100 transition-colors"
            >
              platform.openai.com
            </a>
            {resetMinutes > 0 && ` · Auto-resumes in ${resetMinutes}m`}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={handleReset}
            title="Reset circuit breaker (use after resolving billing)"
            className="flex items-center gap-1 text-xs bg-red-600 hover:bg-red-500 border border-red-500 rounded px-2 py-0.5 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            <span className="hidden sm:inline">Reset</span>
          </button>
          <button
            onClick={() => setDismissed(true)}
            title="Dismiss"
            className="p-0.5 rounded hover:bg-red-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

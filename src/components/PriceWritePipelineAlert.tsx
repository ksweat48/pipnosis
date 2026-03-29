import { useEffect, useState } from 'react';
import { AlertTriangle, AlertCircle, X, Clock } from 'lucide-react';
import {
  pricePipelineHealthMonitor,
  PipelineHealth,
  PipelineStatus
} from '../services/price-pipeline-health-monitor';

interface Props {
  className?: string;
}

export function PriceWritePipelineAlert({ className = '' }: Props) {
  const [health, setHealth] = useState<PipelineHealth | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [dismissedStatus, setDismissedStatus] = useState<PipelineStatus | null>(null);

  useEffect(() => {
    pricePipelineHealthMonitor.start();
    const unsub = pricePipelineHealthMonitor.subscribe(setHealth);
    return unsub;
  }, []);

  if (!health) return null;
  if (health.status === 'ok' || health.status === 'unknown') return null;

  if (dismissed && dismissedStatus === health.status) return null;

  const isWarning = health.status === 'warning';
  const isCritical = health.status === 'critical';

  const handleDismiss = () => {
    setDismissed(true);
    setDismissedStatus(health.status);
  };

  const stalestSymbol = health.stalestSymbol;
  const worstAge = health.worstAgeSeconds;
  const remaining = isCritical
    ? 'Scans may already be blocked.'
    : `Hard block triggers at 90s.`;

  return (
    <div
      className={`relative flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
        isCritical
          ? 'border-red-500/40 bg-red-950/40 text-red-200'
          : 'border-amber-500/40 bg-amber-950/30 text-amber-200'
      } ${className}`}
    >
      <div className="mt-0.5 shrink-0">
        {isCritical ? (
          <AlertCircle className="h-4 w-4 text-red-400" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-amber-400" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-medium leading-snug">
          {isCritical ? 'Price feed degraded' : 'Price feed slowing'}
        </p>
        <p className="mt-0.5 text-xs opacity-75 leading-relaxed">
          {stalestSymbol ? (
            <>
              <span className="font-mono">{stalestSymbol}</span> last updated{' '}
              <span className="font-medium">{worstAge}s ago</span>.{' '}
            </>
          ) : (
            <>Prices are {worstAge}s old. </>
          )}
          {remaining}
        </p>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-1 opacity-50 text-xs">
          <Clock className="h-3 w-3" />
          <span>{new Date(health.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        </div>
        <button
          onClick={handleDismiss}
          className="opacity-50 hover:opacity-100 transition-opacity"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

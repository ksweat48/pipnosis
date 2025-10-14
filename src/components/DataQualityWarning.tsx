import React from 'react';
import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

interface DataQualityWarningProps {
  hasErrors: boolean;
  hasWarnings: boolean;
  errorCount?: number;
  warningCount?: number;
  repairedCount?: number;
  onDismiss?: () => void;
}

export const DataQualityWarning: React.FC<DataQualityWarningProps> = ({
  hasErrors,
  hasWarnings,
  errorCount = 0,
  warningCount = 0,
  repairedCount = 0,
  onDismiss
}) => {
  if (!hasErrors && !hasWarnings) {
    return null;
  }

  return (
    <div className={`rounded-lg border p-4 mb-4 ${
      hasErrors
        ? 'bg-red-500/10 border-red-500/30'
        : 'bg-yellow-500/10 border-yellow-500/30'
    }`}>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          {hasErrors ? (
            <XCircle className="h-5 w-5 text-red-400" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-yellow-400" />
          )}
        </div>
        <div className="flex-1">
          <h4 className={`font-semibold ${hasErrors ? 'text-red-300' : 'text-yellow-300'}`}>
            {hasErrors ? 'Data Quality Issues Detected' : 'Data Quality Warnings'}
          </h4>
          <div className="mt-2 text-sm text-white/70 space-y-1">
            {hasErrors && errorCount > 0 && (
              <p>
                {errorCount} validation error{errorCount > 1 ? 's' : ''} detected in the market data.
              </p>
            )}
            {hasWarnings && warningCount > 0 && (
              <p>
                {warningCount} warning{warningCount > 1 ? 's' : ''} found in the candle data.
              </p>
            )}
            {repairedCount > 0 && (
              <div className="flex items-center gap-2 mt-2 p-2 bg-green-500/10 border border-green-500/20 rounded">
                <CheckCircle className="h-4 w-4 text-green-400" />
                <span className="text-green-300 text-sm font-medium">
                  {repairedCount} candle{repairedCount > 1 ? 's' : ''} automatically repaired
                </span>
              </div>
            )}
            <p className="text-xs text-white/50 mt-2">
              {hasErrors
                ? 'Some data may be unreliable. Auto-repair attempted where possible.'
                : 'Minor data inconsistencies detected but have been automatically corrected.'}
            </p>
          </div>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="flex-shrink-0 text-white/50 hover:text-white/70 transition-colors"
          >
            <span className="text-xl">&times;</span>
          </button>
        )}
      </div>
    </div>
  );
};

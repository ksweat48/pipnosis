/**
 * Chart Error Display Component
 *
 * Enhanced error messages with specific guidance and retry options.
 * Better user communication than generic error messages.
 *
 * ZERO RISK: UI improvement only.
 */

import { AlertTriangle, RefreshCw, Wifi, Database, Clock, Info } from 'lucide-react';
import { BULLETPROOF_CONFIG } from '@/config/chart-bulletproofing';

interface ChartErrorDisplayProps {
  error: any;
  symbol: string;
  timeframe: string;
  fromCache?: boolean;
  offline?: boolean;
  dataAge?: number;
  onRetry?: () => void;
}

export function ChartErrorDisplay({
  error,
  symbol,
  timeframe,
  fromCache,
  offline,
  dataAge,
  onRetry,
}: ChartErrorDisplayProps) {
  if (!BULLETPROOF_CONFIG.enableEnhancedErrors) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-gray-400">Error loading chart data</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  const errorMessage = error?.message || String(error);

  const getErrorDetails = () => {
    // Network errors
    if (offline || errorMessage.includes('network') || errorMessage.includes('fetch')) {
      return {
        icon: <Wifi className="w-12 h-12 text-orange-500 mx-auto mb-4" />,
        title: 'Network Connection Issue',
        description: offline
          ? 'You appear to be offline. Check your internet connection.'
          : 'Unable to reach the server. This may be a temporary network issue.',
        suggestion: 'Try again in a moment. If using cached data, it will be shown automatically.',
        color: 'orange',
      };
    }

    // Database errors
    if (errorMessage.includes('database') || errorMessage.includes('supabase') || errorMessage.includes('postgres')) {
      return {
        icon: <Database className="w-12 h-12 text-red-500 mx-auto mb-4" />,
        title: 'Database Connection Issue',
        description: 'Unable to load chart data from the database.',
        suggestion: 'This is usually temporary. The system will retry automatically.',
        color: 'red',
      };
    }

    // Timeout errors
    if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
      return {
        icon: <Clock className="w-12 h-12 text-yellow-500 mx-auto mb-4" />,
        title: 'Request Timeout',
        description: 'The server took too long to respond.',
        suggestion: 'Try again or switch to a shorter timeframe.',
        color: 'yellow',
      };
    }

    // Generic error
    return {
      icon: <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />,
      title: 'Unable to Load Chart',
      description: errorMessage || 'An unexpected error occurred.',
      suggestion: 'Please try refreshing the page.',
      color: 'red',
    };
  };

  const details = getErrorDetails();

  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="max-w-md text-center">
        {details.icon}

        <h3 className={`text-xl font-semibold mb-2 text-${details.color}-500`}>
          {details.title}
        </h3>

        <p className="text-gray-400 mb-2">{details.description}</p>

        <p className="text-sm text-gray-500 mb-4">{details.suggestion}</p>

        {/* Cached Data Notice */}
        {fromCache && (
          <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded">
            <div className="flex items-center justify-center gap-2 mb-1">
              <Info className="w-4 h-4 text-blue-400" />
              <span className="text-sm text-blue-400 font-medium">Using Cached Data</span>
            </div>
            {dataAge && (
              <p className="text-xs text-blue-400/80">
                Last updated {Math.round(dataAge / 1000)}s ago
              </p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 justify-center">
          {onRetry && (
            <button
              onClick={onRetry}
              className={`px-4 py-2 bg-${details.color}-600 hover:bg-${details.color}-700 text-white rounded-lg flex items-center gap-2 transition-colors`}
            >
              <RefreshCw className="w-4 h-4" />
              Retry
            </button>
          )}
        </div>

        {/* Symbol/Timeframe Info */}
        <div className="mt-6 pt-4 border-t border-gray-700">
          <p className="text-xs text-gray-500">
            {symbol} · {timeframe}
          </p>
        </div>
      </div>
    </div>
  );
}

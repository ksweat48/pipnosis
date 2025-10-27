import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, XCircle, Clock } from 'lucide-react';
import { isSupabaseConfigured } from '@/lib/supabase';

interface ConfigStatus {
  supabase: boolean;
  metaapi: boolean;
  metaapiVerified?: boolean;
  connectionMode?: 'live' | 'degraded' | 'offline';
  lastDataUpdate?: string;
  cacheAge?: number;
}

export const ConfigurationStatus: React.FC = () => {
  const [status, setStatus] = useState<ConfigStatus>({
    supabase: false,
    metaapi: false,
    metaapiVerified: false,
    connectionMode: 'offline'
  });
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    const checkConfiguration = async () => {
      const supabaseConfigured = isSupabaseConfigured();
      const metaapiConfigured = !!(
        import.meta.env.VITE_METAAPI_ACCOUNT_ID &&
        import.meta.env.VITE_METAAPI_REGION
      );

      let metaapiVerified = false;
      let connectionMode: 'live' | 'degraded' | 'offline' = 'offline';

      if (metaapiConfigured) {
        try {
          const res = await fetch('/.netlify/functions/verify-metaapi-account', { method: 'GET' });
          const data = await res.json();
          metaapiVerified = data.ok === true;

          if (metaapiVerified) {
            connectionMode = 'live';
          }
        } catch (error) {
          console.warn('MetaAPI verification check failed:', error);
        }
      }

      if (!metaapiVerified && supabaseConfigured) {
        try {
          const priceRes = await fetch('/.netlify/functions/get-live-price?symbol=EURUSD');
          const priceData = await priceRes.json();

          if (priceData.ok && priceData.source === 'supabase-cache') {
            connectionMode = 'degraded';
            setStatus(prev => ({
              ...prev,
              lastDataUpdate: priceData.timestamp,
              cacheAge: priceData.ageSeconds
            }));
          } else if (priceData.ok && priceData.source === 'market-data-fallback') {
            connectionMode = 'degraded';
          }
        } catch (error) {
          console.warn('Price check failed:', error);
        }
      }

      setStatus({
        supabase: supabaseConfigured,
        metaapi: metaapiConfigured,
        metaapiVerified,
        connectionMode
      });

      if (!supabaseConfigured || connectionMode !== 'live') {
        setShowDetails(true);
      }
    };

    checkConfiguration();

    const interval = setInterval(checkConfiguration, 30000);
    return () => clearInterval(interval);
  }, []);

  const allConfigured = status.supabase && status.metaapi;
  const isLive = status.connectionMode === 'live';
  const isDegraded = status.connectionMode === 'degraded';

  if (isLive && !showDetails) {
    return null;
  }

  const getStatusIcon = () => {
    if (isLive) return <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />;
    if (isDegraded) return <Clock className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />;
    return <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />;
  };

  const getStatusTitle = () => {
    if (isLive) return 'All Systems Operational';
    if (isDegraded) return 'Operating in Degraded Mode';
    return 'System Status';
  };

  const formatCacheAge = (seconds?: number) => {
    if (!seconds) return 'Unknown';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  return (
    <div className={`glass-card p-4 mb-6 ${isDegraded ? 'border-l-4 border-yellow-400' : ''}`}>
      <div className="flex items-start gap-3">
        {getStatusIcon()}

        <div className="flex-1 min-w-0">
          <h3 className="text-white font-medium mb-2">
            {getStatusTitle()}
          </h3>

          {showDetails && (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                {status.supabase ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400" />
                )}
                <span className="text-white/70">
                  Supabase: {status.supabase ? 'Connected' : 'Not configured'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {status.metaapiVerified ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                ) : isDegraded ? (
                  <Clock className="w-4 h-4 text-yellow-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400" />
                )}
                <span className="text-white/70">
                  MetaApi: {status.metaapiVerified ? 'Live Connection' : isDegraded ? 'Using Cached Data' : 'Not Connected'}
                </span>
              </div>

              {isDegraded && status.cacheAge && (
                <div className="flex items-center gap-2 ml-6">
                  <span className="text-white/50 text-xs">
                    Last update: {formatCacheAge(status.cacheAge)}
                  </span>
                </div>
              )}
            </div>
          )}

          {isDegraded && (
            <div className="mt-3 p-2 bg-yellow-400/10 rounded border border-yellow-400/20">
              <p className="text-yellow-200 text-xs">
                Live connection unavailable. Using cached market data. Charts and prices may be delayed.
              </p>
            </div>
          )}

          {!status.metaapiVerified && status.metaapi && !isDegraded && (
            <p className="text-white/60 text-xs mt-3">
              MetaApi credentials configured but connection verification failed. Check backend configuration.
            </p>
          )}

          {!status.metaapi && (
            <p className="text-white/60 text-xs mt-3">
              Configure MetaApi credentials in your .env file to enable live trading.
            </p>
          )}

          {!status.supabase && (
            <p className="text-red-400 text-xs mt-3">
              Supabase connection failed. Please check your environment variables.
            </p>
          )}
        </div>

        {(allConfigured || isDegraded) && (
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-white/60 hover:text-white text-xs underline flex-shrink-0"
          >
            {showDetails ? 'Hide' : 'Details'}
          </button>
        )}
      </div>
    </div>
  );
};

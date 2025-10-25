import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import { isSupabaseConfigured } from '@/lib/supabase';

interface ConfigStatus {
  supabase: boolean;
  metaapi: boolean;
  metaapiVerified?: boolean;
}

export const ConfigurationStatus: React.FC = () => {
  const [status, setStatus] = useState<ConfigStatus>({
    supabase: false,
    metaapi: false,
    metaapiVerified: false
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
      if (metaapiConfigured) {
        try {
          const res = await fetch('/.netlify/functions/verify-metaapi-account', { method: 'GET' });
          const data = await res.json();
          metaapiVerified = data.ok === true;
        } catch (error) {
          console.warn('MetaAPI verification check failed:', error);
        }
      }

      setStatus({
        supabase: supabaseConfigured,
        metaapi: metaapiConfigured,
        metaapiVerified
      });

      if (!supabaseConfigured || !metaapiVerified) {
        setShowDetails(true);
      }
    };

    checkConfiguration();
  }, []);

  const allConfigured = status.supabase && status.metaapi;
  const partiallyConfigured = status.supabase && !status.metaapi;

  if (allConfigured && !showDetails) {
    return null;
  }

  return (
    <div className="glass-card p-4 mb-6">
      <div className="flex items-start gap-3">
        {allConfigured ? (
          <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
        ) : partiallyConfigured ? (
          <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
        ) : (
          <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
        )}

        <div className="flex-1 min-w-0">
          <h3 className="text-white font-medium mb-2">
            {allConfigured ? 'All Systems Operational' : 'Configuration Status'}
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
                ) : (
                  <AlertCircle className="w-4 h-4 text-yellow-400" />
                )}
                <span className="text-white/70">
                  MetaApi: {status.metaapiVerified ? 'Connected' : 'Not connected'}
                </span>
              </div>
            </div>
          )}

          {!status.metaapiVerified && status.metaapi && (
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

        {(allConfigured || partiallyConfigured) && (
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

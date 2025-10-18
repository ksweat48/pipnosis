import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import { isSupabaseConfigured } from '@/lib/supabase';

interface ConfigStatus {
  supabase: boolean;
  metaapi: boolean;
}

export const ConfigurationStatus: React.FC = () => {
  const [status, setStatus] = useState<ConfigStatus>({
    supabase: false,
    metaapi: false
  });
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    const checkConfiguration = () => {
      const supabaseConfigured = isSupabaseConfigured();
      const metaapiConfigured = !!(
        import.meta.env.VITE_METAAPI_TOKEN &&
        import.meta.env.VITE_METAAPI_ACCOUNT_ID
      );

      setStatus({
        supabase: supabaseConfigured,
        metaapi: metaapiConfigured
      });

      if (!supabaseConfigured || !metaapiConfigured) {
        setShowDetails(true);
      }
    };

    checkConfiguration();
  }, []);

  const allConfigured = status.supabase && status.metaapi;
  const hasCriticalError = !status.supabase || !status.metaapi;

  if (allConfigured && !showDetails) {
    return null;
  }

  return (
    <div className="glass-card p-4 mb-6">
      <div className="flex items-start gap-3">
        {allConfigured ? (
          <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
        ) : (
          <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
        )}

        <div className="flex-1 min-w-0">
          <h3 className="text-white font-medium mb-2">
            {allConfigured ? 'All Systems Operational' : 'Critical Configuration Error'}
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
                {status.metaapi ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400" />
                )}
                <span className="text-white/70">
                  MetaAPI: {status.metaapi ? 'Connected' : 'Not configured'}
                </span>
              </div>
            </div>
          )}

          {hasCriticalError && (
            <p className="text-red-400 text-xs mt-3">
              {!status.supabase && !status.metaapi
                ? 'Both Supabase and MetaAPI credentials are required. The application cannot function without proper configuration.'
                : !status.supabase
                ? 'Supabase connection is required. Please check your environment variables.'
                : 'MetaAPI credentials are required for live trading data. The application cannot function without proper configuration.'}
            </p>
          )}
        </div>

        {allConfigured && (
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

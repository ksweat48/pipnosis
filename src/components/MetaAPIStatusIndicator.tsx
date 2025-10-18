import { useState, useEffect } from 'react';
import { Activity, AlertCircle, CheckCircle, Clock, XCircle } from 'lucide-react';
import { metaApiTokenManager } from '@/services/metaapi-token-manager';

interface TokenInfo {
  hasToken: boolean;
  isAdminToken: boolean;
  expiresInMinutes: number | null;
  isValid: boolean;
  region: string;
  refreshCount: number;
}

export function MetaAPIStatusIndicator() {
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const updateStatus = () => {
      const info = metaApiTokenManager.getTokenInfo();
      setTokenInfo(info as TokenInfo);
    };

    updateStatus();
    const interval = setInterval(updateStatus, 30000);

    return () => clearInterval(interval);
  }, []);

  if (!tokenInfo) {
    return null;
  }

  const getStatusColor = () => {
    if (!tokenInfo.hasToken) return 'text-gray-400';
    if (!tokenInfo.isValid) return 'text-red-500';
    if (tokenInfo.isAdminToken) return 'text-yellow-500';
    return 'text-green-500';
  };

  const getStatusIcon = () => {
    if (!tokenInfo.hasToken) return <XCircle className="w-4 h-4" />;
    if (!tokenInfo.isValid) return <AlertCircle className="w-4 h-4" />;
    if (tokenInfo.isAdminToken) return <Clock className="w-4 h-4" />;
    return <CheckCircle className="w-4 h-4" />;
  };

  const getStatusText = () => {
    if (!tokenInfo.hasToken) return 'No Token';
    if (!tokenInfo.isValid) return 'Token Expired';
    if (tokenInfo.isAdminToken) return 'Admin Token';
    return 'Secure Token';
  };

  const getStatusMessage = () => {
    if (!tokenInfo.hasToken) {
      return 'MetaAPI token not configured';
    }
    if (!tokenInfo.isValid) {
      return 'Token has expired and needs refresh';
    }
    if (tokenInfo.isAdminToken) {
      return 'Using admin token (fallback mode)';
    }
    return `Temporary token active (${tokenInfo.expiresInMinutes}m remaining)`;
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors ${
          isExpanded ? 'bg-gray-800' : 'bg-gray-900 hover:bg-gray-800'
        }`}
        title="MetaAPI Connection Status"
      >
        <Activity className="w-4 h-4 text-gray-400" />
        <div className={`flex items-center gap-1.5 ${getStatusColor()}`}>
          {getStatusIcon()}
          <span className="text-sm font-medium">{getStatusText()}</span>
        </div>
      </button>

      {isExpanded && (
        <div className="absolute right-0 mt-2 w-80 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 p-4">
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-white mb-2">MetaAPI Status</h3>
              <p className="text-xs text-gray-400">{getStatusMessage()}</p>
            </div>

            <div className="border-t border-gray-700 pt-3 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Region:</span>
                <span className="text-white font-mono">{tokenInfo.region}</span>
              </div>

              {tokenInfo.expiresInMinutes !== null && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Expires:</span>
                  <span className={`font-mono ${
                    tokenInfo.expiresInMinutes < 10 ? 'text-red-400' :
                    tokenInfo.expiresInMinutes < 30 ? 'text-yellow-400' :
                    'text-green-400'
                  }`}>
                    {tokenInfo.expiresInMinutes} minutes
                  </span>
                </div>
              )}

              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Type:</span>
                <span className="text-white font-mono">
                  {tokenInfo.isAdminToken ? 'Admin' : 'Temporary'}
                </span>
              </div>

              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Refresh Count:</span>
                <span className="text-white font-mono">{tokenInfo.refreshCount}</span>
              </div>
            </div>

            <div className="border-t border-gray-700 pt-3">
              <button
                onClick={() => {
                  console.log('🧪 Running diagnostics from UI...');
                  (window as any).testMetaAPIConnection?.();
                }}
                className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
              >
                Run Diagnostics
              </button>
            </div>

            {tokenInfo.isAdminToken && (
              <div className="bg-yellow-900/20 border border-yellow-700/30 rounded p-2">
                <p className="text-xs text-yellow-400">
                  ⚠️ Using admin token. Check browser console or run diagnostics to troubleshoot.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

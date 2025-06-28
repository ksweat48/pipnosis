import React from 'react';
import { RefreshCw, Server, CheckCircle, Cloud, Globe } from 'lucide-react';
import { useBackendConnection } from '../hooks/useBackendAPI';
import { backendAPI } from '../services/backendAPI';

interface BackendStatusProps {
  showDetails?: boolean;
  className?: string;
}

export const BackendStatus: React.FC<BackendStatusProps> = ({ 
  showDetails = false, 
  className = "" 
}) => {
  const { isConnected, isChecking, lastChecked, checkConnection } = useBackendConnection();

  const isProduction = window.location.hostname === 'pipnosis.com' || 
                      window.location.hostname === 'www.pipnosis.com' ||
                      window.location.hostname.includes('netlify.app');

  const getStatusColor = () => {
    if (isChecking) return 'text-yellow-400';
    return isConnected ? 'text-green-400' : 'text-blue-400';
  };

  const getStatusIcon = () => {
    if (isChecking) return <RefreshCw className="h-4 w-4 animate-spin" />;
    return isConnected ? <Cloud className="h-4 w-4" /> : <Globe className="h-4 w-4" />;
  };

  const getStatusText = () => {
    if (isChecking) return 'Checking...';
    if (isConnected) return 'API Live';
    return isProduction ? 'Production AI' : 'Demo Mode';
  };

  if (!showDetails) {
    return (
      <div className={`flex items-center space-x-2 ${className}`}>
        <div className={getStatusColor()}>{getStatusIcon()}</div>
        <span className={`text-xs ${getStatusColor()}`}>{getStatusText()}</span>
      </div>
    );
  }

  return (
    <div className={`bg-slate-800 rounded-lg border border-slate-700 p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <Server className="h-5 w-5 text-blue-400" />
          <h4 className="text-white font-medium">Backend Status</h4>
        </div>
        <button
          onClick={checkConnection}
          disabled={isChecking}
          className="p-1 text-slate-400 hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isChecking ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">Status:</span>
          <div className={`flex items-center space-x-1 ${getStatusColor()}`}>
            {getStatusIcon()}
            <span className="text-sm font-medium">{getStatusText()}</span>
          </div>
        </div>

        {lastChecked && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Last checked:</span>
            <span className="text-sm text-slate-300">{lastChecked.toLocaleTimeString()}</span>
          </div>
        )}

        <div className="flex items-start justify-between">
          <span className="text-sm text-slate-400 flex-shrink-0">API Endpoint:</span>
          <span className="text-sm text-slate-300 font-mono text-right break-all ml-2">
            {backendAPI.getAPIEndpoint().replace('https://', '').replace('http://', '')}
          </span>
        </div>
      </div>

      {!isConnected && !isChecking && (
        <div className="mt-3 p-2 bg-blue-500/10 border border-blue-500/30 rounded text-xs text-blue-300">
          {isProduction 
            ? '🚀 Production AI active with realistic responses.'
            : '✨ Demo mode active with realistic AI responses.'
          }
        </div>
      )}

      {isConnected && (
        <div className="mt-3 p-2 bg-green-500/10 border border-green-500/30 rounded text-xs text-green-300">
          ✅ Connected to live backend API.
        </div>
      )}
    </div>
  );
};
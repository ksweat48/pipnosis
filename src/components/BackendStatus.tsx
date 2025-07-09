import React from 'react';
import { Wifi, WifiOff, RefreshCw, Server, AlertCircle, CheckCircle } from 'lucide-react';
import { useBackendConnection } from '../hooks/useBackendConnection';

interface BackendStatusProps {
  showDetails?: boolean;
  className?: string;
}

export const BackendStatus: React.FC<BackendStatusProps> = ({ 
  showDetails = false, 
  className = "" 
}) => {
  const { isConnected, isChecking, lastChecked, checkConnection } = useBackendConnection();

  const getStatusColor = () => {
    if (isChecking) return 'text-yellow-400';
    return isConnected ? 'text-green-400' : 'text-red-400';
  };

  const getStatusIcon = () => {
    if (isChecking) return <RefreshCw className="h-4 w-4 animate-spin" />;
    return isConnected ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />;
  };

  const getStatusText = () => {
    if (isChecking) return 'Checking...';
    return isConnected ? 'Backend Connected' : 'Backend Offline';
  };

  // Get the actual API endpoint being used
  const getApiEndpoint = () => {
    const isProduction = window.location.hostname === 'pipnosis.com' || 
                        window.location.hostname === 'www.pipnosis.com' ||
                        window.location.hostname.includes('netlify.app');
    
    const isWebContainer = window.location.hostname.includes('webcontainer') || 
                           window.location.hostname.includes('bolt.new') ||
                           window.location.hostname.includes('stackblitz');
    
    if (isProduction) {
      return 'pipnosis-production.up.railway.app';
    }
    
    if (isWebContainer) {
      return `${window.location.hostname}:3001`;
    }
    
    return import.meta.env.VITE_PIPNOSIS_API_URL || 'localhost:3001';
  };

  if (!showDetails) {
    // Compact version for header
    return (
      <div className={`flex items-center space-x-2 ${className}`}>
        <div className={getStatusColor()}>
          {getStatusIcon()}
        </div>
        <span className={`text-xs ${getStatusColor()}`}>
          {getStatusText()}
        </span>
      </div>
    );
  }

  // Detailed version for dashboard
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
          title="Refresh status"
        >
          <RefreshCw className={`h-4 w-4 ${isChecking ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">Connection:</span>
          <div className={`flex items-center space-x-1 ${getStatusColor()}`}>
            {getStatusIcon()}
            <span className="text-sm font-medium">{getStatusText()}</span>
          </div>
        </div>

        {lastChecked && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Last checked:</span>
            <span className="text-sm text-slate-300">
              {lastChecked.toLocaleTimeString()}
            </span>
          </div>
        )}

        <div className="flex items-start justify-between">
          <span className="text-sm text-slate-400 flex-shrink-0">API Endpoint:</span>
          <span className="text-sm text-slate-300 font-mono text-right break-all ml-2">
            {getApiEndpoint()}
          </span>
        </div>
      </div>

      {!isConnected && !isChecking && (
        <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300">
          Backend server is not responding. Make sure the server is running.
        </div>
      )}
    </div>
  );
};
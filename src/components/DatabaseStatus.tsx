import React from 'react';
import { Database, CheckCircle, RefreshCw, Users, TrendingUp, BookOpen, Target, Cloud, Globe } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useDatabaseStats } from '../hooks/useDatabase';

interface DatabaseStatusProps {
  showDetails?: boolean;
  className?: string;
}

export const DatabaseStatus: React.FC<DatabaseStatusProps> = ({ 
  showDetails = false, 
  className = "" 
}) => {
  const { databaseConnected, user } = useAuth();
  const { stats, isLoading, refreshStats } = useDatabaseStats();

  const isProduction = window.location.hostname === 'pipnosis.com' || 
                      window.location.hostname === 'www.pipnosis.com' ||
                      window.location.hostname.includes('netlify.app');

  const getStatusColor = () => {
    return databaseConnected ? 'text-green-400' : 'text-blue-400';
  };

  const getStatusIcon = () => {
    if (isLoading) return <RefreshCw className="h-4 w-4 animate-spin" />;
    return databaseConnected ? <Cloud className="h-4 w-4" /> : <Globe className="h-4 w-4" />;
  };

  const getStatusText = () => {
    if (isLoading) return 'Syncing...';
    if (databaseConnected) return 'DB Online';
    return isProduction ? 'Production Mode' : 'Demo Mode';
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
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <Database className="h-5 w-5 text-blue-400" />
          <h4 className="text-white font-medium">Database Status</h4>
        </div>
        <button
          onClick={refreshStats}
          disabled={isLoading}
          className="p-1 text-slate-400 hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">Connection:</span>
          <div className={`flex items-center space-x-1 ${getStatusColor()}`}>
            {getStatusIcon()}
            <span className="text-sm font-medium">{getStatusText()}</span>
          </div>
        </div>

        {user && (
          <>
            <div className="border-t border-slate-600 pt-4">
              <h5 className="text-white font-medium mb-3">Your Data</h5>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-900 rounded-lg p-3 border border-slate-600">
                  <div className="flex items-center space-x-2 mb-1">
                    <Target className="h-4 w-4 text-blue-400" />
                    <span className="text-xs text-slate-400">Prompts</span>
                  </div>
                  <div className="text-lg font-bold text-white">{stats.totalPrompts}</div>
                </div>

                <div className="bg-slate-900 rounded-lg p-3 border border-slate-600">
                  <div className="flex items-center space-x-2 mb-1">
                    <TrendingUp className="h-4 w-4 text-green-400" />
                    <span className="text-xs text-slate-400">Trades</span>
                  </div>
                  <div className="text-lg font-bold text-white">{stats.totalTrades}</div>
                </div>

                <div className="bg-slate-900 rounded-lg p-3 border border-slate-600">
                  <div className="flex items-center space-x-2 mb-1">
                    <BookOpen className="h-4 w-4 text-purple-400" />
                    <span className="text-xs text-slate-400">Journal</span>
                  </div>
                  <div className="text-lg font-bold text-white">{stats.totalJournalEntries}</div>
                </div>

                <div className="bg-slate-900 rounded-lg p-3 border border-slate-600">
                  <div className="flex items-center space-x-2 mb-1">
                    <Users className="h-4 w-4 text-yellow-400" />
                    <span className="text-xs text-slate-400">Win Rate</span>
                  </div>
                  <div className="text-lg font-bold text-white">{stats.winRate}%</div>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-600 pt-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Account Value:</span>
                <span className="text-green-400 font-semibold">
                  ${stats.accountValue.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Total P&L:</span>
                <span className={`font-semibold ${stats.totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {stats.totalPnL >= 0 ? '+' : ''}${stats.totalPnL}
                </span>
              </div>
            </div>
          </>
        )}

        {!databaseConnected && (
          <div className="p-2 bg-blue-500/10 border border-blue-500/30 rounded text-xs text-blue-300">
            {isProduction 
              ? '🚀 Production mode active with cloud data sync.'
              : '✨ Demo mode active with realistic AI responses.'
            }
          </div>
        )}

        {databaseConnected && user && (
          <div className="p-2 bg-green-500/10 border border-green-500/30 rounded text-xs text-green-300">
            ✅ All data synced and backed up securely.
          </div>
        )}
      </div>
    </div>
  );
};
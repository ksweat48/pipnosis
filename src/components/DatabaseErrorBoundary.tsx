import React, { useState, useEffect } from 'react';
import { AlertTriangle, RefreshCw, Database, ExternalLink } from 'lucide-react';
import { dbHealthMonitor, DatabaseHealthStatus } from '../services/db-health-monitor';

interface DatabaseErrorBoundaryProps {
  children: React.ReactNode;
}

export function DatabaseErrorBoundary({ children }: DatabaseErrorBoundaryProps) {
  const [healthStatus, setHealthStatus] = useState<DatabaseHealthStatus>('unknown');
  const [showError, setShowError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [actionableMessage, setActionableMessage] = useState('');

  useEffect(() => {
    const handleHealthUpdate = () => {
      const metrics = dbHealthMonitor.getMetrics();
      setHealthStatus(metrics.status);

      if (metrics.status === 'critical') {
        setShowError(true);
        setErrorMessage(dbHealthMonitor.getDetailedErrorMessage());
        setActionableMessage(dbHealthMonitor.getActionableMessage());
      }
    };

    const handleCritical = () => {
      const metrics = dbHealthMonitor.getMetrics();
      setShowError(true);
      setHealthStatus('critical');
      setErrorMessage(dbHealthMonitor.getDetailedErrorMessage());
      setActionableMessage(dbHealthMonitor.getActionableMessage());
    };

    dbHealthMonitor.on('health-update', handleHealthUpdate);
    dbHealthMonitor.on('health-critical', handleCritical);

    handleHealthUpdate();

    return () => {
      dbHealthMonitor.off('health-update', handleHealthUpdate);
      dbHealthMonitor.off('health-critical', handleCritical);
    };
  }, []);

  const handleRetry = () => {
    setShowError(false);
    window.location.reload();
  };

  const handleDismiss = () => {
    setShowError(false);
  };

  if (!showError || healthStatus !== 'critical') {
    return <>{children}</>;
  }

  return (
    <>
      {children}
      <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-gray-900 border-2 border-red-500 rounded-xl max-w-2xl w-full shadow-2xl">
          <div className="p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-red-900/30 rounded-full">
                <AlertTriangle className="w-8 h-8 text-red-500" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">Database Connection Critical</h2>
                <p className="text-gray-400 text-sm">The application cannot connect to the database</p>
              </div>
            </div>

            <div className="bg-red-900/20 border border-red-500 rounded-lg p-6 mb-6">
              <h3 className="text-lg font-semibold text-red-400 mb-3">Error Details</h3>
              <p className="text-gray-300 text-sm leading-relaxed">
                {errorMessage}
              </p>
            </div>

            {actionableMessage && (
              <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 mb-6">
                <h3 className="text-lg font-semibold text-gray-200 mb-3">How to Fix</h3>
                <p className="text-gray-300 text-sm leading-relaxed">
                  {actionableMessage}
                </p>
              </div>
            )}

            <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 mb-6">
              <h3 className="text-sm font-semibold text-gray-200 mb-3">Common Solutions:</h3>
              <ul className="space-y-2 text-sm text-gray-300">
                <li className="flex items-start gap-2">
                  <Database className="w-4 h-4 text-cyan-400 mt-1 flex-shrink-0" />
                  <span>Check if the <code className="text-cyan-400 bg-gray-900 px-1 rounded">market_data</code> table exists in Supabase Dashboard</span>
                </li>
                <li className="flex items-start gap-2">
                  <Database className="w-4 h-4 text-cyan-400 mt-1 flex-shrink-0" />
                  <span>Verify environment variables in <code className="text-cyan-400 bg-gray-900 px-1 rounded">.env</code> file</span>
                </li>
                <li className="flex items-start gap-2">
                  <Database className="w-4 h-4 text-cyan-400 mt-1 flex-shrink-0" />
                  <span>Run database migrations from <code className="text-cyan-400 bg-gray-900 px-1 rounded">supabase/migrations/</code></span>
                </li>
                <li className="flex items-start gap-2">
                  <Database className="w-4 h-4 text-cyan-400 mt-1 flex-shrink-0" />
                  <span>Check Row Level Security (RLS) policies allow access</span>
                </li>
              </ul>
            </div>

            <div className="bg-blue-900/20 border border-blue-500 rounded-lg p-4 mb-6">
              <p className="text-sm text-gray-300">
                <span className="font-semibold text-blue-400">Need help?</span> See{' '}
                <code className="text-cyan-400 bg-gray-900 px-1 rounded">PRODUCTION_DATABASE_SETUP.md</code>{' '}
                for step-by-step setup instructions.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleRetry}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg font-medium transition"
              >
                <RefreshCw className="w-5 h-5" />
                Retry Connection
              </button>

              <button
                onClick={handleDismiss}
                className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition"
              >
                Dismiss (Not Recommended)
              </button>
            </div>

            <a
              href="https://supabase.com/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-cyan-400 transition"
            >
              <ExternalLink className="w-4 h-4" />
              Open Supabase Dashboard
            </a>
          </div>
        </div>
      </div>
    </>
  );
}

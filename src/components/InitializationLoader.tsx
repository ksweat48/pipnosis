import React, { useState, useEffect } from 'react';
import { Loader2, AlertCircle, CheckCircle } from 'lucide-react';

interface InitializationLoaderProps {
  isLoading: boolean;
  error?: string | null;
  tasks?: Array<{
    name: string;
    status: 'pending' | 'loading' | 'success' | 'error';
  }>;
  onRetry?: () => void;
}

export const InitializationLoader: React.FC<InitializationLoaderProps> = ({
  isLoading,
  error,
  tasks = [],
  onRetry,
}) => {
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showSlowWarning, setShowSlowWarning] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setElapsedTime(0);
      setShowSlowWarning(false);
      return;
    }

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setElapsedTime(elapsed);

      if (elapsed > 10) {
        setShowSlowWarning(true);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isLoading]);

  if (!isLoading && !error) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 flex items-center justify-center z-50">
      <div className="max-w-md w-full glass-card p-8 mx-4">
        {error ? (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>

            <h2 className="text-2xl font-bold text-white">Initialization Failed</h2>

            <p className="text-white/70">{error}</p>

            {onRetry && (
              <button
                onClick={onRetry}
                className="mt-4 px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-medium rounded-lg transition-colors"
              >
                Retry
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
              </div>

              <h2 className="text-2xl font-bold text-white mb-2">Initializing Pipnosis</h2>

              <p className="text-white/60 text-sm">
                Setting up your trading environment...
              </p>

              {elapsedTime > 0 && (
                <p className="text-white/40 text-xs mt-2">
                  {elapsedTime}s elapsed
                </p>
              )}
            </div>

            {showSlowWarning && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                <p className="text-yellow-300 text-sm text-center">
                  Taking longer than expected. This might be due to network conditions or high server load.
                </p>
              </div>
            )}

            {tasks.length > 0 && (
              <div className="space-y-2">
                {tasks.map((task, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between bg-black/20 rounded-lg p-3"
                  >
                    <span className="text-white/80 text-sm">{task.name}</span>
                    {task.status === 'loading' && (
                      <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />
                    )}
                    {task.status === 'success' && (
                      <CheckCircle className="w-4 h-4 text-emerald-500" />
                    )}
                    {task.status === 'error' && (
                      <AlertCircle className="w-4 h-4 text-red-500" />
                    )}
                    {task.status === 'pending' && (
                      <div className="w-4 h-4 border-2 border-white/20 rounded-full" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

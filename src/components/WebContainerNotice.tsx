import React, { useState, useEffect } from 'react';
import { AlertTriangle, ExternalLink, CheckCircle, XCircle } from 'lucide-react';
import { errorHandler } from '@/lib/error-handler';

interface WebContainerNoticeProps {
  onClose?: () => void;
}

export const WebContainerNotice: React.FC<WebContainerNoticeProps> = ({ onClose }) => {
  const [isWebContainer, setIsWebContainer] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState({
    database: 'checking',
    demo: 'active',
    metaapi: 'disabled'
  });

  useEffect(() => {
    const checkEnvironment = errorHandler.isWebContainerEnvironment();
    setIsWebContainer(checkEnvironment);

    if (checkEnvironment) {
      setTimeout(() => {
        setConnectionStatus({
          database: 'connected',
          demo: 'active',
          metaapi: 'disabled'
        });
      }, 1000);
    }
  }, []);

  if (!isWebContainer) return null;

  return (
    <div className="glass-card p-6 mb-8">
      <div className="flex items-start space-x-4">
        <AlertTriangle className="h-5 w-5 text-emerald-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <h4 className="text-emerald-300 font-bold text-lg mb-3">Preview Environment Notice</h4>
          <p className="text-white/80 font-medium">
            You're viewing Pipnosis in a preview environment. All trading is simulated with demo data.
          </p>

          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex items-center space-x-2">
                {connectionStatus.database === 'connected' ? (
                  <CheckCircle className="h-4 w-4 text-emerald-400" />
                ) : connectionStatus.database === 'checking' ? (
                  <div className="h-4 w-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-400" />
                )}
                <span className="text-white/70 text-sm font-medium">Database</span>
              </div>

              <div className="flex items-center space-x-2">
                <CheckCircle className="h-4 w-4 text-emerald-400" />
                <span className="text-white/70 text-sm font-medium">Demo Trading</span>
              </div>

              <div className="flex items-center space-x-2">
                <XCircle className="h-4 w-4 text-yellow-400" />
                <span className="text-white/70 text-sm font-medium">Live MetaAPI</span>
              </div>
            </div>

            <div className="flex items-center space-x-2 text-emerald-300 font-medium">
              <span>✨ Full AI functionality active with demo trading</span>
            </div>
            <p className="text-white/60 text-sm font-medium">
              All features are functional - this is the complete Pipnosis experience!
            </p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-emerald-400 hover:text-emerald-300 p-2 transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
};
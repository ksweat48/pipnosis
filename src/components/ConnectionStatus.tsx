import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, AlertCircle } from 'lucide-react';
import { errorHandler } from '@/lib/error-handler';

interface ConnectionStatusProps {
  className?: string;
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ className = '' }) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isWebContainer, setIsWebContainer] = useState(false);
  const [showWarning, setShowWarning] = useState(false);

  useEffect(() => {
    setIsWebContainer(errorHandler.isWebContainerEnvironment());

    const handleOnline = () => {
      setIsOnline(true);
      setShowWarning(false);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setShowWarning(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!showWarning && isOnline && !isWebContainer) {
    return null;
  }

  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      {!isOnline ? (
        <>
          <WifiOff className="h-4 w-4 text-red-400" />
          <span className="text-red-400 text-sm font-medium">
            Offline - Check your connection
          </span>
        </>
      ) : isWebContainer ? (
        <>
          <AlertCircle className="h-4 w-4 text-emerald-400" />
          <span className="text-emerald-400 text-sm font-medium">
            Preview Mode - Demo data active
          </span>
        </>
      ) : (
        <>
          <Wifi className="h-4 w-4 text-emerald-400" />
          <span className="text-emerald-400 text-sm font-medium">
            Connected
          </span>
        </>
      )}
    </div>
  );
};

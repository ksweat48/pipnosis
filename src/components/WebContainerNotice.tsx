import React from 'react';
import { AlertTriangle, ExternalLink, Server } from 'lucide-react';

interface WebContainerNoticeProps {
  onClose?: () => void;
}

export const WebContainerNotice: React.FC<WebContainerNoticeProps> = ({ onClose }) => {
  const isWebContainer = window.location.hostname.includes('webcontainer-api.io') || 
                         window.location.hostname.includes('local-credentialless') ||
                         window.location.hostname.includes('bolt.new') ||
                         window.location.hostname.includes('stackblitz');

  if (!isWebContainer) return null;

  return (
    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-4">
      <div className="flex items-start space-x-3">
        <AlertTriangle className="h-5 w-5 text-blue-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <h4 className="text-blue-300 font-medium mb-2">WebContainer Environment Notice</h4>
          <p className="text-blue-200 text-sm">
            You're viewing Pipnosis in a preview environment where MT5 connection and some network features are limited. 
            WebSocket connections to external services are restricted in this environment.
          </p>
          <div className="mt-3 space-y-2">
            <div className="flex items-center space-x-2 text-sm text-blue-300">
              <Server className="h-4 w-4" />
              <span>Using fallback data for demonstration purposes</span>
            </div>
            <p className="text-xs text-blue-200">
              For full functionality including MT5 integration, run the application locally on your computer.
            </p>
          </div>
        </div>
        {onClose && (
          <button 
            onClick={onClose}
            className="text-blue-400 hover:text-blue-300 p-1"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
};
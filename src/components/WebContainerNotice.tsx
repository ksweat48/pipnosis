import React from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';

interface WebContainerNoticeProps {
  onClose?: () => void;
}

export const WebContainerNotice: React.FC<WebContainerNoticeProps> = ({ onClose }) => {
  // Simplified check for WebContainer environment
  const isWebContainer = window.location.hostname.includes('webcontainer') || 
                         window.location.hostname.includes('bolt.new') ||
                         window.location.hostname.includes('stackblitz');

  if (!isWebContainer) return null;

  return (
    <div className="bg-gradient-to-r from-emerald-500/10 to-green-500/10 border border-emerald-500/30 rounded-xl p-4 mb-6 backdrop-blur-sm">
      <div className="flex items-start space-x-3">
        <AlertTriangle className="h-5 w-5 text-emerald-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <h4 className="text-blue-300 font-bold mb-2">Preview Environment Notice</h4>
          <p className="text-blue-200 text-sm">
            You're viewing Pipnosis in a preview environment. All trading is simulated with demo data.
          </p>
          <div className="mt-3 space-y-2">
            <div className="flex items-center space-x-2 text-sm text-blue-300">
              <span>✨ Full AI functionality active with demo trading</span>
            </div>
            <p className="text-xs text-blue-200">
              All features are functional - this is the complete Pipnosis experience!
            </p>
          </div>
        </div>
        {onClose && (
          <button 
            onClick={onClose}
            className="text-emerald-400 hover:text-emerald-300 p-1"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
};
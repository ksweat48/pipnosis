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
    <div className="glass-card p-6 mb-8">
      <div className="flex items-start space-x-4">
        <AlertTriangle className="h-5 w-5 text-emerald-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <h4 className="text-emerald-300 font-bold text-lg mb-3">Preview Environment Notice</h4>
          <p className="text-white/80 font-medium">
            You're viewing Pipnosis in a preview environment. All trading is simulated with demo data.
          </p>
          <div className="mt-4 space-y-2">
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
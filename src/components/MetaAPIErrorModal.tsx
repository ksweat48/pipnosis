import React from 'react';
import { AlertCircle, X, ExternalLink } from 'lucide-react';

interface MetaAPIErrorModalProps {
  isOpen: boolean;
  error: Error | null;
  onClose: () => void;
  onRetry?: () => void;
}

export const MetaAPIErrorModal: React.FC<MetaAPIErrorModalProps> = ({
  isOpen,
  error,
  onClose,
  onRetry
}) => {
  if (!isOpen || !error) return null;

  const errorMessage = error.message;
  const isSSLError = errorMessage.includes('SSL Certificate Error');
  const isNetworkError = errorMessage.includes('Network Connection Error');
  const isCredentialError = errorMessage.includes('credentials not configured');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="glass-card max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-8 h-8 text-red-400 flex-shrink-0" />
              <h2 className="text-xl font-semibold text-white">
                {isSSLError && 'SSL Certificate Error'}
                {isNetworkError && 'Network Connection Error'}
                {isCredentialError && 'Configuration Required'}
                {!isSSLError && !isNetworkError && !isCredentialError && 'MetaAPI Connection Error'}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="text-white/60 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-4">
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
              <p className="text-white/90 whitespace-pre-line font-mono text-sm">
                {errorMessage}
              </p>
            </div>

            {isSSLError && (
              <div className="space-y-3">
                <h3 className="text-white font-medium">Additional Troubleshooting:</h3>
                <ul className="space-y-2 text-white/70 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-400 mt-1">•</span>
                    <span>Check if your system clock is synchronized with internet time</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-400 mt-1">•</span>
                    <span>Update your operating system to the latest version</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-400 mt-1">•</span>
                    <span>Try accessing from a different network (mobile hotspot, different WiFi)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-400 mt-1">•</span>
                    <span>Contact your IT department if using a corporate network</span>
                  </li>
                </ul>

                <a
                  href="https://metaapi.cloud/docs/client/troubleshooting/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-emerald-400 hover:text-emerald-300 text-sm mt-3"
                >
                  View MetaAPI Troubleshooting Guide
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            )}

            {isNetworkError && (
              <div className="space-y-3">
                <h3 className="text-white font-medium">Connection Checklist:</h3>
                <ul className="space-y-2 text-white/70 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-400 mt-1">•</span>
                    <span>Verify your internet connection is active and stable</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-400 mt-1">•</span>
                    <span>Check if other websites are accessible</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-400 mt-1">•</span>
                    <span>Disable VPN or proxy temporarily to test</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-400 mt-1">•</span>
                    <span>Check firewall settings to ensure WebSocket connections are allowed</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-400 mt-1">•</span>
                    <span>Restart your router if connection seems unstable</span>
                  </li>
                </ul>
              </div>
            )}

            {isCredentialError && (
              <div className="space-y-3">
                <h3 className="text-white font-medium">Setup Instructions:</h3>
                <p className="text-white/70 text-sm">
                  This application requires MetaAPI credentials to function. Please follow the setup
                  instructions to configure your environment variables.
                </p>
              </div>
            )}

            <div className="flex gap-3 mt-6 pt-4 border-t border-white/10">
              {onRetry && !isCredentialError && (
                <button
                  onClick={() => {
                    onClose();
                    onRetry();
                  }}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors"
                >
                  Retry Connection
                </button>
              )}
              <button
                onClick={onClose}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

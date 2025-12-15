import { useEffect, useState } from 'react';
import { usePWAUpdate } from '../hooks/usePWAUpdate';
import { RefreshCw, X } from 'lucide-react';

export function UpdateBanner() {
  const { updateAvailable, updateContext, applyUpdate, dismissUpdate } = usePWAUpdate();
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (updateAvailable && updateContext === 'app-resume') {
      setIsVisible(true);
      setTimeout(() => setIsAnimating(true), 10);

      const autoDismissTimer = setTimeout(() => {
        handleDismiss();
      }, 30000);

      return () => clearTimeout(autoDismissTimer);
    }
  }, [updateAvailable, updateContext]);

  const handleDismiss = () => {
    setIsAnimating(false);
    setTimeout(() => {
      setIsVisible(false);
      dismissUpdate();
    }, 300);
  };

  const handleUpdate = () => {
    applyUpdate();
  };

  if (!isVisible) return null;

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ease-out ${
        isAnimating ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'
      }`}
    >
      <div className="bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3 flex-1">
              <div className="flex-shrink-0">
                <RefreshCw className="h-5 w-5 animate-spin" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">
                  New version available
                </p>
                <p className="text-xs text-blue-100 mt-0.5">
                  Update now for the latest features and improvements
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleUpdate}
                className="px-4 py-2 bg-white text-blue-600 rounded-lg text-sm font-medium hover:bg-blue-50 transition-colors shadow-sm"
              >
                Update Now
              </button>
              <button
                onClick={handleDismiss}
                className="px-3 py-2 text-white hover:bg-blue-700 rounded-lg transition-colors"
                aria-label="Dismiss update notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

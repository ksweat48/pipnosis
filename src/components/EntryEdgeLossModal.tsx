import React, { useState, useEffect } from 'react';
import { AlertTriangle, TrendingDown, Clock, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface EntryEdgeLossModalProps {
  modalId: string;
  intentData: {
    symbol: string;
    direction: 'long' | 'short';
    style: string;
    entry_zone_min: number;
    entry_zone_max: number;
    created_at: string;
    timeout_minutes: number;
  };
  onClose: () => void;
}

export const EntryEdgeLossModal: React.FC<EntryEdgeLossModalProps> = ({
  modalId,
  intentData,
  onClose
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(60);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleAutoClose();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const handleAutoClose = async () => {
    console.log('[EntryEdgeLoss] Auto-closing session after timeout');
    await handleResponse('close');
  };

  const handleResponse = async (response: 'continue' | 'close') => {
    if (isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      console.log(`[EntryEdgeLoss] User chose: ${response}`);

      const { data, error } = await supabase.rpc('handle_entry_edge_loss_response', {
        p_modal_id: modalId,
        p_response: response
      });

      if (error) {
        console.error('[EntryEdgeLoss] Failed to handle response:', error);
        setError('Failed to process your response. Please try again.');
        setIsLoading(false);
        return;
      }

      console.log('[EntryEdgeLoss] Response processed:', data);

      onClose();

      if (response === 'continue') {
        // Reload page to restart scanning with fresh timer
        setTimeout(() => {
          window.location.reload();
        }, 500);
      }
    } catch (err) {
      console.error('[EntryEdgeLoss] Error handling response:', err);
      setError('An unexpected error occurred');
      setIsLoading(false);
    }
  };

  const minutesWaited = Math.floor(
    (Date.now() - new Date(intentData.created_at).getTime()) / 60000
  );

  const styleInfo = {
    SCALP: { maxWait: 10, color: 'text-orange-500' },
    MICRO_INTRADAY: { maxWait: 45, color: 'text-yellow-500' },
    INTRADAY: { maxWait: 120, color: 'text-blue-500' },
  }[intentData.style] || { maxWait: 45, color: 'text-yellow-500' };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl max-w-2xl w-full p-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-500/20 rounded-lg">
              <AlertTriangle className="w-6 h-6 text-orange-500" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">Trade Edge Decaying</h2>
              <p className="text-sm text-gray-400">Entry monitoring timeout approaching</p>
            </div>
          </div>
          <div className={`text-3xl font-bold ${secondsRemaining <= 10 ? 'text-red-500 animate-pulse' : 'text-orange-500'}`}>
            {secondsRemaining}s
          </div>
        </div>

        {/* Warning Message */}
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <TrendingDown className="w-5 h-5 text-orange-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-white font-medium mb-1">
                This {intentData.style.replace('_', ' ')} entry has been monitoring for {minutesWaited} minutes
                without finding ideal conditions.
              </p>
              <p className="text-gray-300 text-sm">
                The edge for this trade may be weakening. Maximum wait time for {intentData.style.replace('_', ' ')} trades is {styleInfo.maxWait} minutes.
              </p>
            </div>
          </div>
        </div>

        {/* Trade Details */}
        <div className="bg-gray-800/50 rounded-lg p-4 mb-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-gray-400 text-sm mb-1">Symbol</p>
              <p className="text-white font-semibold">{intentData.symbol}</p>
            </div>
            <div>
              <p className="text-gray-400 text-sm mb-1">Direction</p>
              <p className={`font-semibold ${intentData.direction === 'long' ? 'text-green-500' : 'text-red-500'}`}>
                {intentData.direction.toUpperCase()}
              </p>
            </div>
            <div>
              <p className="text-gray-400 text-sm mb-1">Entry Zone</p>
              <p className="text-white font-mono text-sm">
                {intentData.entry_zone_min.toFixed(5)} - {intentData.entry_zone_max.toFixed(5)}
              </p>
            </div>
            <div>
              <p className="text-gray-400 text-sm mb-1">Trade Style</p>
              <p className={`font-semibold ${styleInfo.color}`}>
                {intentData.style.replace('_', ' ')}
              </p>
            </div>
          </div>
        </div>

        {/* Time Warning */}
        <div className="flex items-center gap-2 mb-6 text-gray-300 text-sm">
          <Clock className="w-4 h-4" />
          <p>
            Waited {minutesWaited} of {styleInfo.maxWait} minutes maximum for this style
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-6">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => handleResponse('continue')}
            disabled={isLoading || secondsRemaining === 0}
            className="flex-1 py-3 px-6 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <span>Processing...</span>
            ) : (
              <>
                <Clock className="w-5 h-5" />
                Continue Scanning
              </>
            )}
          </button>
          <button
            onClick={() => handleResponse('close')}
            disabled={isLoading}
            className="flex-1 py-3 px-6 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <span>Processing...</span>
            ) : (
              <>
                <X className="w-5 h-5" />
                Close Session
              </>
            )}
          </button>
        </div>

        {/* Footer Info */}
        <div className="mt-4 pt-4 border-t border-gray-700">
          <p className="text-gray-400 text-xs text-center">
            If no action is taken, the session will automatically close in {secondsRemaining} seconds
          </p>
        </div>
      </div>
    </div>
  );
};

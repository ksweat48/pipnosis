import React, { useState } from 'react';
import { AlertTriangle, RefreshCw, Trash2, CheckCircle } from 'lucide-react';
import { cacheResetService } from '@/services/cache-reset-service';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/useToast';

export const DataResetPanel: React.FC = () => {
  const toast = useToast();
  const [isResetting, setIsResetting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [stats, setStats] = useState<{
    candles: number;
    prices: number;
    rejections: number;
  } | null>(null);

  const fetchStats = async () => {
    try {
      const { count: candleCount } = await supabase
        .from('forex_candles')
        .select('*', { count: 'exact', head: true });

      const { count: priceCount } = await supabase
        .from('realtime_prices')
        .select('*', { count: 'exact', head: true });

      const { count: rejectionCount } = await supabase
        .from('price_validation_rejections')
        .select('*', { count: 'exact', head: true });

      setStats({
        candles: candleCount || 0,
        prices: priceCount || 0,
        rejections: rejectionCount || 0
      });
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  };

  React.useEffect(() => {
    fetchStats();
  }, []);

  const handleCacheClear = async () => {
    setIsResetting(true);
    try {
      await cacheResetService.resetAndReload();
    } catch (error) {
      console.error('Cache reset failed:', error);
      setIsResetting(false);
    }
  };

  const handleFullReset = () => {
    setShowConfirm(true);
  };

  const confirmFullReset = async () => {
    setIsResetting(true);
    setShowConfirm(false);

    try {
      // Clear caches first
      await cacheResetService.performCompleteReset();

      // Note: Database reset must be done via migration
      toast.success('Cache Cleared', 'All caches have been cleared. Database reset requires running the migration from Supabase dashboard.');

      // Reload page after a brief delay to show the toast
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (error) {
      console.error('Full reset failed:', error);
      toast.error('Reset Failed', 'Failed to complete the reset. Please try again.');
      setIsResetting(false);
    }
  };

  return (
    <div className="bg-slate-800 rounded-lg p-6 space-y-6">
      <div className="flex items-center gap-3">
        <AlertTriangle className="w-6 h-6 text-orange-500" />
        <h2 className="text-xl font-semibold text-white">Data Reset & Cache Management</h2>
      </div>

      {stats && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-slate-700 rounded p-4">
            <div className="text-slate-400 text-sm">Candles</div>
            <div className="text-2xl font-bold text-white">{stats.candles.toLocaleString()}</div>
          </div>
          <div className="bg-slate-700 rounded p-4">
            <div className="text-slate-400 text-sm">Prices</div>
            <div className="text-2xl font-bold text-white">{stats.prices.toLocaleString()}</div>
          </div>
          <div className="bg-slate-700 rounded p-4">
            <div className="text-slate-400 text-sm">Validation Rejections</div>
            <div className={`text-2xl font-bold ${stats.rejections > 0 ? 'text-red-500' : 'text-green-500'}`}>
              {stats.rejections.toLocaleString()}
            </div>
          </div>
        </div>
      )}

      {stats && stats.rejections > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-red-400 font-medium">Cross-Symbol Contamination Detected</div>
            <div className="text-slate-400 text-sm mt-1">
              {stats.rejections} price validation rejections found. This indicates wrong symbol prices are being mixed.
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <button
          onClick={handleCacheClear}
          disabled={isResetting}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-lg px-4 py-3 flex items-center justify-center gap-2 transition-colors"
        >
          <RefreshCw className={`w-5 h-5 ${isResetting ? 'animate-spin' : ''}`} />
          {isResetting ? 'Clearing Cache...' : 'Clear Cache & Reload'}
        </button>

        <button
          onClick={handleFullReset}
          disabled={isResetting}
          className="w-full bg-red-600 hover:bg-red-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-lg px-4 py-3 flex items-center justify-center gap-2 transition-colors"
        >
          <Trash2 className="w-5 h-5" />
          Nuclear Reset (Clear All Data)
        </button>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-lg p-6 max-w-md w-full space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-red-500 flex-shrink-0" />
              <div>
                <h3 className="text-lg font-semibold text-white">Confirm Nuclear Reset</h3>
                <p className="text-slate-400 text-sm mt-2">
                  This will:
                </p>
                <ul className="text-slate-400 text-sm mt-2 space-y-1 list-disc list-inside">
                  <li>Clear all browser caches</li>
                  <li>Stop all polling services</li>
                  <li>Reload the page</li>
                </ul>
                <p className="text-slate-400 text-sm mt-3">
                  Note: To clear database data, run the migration from Supabase dashboard.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white rounded px-4 py-2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmFullReset}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded px-4 py-2 transition-colors"
              >
                Confirm Reset
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="text-slate-400 text-sm space-y-2">
        <div className="flex items-start gap-2">
          <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
          <div>
            <strong>Cache Clear:</strong> Clears browser storage and restarts polling with fresh data
          </div>
        </div>
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <strong>Nuclear Reset:</strong> Complete reset of all caches. Database reset requires migration.
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { Activity, Zap, TrendingUp, Save, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { pollingConfigService, PollingSpeed, POLLING_STRATEGIES } from '@/services/polling-config-service';
import { globalPollingCoordinator } from '@/services/global-polling-coordinator';
import { useToast } from '@/hooks/useToast';

export function PollingPreferences() {
  const toast = useToast();
  const [speed, setSpeed] = useState<PollingSpeed>('balanced');
  const [enableVolatilityAdjustment, setEnableVolatilityAdjustment] = useState(true);
  const [pauseOnInactive, setPauseOnInactive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadPreferences();
  }, []);

  const loadPreferences = async () => {
    const config = pollingConfigService.getConfig();
    setSpeed(config.speed);
    setEnableVolatilityAdjustment(config.enableVolatilityAdjustment);
    setPauseOnInactive(config.pauseOnInactive);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('Not authenticated');
      }

      await pollingConfigService.saveUserConfig(user.id, {
        speed,
        enableVolatilityAdjustment,
        pauseOnInactive,
      });

      globalPollingCoordinator.restartPolling();

      setSaved(true);
      toast.success('Preferences Saved', 'Your polling preferences have been updated');
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error('Failed to save polling preferences:', error);
      toast.error('Save Failed', 'Failed to save preferences. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const getSpeedDescription = (speed: PollingSpeed): string => {
    switch (speed) {
      case 'conservative':
        return 'Slower polling, lower API usage. Best for passive monitoring.';
      case 'balanced':
        return 'Optimal balance between speed and API efficiency. Recommended for most users.';
      case 'aggressive':
        return 'Fastest updates for active trading. Higher API usage.';
    }
  };

  const getSpeedIcon = (speed: PollingSpeed) => {
    switch (speed) {
      case 'conservative':
        return <Activity className="w-5 h-5" />;
      case 'balanced':
        return <TrendingUp className="w-5 h-5" />;
      case 'aggressive':
        return <Zap className="w-5 h-5" />;
    }
  };

  const strategy = POLLING_STRATEGIES[speed];

  return (
    <div className="glass-card p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white mb-1">Polling Speed</h2>
          <p className="text-sm text-gray-400">
            Configure how often price data is updated
          </p>
        </div>
        <RefreshCw className="w-6 h-6 text-blue-400" />
      </div>

      <div className="space-y-3">
        <label className="text-sm font-medium text-gray-300">Speed Profile</label>
        <div className="grid grid-cols-1 gap-3">
          {(['conservative', 'balanced', 'aggressive'] as PollingSpeed[]).map((option) => (
            <button
              key={option}
              onClick={() => setSpeed(option)}
              className={`
                flex items-start gap-4 p-4 rounded-lg border-2 transition-all
                ${
                  speed === option
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-white/10 bg-black/20 hover:border-white/20'
                }
              `}
            >
              <div className={`mt-0.5 ${speed === option ? 'text-blue-400' : 'text-gray-400'}`}>
                {getSpeedIcon(option)}
              </div>
              <div className="flex-1 text-left">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-white capitalize">{option}</span>
                  {option === 'balanced' && (
                    <span className="text-xs px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded">
                      Recommended
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-400 mb-2">{getSpeedDescription(option)}</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-gray-500">Critical:</span>{' '}
                    <span className="text-gray-300">{strategy.criticalInterval}ms</span>
                  </div>
                  <div>
                    <span className="text-gray-500">High:</span>{' '}
                    <span className="text-gray-300">{strategy.highInterval}ms</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Normal:</span>{' '}
                    <span className="text-gray-300">{strategy.normalInterval}ms</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Low:</span>{' '}
                    <span className="text-gray-300">{strategy.lowInterval}ms</span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-white/10 pt-4 space-y-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={enableVolatilityAdjustment}
            onChange={(e) => setEnableVolatilityAdjustment(e.target.checked)}
            className="mt-1 w-4 h-4 rounded border-white/20 bg-black/40 text-blue-500 focus:ring-blue-500/50"
          />
          <div className="flex-1">
            <span className="text-white font-medium">Auto-adjust based on volatility</span>
            <p className="text-sm text-gray-400 mt-1">
              Automatically increase polling speed when market volatility is high
            </p>
          </div>
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={pauseOnInactive}
            onChange={(e) => setPauseOnInactive(e.target.checked)}
            className="mt-1 w-4 h-4 rounded border-white/20 bg-black/40 text-blue-500 focus:ring-blue-500/50"
          />
          <div className="flex-1">
            <span className="text-white font-medium">Pause when tab inactive</span>
            <p className="text-sm text-gray-400 mt-1">
              Reduce polling when browser tab is in the background to save resources
            </p>
          </div>
        </label>
      </div>

      <div className="border-t border-white/10 pt-4">
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
          <h3 className="text-sm font-medium text-blue-400 mb-2">Rate Limit Information</h3>
          <div className="text-xs text-gray-400 space-y-1">
            <p>• MetaAPI allows up to 100 price requests per 10 seconds</p>
            <p>• Each request costs 50 CPU credits</p>
            <p>• Polling speed is automatically throttled if approaching limits</p>
            <p>• Higher priority symbols (positions, active charts) poll faster</p>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-medium hover:from-blue-700 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Saving...
            </>
          ) : saved ? (
            <>
              <Save className="w-4 h-4" />
              Saved!
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save Preferences
            </>
          )}
        </button>
      </div>
    </div>
  );
}

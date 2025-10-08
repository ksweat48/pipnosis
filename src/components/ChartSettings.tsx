import React, { useState } from 'react';
import { Settings, X } from 'lucide-react';
import { ChartPreferences } from '../hooks/useChartPreferences';

interface ChartSettingsProps {
  preferences: ChartPreferences;
  onUpdate: (updates: Partial<ChartPreferences>) => void;
}

export const ChartSettings: React.FC<ChartSettingsProps> = ({ preferences, onUpdate }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors border border-white/10"
        title="Chart Settings"
      >
        <Settings className="h-5 w-5 text-white" />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 top-12 z-50 w-80 glass-card p-4 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">Chart Settings</h3>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-white/10 rounded-lg transition-colors"
              >
                <X className="h-5 w-5 text-white/60" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">
                  Theme
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => onUpdate({ theme: 'dark' })}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      preferences.theme === 'dark'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                        : 'bg-white/5 text-white/60 hover:bg-white/10 border border-white/10'
                    }`}
                  >
                    Dark
                  </button>
                  <button
                    onClick={() => onUpdate({ theme: 'light' })}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      preferences.theme === 'light'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                        : 'bg-white/5 text-white/60 hover:bg-white/10 border border-white/10'
                    }`}
                  >
                    Light
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm font-medium text-white/80">Show Volume</span>
                  <input
                    type="checkbox"
                    checked={preferences.show_volume}
                    onChange={(e) => onUpdate({ show_volume: e.target.checked })}
                    className="w-5 h-5 rounded border-white/20 bg-white/5 checked:bg-emerald-500 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-0"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm font-medium text-white/80">Show Grid</span>
                  <input
                    type="checkbox"
                    checked={preferences.show_grid}
                    onChange={(e) => onUpdate({ show_grid: e.target.checked })}
                    className="w-5 h-5 rounded border-white/20 bg-white/5 checked:bg-emerald-500 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-0"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm font-medium text-white/80">Show AI Analysis</span>
                  <input
                    type="checkbox"
                    checked={preferences.show_ai_analysis}
                    onChange={(e) => onUpdate({ show_ai_analysis: e.target.checked })}
                    className="w-5 h-5 rounded border-white/20 bg-white/5 checked:bg-emerald-500 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-0"
                  />
                </label>
              </div>

              <div className="pt-3 border-t border-white/10">
                <p className="text-xs text-white/50">
                  Your chart preferences are automatically saved
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

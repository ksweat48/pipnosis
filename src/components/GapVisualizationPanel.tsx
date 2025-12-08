import React, { useState, useEffect } from 'react';
import {
  Minimize2,
  Maximize2,
  Eye,
  EyeOff,
  TrendingUp,
  AlertTriangle,
  Info,
  Settings
} from 'lucide-react';
import {
  gapVisualizationService,
  GapVisualizationMode,
  PriceGap
} from '@/services/gap-visualization-service';
import { candleGapFillerService } from '@/services/candle-gap-filler';

interface GapVisualizationPanelProps {
  gaps: PriceGap[];
  onSettingsChange: () => void;
}

export function GapVisualizationPanel({ gaps, onSettingsChange }: GapVisualizationPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [settings, setSettings] = useState(gapVisualizationService.getSettings());
  const [gapFillerEnabled, setGapFillerEnabled] = useState(candleGapFillerService.isEnabled());

  const stats = gapVisualizationService.getGapStatistics(gaps);
  const quality = gapVisualizationService.assessDataQuality(gaps);

  useEffect(() => {
    gapVisualizationService.loadSettings();
    candleGapFillerService.loadOptions();
    setSettings(gapVisualizationService.getSettings());
    setGapFillerEnabled(candleGapFillerService.isEnabled());
  }, []);

  const handleModeChange = (mode: GapVisualizationMode) => {
    const newSettings = { ...settings, mode };
    setSettings(newSettings);
    gapVisualizationService.updateSettings(newSettings);
    onSettingsChange();
  };

  const handleBarSpacingChange = (barSpacing: number) => {
    const newSettings = { ...settings, barSpacing };
    setSettings(newSettings);
    gapVisualizationService.updateSettings(newSettings);
    onSettingsChange();
  };

  const handleToggleMajorGapHighlight = () => {
    const newSettings = { ...settings, highlightMajorGaps: !settings.highlightMajorGaps };
    setSettings(newSettings);
    gapVisualizationService.updateSettings(newSettings);
    onSettingsChange();
  };

  const handleToggleGapFiller = () => {
    const newEnabled = !gapFillerEnabled;
    setGapFillerEnabled(newEnabled);
    candleGapFillerService.setEnabled(newEnabled);
    onSettingsChange();
  };

  const getModeIcon = (mode: GapVisualizationMode) => {
    switch (mode) {
      case 'show_all':
        return <Eye className="w-4 h-4" />;
      case 'hide_weekends':
        return <Minimize2 className="w-4 h-4" />;
      case 'compress_all':
        return <Maximize2 className="w-4 h-4" />;
      case 'highlight_major':
        return <AlertTriangle className="w-4 h-4" />;
    }
  };

  const getModeDescription = (mode: GapVisualizationMode) => {
    switch (mode) {
      case 'show_all':
        return 'Show all gaps and normal spacing';
      case 'hide_weekends':
        return 'Hide weekend gaps for cleaner view';
      case 'compress_all':
        return 'Maximum compression, minimal spacing';
      case 'highlight_major':
        return 'Only show significant price gaps';
    }
  };

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="fixed bottom-20 right-4 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 shadow-lg hover:bg-gray-750 transition-colors flex items-center gap-2 z-20"
        title="Gap Visualization Controls"
      >
        <Settings className="w-4 h-4 text-gray-400" />
        <span className="text-sm text-gray-300">
          {stats.totalGaps} gaps
          {quality.score < 80 && (
            <span className="ml-2 text-yellow-500">
              <AlertTriangle className="w-3 h-3 inline" />
            </span>
          )}
        </span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-20 right-4 bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-4 w-80 z-20 max-h-96 overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-blue-500" />
          <h3 className="text-sm font-semibold text-white">Gap Controls</h3>
        </div>
        <button
          onClick={() => setIsExpanded(false)}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <Minimize2 className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-4">
        {/* Data Quality Indicator */}
        <div className={`p-3 rounded-lg ${
          quality.isGood ? 'bg-green-900/20 border border-green-700/50' : 'bg-yellow-900/20 border border-yellow-700/50'
        }`}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-gray-300">Data Quality</span>
            <span className={`text-sm font-bold ${
              quality.isGood ? 'text-green-400' : 'text-yellow-400'
            }`}>
              {quality.score}%
            </span>
          </div>
          {quality.issues.length > 0 && (
            <div className="text-xs text-yellow-300 mt-1">
              {quality.issues.map((issue, i) => (
                <div key={i} className="flex items-start gap-1">
                  <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span>{issue}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Gap Statistics */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-gray-900 p-2 rounded">
            <div className="text-xs text-gray-400">Total Gaps</div>
            <div className="text-lg font-bold text-white">{stats.totalGaps}</div>
          </div>
          <div className="bg-gray-900 p-2 rounded">
            <div className="text-xs text-gray-400">Major Gaps</div>
            <div className="text-lg font-bold text-orange-400">{stats.majorGaps}</div>
          </div>
          <div className="bg-gray-900 p-2 rounded">
            <div className="text-xs text-gray-400">Weekend</div>
            <div className="text-lg font-bold text-blue-400">{stats.weekendGaps}</div>
          </div>
          <div className="bg-gray-900 p-2 rounded">
            <div className="text-xs text-gray-400">Avg Size</div>
            <div className="text-lg font-bold text-green-400">{stats.avgGapSize.toFixed(2)}%</div>
          </div>
        </div>

        {/* Visualization Mode */}
        <div>
          <label className="block text-xs font-medium text-gray-300 mb-2">
            Visualization Mode
          </label>
          <div className="space-y-1">
            {(['show_all', 'hide_weekends', 'compress_all', 'highlight_major'] as GapVisualizationMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => handleModeChange(mode)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded transition-colors ${
                  settings.mode === mode
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-900 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {getModeIcon(mode)}
                <div className="flex-1 text-left">
                  <div className="text-xs font-medium">
                    {mode.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </div>
                  <div className="text-xs opacity-70">
                    {getModeDescription(mode)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Bar Spacing Slider */}
        <div>
          <label className="block text-xs font-medium text-gray-300 mb-2">
            Candle Spacing: {settings.barSpacing}px
          </label>
          <input
            type="range"
            min="2"
            max="12"
            step="1"
            value={settings.barSpacing}
            onChange={(e) => handleBarSpacingChange(Number(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>Tight</span>
            <span>Normal</span>
            <span>Wide</span>
          </div>
        </div>

        {/* Gap Filler Toggle */}
        <div className="flex items-center justify-between p-3 bg-gray-900 rounded-lg">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-blue-400" />
            <div>
              <div className="text-xs font-medium text-white">Auto Fill Small Gaps</div>
              <div className="text-xs text-gray-400">Smooth minor data gaps</div>
            </div>
          </div>
          <button
            onClick={handleToggleGapFiller}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              gapFillerEnabled ? 'bg-blue-600' : 'bg-gray-700'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                gapFillerEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* Highlight Major Gaps Toggle */}
        <div className="flex items-center justify-between p-3 bg-gray-900 rounded-lg">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-400" />
            <div>
              <div className="text-xs font-medium text-white">Highlight Major Gaps</div>
              <div className="text-xs text-gray-400">Mark gaps over 0.5%</div>
            </div>
          </div>
          <button
            onClick={handleToggleMajorGapHighlight}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              settings.highlightMajorGaps ? 'bg-orange-600' : 'bg-gray-700'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                settings.highlightMajorGaps ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* Largest Gap Info */}
        {stats.largestGap && (
          <div className="p-3 bg-gray-900 rounded-lg border border-orange-700/50">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-orange-400" />
              <span className="text-xs font-medium text-white">Largest Gap</span>
            </div>
            <div className="text-xs text-gray-300">
              <div>{stats.largestGap.description}</div>
              <div className="text-orange-400 font-bold mt-1">
                {stats.largestGap.gapSizePercent.toFixed(2)}% price change
              </div>
              <div className="text-gray-400">
                {new Date(stats.largestGap.startTime * 1000).toLocaleString()} →
                {new Date(stats.largestGap.endTime * 1000).toLocaleString()}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

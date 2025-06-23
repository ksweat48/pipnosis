import React, { useState } from 'react';
import { X, Settings, Radio, Upload, AlertTriangle, CheckCircle, Zap, TrendingUp } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [settings, setSettings] = useState({
    // Primary Control
    dataMode: 'api', // 'api' or 'snapshot'
    
    // Trading Pairs Selection (API Mode only)
    pairSelectionMode: 'ai-choose', // 'ai-choose' or 'manual'
    selectedPairs: ['EURUSD', 'GBPUSD', 'USDJPY'],
    
    // Trading Objective
    tradingGoal: 'weekly-income',
    
    // Risk Profile
    riskProfile: 'auto-detect',
    
    // Trading Style
    tradeRhythm: 'ai-choose',
    
    // AI Behavior
    aiExecutionStyle: 'fully-automated',
    
    // Trade Frequency
    maxTradeActivity: 'ai-decide',
    
    // Reporting & Alerts
    reportingMethod: 'both',
    feedbackStyle: 'ai-reasoning',
    
    // Snapshot Upload
    uploadedAssets: [] as File[]
  });

  const availablePairs = [
    'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD',
    'EURJPY', 'GBPJPY', 'EURGBP', 'AUDJPY', 'EURAUD', 'EURCHF', 'AUDCAD',
    'GBPAUD', 'GBPCAD', 'GBPCHF', 'CADCHF', 'CADJPY', 'AUDCHF', 'NZDJPY'
  ];

  const handleSettingChange = (key: string, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handlePairToggle = (pair: string) => {
    setSettings(prev => {
      const currentPairs = prev.selectedPairs;
      const isSelected = currentPairs.includes(pair);
      
      if (isSelected) {
        // Remove pair if already selected
        return {
          ...prev,
          selectedPairs: currentPairs.filter(p => p !== pair)
        };
      } else {
        // Add pair if not selected and under limit
        if (currentPairs.length < 3) {
          return {
            ...prev,
            selectedPairs: [...currentPairs, pair]
          };
        }
        return prev; // Don't add if already at limit
      }
    });
  };

  const handleFileUpload = (files: FileList | null) => {
    if (files) {
      const fileArray = Array.from(files).slice(0, 12); // Max 3 assets × 4 timeframes
      setSettings(prev => ({ ...prev, uploadedAssets: fileArray }));
    }
  };

  const isApiMode = settings.dataMode === 'api';
  const isSnapshotMode = settings.dataMode === 'snapshot';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-4xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700 flex-shrink-0">
          <div className="flex items-center space-x-3">
            <Settings className="h-6 w-6 text-blue-400" />
            <h2 className="text-xl font-semibold text-white">Trading Options & Preferences</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* Section 1: Data Mode Selector */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white flex items-center space-x-2">
              <Radio className="h-5 w-5 text-blue-400" />
              <span>Select Trading Mode</span>
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div 
                className={`p-6 rounded-xl border-2 cursor-pointer transition-all ${
                  isApiMode 
                    ? 'border-blue-500 bg-blue-500/10' 
                    : 'border-slate-600 bg-slate-900 hover:border-slate-500'
                }`}
                onClick={() => handleSettingChange('dataMode', 'api')}
              >
                <div className="flex items-center space-x-3 mb-3">
                  <div className={`w-4 h-4 rounded-full border-2 ${
                    isApiMode ? 'border-blue-500 bg-blue-500' : 'border-slate-400'
                  }`}>
                    {isApiMode && <div className="w-2 h-2 bg-white rounded-full m-0.5"></div>}
                  </div>
                  <h4 className="text-white font-semibold">API Mode</h4>
                  <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded">Recommended</span>
                </div>
                <ul className="text-sm text-slate-300 space-y-1">
                  <li>• Connects directly to MetaTrader 5 using official MT5 Python API</li>
                  <li>• Grants access to live price data and real-time trade management</li>
                  <li>• Enables full feature set and AI optimization</li>
                </ul>
              </div>

              <div 
                className={`p-6 rounded-xl border-2 cursor-pointer transition-all ${
                  isSnapshotMode 
                    ? 'border-blue-500 bg-blue-500/10' 
                    : 'border-slate-600 bg-slate-900 hover:border-slate-500'
                }`}
                onClick={() => handleSettingChange('dataMode', 'snapshot')}
              >
                <div className="flex items-center space-x-3 mb-3">
                  <div className={`w-4 h-4 rounded-full border-2 ${
                    isSnapshotMode ? 'border-blue-500 bg-blue-500' : 'border-slate-400'
                  }`}>
                    {isSnapshotMode && <div className="w-2 h-2 bg-white rounded-full m-0.5"></div>}
                  </div>
                  <h4 className="text-white font-semibold">Snapshot Mode</h4>
                  <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded">Manual Upload</span>
                </div>
                <ul className="text-sm text-slate-300 space-y-1">
                  <li>• User uploads screenshots of W1, D1, H1, M15 charts</li>
                  <li>• Pipnosis reads snapshots to calculate one-time trade plan</li>
                  <li>• Limits functionality to features without continuous market access</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Section 1.5: Trading Pairs Selection (API Mode Only) */}
          {isApiMode && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white flex items-center space-x-2">
                <TrendingUp className="h-5 w-5 text-blue-400" />
                <span>Trading Pairs Selection</span>
              </h3>
              
              <div className="space-y-4">
                <div className="flex items-center space-x-4">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="radio"
                      name="pairSelection"
                      value="ai-choose"
                      checked={settings.pairSelectionMode === 'ai-choose'}
                      onChange={(e) => handleSettingChange('pairSelectionMode', e.target.value)}
                      className="text-blue-500 focus:ring-blue-500"
                    />
                    <span className="text-white">Let AI choose the best pairs to execute your prompt</span>
                    <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-1 rounded">Recommended</span>
                  </label>
                </div>
                
                <div className="flex items-center space-x-4">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="radio"
                      name="pairSelection"
                      value="manual"
                      checked={settings.pairSelectionMode === 'manual'}
                      onChange={(e) => handleSettingChange('pairSelectionMode', e.target.value)}
                      className="text-blue-500 focus:ring-blue-500"
                    />
                    <span className="text-white">I want to choose my 3 trading pairs</span>
                  </label>
                </div>

                {settings.pairSelectionMode === 'manual' && (
                  <div className="mt-4 p-4 bg-slate-900 rounded-lg border border-slate-600">
                    <div className="mb-3">
                      <p className="text-sm text-slate-300 mb-2">
                        Select up to 3 trading pairs ({settings.selectedPairs.length}/3 selected)
                      </p>
                      {settings.selectedPairs.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-3">
                          {settings.selectedPairs.map(pair => (
                            <span 
                              key={pair}
                              className="bg-blue-500/20 text-blue-400 px-3 py-1 rounded-full text-sm flex items-center space-x-2"
                            >
                              <span>{pair}</span>
                              <button
                                onClick={() => handlePairToggle(pair)}
                                className="text-blue-300 hover:text-white"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                      {availablePairs.map(pair => {
                        const isSelected = settings.selectedPairs.includes(pair);
                        const canSelect = settings.selectedPairs.length < 3 || isSelected;
                        
                        return (
                          <button
                            key={pair}
                            onClick={() => handlePairToggle(pair)}
                            disabled={!canSelect}
                            className={`px-3 py-2 text-sm rounded-lg border transition-all ${
                              isSelected
                                ? 'border-blue-500 bg-blue-500/20 text-blue-400'
                                : canSelect
                                ? 'border-slate-600 bg-slate-800 text-slate-300 hover:border-slate-500 hover:bg-slate-700'
                                : 'border-slate-700 bg-slate-800/50 text-slate-500 cursor-not-allowed'
                            }`}
                          >
                            {pair}
                          </button>
                        );
                      })}
                    </div>
                    
                    {settings.selectedPairs.length === 3 && (
                      <div className="mt-3 p-2 bg-green-500/10 border border-green-500/30 rounded-lg">
                        <p className="text-sm text-green-400 flex items-center space-x-2">
                          <CheckCircle className="h-4 w-4" />
                          <span>3 pairs selected. You can change your selection by clicking on selected pairs above.</span>
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {settings.pairSelectionMode === 'ai-choose' && (
                  <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                    <p className="text-sm text-blue-300 flex items-center space-x-2">
                      <CheckCircle className="h-4 w-4" />
                      <span>AI will analyze market conditions and select the most profitable pairs based on your trading goal and risk profile.</span>
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Section 2: Trading Objective */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white">Trading Objective</h3>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Trading Goal</label>
              <select
                value={settings.tradingGoal}
                onChange={(e) => handleSettingChange('tradingGoal', e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="grow-account">Grow Account (long-term compounding)</option>
                <option value="weekly-income">Weekly Income (e.g., "Make $500/week")</option>
                <option value="quick-flip">Quick Flip (1 trade, high risk)</option>
              </select>
            </div>
          </div>

          {/* Section 3: Risk Profile Selector */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white">Risk Profile Selector</h3>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Choose Risk Setting</label>
              <select
                value={settings.riskProfile}
                onChange={(e) => handleSettingChange('riskProfile', e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="auto-detect">Auto-Detect (AI decides based on balance and goal)</option>
                <option value="low-risk">Low Risk (1–2% exposure)</option>
                <option value="medium-risk">Medium Risk (3–5%)</option>
                <option value="high-risk">High Risk (6–10%)</option>
              </select>
            </div>
          </div>

          {/* Section 4: Trading Style Preference */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white">Trading Style Preference</h3>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Preferred Trade Rhythm</label>
              <select
                value={settings.tradeRhythm}
                onChange={(e) => handleSettingChange('tradeRhythm', e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ai-choose">Let AI Choose</option>
                <option value="short-term">Short-Term (scalping/intraday)</option>
                <option value="medium-term">Medium-Term (swing 1–3 days)</option>
              </select>
              
              {isSnapshotMode && settings.tradeRhythm === 'short-term' && (
                <div className="mt-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-start space-x-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-yellow-300">
                    Scalping is not recommended in snapshot mode unless chart images are updated frequently.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Section 5: AI Behavior Mode */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white">AI Behavior Mode</h3>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">AI Execution Style</label>
              <select
                value={settings.aiExecutionStyle}
                onChange={(e) => handleSettingChange('aiExecutionStyle', e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="fully-automated">Fully Automated</option>
                <option value="explain-before-entry">Explain Before Entry</option>
                <option value="watch-learn">Watch & Learn Mode</option>
              </select>
              
              {isSnapshotMode && settings.aiExecutionStyle === 'watch-learn' && (
                <div className="mt-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-start space-x-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-yellow-300">
                    Watch & Learn Mode may be limited in snapshot mode.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Section 6: Trade Frequency Preference */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white">Trade Frequency Preference</h3>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Max Trade Activity</label>
              <select
                value={settings.maxTradeActivity}
                onChange={(e) => handleSettingChange('maxTradeActivity', e.target.value)}
                className={`w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  isSnapshotMode ? 'opacity-60' : ''
                }`}
                disabled={isSnapshotMode && settings.maxTradeActivity === 'moderate'}
              >
                <option value="minimal">Minimal (1–2/day)</option>
                <option value="moderate" disabled={isSnapshotMode}>
                  Moderate (up to 5/day) {isSnapshotMode ? '- Not available in snapshot mode' : ''}
                </option>
                <option value="ai-decide">
                  Let AI Decide {isSnapshotMode ? '(1 trade only)' : ''}
                </option>
              </select>
              
              {isSnapshotMode && (
                <div className="mt-2 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg flex items-start space-x-2">
                  <CheckCircle className="h-4 w-4 text-blue-400 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-blue-300">
                    Snapshot mode only supports single-entry strategies based on chart images. AI will choose best asset & entry from the 3.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Section 7: Reporting & Alerts */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white">Reporting & Alerts</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Receive Reports Via</label>
                <select
                  value={settings.reportingMethod}
                  onChange={(e) => handleSettingChange('reportingMethod', e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="telegram">Telegram</option>
                  <option value="email">Email</option>
                  <option value="both">Both</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Performance Feedback Style</label>
                <select
                  value={settings.feedbackStyle}
                  onChange={(e) => handleSettingChange('feedbackStyle', e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="summary-only">Summary Only</option>
                  <option value="ai-reasoning">AI Trade Reasoning</option>
                  <option value="visual-reports" disabled={isSnapshotMode}>
                    Visual Reports (charts) {isSnapshotMode ? '- Not available in snapshot mode' : ''}
                  </option>
                </select>
              </div>
            </div>
          </div>

          {/* Section 8: Snapshot Upload Panel */}
          {isSnapshotMode && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white flex items-center space-x-2">
                <Upload className="h-5 w-5 text-blue-400" />
                <span>Snapshot Upload Panel</span>
              </h3>
              
              <div className="p-6 border-2 border-dashed border-slate-600 rounded-lg">
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={(e) => handleFileUpload(e.target.files)}
                  className="hidden"
                  id="snapshot-upload-settings"
                />
                <label htmlFor="snapshot-upload-settings" className="cursor-pointer">
                  <div className="text-center space-y-3">
                    <div className="p-3 bg-slate-700 rounded-lg inline-block">
                      <Upload className="h-8 w-8 text-slate-400" />
                    </div>
                    <div>
                      <p className="text-white font-medium">Upload up to 3 assets</p>
                      <p className="text-sm text-slate-400">For each asset: Upload 4 timeframes (W1, D1, H1, M15)</p>
                    </div>
                    <div className="bg-blue-500 text-white px-4 py-2 rounded-lg inline-block hover:bg-blue-600 transition-colors">
                      Choose Chart Files
                    </div>
                  </div>
                </label>
                
                {settings.uploadedAssets.length > 0 && (
                  <div className="mt-4 p-3 bg-slate-900 rounded-lg">
                    <p className="text-sm text-slate-300 mb-2">Uploaded files: {settings.uploadedAssets.length}</p>
                    <div className="text-xs text-slate-400 space-y-1">
                      {settings.uploadedAssets.map((file, index) => (
                        <div key={index}>{file.name}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Optional Notes</label>
                <textarea
                  placeholder="Add any asset-specific comments or trading preferences..."
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none h-20"
                />
              </div>
            </div>
          )}

          {/* Developer Recommendation */}
          <div className="p-4 bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/30 rounded-lg">
            <div className="flex items-start space-x-3">
              <Zap className="h-5 w-5 text-blue-400 mt-0.5 flex-shrink-0" />
              <div>
                <h4 className="text-white font-semibold mb-2">Pipnosis Recommendation</h4>
                <p className="text-sm text-slate-300 mb-2">
                  Pipnosis is a prompt-based AI trading system designed for low-input, high-intelligence decision making.
                </p>
                <p className="text-sm text-blue-300">
                  👉 Start with Python-based control, using the official MetaTrader 5 Python API for optimal performance.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer - Fixed at bottom */}
        <div className="flex items-center justify-between p-6 border-t border-slate-700 flex-shrink-0 bg-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <div className="flex space-x-3">
            <button
              onClick={() => {
                console.log('Settings saved:', settings);
                onClose();
              }}
              className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
            >
              Save Preferences
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
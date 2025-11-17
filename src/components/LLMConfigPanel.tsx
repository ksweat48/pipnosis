import React from 'react';
import { Brain, Zap, DollarSign, Sliders } from 'lucide-react';

interface LLMConfigPanelProps {
  temperature: number;
  setTemperature: (temp: number) => void;
  maxTokens: number;
  setMaxTokens: (tokens: number) => void;
  promptTemplate: string;
  setPromptTemplate: (template: string) => void;
  model: string;
  setModel: (model: string) => void;
  fallbackEnabled: boolean;
  setFallbackEnabled: (enabled: boolean) => void;
}

export default function LLMConfigPanel({
  temperature,
  setTemperature,
  maxTokens,
  setMaxTokens,
  promptTemplate,
  setPromptTemplate,
  model,
  setModel,
  fallbackEnabled,
  setFallbackEnabled
}: LLMConfigPanelProps) {
  const estimatedCost = (callCount: number) => {
    const costPerCall = model === 'gpt-4o' ? 0.01 : 0.015;
    return (callCount * costPerCall).toFixed(2);
  };

  return (
    <div className="bg-gradient-to-r from-blue-900/30 to-purple-900/30 backdrop-blur-sm border-2 border-blue-500/30 rounded-lg shadow-md p-6">
      <h3 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
        <Brain className="w-6 h-6 text-blue-400" />
        LLM Configuration (GPT-4 Decision Engine)
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Model Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            GPT-4 Model
          </label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="gpt-4o">GPT-4o (Faster, $0.01/call)</option>
            <option value="gpt-4-turbo">GPT-4 Turbo (More capable, $0.015/call)</option>
          </select>
          <p className="mt-1 text-xs text-gray-400">
            Estimated cost for 100 calls: ${estimatedCost(100)}
          </p>
        </div>

        {/* Temperature Slider */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Sliders className="w-4 h-4" />
              Temperature: {temperature.toFixed(2)}
            </span>
            <span className="text-xs text-gray-400">
              {temperature < 0.2 ? 'Very Conservative' :
               temperature < 0.4 ? 'Conservative' :
               temperature < 0.6 ? 'Balanced' :
               temperature < 0.8 ? 'Creative' : 'Very Creative'}
            </span>
          </label>
          <input
            type="range"
            min="0.1"
            max="1.0"
            step="0.05"
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
            className="w-full accent-blue-500"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>Conservative (0.1)</span>
            <span>Balanced (0.5)</span>
            <span>Creative (1.0)</span>
          </div>
        </div>

        {/* Max Tokens */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Max Tokens per Response
          </label>
          <input
            type="number"
            min="500"
            max="2000"
            step="100"
            value={maxTokens}
            onChange={(e) => setMaxTokens(parseInt(e.target.value))}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <p className="mt-1 text-xs text-gray-400">
            Higher = more detailed reasoning, but slower & costlier
          </p>
        </div>

        {/* Prompt Template */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            System Prompt Template
          </label>
          <select
            value={promptTemplate}
            onChange={(e) => setPromptTemplate(e.target.value)}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="balanced">Balanced (Recommended)</option>
            <option value="aggressive">Aggressive (More trades)</option>
            <option value="conservative">Conservative (High quality only)</option>
            <option value="scalping">Scalping Focus (Ultra short-term)</option>
          </select>
          <p className="mt-1 text-xs text-gray-400">
            Defines GPT-4's trading personality and risk tolerance
          </p>
        </div>
      </div>

      {/* Fallback Settings */}
      <div className="mt-6 p-4 bg-gray-700/50 rounded-lg border border-gray-600">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={fallbackEnabled}
            onChange={(e) => setFallbackEnabled(e.target.checked)}
            className="w-5 h-5 text-blue-600"
          />
          <div className="flex-1">
            <span className="text-sm font-semibold text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-400" />
              Enable Rule-Based Fallback on API Failure
            </span>
            <p className="text-xs text-gray-400 mt-1">
              If GPT-4 API fails, use fast rule-based decisions to prevent missed opportunities
            </p>
          </div>
        </label>
      </div>

      {/* Cost Estimation */}
      <div className="mt-6 p-4 bg-green-900/20 border border-green-500/30 rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <DollarSign className="w-5 h-5 text-green-400" />
          <h4 className="text-sm font-semibold text-white">Cost Estimation</h4>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-gray-400 text-xs">Per Backtest (50 calls)</p>
            <p className="text-lg font-bold text-green-400">${estimatedCost(50)}</p>
          </div>
          <div>
            <p className="text-gray-400 text-xs">Per Backtest (100 calls)</p>
            <p className="text-lg font-bold text-green-400">${estimatedCost(100)}</p>
          </div>
          <div>
            <p className="text-gray-400 text-xs">Daily (500 calls)</p>
            <p className="text-lg font-bold text-yellow-400">${estimatedCost(500)}</p>
          </div>
          <div>
            <p className="text-gray-400 text-xs">Monthly (15k calls)</p>
            <p className="text-lg font-bold text-orange-400">${estimatedCost(15000)}</p>
          </div>
        </div>
      </div>

      {/* Info Box */}
      <div className="mt-4 p-3 bg-blue-900/20 border-l-4 border-blue-400 rounded">
        <p className="text-sm text-blue-200">
          <strong>How it works:</strong> Each market scan sends market data to GPT-4, which analyzes the setup
          and returns a trade decision with reasoning. Temperature controls creativity vs consistency.
          Lower = more predictable, Higher = more adaptive to changing conditions.
        </p>
      </div>
    </div>
  );
}

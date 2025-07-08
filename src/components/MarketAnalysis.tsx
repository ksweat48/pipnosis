import React, { useState } from 'react';
import { TrendingUp, TrendingDown, BarChart3, Camera, Upload, RefreshCw, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';

interface MarketDataPoint {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  trend: string;
  signal: string;
}

interface MarketAnalysisProps {
  analysisMode: 'api' | 'screenshot';
  marketData: MarketDataPoint[];
  onModeChange: (mode: 'api' | 'screenshot') => void;
  onScreenshotUpload: (files: FileList) => void;
  isLoading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refetch: () => void;
}

export const MarketAnalysis: React.FC<MarketAnalysisProps> = ({
  analysisMode = 'api',
  marketData = [],
  onModeChange = () => {},
  onScreenshotUpload = () => {},
  isLoading = false,
  error = null,
  lastUpdated = null,
  refetch = () => {}
}) => {
  const [showAll, setShowAll] = useState(false);

  const getSignalColor = (signal: string) => {
    switch (signal) {
      case 'buy': return 'text-green-400 bg-green-500/20 border-green-500/30';
      case 'sell': return 'text-red-400 bg-red-500/20 border-red-500/30';
      case 'hold': return 'text-yellow-400 bg-yellow-500/20 border-yellow-500/30';
      default: return 'text-slate-400 bg-slate-500/20 border-slate-500/30';
    }
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'up': return <TrendingUp className="h-4 w-4 text-green-400" />;
      case 'down': return <TrendingDown className="h-4 w-4 text-red-400" />;
      default: return <BarChart3 className="h-4 w-4 text-slate-400" />;
    }
  };

  // Ensure marketData is always an array before processing
  const safeMarketData = marketData && Array.isArray(marketData) ? marketData : [];
  
  // Tier 1 pairs (first 7) - always shown in "show less" mode
  const tier1Pairs = safeMarketData.slice(0, 7);
  // Tier 2 pairs (remaining) - only shown in "show more" mode
  const tier2Pairs = safeMarketData.slice(7);
  
  // Show only Tier 1 pairs by default, or all pairs if showAll is true
  const displayedData = showAll ? safeMarketData : tier1Pairs;
  const hasTier2Pairs = tier2Pairs.length > 0;

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700">
      <div className="p-4 sm:p-6 border-b border-slate-700">
        <div className="flex flex-col space-y-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <h3 className="text-lg font-semibold text-white flex items-center space-x-2">
            <BarChart3 className="h-5 w-5 text-blue-400" /> 
            <span>Market Analysis</span>
            <button
              onClick={() => refetch()}
              className="p-1 text-slate-400 hover:text-white transition-colors"
            >
              {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </button>
            {isLoading && <RefreshCw className="h-4 w-4 text-blue-400 animate-spin" />}
          </h3>
          
          <div className="flex bg-slate-700 rounded-lg p-1">
            <button
              onClick={() => onModeChange('api')}
              className={`px-3 py-2 text-sm rounded transition-colors flex-1 sm:flex-none ${
                analysisMode === 'api' 
                  ? 'bg-blue-500 text-white' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Live Data
            </button>
            <button
              onClick={() => onModeChange('screenshot')}
              className={`px-3 py-2 text-sm rounded transition-colors flex-1 sm:flex-none ${
                analysisMode === 'screenshot' 
                  ? 'bg-blue-500 text-white' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Screenshots
            </button>
          </div>
        </div>

      </div>

      <div className="p-4 sm:p-6">
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start space-x-2">
            <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-red-400 text-sm font-medium">Market Data Error</p>
              <p className="text-red-300 text-xs mt-1">{error}</p>
            </div>
          </div>
        )}

        {analysisMode === 'screenshot' ? (
          <div className="p-4 sm:p-6 border-2 border-dashed border-slate-600 rounded-lg text-center">
            <input
              type="file"
              multiple
              accept="image/*"
              onChange={(e) => e.target.files && onScreenshotUpload(e.target.files)}
              className="hidden"
              id="screenshot-upload"
            />
            <label htmlFor="screenshot-upload" className="cursor-pointer">
              <div className="flex flex-col items-center space-y-3">
                <div className="p-3 bg-slate-700 rounded-lg">
                  <Camera className="h-6 w-6 sm:h-8 sm:w-8 text-slate-400" />
                </div>
                <div>
                  <p className="text-white font-medium text-sm sm:text-base">Upload Chart Screenshots</p>
                  <p className="text-xs sm:text-sm text-slate-400 mt-1">Drop W1, D1, H1, M15 timeframes for up to 3 assets</p>
                </div>
                <div className="flex items-center space-x-2 bg-blue-500 text-white px-3 py-2 sm:px-4 rounded-lg hover:bg-blue-600 transition-colors text-sm">
                  <Upload className="h-4 w-4" />
                  <span>Choose Files</span>
                </div>
              </div>
            </label>
          </div>
        ) : (
          <div className="space-y-4">
            {isLoading ? (
              <div className="text-center py-8">
                <RefreshCw className="h-8 w-8 text-blue-400 animate-spin mx-auto mb-3" />
                <p className="text-slate-400">Loading live market data...</p>
              </div>
            ) : marketData.length === 0 ? (
              <div className="text-center py-8">
                <BarChart3 className="h-8 w-8 text-slate-400 mx-auto mb-3" />
                <p className="text-slate-400">No market data available</p>
                <p className="text-slate-500 text-sm mt-1">
                  {error ? 'Connection error - check backend status' : 'Waiting for data...'}
                </p>
              </div>
            ) : (
              <>
                {/* Tier 1 Pairs Section */}
                {tier1Pairs.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-medium text-emerald-400 flex items-center space-x-2">
                        <span>🔷 Tier 1 - Major Pairs</span>
                        <span className="text-xs text-slate-400">({tier1Pairs.length} pairs)</span>
                      </h4>
                    </div>
                    
                    {tier1Pairs.map((data) => (
                      <div key={data.symbol} className="bg-slate-900 rounded-lg p-3 sm:p-4 border border-slate-600">
                        <div className="flex flex-col space-y-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
                          <div className="flex items-center space-x-3 sm:space-x-4">
                            <div className="flex items-center space-x-2">
                              <h4 className="font-semibold text-white text-base sm:text-lg min-w-[60px] sm:min-w-[80px]">{data.symbol}</h4>
                              {getTrendIcon(data.trend)}
                            </div>
                            
                            <div className="flex items-center space-x-3 sm:space-x-6">
                              <div>
                                <p className="text-lg sm:text-xl font-bold text-white">
                                  {data.price.toFixed(data.symbol.includes('JPY') ? 2 : 5)}
                                </p>
                              </div>
                              
                              <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-3 space-y-1 sm:space-y-0">
                                <span className={`text-xs sm:text-sm font-medium ${data.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  {data.change >= 0 ? '+' : ''}{data.change.toFixed(data.symbol.includes('JPY') ? 2 : 5)}
                                </span>
                                <span className={`text-xs sm:text-sm ${data.changePercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  ({data.changePercent >= 0 ? '+' : ''}{data.changePercent.toFixed(2)}%)
                                </span>
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex justify-end">
                            <span className={`px-2 py-1 sm:px-3 rounded text-xs font-medium border ${getSignalColor(data.signal)}`}>
                              {data.signal.toUpperCase()}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Tier 2 Pairs Section - Only show when expanded */}
                {showAll && tier2Pairs.length > 0 && (
                  <div className="space-y-3 mt-6">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-medium text-yellow-400 flex items-center space-x-2">
                        <span>🔶 Tier 2 - Volatile & High RRR</span>
                        <span className="text-xs text-slate-400">({tier2Pairs.length} pairs)</span>
                      </h4>
                    </div>
                    
                    {tier2Pairs.map((data) => (
                      <div key={data.symbol} className="bg-slate-900 rounded-lg p-3 sm:p-4 border border-slate-600">
                        <div className="flex flex-col space-y-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
                          <div className="flex items-center space-x-3 sm:space-x-4">
                            <div className="flex items-center space-x-2">
                              <h4 className="font-semibold text-white text-base sm:text-lg min-w-[60px] sm:min-w-[80px]">{data.symbol}</h4>
                              {getTrendIcon(data.trend)}
                            </div>
                            
                            <div className="flex items-center space-x-3 sm:space-x-6">
                              <div>
                                <p className="text-lg sm:text-xl font-bold text-white">
                                  {data.price.toFixed(data.symbol.includes('JPY') ? 2 : 5)}
                                </p>
                              </div>
                              
                              <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-3 space-y-1 sm:space-y-0">
                                <span className={`text-xs sm:text-sm font-medium ${data.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  {data.change >= 0 ? '+' : ''}{data.change.toFixed(data.symbol.includes('JPY') ? 2 : 5)}
                                </span>
                                <span className={`text-xs sm:text-sm ${data.changePercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  ({data.changePercent >= 0 ? '+' : ''}{data.changePercent.toFixed(2)}%)
                                </span>
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex justify-end">
                            <span className={`px-2 py-1 sm:px-3 rounded text-xs font-medium border ${getSignalColor(data.signal)}`}>
                              {data.signal.toUpperCase()}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Show More/Less Button */}
                {hasTier2Pairs && (
                  <div className="flex justify-center pt-4 mt-4">
                    <button
                      onClick={() => setShowAll(!showAll)} 
                      className="flex items-center space-x-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white rounded-lg transition-colors text-sm"
                    >
                      <span>
                        {showAll 
                          ? `Show Less (Tier 1 only - ${tier1Pairs.length} pairs)` 
                          : `Show More (Tier 1 + Tier 2 - ${safeMarketData.length} total pairs)`
                        }
                      </span>
                      {showAll ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Data Source Indicator */}
        <div className="mt-6 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${isLoading ? 'bg-yellow-400 animate-pulse' : error ? 'bg-red-400' : 'bg-green-400'}`}></div>
            <span>
              {analysisMode === 'api' 
                ? isLoading ? 'Fetching live data...' 
                : error ? 'Using fallback data' 
                : 'Demo market data'
                : 'Screenshot mode'}
            </span>
          </div>
          {analysisMode === 'api' && !isLoading && !error && safeMarketData.length > 0 && lastUpdated && (
            <span>Updated: {lastUpdated.toLocaleTimeString()}</span>
          )}
        </div>
      </div>
    </div>
  );
};
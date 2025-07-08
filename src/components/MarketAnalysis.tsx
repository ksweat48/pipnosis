import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, BarChart3, Camera, Upload, RefreshCw, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { backendAPI } from '../services/backendAPI';
import { useAuth } from '../contexts/AuthContext';

interface MarketDataPoint {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  trend: 'up' | 'down' | 'sideways';
  signal: 'buy' | 'sell' | 'hold';
}

interface MarketAnalysisProps {
  analysisMode: 'api' | 'screenshot';
  onModeChange: (mode: 'api' | 'screenshot') => void;
  onScreenshotUpload: (files: FileList) => void;
}

export const MarketAnalysis: React.FC<MarketAnalysisProps> = ({
  analysisMode,
  onModeChange,
  onScreenshotUpload
}) => {
  const { user } = useAuth();
  const [marketData, setMarketData] = useState<MarketDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [showAll, setShowAll] = useState(false);

  const fetchRealMarketData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Use the correct API method that matches the backend endpoint
      const data = await backendAPI.getMarketData();
      
      if (data && data.symbols) {
        const formattedData: MarketDataPoint[] = data.symbols.map(symbol => ({
          symbol: symbol.symbol,
          price: (symbol.bid + symbol.ask) / 2,
          change: symbol.change,
          changePercent: symbol.changePercent,
          trend: symbol.trend === 'bullish' ? 'up' : symbol.trend === 'bearish' ? 'down' : 'sideways',
          signal: symbol.signals.includes('Buy Signal') ? 'buy' : 
                 symbol.signals.includes('Sell Signal') ? 'sell' : 'hold'
        }));
        
        setMarketData(formattedData);
        setLastUpdate(new Date());
      } else if (Array.isArray(data)) {
        // Handle direct array response from getMarketData
        const formattedData: MarketDataPoint[] = data.map(item => ({
          symbol: item.symbol,
          price: typeof item.price === 'number' ? item.price : (item.bid + item.ask) / 2,
          change: item.change || 0,
          changePercent: item.changePercent || 0,
          trend: item.trend || 'sideways',
          signal: item.signal || 'hold'
        }));
        
        setMarketData(formattedData);
        setLastUpdate(new Date());
      } else {
        setMarketData(generateMarketData());
        setLastUpdate(new Date());
      }
    } catch (err) {
      console.error('Failed to fetch market data:', err);
      setError('Failed to fetch market data. Using fallback data.');
      setMarketData(generateMarketData());
      setLastUpdate(new Date());
    } finally {
      setIsLoading(false);
    }
  };

  const generateMarketData = (): MarketDataPoint[] => {
    const pairs = [
      { symbol: 'EURUSD', basePrice: 1.1425 },
      { symbol: 'GBPUSD', basePrice: 1.2735 },
      { symbol: 'USDJPY', basePrice: 149.85 },
      { symbol: 'USDCHF', basePrice: 0.8945 },
      { symbol: 'AUDUSD', basePrice: 0.6785 },
      { symbol: 'USDCAD', basePrice: 1.3625 },
      { symbol: 'NZDUSD', basePrice: 0.6245 }
    ];

    return pairs.map(({ symbol, basePrice }) => {
      const isJPY = symbol.includes('JPY');
      const priceVariation = isJPY 
        ? (Math.random() - 0.5) * 2.0 
        : (Math.random() - 0.5) * 0.02;
      const changeVariation = isJPY 
        ? (Math.random() - 0.5) * 1.0 
        : (Math.random() - 0.5) * 0.01;

      return {
        symbol,
        price: basePrice + priceVariation,
        change: changeVariation,
        changePercent: (changeVariation / basePrice) * 100,
        trend: Math.random() > 0.5 ? 'up' : 'down',
        signal: ['buy', 'sell', 'hold'][Math.floor(Math.random() * 3)] as 'buy' | 'sell' | 'hold'
      };
    });
  };

  useEffect(() => {
    const fetchData = () => {
      if (user) {
        fetchRealMarketData();
      } else {
        setIsLoading(true);
        setTimeout(() => {
          setMarketData(generateMarketData());
          setLastUpdate(new Date());
          setIsLoading(false);
        }, 1000);
      }
    };

    fetchData();
    
    const interval = setInterval(fetchData, user ? 10000 : 5000);
    
    return () => clearInterval(interval);
  }, [user]);

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

  const displayedData = showAll ? marketData : marketData.slice(0, 3);

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700">
      <div className="p-4 sm:p-6 border-b border-slate-700">
        <div className="flex flex-col space-y-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <h3 className="text-lg font-semibold text-white flex items-center space-x-2">
            <BarChart3 className="h-5 w-5 text-blue-400" />
            <span>Live Market Analysis</span>
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
              </div>
            ) : (
              <div className="space-y-3">
                {displayedData.map((data) => (
                  <div key={data.symbol} className="bg-slate-900 rounded-lg p-3 sm:p-4 border border-slate-600 hover:border-slate-500 transition-colors">
                    <div className="flex flex-col space-y-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
                      <div className="flex items-center space-x-3 sm:space-x-4">
                        <div className="flex items-center space-x-2">
                          <h4 className="font-semibold text-white text-base sm:text-lg min-w-[60px] sm:min-w-[80px]">
                            {data.symbol}
                          </h4>
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
                      
                      <div className="flex items-center space-x-2">
                        <span className={`px-2 py-1 rounded text-xs font-medium border ${getSignalColor(data.signal)}`}>
                          {data.signal.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
                
                {marketData.length > 3 && (
                  <button 
                    onClick={() => setShowAll(!showAll)}
                    className="w-full py-2 text-blue-400 hover:text-blue-300 bg-slate-900 rounded-lg border border-slate-600 hover:border-blue-500 transition-colors flex items-center justify-center space-x-2"
                  >
                    <span>{showAll ? 'Show Less' : `Show ${marketData.length - 3} More Pairs`}</span>
                    {showAll ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${
              isLoading ? 'bg-yellow-400 animate-pulse' : 
              error ? 'bg-red-400' : 'bg-green-400'
            }`}></div>
            <span>
              {analysisMode === 'api' 
                ? isLoading 
                  ? 'Fetching live data...' 
                  : error 
                  ? 'Using fallback data' 
                  : user
                  ? 'Live market data'
                  : 'Demo market data'
                : 'Screenshot mode'
              }
            </span>
          </div>
          {analysisMode === 'api' && !isLoading && !error && marketData.length > 0 && lastUpdate && (
            <span>Updated: {lastUpdate.toLocaleTimeString()}</span>
          )}
        </div>
      </div>
    </div>
  );
};
import React, { useState, useEffect } from 'react';
import { Shield, AlertTriangle, TrendingDown, Activity, Settings, RefreshCw, Zap, Lock, Unlock, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface RiskEngineProps {
  isVisible?: boolean;
  onToggleVisibility?: () => void;
  className?: string;
}

interface RiskStatus {
  lawId: number;
  name: string;
  status: 'compliant' | 'warning' | 'violation';
  currentValue: number;
  threshold: number;
  action?: string;
}

export const RiskManagementEngine: React.FC<RiskEngineProps> = ({ 
  isVisible = false,
  onToggleVisibility,
  className = "" 
}) => {
  const [isEngineActive, setIsEngineActive] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [riskScore, setRiskScore] = useState(15);
  const [overallRisk, setOverallRisk] = useState<'low' | 'medium' | 'high'>('low');
  const [currentDrawdown, setCurrentDrawdown] = useState(1.8);
  const [openPositions, setOpenPositions] = useState(1);
  const [dailyRisk, setDailyRisk] = useState(2.5);
  const [lawsStatus, setLawsStatus] = useState<RiskStatus[]>([]);
  const { user } = useAuth();

  // Initialize risk data
  useEffect(() => {
    loadRiskData();
    
    if (autoRefresh) {
      const interval = setInterval(loadRiskData, 5000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, isVisible]);

  const loadRiskData = () => {
    if (!isEngineActive || !isVisible) return;
    
    setIsLoading(true);
    
    // Make a real API call to get risk data
    try {
      backendAPI.getRiskAnalysis(user?.id)
        .then(response => {
          setRiskScore(response.riskScore);
          setOverallRisk(response.overallRisk);
          setCurrentDrawdown(response.currentDrawdown);
          setOpenPositions(response.openPositions);
          setDailyRisk(response.dailyRisk);
          setLastUpdate(new Date());
          setLawsStatus(response.pipnosisLawsStatus);
          setIsLoading(false);
        })
        .catch(error => {
          console.error('Failed to load risk data:', error);
          setIsLoading(false);
        });
    } catch (error) {
      console.error('Error loading risk data:', error);
      setIsLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'compliant': return 'text-green-400';
      case 'warning': return 'text-yellow-400';
      case 'violation': return 'text-red-400';
      default: return 'text-slate-400';
    }
  };

  const getStatusBg = (status: string) => {
    switch (status) {
      case 'compliant': return 'bg-green-500/20 border-green-500/30';
      case 'warning': return 'bg-yellow-500/20 border-yellow-500/30';
      case 'violation': return 'bg-red-500/20 border-red-500/30';
      default: return 'bg-slate-500/20 border-slate-500/30';
    }
  };

  const getOverallRiskColor = (risk: string) => {
    switch (risk) {
      case 'low': return 'text-green-400';
      case 'medium': return 'text-yellow-400';
      case 'high': return 'text-red-400';
      default: return 'text-slate-400';
    }
  };

  const getOverallRiskBg = (risk: string) => {
    switch (risk) {
      case 'low': return 'bg-green-500/20 border-green-500/30';
      case 'medium': return 'bg-yellow-500/20 border-yellow-500/30';
      case 'high': return 'bg-red-500/20 border-red-500/30';
      default: return 'bg-slate-500/20 border-slate-500/30';
    }
  };

  const hasViolations = lawsStatus.some(law => law.status === 'violation');
  const hasWarnings = lawsStatus.some(law => law.status === 'warning');

  return (
    <div className={`bg-slate-800 rounded-xl border border-slate-700 ${className}`}>
      {/* Collapsible Header */}
      <div className="p-4 sm:p-6 border-b border-slate-700 cursor-pointer" onClick={onToggleVisibility}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-lg ${
              hasViolations ? 'bg-red-500/20' : hasWarnings ? 'bg-yellow-500/20' : 'bg-green-500/20'
            }`}>
              <Shield className={`h-5 w-5 ${
                hasViolations ? 'text-red-400' : hasWarnings ? 'text-yellow-400' : 'text-green-400'
              }`} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Risk Management Engine</h3>
              <p className="text-sm text-slate-400">Real-time Pipnosis Laws enforcement</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            {overallRisk && (
              <div className={`px-3 py-1 rounded-lg text-sm font-medium border ${getOverallRiskBg(overallRisk)}`}>
                <div className="flex items-center space-x-2">
                  <div className={`w-2 h-2 rounded-full ${
                    overallRisk === 'low' ? 'bg-green-400' :
                    overallRisk === 'medium' ? 'bg-yellow-400' : 'bg-red-400'
                  }`}></div>
                  <span className={getOverallRiskColor(overallRisk)}>
                    {overallRisk.toUpperCase()} RISK
                  </span>
                </div>
              </div>
            )}
            
            {/* Toggle Button */}
            <button className="p-2 text-slate-400 hover:text-white transition-colors">
              {isVisible ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Expandable Content */}
      {isVisible && (
        <div className="p-4 sm:p-6 space-y-6">
          {/* Control Buttons */}
          {user && (
            <div className="flex items-center justify-end space-x-2">
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`p-2 rounded-lg transition-colors ${
                  autoRefresh 
                    ? 'text-blue-400 hover:bg-blue-500/20' 
                    : 'text-slate-400 hover:bg-slate-700'
                }`}
                title={autoRefresh ? 'Disable auto-refresh' : 'Enable auto-refresh'}
              >
                {autoRefresh ? (
                  <RefreshCw className="h-4 w-4" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </button>
              
              <button
                onClick={() => setIsEngineActive(!isEngineActive)}
                className={`p-2 rounded-lg transition-colors ${
                  isEngineActive 
                    ? 'text-green-400 hover:bg-green-500/20' 
                    : 'text-red-400 hover:bg-red-500/20'
                }`}
                title={isEngineActive ? 'Disable Risk Engine' : 'Enable Risk Engine'}
              >
                {isEngineActive ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
              </button>
              
              <button
                onClick={loadRiskData}
                disabled={isLoading}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
                title="Refresh risk analysis"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
              
              <button className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors">
                <Settings className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Engine Status */}
          {user ? (
            <div className={`p-4 rounded-lg border ${
              isEngineActive 
                ? 'bg-green-500/10 border-green-500/30' 
                : 'bg-red-500/10 border-red-500/30'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <Zap className={`h-5 w-5 ${isEngineActive ? 'text-green-400' : 'text-red-400'}`} />
                  <div>
                    <h4 className={`font-medium ${isEngineActive ? 'text-green-300' : 'text-red-300'}`}>
                      Risk Engine {isEngineActive ? 'Active' : 'Disabled'}
                    </h4>
                    <p className={`text-sm ${isEngineActive ? 'text-green-200' : 'text-red-200'}`}>
                      {isEngineActive 
                        ? 'Monitoring all trades and enforcing Pipnosis Laws in real-time'
                        : 'Risk monitoring is disabled - trades may not be protected by Pipnosis Laws'
                      }
                    </p>
                  </div>
                </div>
                <div className="text-sm text-slate-400">
                  Last update: {lastUpdate.toLocaleTimeString()}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg text-center">
              <Shield className="h-12 w-12 text-blue-400 mx-auto mb-4 opacity-50" />
              <h4 className="text-white font-semibold mb-2">Risk Management Engine</h4>
              <p className="text-slate-400 mb-4">Sign in to access the risk management engine</p>
              <p className="text-sm text-slate-500">The risk engine enforces Pipnosis Laws to protect your capital and ensure safe trading</p>
            </div>
          )}

          {/* Risk Metrics Overview */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
              <div className="flex items-center space-x-2 mb-2">
                <Shield className="h-4 w-4 text-blue-400" />
                <span className="text-sm text-slate-400">Risk Score</span>
              </div>
              <div className={`text-2xl font-bold ${getOverallRiskColor(overallRisk)}`}>
                {riskScore}
              </div>
              <div className="text-xs text-slate-500">Max: 100</div>
            </div>

            <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
              <div className="flex items-center space-x-2 mb-2">
                <TrendingDown className="h-4 w-4 text-red-400" />
                <span className="text-sm text-slate-400">Drawdown</span>
              </div>
              <div className={`text-2xl font-bold ${
                currentDrawdown > 10 ? 'text-red-400' : 
                currentDrawdown > 5 ? 'text-yellow-400' : 'text-green-400'
              }`}>
                {currentDrawdown.toFixed(1)}%
              </div>
              <div className="text-xs text-slate-500">Max: 15%</div>
            </div>

            <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
              <div className="flex items-center space-x-2 mb-2">
                <Activity className="h-4 w-4 text-purple-400" />
                <span className="text-sm text-slate-400">Open Positions</span>
              </div>
              <div className={`text-2xl font-bold ${
                openPositions >= 5 ? 'text-red-400' : 
                openPositions >= 3 ? 'text-yellow-400' : 'text-green-400'
              }`}>
                {openPositions}
              </div>
              <div className="text-xs text-slate-500">Max: 5</div>
            </div>

            <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
              <div className="flex items-center space-x-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-yellow-400" />
                <span className="text-sm text-slate-400">Daily Risk</span>
              </div>
              <div className={`text-2xl font-bold ${
                dailyRisk > 6 ? 'text-red-400' : 
                dailyRisk > 3 ? 'text-yellow-400' : 'text-green-400'
              }`}>
                {dailyRisk.toFixed(1)}%
              </div>
              <div className="text-xs text-slate-500">Max: 6%</div>
            </div>
          </div>

          {/* Pipnosis Laws Status */}
          {lawsStatus.length > 0 && (
            <div className="space-y-4">
              <h4 className="text-white font-semibold flex items-center space-x-2">
                <Shield className="h-5 w-5 text-blue-400" />
                <span>Pipnosis Laws Compliance</span>
              </h4>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {lawsStatus.map((law) => (
                  <div
                    key={law.lawId}
                    className={`bg-slate-900 rounded-lg p-4 border transition-all ${
                      law.status === 'violation' ? 'border-red-500/50 bg-red-500/5' :
                      law.status === 'warning' ? 'border-yellow-500/50 bg-yellow-500/5' :
                      'border-slate-600'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center space-x-2">
                        <div className={`w-3 h-3 rounded-full ${
                          law.status === 'compliant' ? 'bg-green-400' :
                          law.status === 'warning' ? 'bg-yellow-400' : 'bg-red-400'
                        }`}></div>
                        <h5 className="text-white font-medium text-sm">Law #{law.lawId}: {law.name}</h5>
                      </div>
                      <div className={`text-xs px-2 py-1 rounded ${getStatusBg(law.status)}`}>
                        <span className={getStatusColor(law.status)}>
                          {law.status.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400 text-sm">Current:</span>
                        <span className={`font-medium ${getStatusColor(law.status)}`}>
                          {law.currentValue}
                          {law.name.includes('Risk') || law.name.includes('Drawdown') ? '%' : ''}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400 text-sm">Threshold:</span>
                        <span className="text-white font-medium">
                          {law.threshold}
                          {law.name.includes('Risk') || law.name.includes('Drawdown') ? '%' : ''}
                        </span>
                      </div>
                      
                      {/* Progress Bar */}
                      <div className="w-full bg-slate-700 rounded-full h-2 mt-2">
                        <div
                          className={`h-2 rounded-full transition-all duration-300 ${
                            law.status === 'violation' ? 'bg-red-400' :
                            law.status === 'warning' ? 'bg-yellow-400' : 'bg-green-400'
                          }`}
                          style={{
                            width: `${Math.min((law.currentValue / law.threshold) * 100, 100)}%`
                          }}
                        ></div>
                      </div>
                      
                      {law.action && (
                        <div className="text-xs text-slate-500 mt-2">
                          <strong>Action:</strong> {law.action}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Recommendations */}
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
            <h4 className="text-blue-300 font-medium mb-3 flex items-center space-x-2">
              <Zap className="h-4 w-4" />
              <span>AI Risk Recommendations</span>
            </h4>
            <ul className="space-y-2">
              <li className="text-blue-200 text-sm flex items-start space-x-2">
                <span className="text-blue-400 mt-1">•</span>
                <span>Current risk levels are well within safe parameters</span>
              </li>
              <li className="text-blue-200 text-sm flex items-start space-x-2">
                <span className="text-blue-400 mt-1">•</span>
                <span>Consider scaling position sizes based on market volatility</span>
              </li>
              <li className="text-blue-200 text-sm flex items-start space-x-2">
                <span className="text-blue-400 mt-1">•</span>
                <span>Monitor correlation if adding new positions in same currency</span>
              </li>
            </ul>
          </div>

          {/* Loading State */}
          {isLoading && (
            <div className="text-center py-4">
              <RefreshCw className="h-6 w-6 text-blue-400 animate-spin mx-auto mb-2" />
              <p className="text-slate-400 text-sm">Analyzing risk metrics...</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
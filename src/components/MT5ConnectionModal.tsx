import React, { useState, useEffect } from 'react';
import { X, Download, CheckCircle, AlertCircle, Loader, Shield, Server, Key, User, ExternalLink, Play, Monitor, Wifi, WifiOff, Zap, Copy, FileText, RefreshCw } from 'lucide-react';
import { useMT5Integration } from '../hooks/useMT5Integration';

interface MT5ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MT5ConnectionModal: React.FC<MT5ConnectionModalProps> = ({ isOpen, onClose }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState({
    login: '',
    password: '',
    server: '',
    accountType: 'demo'
  });

  const { 
    connectionState, 
    connect, 
    disconnect, 
    checkBridgeAvailability,
    isConnected,
    isConnecting,
    error: connectionError 
  } = useMT5Integration();

  const [bridgeAvailable, setBridgeAvailable] = useState(false);
  const [checkingBridge, setCheckingBridge] = useState(false);
  const [installationMethod, setInstallationMethod] = useState<'manual' | 'download'>('manual');
  const [bridgeCheckAttempts, setBridgeCheckAttempts] = useState(0);
  const [automatedTradingEnabled, setAutomatedTradingEnabled] = useState<boolean | null>(null);
  const [checkingSettings, setCheckingSettings] = useState(false);
  const [webRequestEnabled, setWebRequestEnabled] = useState<boolean | null>(null);

  const brokerServers = [
    'MetaQuotes-Demo',
    'ICMarkets-Demo',
    'ICMarkets-Live01',
    'FTMO-Demo',
    'FTMO-Server',
    'Pepperstone-Demo',
    'Pepperstone-Live',
    'XM-Demo',
    'XM-Real',
    'Alpari-Demo',
    'Alpari-Real',
    'FXCM-Demo',
    'FXCM-Real',
    'Custom Server'
  ];

  const steps = [
    {
      id: 1,
      title: 'Setup MT5 Bridge',
      description: 'Install and configure the bridge application',
      completed: bridgeAvailable,
      active: currentStep === 1
    },
    {
      id: 2,
      title: 'Start Bridge Service',
      description: 'Launch the bridge application',
      completed: bridgeAvailable && currentStep > 2,
      active: currentStep === 2
    },
    {
      id: 3,
      title: 'Connect to Bridge',
      description: 'Establish WebSocket connection',
      completed: isConnected,
      active: currentStep === 3
    },
    {
      id: 4,
      title: 'Live Trading Ready',
      description: 'Real-time MT5 integration active',
      completed: isConnected,
      active: currentStep === 4 && isConnected
    }
  ];

  // Check bridge availability on modal open
  useEffect(() => {
    if (isOpen) {
      checkBridge();
    }
  }, [isOpen]);

  // Update step based on connection state
  useEffect(() => {
    if (isConnected) {
      setCurrentStep(4);
    } else if (bridgeAvailable) {
      setCurrentStep(3);
    }
  }, [isConnected, bridgeAvailable]);

  // Check if automated trading is enabled when connected
  useEffect(() => {
    if (isConnected && connectionState.accountData) {
      // Check if trade_expert property exists and is a boolean
      if (typeof connectionState.accountData.tradeExpert === 'boolean') {
        setAutomatedTradingEnabled(connectionState.accountData.tradeExpert);
      } else {
        setAutomatedTradingEnabled(null); // Unknown state
      }
    }
  }, [isConnected, connectionState.accountData]);

  const checkBridge = async () => {
    setCheckingBridge(true);
    setBridgeCheckAttempts(prev => prev + 1);
    
    try {
      const available = await checkBridgeAvailability();
      setBridgeAvailable(available);
      
      if (available && currentStep === 1) {
        setCurrentStep(3); // Skip to connection step if bridge is running
      }
    } catch (error) {
      console.error('Error checking bridge availability:', error);
      setBridgeAvailable(false);
    } finally {
      setCheckingBridge(false);
    }
  };

  const handleCredentialChange = (field: string, value: string) => {
    setCredentials(prev => ({ ...prev, [field]: value }));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const handleConnectToBridge = async () => {
    try {
      const success = await connect();
      if (success) {
        setCurrentStep(4);
      }
    } catch (error) {
      console.error('Failed to connect to bridge:', error);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setCurrentStep(3);
  };

  const checkMT5Settings = async () => {
    setCheckingSettings(true);
    
    try {
      // First check if we're connected
      if (!isConnected) {
        try {
          await connect();
        } catch (error) {
          setError('Failed to connect to MT5 bridge. Please make sure it is running.');
          setCheckingSettings(false);
          return;
        }
      }
      
      // Check if we have account data
      if (connectionState.accountData) {
        // Check if automated trading is enabled
        if (typeof connectionState.accountData.tradeExpert === 'boolean') {
          setAutomatedTradingEnabled(connectionState.accountData.tradeExpert);
          
          if (!connectionState.accountData.tradeExpert) {
            setError('Automated trading is disabled in MT5. Please enable it in Tools > Options > Expert Advisors > Allow automated trading.');
          } else {
            setError(null);
          }
        } else {
          setAutomatedTradingEnabled(null);
          setError('Could not determine if automated trading is enabled. Please check MT5 settings manually.');
        }
      } else {
        setError('Could not retrieve MT5 account data. Please check if MT5 is running and logged in.');
      }
    } catch (error) {
      setError('Failed to check MT5 settings: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setCheckingSettings(false);
    }
  };

  // Manual installation instructions
  const manualInstallationSteps = [
    {
      title: "Create Bridge Directory",
      command: "mkdir C:\\Pipnosis\\MT5Bridge",
      description: "Create a directory for the MT5 bridge files"
    },
    {
      title: "Download Python Files",
      description: "Copy the bridge files to your computer",
      files: [
        { name: "mt5_connector.py", description: "Main bridge application" },
        { name: "requirements.txt", description: "Python dependencies" }
      ]
    },
    {
      title: "Install Dependencies",
      command: "pip install -r requirements.txt",
      description: "Install required Python packages"
    },
    {
      title: "Run the Bridge",
      command: "python mt5_connector.py",
      description: "Start the MT5 bridge service"
    }
  ];

  // If not open and not in iframe mode, return null
  if (!isOpen && window.location.pathname !== '/mt5-connection-modal') return null;

  // Check if we're in iframe mode
  const isIframeMode = window.location.pathname === '/mt5-connection-modal';

  return (
    <div className={isIframeMode ? "" : "fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4"}>
      <div className={`bg-slate-800 rounded-xl border border-slate-700 ${isIframeMode ? "w-full h-full" : "w-full max-w-7xl max-h-[95vh]"} overflow-hidden flex flex-col`}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-slate-700 bg-gradient-to-r from-slate-800 to-slate-700 flex-shrink-0">
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-lg ${isConnected ? 'bg-green-500/20' : 'bg-blue-500/20'}`}>
              <Server className={`h-5 w-5 sm:h-6 sm:w-6 ${isConnected ? 'text-green-400' : 'text-blue-400'}`} />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-semibold text-white">
                {isConnected ? 'MT5 Integration Active' : 'Connect MetaTrader 5'}
              </h2>
              <p className="text-xs sm:text-sm text-slate-400">
                {isConnected ? 'Real-time data streaming' : 'Set up live trading integration'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col lg:flex-row flex-1 min-h-0 overflow-auto">
          {/* Progress Sidebar */}
          <div className="w-full lg:w-80 bg-slate-900 border-b lg:border-b-0 lg:border-r border-slate-700 p-4 sm:p-6 flex-shrink-0">
            <h3 className="text-lg font-semibold text-white mb-4 sm:mb-6">Setup Progress</h3>
            <div className="space-y-3 sm:space-y-4">
              {steps.map((step) => (
                <div key={step.id} className="flex items-start space-x-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all ${
                    step.completed 
                      ? 'bg-green-500 text-white' 
                      : step.active 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-slate-700 text-slate-400'
                  }`}>
                    {step.completed ? <CheckCircle className="h-4 w-4" /> : step.id}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className={`font-medium text-sm sm:text-base ${step.active ? 'text-white' : 'text-slate-400'}`}>
                      {step.title}
                    </h4>
                    <p className="text-xs sm:text-sm text-slate-500">{step.description}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Connection Status */}
            <div className="mt-6 sm:mt-8 p-3 sm:p-4 bg-slate-800 rounded-lg border border-slate-600">
              <h4 className="text-white font-medium mb-3 flex items-center space-x-2 text-sm sm:text-base">
                <Monitor className="h-4 w-4" />
                <span>Connection Status</span>
              </h4>
              
              <div className="space-y-2 text-xs sm:text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Bridge:</span>
                  <div className={`flex items-center space-x-1 ${
                    checkingBridge ? 'text-yellow-400' :
                    bridgeAvailable ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {checkingBridge ? (
                      <Loader className="h-3 w-3 animate-spin" />
                    ) : bridgeAvailable ? (
                      <CheckCircle className="h-3 w-3" />
                    ) : (
                      <AlertCircle className="h-3 w-3" />
                    )}
                    <span>{checkingBridge ? 'Checking...' : bridgeAvailable ? 'Running' : 'Not Found'}</span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">WebSocket:</span>
                  <div className={`flex items-center space-x-1 ${
                    isConnecting ? 'text-yellow-400' :
                    isConnected ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {isConnecting ? (
                      <Loader className="h-3 w-3 animate-spin" />
                    ) : isConnected ? (
                      <Wifi className="h-3 w-3" />
                    ) : (
                      <WifiOff className="h-3 w-3" />
                    )}
                    <span>{isConnecting ? 'Connecting...' : isConnected ? 'Connected' : 'Disconnected'}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-400">MT5 Data:</span>
                  <div className={`flex items-center space-x-1 ${
                    connectionState.accountData ? 'text-green-400' : 'text-slate-400'
                  }`}>
                    {connectionState.accountData ? (
                      <CheckCircle className="h-3 w-3" />
                    ) : (
                      <AlertCircle className="h-3 w-3" />
                    )}
                    <span>{connectionState.accountData ? 'Live Data' : 'No Data'}</span>
                  </div>
                </div>

                {/* Automated Trading Status */}
                {isConnected && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Automated Trading:</span>
                    <div className={`flex items-center space-x-1 ${
                      checkingSettings ? 'text-yellow-400' :
                      automatedTradingEnabled === true ? 'text-green-400' :
                      automatedTradingEnabled === false ? 'text-red-400' : 'text-slate-400'
                    }`}>
                      {checkingSettings ? (
                        <Loader className="h-3 w-3 animate-spin" />
                      ) : automatedTradingEnabled === true ? (
                        <CheckCircle className="h-3 w-3" />
                      ) : automatedTradingEnabled === false ? (
                        <AlertTriangle className="h-3 w-3" />
                      ) : (
                        <AlertCircle className="h-3 w-3" />
                      )}
                      <span>
                        {checkingSettings ? 'Checking...' :
                         automatedTradingEnabled === true ? 'Enabled' :
                         automatedTradingEnabled === false ? 'Disabled' : 'Unknown'}
                      </span>
                    </div>
                  </div>
                )}

                {/* WebRequest Status */}
                {isConnected && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">WebRequest:</span>
                    <div className={`flex items-center space-x-1 ${
                      webRequestEnabled === true ? 'text-green-400' :
                      webRequestEnabled === false ? 'text-yellow-400' : 'text-slate-400'
                    }`}>
                      {webRequestEnabled === true ? (
                        <CheckCircle className="h-3 w-3" />
                      ) : webRequestEnabled === false ? (
                        <AlertTriangle className="h-3 w-3" />
                      ) : (
                        <AlertCircle className="h-3 w-3" />
                      )}
                      <span>
                        {webRequestEnabled === true ? 'Enabled' :
                         webRequestEnabled === false ? 'Not Configured' : 'Unknown'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Live Data Preview */}
            {isConnected && connectionState.accountData && (
              <div className="mt-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                <div className="flex items-center space-x-2 text-green-400 mb-2">
                  <Zap className="h-4 w-4" />
                  <span className="text-sm font-medium">Live MT5 Data</span>
                </div>
                <div className="text-xs text-green-300 space-y-1">
                  <div>Account: {connectionState.accountData.login}</div>
                  <div>Balance: ${connectionState.accountData.balance?.toLocaleString()}</div>
                  <div>Positions: {connectionState.positions?.length || 0}</div>
                </div>
              </div>
            )}

            {/* Automated Trading Warning */}
            {isConnected && automatedTradingEnabled === false && (
              <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <div className="flex items-start space-x-2">
                  <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-red-300 text-sm font-medium">Automated Trading Disabled</p>
                    <p className="text-red-200 text-xs mt-1">
                      You must enable automated trading in MT5 to execute trades:
                    </p>
                    <ol className="text-red-200 text-xs mt-1 list-decimal list-inside">
                      <li>Open MetaTrader 5</li>
                      <li>Go to Tools > Options</li>
                      <li>Select the "Expert Advisors" tab</li>
                      <li>Check "Allow automated trading"</li>
                      <li>Click "OK"</li>
                    </ol>
                  </div>
                </div>
              </div>
            )}

            {/* WebRequest Warning */}
            {isConnected && webRequestEnabled === false && (
              <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="flex items-start space-x-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-yellow-300 text-sm font-medium">WebRequest Not Configured</p>
                    <p className="text-yellow-200 text-xs mt-1">
                      If your MT5 connector needs to make web requests, enable this setting:
                    </p>
                    <ol className="text-yellow-200 text-xs mt-1 list-decimal list-inside">
                      <li>Open MetaTrader 5</li>
                      <li>Go to Tools > Options</li>
                      <li>Select the "Expert Advisors" tab</li>
                      <li>Check "Allow WebRequest for listed URL:"</li>
                      <li>Add the necessary URLs (e.g., your API endpoints)</li>
                      <li>Click "OK"</li>
                    </ol>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Main Content */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-4 sm:p-6 lg:p-8 space-y-6 sm:space-y-8">
              {/* Step 1: Setup Bridge */}
              {currentStep === 1 && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-xl sm:text-2xl font-semibold text-white mb-2">Setup MT5 Bridge</h3>
                    <p className="text-slate-400 mb-6 text-sm sm:text-base">
                      The MT5 Bridge connects your MetaTrader 5 terminal with Pipnosis AI. Choose your preferred installation method.
                    </p>
                  </div>

                  {/* Installation Method Selection */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div 
                      className={`p-6 rounded-xl border-2 cursor-pointer transition-all ${
                        installationMethod === 'manual' 
                          ? 'border-blue-500 bg-blue-500/10' 
                          : 'border-slate-600 bg-slate-900 hover:border-slate-500'
                      }`}
                      onClick={() => setInstallationMethod('manual')}
                    >
                      <div className="flex items-center space-x-3 mb-3">
                        <div className={`w-4 h-4 rounded-full border-2 ${
                          installationMethod === 'manual' ? 'border-blue-500 bg-blue-500' : 'border-slate-400'
                        }`}>
                          {installationMethod === 'manual' && <div className="w-2 h-2 bg-white rounded-full m-0.5"></div>}
                        </div>
                        <h4 className="text-white font-semibold">Manual Setup</h4>
                        <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded">Recommended</span>
                      </div>
                      <ul className="text-sm text-slate-300 space-y-1">
                        <li>• Copy Python files to your computer</li>
                        <li>• Install dependencies with pip</li>
                        <li>• Run the bridge script directly</li>
                        <li>• Full control over the installation</li>
                      </ul>
                    </div>

                    <div 
                      className={`p-6 rounded-xl border-2 cursor-pointer transition-all ${
                        installationMethod === 'download' 
                          ? 'border-blue-500 bg-blue-500/10' 
                          : 'border-slate-600 bg-slate-900 hover:border-slate-500'
                      }`}
                      onClick={() => setInstallationMethod('download')}
                    >
                      <div className="flex items-center space-x-3 mb-3">
                        <div className={`w-4 h-4 rounded-full border-2 ${
                          installationMethod === 'download' ? 'border-blue-500 bg-blue-500' : 'border-slate-400'
                        }`}>
                          {installationMethod === 'download' && <div className="w-2 h-2 bg-white rounded-full m-0.5"></div>}
                        </div>
                        <h4 className="text-white font-semibold">Download Installer</h4>
                        <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded">Coming Soon</span>
                      </div>
                      <ul className="text-sm text-slate-300 space-y-1">
                        <li>• Automated Windows installer</li>
                        <li>• One-click installation process</li>
                        <li>• Automatic dependency management</li>
                        <li>• Desktop shortcut creation</li>
                      </ul>
                    </div>
                  </div>

                  {/* Manual Installation Instructions */}
                  {installationMethod === 'manual' && (
                    <div className="bg-slate-900 rounded-xl border border-slate-600 p-6">
                      <h4 className="text-white font-semibold mb-4 flex items-center space-x-2">
                        <FileText className="h-5 w-5 text-blue-400" />
                        <span>Manual Installation Steps</span>
                      </h4>
                      
                      <div className="space-y-6">
                        {manualInstallationSteps.map((step, index) => (
                          <div key={index} className="border-l-4 border-blue-500 pl-4">
                            <h5 className="text-white font-medium mb-2">{index + 1}. {step.title}</h5>
                            <p className="text-slate-400 text-sm mb-3">{step.description}</p>
                            
                            {step.command && (
                              <div className="bg-slate-800 rounded-lg p-3 border border-slate-600">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-slate-400 text-xs">Command:</span>
                                  <button
                                    onClick={() => copyToClipboard(step.command!)}
                                    className="text-blue-400 hover:text-blue-300 text-xs flex items-center space-x-1"
                                  >
                                    <Copy className="h-3 w-3" />
                                    <span>Copy</span>
                                  </button>
                                </div>
                                <code className="text-green-400 text-sm font-mono">{step.command}</code>
                              </div>
                            )}
                            
                            {step.files && (
                              <div className="space-y-2">
                                {step.files.map((file, fileIndex) => (
                                  <div key={fileIndex} className="bg-slate-800 rounded-lg p-3 border border-slate-600">
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <span className="text-white font-mono text-sm">{file.name}</span>
                                        <p className="text-slate-400 text-xs">{file.description}</p>
                                      </div>
                                      <a
                                        href={`/mt5-bridge/${file.name}`}
                                        download
                                        className="text-blue-400 hover:text-blue-300 text-xs flex items-center space-x-1"
                                      >
                                        <Download className="h-3 w-3" />
                                        <span>Download</span>
                                      </a>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      
                      <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                        <h5 className="text-blue-300 font-medium mb-2">Prerequisites</h5>
                        <ul className="text-blue-200 text-sm space-y-1">
                          <li>• Python 3.8 or higher installed</li>
                          <li>• MetaTrader 5 terminal running and logged in</li>
                          <li>• Command prompt or terminal access</li>
                          <li>• Administrator privileges (if needed)</li>
                        </ul>
                      </div>
                    </div>
                  )}

                  {/* Download Installer (Coming Soon) */}
                  {installationMethod === 'download' && (
                    <div className="bg-slate-900 rounded-xl border border-slate-600 p-6">
                      <div className="text-center">
                        <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg mb-4">
                          <AlertCircle className="h-8 w-8 text-yellow-400 mx-auto mb-2" />
                          <h4 className="text-yellow-300 font-medium">Installer Coming Soon</h4>
                          <p className="text-yellow-200 text-sm mt-1">
                            The automated installer is currently in development. Please use the manual setup method for now.
                          </p>
                        </div>
                        
                        <button
                          onClick={() => setInstallationMethod('manual')}
                          className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                        >
                          Switch to Manual Setup
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <button
                      onClick={checkBridge}
                      disabled={checkingBridge}
                      className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors font-medium flex items-center space-x-2"
                    >
                      {checkingBridge ? (
                        <>
                          <Loader className="h-4 w-4 animate-spin" />
                          <span>Checking...</span>
                        </>
                      ) : (
                        <>
                          <Monitor className="h-4 w-4" />
                          <span>Check Bridge Status</span>
                        </>
                      )}
                    </button>

                    {bridgeAvailable && (
                      <button
                        onClick={() => setCurrentStep(3)}
                        className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium"
                      >
                        Continue to Connection
                      </button>
                    )}
                  </div>

                  {!bridgeAvailable && !checkingBridge && bridgeCheckAttempts > 0 && (
                    <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                      <div className="flex items-start space-x-3">
                        <AlertCircle className="h-5 w-5 text-red-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <h4 className="text-red-300 font-medium">Bridge Not Detected</h4>
                          <p className="text-red-200 text-sm mt-1">
                            The MT5 Bridge is not running. Please follow the installation steps above and start the bridge.
                          </p>
                          <div className="mt-3 p-3 bg-slate-800 rounded-lg border border-slate-700">
                            <h5 className="text-white text-sm font-medium mb-2">Troubleshooting Steps:</h5>
                            <ol className="text-slate-300 text-sm space-y-1 list-decimal list-inside">
                              <li>Make sure Python 3.8+ is installed</li>
                              <li>Install required packages: <code className="text-blue-300">pip install MetaTrader5 websockets</code></li>
                              <li>Run the bridge: <code className="text-blue-300">python mt5_connector.py</code></li>
                              <li>Ensure MetaTrader 5 is running and logged in</li>
                              <li>Check if port 8765 is available (or try ports 8766-8770)</li>
                            </ol>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Step 2: Start Bridge (Skip this step in manual mode) */}
              {currentStep === 2 && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-xl sm:text-2xl font-semibold text-white mb-2">Start the MT5 Bridge</h3>
                    <p className="text-slate-400 mb-6 text-sm sm:text-base">
                      Run the bridge application to enable communication between MT5 and Pipnosis.
                    </p>
                  </div>

                  <div className="bg-slate-900 rounded-xl border border-slate-600 p-6">
                    <h4 className="text-white font-semibold mb-4">Launch Instructions</h4>
                    
                    <div className="space-y-4">
                      <div className="flex items-start space-x-3">
                        <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold">1</div>
                        <div>
                          <p className="text-white font-medium text-sm">Open Command Prompt</p>
                          <p className="text-slate-400 text-sm">Navigate to your bridge installation directory</p>
                        </div>
                      </div>
                      
                      <div className="flex items-start space-x-3">
                        <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold">2</div>
                        <div>
                          <p className="text-white font-medium text-sm">Run the Bridge</p>
                          <div className="bg-slate-800 rounded-lg p-3 border border-slate-600 mt-2">
                            <code className="text-green-400 text-sm">python mt5_connector.py</code>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-start space-x-3">
                        <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold">3</div>
                        <div>
                          <p className="text-white font-medium text-sm">Verify Connection</p>
                          <p className="text-slate-400 text-sm">You should see "MT5 Connector is ready for live trading!"</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <button
                      onClick={checkBridge}
                      disabled={checkingBridge}
                      className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors font-medium flex items-center space-x-2"
                    >
                      {checkingBridge ? (
                        <>
                          <Loader className="h-4 w-4 animate-spin" />
                          <span>Checking...</span>
                        </>
                      ) : (
                        <>
                          <Monitor className="h-4 w-4" />
                          <span>Check Bridge Status</span>
                        </>
                      )}
                    </button>

                    {bridgeAvailable && (
                      <button
                        onClick={() => setCurrentStep(3)}
                        className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium"
                      >
                        Continue to Connection
                      </button>
                    )}
                  </div>

                  {!bridgeAvailable && !checkingBridge && (
                    <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                      <div className="flex items-start space-x-3">
                        <AlertCircle className="h-5 w-5 text-red-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <h4 className="text-red-300 font-medium">Bridge Not Running</h4>
                          <p className="text-red-200 text-sm mt-1">
                            Please start the bridge application using the command above and try again.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Step 3: Connect to Bridge */}
              {currentStep === 3 && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-xl sm:text-2xl font-semibold text-white mb-2">Connect to MT5 Bridge</h3>
                    <p className="text-slate-400 mb-6 text-sm sm:text-base">
                      Establish a WebSocket connection between Pipnosis and your MT5 Bridge to enable real-time data streaming.
                    </p>
                  </div>

                  <div className="bg-slate-900 rounded-xl border border-slate-600 p-6">
                    <div className="flex items-center justify-between mb-6">
                      <h4 className="text-white font-semibold">WebSocket Connection</h4>
                      <div className={`px-3 py-1 rounded-lg text-sm font-medium ${
                        isConnected ? 'bg-green-500/20 text-green-400' :
                        isConnecting ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>
                        {isConnecting ? 'Connecting...' : isConnected ? 'Connected' : 'Disconnected'}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Bridge URL:</span>
                        <span className="text-white font-mono text-sm">ws://localhost:8765</span>
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Protocol:</span>
                        <span className="text-white">WebSocket</span>
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Security:</span>
                        <span className="text-green-400">Local Connection Only</span>
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Fallback Ports:</span>
                        <span className="text-white">8766, 8767, 8768, 8769, 8770</span>
                      </div>
                    </div>

                    {error && (
                      <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                        <p className="text-red-400 text-sm">{error}</p>
                        <p className="text-red-300 text-xs mt-2">
                          Make sure the MT5 bridge is running and MetaTrader 5 is open and logged in.
                        </p>
                      </div>
                    )}

                    <div className="mt-6 flex space-x-3">
                      {!isConnected ? (
                        <button
                          onClick={handleConnectToBridge}
                          disabled={isConnecting}
                          className="flex-1 bg-blue-500 text-white py-3 px-4 rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors font-medium flex items-center justify-center space-x-2"
                        >
                          {isConnecting ? (
                            <>
                              <Loader className="h-4 w-4 animate-spin" />
                              <span>Connecting...</span>
                            </>
                          ) : (
                            <>
                              <Wifi className="h-4 w-4" />
                              <span>Connect to Bridge</span>
                            </>
                          )}
                        </button>
                      ) : (
                        <button
                          onClick={handleDisconnect}
                          className="flex-1 bg-red-500 text-white py-3 px-4 rounded-lg hover:bg-red-600 transition-colors font-medium flex items-center justify-center space-x-2"
                        >
                          <WifiOff className="h-4 w-4" />
                          <span>Disconnect</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* MT5 Settings Check */}
                  {isConnected && (
                    <div className="bg-slate-900 rounded-xl border border-slate-600 p-6">
                      <h4 className="text-white font-semibold mb-4">MT5 Settings Check</h4>
                      
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Automated Trading:</span>
                          <div className={`flex items-center space-x-1 ${
                            checkingSettings ? 'text-yellow-400' :
                            automatedTradingEnabled === true ? 'text-green-400' :
                            automatedTradingEnabled === false ? 'text-red-400' : 'text-slate-400'
                          }`}>
                            {checkingSettings ? (
                              <Loader className="h-3 w-3 animate-spin" />
                            ) : automatedTradingEnabled === true ? (
                              <CheckCircle className="h-3 w-3" />
                            ) : automatedTradingEnabled === false ? (
                              <AlertTriangle className="h-3 w-3" />
                            ) : (
                              <AlertCircle className="h-3 w-3" />
                            )}
                            <span>
                              {checkingSettings ? 'Checking...' :
                               automatedTradingEnabled === true ? 'Enabled' :
                               automatedTradingEnabled === false ? 'Disabled' : 'Unknown'}
                            </span>
                          </div>
                        </div>

                        {/* WebRequest Setting */}
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">WebRequest:</span>
                          <div className={`flex items-center space-x-1 ${
                            webRequestEnabled === true ? 'text-green-400' :
                            webRequestEnabled === false ? 'text-yellow-400' : 'text-slate-400'
                          }`}>
                            {webRequestEnabled === true ? (
                              <CheckCircle className="h-3 w-3" />
                            ) : webRequestEnabled === false ? (
                              <AlertTriangle className="h-3 w-3" />
                            ) : (
                              <AlertCircle className="h-3 w-3" />
                            )}
                            <span>
                              {webRequestEnabled === true ? 'Enabled' :
                               webRequestEnabled === false ? 'Not Configured' : 'Unknown'}
                            </span>
                          </div>
                        </div>
                        
                        <button
                          onClick={checkMT5Settings}
                          disabled={checkingSettings}
                          className="w-full bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors font-medium flex items-center justify-center space-x-2"
                        >
                          {checkingSettings ? (
                            <>
                              <Loader className="h-4 w-4 animate-spin" />
                              <span>Checking MT5 Settings...</span>
                            </>
                          ) : (
                            <>
                              <RefreshCw className="h-4 w-4" />
                              <span>Check MT5 Settings</span>
                            </>
                          )}
                        </button>
                      </div>
                      
                      {automatedTradingEnabled === false && (
                        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                          <div className="flex items-start space-x-2">
                            <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="text-red-300 text-sm font-medium">Automated Trading is Disabled</p>
                              <p className="text-red-200 text-xs mt-1">
                                You must enable automated trading in MT5 to execute trades:
                              </p>
                              <ol className="text-red-200 text-xs mt-1 list-decimal list-inside">
                                <li>Open MetaTrader 5</li>
                                <li>Go to Tools > Options</li>
                                <li>Select the "Expert Advisors" tab</li>
                                <li>Check "Allow automated trading"</li>
                                <li>Click "OK"</li>
                                <li>Restart MetaTrader 5</li>
                              </ol>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* WebRequest Configuration Instructions */}
                      <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                        <div className="flex items-start space-x-2">
                          <AlertTriangle className="h-4 w-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-yellow-300 text-sm font-medium">WebRequest Configuration</p>
                            <p className="text-yellow-200 text-xs mt-1">
                              For MT5 to communicate with external services, enable WebRequest:
                            </p>
                            <ol className="text-yellow-200 text-xs mt-1 list-decimal list-inside">
                              <li>Open MetaTrader 5</li>
                              <li>Go to Tools > Options</li>
                              <li>Select the "Expert Advisors" tab</li>
                              <li>Check "Allow WebRequest for listed URL:"</li>
                              <li>Add these URLs (one per line):</li>
                            </ol>
                            <div className="mt-2 bg-slate-800 p-2 rounded text-xs font-mono text-blue-300">
                              <div>https://elykntifkdaqiafnjosk.supabase.co</div>
                              <div>https://api.openai.com</div>
                              <div>http://localhost:3001</div>
                              <div>https://pipnosis-production.up.railway.app</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Step 4: Connected */}
              {currentStep === 4 && isConnected && (
                <div className="space-y-6">
                  <div className="text-center">
                    <div className="p-6 bg-green-500/20 rounded-full w-20 h-20 sm:w-24 sm:h-24 mx-auto mb-6 flex items-center justify-center">
                      <CheckCircle className="h-10 w-10 sm:h-12 sm:w-12 text-green-400" />
                    </div>
                    <h3 className="text-2xl sm:text-3xl font-semibold text-white mb-2">MT5 Integration Active!</h3>
                    <p className="text-slate-400 mb-8 text-sm sm:text-base">
                      Your MetaTrader 5 account is now connected and streaming live data to Pipnosis AI.
                    </p>
                  </div>

                  {/* Live Data Display */}
                  {connectionState.accountData && (
                    <div className="bg-slate-900 rounded-xl border border-slate-600 p-6">
                      <h4 className="text-white font-semibold mb-4">Live Account Data</h4>
                      
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-slate-800 rounded-lg p-3 border border-slate-600">
                          <div className="text-sm text-slate-400 mb-1">Account</div>
                          <div className="text-white font-mono">{connectionState.accountData.login}</div>
                        </div>
                        
                        <div className="bg-slate-800 rounded-lg p-3 border border-slate-600">
                          <div className="text-sm text-slate-400 mb-1">Balance</div>
                          <div className="text-green-400 font-semibold">${connectionState.accountData.balance?.toLocaleString()}</div>
                        </div>
                        
                        <div className="bg-slate-800 rounded-lg p-3 border border-slate-600">
                          <div className="text-sm text-slate-400 mb-1">Equity</div>
                          <div className="text-blue-400 font-semibold">${connectionState.accountData.equity?.toLocaleString()}</div>
                        </div>
                        
                        <div className="bg-slate-800 rounded-lg p-3 border border-slate-600">
                          <div className="text-sm text-slate-400 mb-1">Positions</div>
                          <div className="text-white font-semibold">{connectionState.positions?.length || 0}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* MT5 Settings Check */}
                  <div className="bg-slate-900 rounded-xl border border-slate-600 p-6">
                    <h4 className="text-white font-semibold mb-4">MT5 Settings Check</h4>
                    
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Automated Trading:</span>
                        <div className={`flex items-center space-x-1 ${
                          checkingSettings ? 'text-yellow-400' :
                          automatedTradingEnabled === true ? 'text-green-400' :
                          automatedTradingEnabled === false ? 'text-red-400' : 'text-slate-400'
                        }`}>
                          {checkingSettings ? (
                            <Loader className="h-3 w-3 animate-spin" />
                          ) : automatedTradingEnabled === true ? (
                            <CheckCircle className="h-3 w-3" />
                          ) : automatedTradingEnabled === false ? (
                            <AlertTriangle className="h-3 w-3" />
                          ) : (
                            <AlertCircle className="h-3 w-3" />
                          )}
                          <span>
                            {checkingSettings ? 'Checking...' :
                             automatedTradingEnabled === true ? 'Enabled' :
                             automatedTradingEnabled === false ? 'Disabled' : 'Unknown'}
                          </span>
                        </div>
                      </div>

                      {/* WebRequest Setting */}
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">WebRequest:</span>
                        <div className={`flex items-center space-x-1 ${
                          webRequestEnabled === true ? 'text-green-400' :
                          webRequestEnabled === false ? 'text-yellow-400' : 'text-slate-400'
                        }`}>
                          {webRequestEnabled === true ? (
                            <CheckCircle className="h-3 w-3" />
                          ) : webRequestEnabled === false ? (
                            <AlertTriangle className="h-3 w-3" />
                          ) : (
                            <AlertCircle className="h-3 w-3" />
                          )}
                          <span>
                            {webRequestEnabled === true ? 'Enabled' :
                             webRequestEnabled === false ? 'Not Configured' : 'Unknown'}
                          </span>
                        </div>
                      </div>
                      
                      <button
                        onClick={checkMT5Settings}
                        disabled={checkingSettings}
                        className="w-full bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors font-medium flex items-center justify-center space-x-2"
                      >
                        {checkingSettings ? (
                          <>
                            <Loader className="h-4 w-4 animate-spin" />
                            <span>Checking MT5 Settings...</span>
                          </>
                        ) : (
                          <>
                            <RefreshCw className="h-4 w-4" />
                            <span>Check MT5 Settings</span>
                          </>
                        )}
                      </button>
                    </div>
                    
                    {automatedTradingEnabled === false && (
                      <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                        <div className="flex items-start space-x-2">
                          <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-red-300 text-sm font-medium">Automated Trading is Disabled</p>
                            <p className="text-red-200 text-xs mt-1">
                              You must enable automated trading in MT5 to execute trades:
                            </p>
                            <ol className="text-red-200 text-xs mt-1 list-decimal list-inside">
                              <li>Open MetaTrader 5</li>
                              <li>Go to Tools > Options</li>
                              <li>Select the "Expert Advisors" tab</li>
                              <li>Check "Allow automated trading"</li>
                              <li>Click "OK"</li>
                              <li>Restart MetaTrader 5</li>
                            </ol>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* WebRequest Configuration Instructions */}
                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                    <div className="flex items-start space-x-3">
                      <AlertTriangle className="h-5 w-5 text-yellow-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <h4 className="text-yellow-300 font-medium">WebRequest Configuration</h4>
                        <p className="text-yellow-200 text-sm mt-1">
                          For MT5 to communicate with external services, you need to enable WebRequest and add the following URLs:
                        </p>
                        <div className="mt-3 p-3 bg-slate-800 rounded-lg border border-slate-700">
                          <h5 className="text-white text-sm font-medium mb-2">Required URLs:</h5>
                          <div className="space-y-1 text-xs font-mono text-blue-300">
                            <div>https://elykntifkdaqiafnjosk.supabase.co</div>
                            <div>https://api.openai.com</div>
                            <div>http://localhost:3001</div>
                            <div>https://pipnosis-production.up.railway.app</div>
                          </div>
                          <p className="text-yellow-200 text-xs mt-3">
                            To add these URLs: Tools > Options > Expert Advisors tab > Check "Allow WebRequest for listed URL:" > Add each URL
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                    <div className="flex items-start space-x-3">
                      <Zap className="h-5 w-5 text-green-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <h4 className="text-green-300 font-medium">Real-Time Integration Active</h4>
                        <ul className="text-green-200 text-sm mt-2 space-y-1">
                          <li>• Live account balance and equity updates</li>
                          <li>• Real-time position monitoring</li>
                          <li>• AI can execute trades directly in MT5</li>
                          <li>• Automatic risk management enforcement</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-center">
                    <button
                      onClick={onClose}
                      className="px-8 py-3 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg hover:from-green-600 hover:to-green-700 transition-all font-medium shadow-lg"
                    >
                      Start AI Trading
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
import React, { useState, useEffect } from 'react';
import { X, Download, CheckCircle, AlertCircle, Loader, Shield, Server, Key, User, ExternalLink, Play, Monitor, Wifi, WifiOff } from 'lucide-react';
import { mt5Client } from '../services/mt5WebSocketClient';

interface MT5ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ConnectionStep {
  id: number;
  title: string;
  description: string;
  completed: boolean;
  active: boolean;
}

export const MT5ConnectionModal: React.FC<MT5ConnectionModalProps> = ({ isOpen, onClose }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [connectorStatus, setConnectorStatus] = useState<'not-installed' | 'installing' | 'installed' | 'running' | 'error'>('not-installed');
  const [credentials, setCredentials] = useState<{
    login: string;
    password: string;
    server: string;
    accountType: string;
    bridgeHost: string;
    bridgePort: string;
  }>({
    login: '',
    password: '',
    server: 'MetaQuotes-Demo',
    accountType: 'demo',
    bridgeHost: '',
    bridgePort: '8765'
  });
  const [isEditingCredentials, setIsEditingCredentials] = useState(false);
  const [currentCredentials, setCurrentCredentials] = useState<{
    login: string;
    server?: string;
    bridgeHost?: string;
    bridgePort?: string;
    lastUpdated?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const steps: ConnectionStep[] = [
    {
      id: 1,
      title: 'Download Pipnosis Connector',
      description: 'Install the secure bridge application',
      completed: currentStep > 1,
      active: currentStep === 1
    },
    {
      id: 2,
      title: 'Configure MT5 Credentials',
      description: 'Enter your MetaTrader 5 account details',
      completed: currentStep > 2,
      active: currentStep === 2
    },
    {
      id: 3,
      title: 'Test Connection',
      description: 'Verify the bridge is working correctly',
      completed: currentStep > 3,
      active: currentStep === 3
    },
    {
      id: 4,
      title: 'Ready to Trade',
      description: 'AI is now connected to your MT5 account',
      completed: connectionStatus === 'connected',
      active: currentStep === 4
    }
  ];

  // Load current credentials from localStorage
  useEffect(() => {
    try {
      // Set default bridge host based on environment
      const envHost = import.meta.env.VITE_MT5_BRIDGE_HOST;
      const envPort = import.meta.env.VITE_MT5_BRIDGE_PORT;
      const savedHost = localStorage.getItem('pipnosis_mt5_bridge_host');
      const savedPort = localStorage.getItem('pipnosis_mt5_bridge_port');
      
      // Determine default host based on environment
      let defaultHost = 'localhost';
      if (window.location.hostname === 'pipnosis.com') {
        defaultHost = savedHost || ''; // Empty for production to prompt user
      } else if (envHost) {
        defaultHost = envHost;
      }
      
      // Determine default port
      const defaultPort = savedPort || envPort || '8765';
      
      setCredentials(prev => ({
        ...prev,
        bridgeHost: defaultHost,
        bridgePort: defaultPort
      }));
      
      const mt5AccountData = localStorage.getItem('pipnosis_mt5_account');
      if (mt5AccountData) {
        const accountData = JSON.parse(mt5AccountData);
        setCurrentCredentials({
          login: accountData.login || 'Unknown',
          server: accountData.server || 'Unknown',
          bridgeHost: accountData.bridgeHost || 'localhost',
          bridgePort: accountData.bridgePort || '8765',
          lastUpdated: accountData.lastUpdate || new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Error loading MT5 account data:', error);
    }
  }, [isOpen]);

  const handleCredentialChange = (field: string, value: string) => {
    setCredentials(prev => ({ ...prev, [field]: value }));
  };

  const handleDownloadConnector = () => {
    // Simulate download process
    setConnectorStatus('installing');
    
    // In a real implementation, this would trigger the actual download
    console.log('Downloading Pipnosis Connector...');
    
    // Simulate installation progress
    setTimeout(() => {
      setConnectorStatus('installed');
      setCurrentStep(2);
    }, 3000);
  };

  const handleTestConnection = async () => {
    setConnectionStatus('connecting');
    setError(null);
    
    try {
      // Configure the MT5 client with the provided host and port
      mt5Client.configure(credentials.bridgeHost, parseInt(credentials.bridgePort, 10));

      // Save to localStorage for persistence
      localStorage.setItem('pipnosis_mt5_bridge_host', credentials.bridgeHost);
      localStorage.setItem('pipnosis_mt5_bridge_port', credentials.bridgePort);
      
      // Test connection to the MT5 bridge
      const result = await mt5Client.testConnection();
      
      if (result.success) {
        setConnectionStatus('connected');
        setConnectorStatus('running');
        setCurrentStep(4);
        
        // Save credentials to localStorage for demo purposes
        const accountData = {
          login: credentials.login,
          server: credentials.server,
          bridgeHost: credentials.bridgeHost,
          bridgePort: credentials.bridgePort,
          balance: 10000,
          equity: 10000,
          lastUpdate: new Date().toISOString()
        };
        localStorage.setItem('pipnosis_mt5_connected', 'true');
        localStorage.setItem('pipnosis_mt5_account', JSON.stringify(accountData));
        
        // Update current credentials
        setCurrentCredentials({
          login: credentials.login,
          server: credentials.server,
          bridgeHost: credentials.bridgeHost,
          bridgePort: credentials.bridgePort,
          lastUpdated: new Date().toISOString()
        });
      } else {
        setConnectionStatus('error');
        setError(result.error || 'Failed to connect to MT5 bridge');
      }
    } catch (error) {
      console.error('Connection test error:', error);
      setConnectionStatus('error');
      setError(error instanceof Error ? error.message : 'Unknown connection error');
    }
  };

  const handleNextStep = () => {
    if (currentStep < 4) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleEditCredentials = () => {
    // Load current credentials into the form
    if (currentCredentials) {
      setCredentials({
        login: currentCredentials.login || '',
        password: '',
        server: currentCredentials.server || 'MetaQuotes-Demo',
        accountType: 'demo',
        bridgeHost: currentCredentials.bridgeHost || 'localhost',
        bridgePort: currentCredentials.bridgePort || '8765'
      });
    }
    setIsEditingCredentials(true);
    setCurrentStep(2);
  };

  const handleSaveCredentials = () => {
    // In a real implementation, this would save to the encrypted config file
    // For now, we'll just update localStorage

    // Validate required fields
    if (!credentials.login) {
      alert('Login is required');
      return;
    }

    if (!credentials.bridgeHost) {
      alert('Bridge Host is required');
      return;
    }

    if (!credentials.bridgePort) {
      alert('Bridge Port is required');
      return;
    }
    
    // Save to localStorage for demo
    const accountData = {
      login: credentials.login,
      server: credentials.server,
      bridgeHost: credentials.bridgeHost,
      bridgePort: credentials.bridgePort,
      balance: 10000, // Placeholder
      equity: 10000, // Placeholder
      lastUpdate: new Date().toISOString()
    };
    
    localStorage.setItem('pipnosis_mt5_account', JSON.stringify(accountData));
    
    // Update current credentials
    setCurrentCredentials({
      login: credentials.login,
      server: credentials.server,
      bridgeHost: credentials.bridgeHost,
      bridgePort: credentials.bridgePort,
      lastUpdated: new Date().toISOString()
    });
    
    setIsEditingCredentials(false);
    
    // Show success message
    alert('Credentials updated successfully! Please restart the MT5 bridge to apply changes.');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-6xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700 bg-gradient-to-r from-slate-800 to-slate-700">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Server className="h-6 w-6 text-blue-400" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">Connect MetaTrader 5</h2>
              <p className="text-sm text-slate-400">Secure bridge to your trading account</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex h-[600px]">
          {/* Progress Sidebar */}
          <div className="w-80 bg-slate-900 border-r border-slate-700 p-6">
            <h3 className="text-lg font-semibold text-white mb-6">Setup Progress</h3>
            <div className="space-y-4">
              {steps.map((step, index) => (
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
                  <div className="flex-1">
                    <h4 className={`font-medium ${step.active ? 'text-white' : 'text-slate-400'}`}>
                      {step.title}
                    </h4>
                    <p className="text-sm text-slate-500">{step.description}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Connection Status Indicator */}
            <div className="mt-8 p-4 bg-slate-800 rounded-lg border border-slate-600">
              <h4 className="text-white font-medium mb-3 flex items-center space-x-2">
                <Monitor className="h-4 w-4" />
                <span>Connector Status</span>
              </h4>
              
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Installation:</span>
                  <div className={`flex items-center space-x-1 ${
                    connectorStatus === 'installed' || connectorStatus === 'running' ? 'text-green-400' : 
                    connectorStatus === 'installing' ? 'text-yellow-400' : 'text-slate-400'
                  }`}>
                    {connectorStatus === 'installing' ? (
                      <Loader className="h-3 w-3 animate-spin" />
                    ) : connectorStatus === 'installed' || connectorStatus === 'running' ? (
                      <CheckCircle className="h-3 w-3" />
                    ) : (
                      <AlertCircle className="h-3 w-3" />
                    )}
                    <span className="capitalize">{connectorStatus.replace('-', ' ')}</span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Connection:</span>
                  <div className={`flex items-center space-x-1 ${
                    connectionStatus === 'connected' ? 'text-green-400' : 
                    connectionStatus === 'connecting' ? 'text-yellow-400' : 
                    connectionStatus === 'error' ? 'text-red-400' : 'text-slate-400'
                  }`}>
                    {connectionStatus === 'connecting' ? (
                      <Loader className="h-3 w-3 animate-spin" />
                    ) : connectionStatus === 'connected' ? (
                      <Wifi className="h-3 w-3" />
                    ) : connectionStatus === 'error' ? (
                      <WifiOff className="h-3 w-3" />
                    ) : (
                      <WifiOff className="h-3 w-3" />
                    )}
                    <span className="capitalize">{connectionStatus === 'idle' ? 'Not connected' : connectionStatus}</span>
                  </div>
                </div>
              </div>
            </div>

            {connectionStatus === 'connected' && (
              <div className="mt-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                <div className="flex items-center space-x-2 text-green-400">
                  <CheckCircle className="h-4 w-4" />
                  <span className="text-sm font-medium">Ready for AI Trading</span>
                </div>
                <p className="text-xs text-green-300 mt-1">
                  Your MT5 account is securely connected to Pipnosis AI
                </p>
              </div>
            )}

            {/* Current Credentials Section */}
            {currentCredentials && (
              <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-blue-300 font-medium text-sm">Current MT5 Account</h4>
                  <button 
                    onClick={handleEditCredentials}
                    className="p-1 text-blue-400 hover:text-blue-300 hover:bg-blue-500/20 rounded transition-colors"
                    title="Edit credentials"
                  >
                    <Edit3 className="h-3 w-3" />
                  </button>
                </div>
                <div className="text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Login:</span>
                    <span className="text-blue-200 font-mono">{currentCredentials.login}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Server:</span>
                    <span className="text-blue-200">{currentCredentials.server}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Bridge Host:</span>
                    <span className="text-blue-200">{currentCredentials.bridgeHost || 'localhost'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Bridge Port:</span>
                    <span className="text-blue-200">{currentCredentials.bridgePort || '8765'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Updated:</span>
                    <span className="text-blue-200">
                      {currentCredentials.lastUpdated ? new Date(currentCredentials.lastUpdated).toLocaleString() : 'Unknown'}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Main Content */}
          <div className="flex-1 p-6 overflow-y-auto">
            {currentStep === 1 && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-2xl font-semibold text-white mb-2">Download Pipnosis Connector</h3>
                  <p className="text-slate-400 mb-6">
                    The Pipnosis Connector is a secure bridge application that connects your MT5 terminal with our AI trading system. 
                    It runs locally on your computer and never sends your credentials to the cloud.
                  </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Download Card */}
                  <div className="bg-slate-900 rounded-xl border border-slate-600 p-6">
                    <div className="flex items-center space-x-4 mb-6">
                      <div className="p-3 bg-blue-500/20 rounded-lg">
                        <Download className="h-8 w-8 text-blue-400" />
                      </div>
                      <div>
                        <h4 className="text-white font-semibold text-lg">Pipnosis Connector v2.1.0</h4>
                        <p className="text-slate-400 text-sm">Windows application (15.2 MB)</p>
                      </div>
                    </div>

                    <div className="space-y-3 mb-6">
                      <div className="flex items-center space-x-2 text-sm text-slate-300">
                        <CheckCircle className="h-4 w-4 text-green-400" />
                        <span>Secure local encryption of credentials</span>
                      </div>
                      <div className="flex items-center space-x-2 text-sm text-slate-300">
                        <CheckCircle className="h-4 w-4 text-green-400" />
                        <span>Real-time MT5 API integration</span>
                      </div>
                      <div className="flex items-center space-x-2 text-sm text-slate-300">
                        <CheckCircle className="h-4 w-4 text-green-400" />
                        <span>Auto-startup and background operation</span>
                      </div>
                      <div className="flex items-center space-x-2 text-sm text-slate-300">
                        <CheckCircle className="h-4 w-4 text-green-400" />
                        <span>Automatic updates and monitoring</span>
                      </div>
                    </div>

                    <button
                      onClick={handleDownloadConnector}
                      disabled={connectorStatus === 'installing'}
                      className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white py-3 px-4 rounded-lg hover:from-blue-600 hover:to-blue-700 transition-all font-medium flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {connectorStatus === 'installing' ? (
                        <>
                          <Loader className="h-4 w-4 animate-spin" />
                          <span>Installing...</span>
                        </>
                      ) : (
                        <>
                          <Download className="h-4 w-4" />
                          <span>Download & Install</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Features Card */}
                  <div className="bg-slate-900 rounded-xl border border-slate-600 p-6">
                    <h4 className="text-white font-semibold text-lg mb-4">What It Does</h4>
                    
                    <div className="space-y-4">
                      <div className="flex items-start space-x-3">
                        <div className="p-1 bg-green-500/20 rounded">
                          <Shield className="h-4 w-4 text-green-400" />
                        </div>
                        <div>
                          <h5 className="text-white font-medium">Secure Bridge</h5>
                          <p className="text-slate-400 text-sm">Creates an encrypted connection between Pipnosis AI and your MT5 terminal</p>
                        </div>
                      </div>
                      
                      <div className="flex items-start space-x-3">
                        <div className="p-1 bg-blue-500/20 rounded">
                          <Server className="h-4 w-4 text-blue-400" />
                        </div>
                        <div>
                          <h5 className="text-white font-medium">Real-time Data</h5>
                          <p className="text-slate-400 text-sm">Provides live market data and account information to the AI</p>
                        </div>
                      </div>
                      
                      <div className="flex items-start space-x-3">
                        <div className="p-1 bg-purple-500/20 rounded">
                          <Play className="h-4 w-4 text-purple-400" />
                        </div>
                        <div>
                          <h5 className="text-white font-medium">Trade Execution</h5>
                          <p className="text-slate-400 text-sm">Executes AI-generated trades directly in your MT5 account</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                  <div className="flex items-start space-x-3">
                    <AlertCircle className="h-5 w-5 text-amber-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <h4 className="text-amber-300 font-medium">Installation Requirements</h4>
                      <ul className="text-sm text-amber-200 mt-1 space-y-1 list-disc list-inside">
                        <li>Windows 10 or later (64-bit)</li>
                        <li>MetaTrader 5 terminal installed and running</li>
                        <li>Administrator privileges for installation</li>
                        <li>Internet connection for secure communication</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {currentStep === 2 && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-2xl font-semibold text-white mb-2">
                    {isEditingCredentials ? 'Update MT5 Credentials' : 'Configure MT5 Account'}
                  </h3>
                  <p className="text-slate-400 mb-6">
                    {isEditingCredentials 
                      ? 'Update your MetaTrader 5 account credentials. These are stored locally and encrypted for security.'
                      : 'Enter your MetaTrader 5 account credentials. These are stored locally and encrypted for security.'}
                  </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        <User className="h-4 w-4 inline mr-2" />
                        MT5 Account Number
                      </label>
                      <input
                        type="text"
                        value={credentials.login}
                        onChange={(e) => handleCredentialChange('login', e.target.value)}
                        placeholder="e.g., 12345678"
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        <Key className="h-4 w-4 inline mr-2" />
                        MT5 Password
                      </label>
                      <input
                        type="password"
                        value={credentials.password}
                        onChange={(e) => handleCredentialChange('password', e.target.value)}
                        placeholder="Your MT5 password"
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        <Server className="h-4 w-4 inline mr-2" />
                        Broker Server
                      </label>
                      <select
                        value={credentials.server}
                        onChange={(e) => handleCredentialChange('server', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="">Select your broker server</option>
                        {brokerServers.map(server => (
                          <option key={server} value={server}>{server}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Account Type
                      </label>
                      <div className="flex space-x-4">
                        <label className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="radio"
                            name="accountType"
                            value="demo"
                            checked={credentials.accountType === 'demo'}
                            onChange={(e) => handleCredentialChange('accountType', e.target.value)}
                            className="text-blue-500 focus:ring-blue-500"
                          />
                          <span className="text-white">Demo</span>
                        </label>
                        <label className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="radio"
                            name="accountType"
                            value="live"
                            checked={credentials.accountType === 'live'}
                            onChange={(e) => handleCredentialChange('accountType', e.target.value)}
                            className="text-blue-500 focus:ring-blue-500"
                          />
                          <span className="text-white">Live</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="text-white font-medium">Bridge Connection Settings</h4>
                    
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        <Server className="h-4 w-4 inline mr-2" />
                        Bridge Host
                        {window.location.hostname.includes('pipnosis.com') && (
                          <span className="text-xs text-blue-400 ml-1">(Your Public IP)</span>
                        )}
                      </label>
                      <input
                        type="text" 
                        value={credentials.bridgeHost}
                        onChange={(e) => handleCredentialChange('bridgeHost', e.target.value)}
                        placeholder={window.location.hostname.includes('pipnosis.com') ? 
                          "Enter your public IP address" : 
                          "localhost or 127.0.0.1"}
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      {window.location.hostname.includes('pipnosis.com') ? (
                        <p className="text-xs text-slate-500 mt-1">Enter your public IP address (find it at <a href="https://whatismyip.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">whatismyip.com</a>)</p>
                      ) : (
                        <p className="text-xs text-slate-500 mt-1">Your computer's IP address or domain name where the MT5 bridge is running</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        <Server className="h-4 w-4 inline mr-2" />
                        Bridge Port
                      </label>
                      <input
                        type="text"
                        value={credentials.bridgePort}
                        onChange={(e) => handleCredentialChange('bridgePort', e.target.value)}
                        placeholder="e.g., 8765"
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      <p className="text-xs text-slate-500 mt-1">Default is 8765. Change only if you modified the bridge port.</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                      <div className="flex items-start space-x-3">
                        <Shield className="h-5 w-5 text-blue-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <h4 className="text-blue-300 font-medium">Security Notice</h4>
                          <p className="text-sm text-blue-200 mt-1">
                            Your credentials are encrypted locally using AES-256 encryption and never transmitted to our servers. 
                            Only trade metadata is sent for AI analysis.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                      <h4 className="text-green-300 font-medium mb-2">What We Access</h4>
                      <ul className="text-sm text-green-200 space-y-1">
                        <li>• Account balance and equity</li>
                        <li>• Open positions and trade history</li>
                        <li>• Real-time price data</li>
                        <li>• Trade execution capabilities</li>
                      </ul>
                    </div>

                    <div className="p-4 bg-slate-900 border border-slate-600 rounded-lg">
                      <h4 className="text-white font-medium mb-2">Need Help Finding Your Details?</h4>
                      <div className="space-y-2 text-sm text-slate-300">
                        <p><strong>Login:</strong> Found in MT5 Navigator → Accounts</p>
                        <p><strong>Server:</strong> Shown in MT5 terminal title bar</p>
                        <p><strong>Password:</strong> Set when opening your account</p>
                      </div>
                      <button className="mt-3 text-blue-400 hover:text-blue-300 text-sm flex items-center space-x-1">
                        <ExternalLink className="h-3 w-3" />
                        <span>View Setup Guide</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end space-x-3">
                  {isEditingCredentials ? (
                    <>
                      <button
                        onClick={() => setIsEditingCredentials(false)}
                        className="px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveCredentials}
                        disabled={!credentials.login || !credentials.bridgeHost || !credentials.bridgePort}
                        className="px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
                      >
                        <Save className="h-4 w-4" />
                        <span>Save Credentials</span>
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={handleNextStep}
                      disabled={!credentials.login || !credentials.bridgeHost || !credentials.bridgePort}
                      className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                    >
                      Test Connection
                    </button>
                  )}
                </div>
              </div>
            )}

            {currentStep === 3 && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-2xl font-semibold text-white mb-2">Test Connection</h3>
                  <p className="text-slate-400 mb-6">
                    Verifying the connection between Pipnosis AI and your MT5 account.
                  </p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-600 p-6">
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-300 font-medium">MT5 Terminal Connection</span>
                      <div className="flex items-center space-x-2">
                        {connectionStatus === 'connecting' && (
                          <>
                            <Loader className="h-4 w-4 text-blue-400 animate-spin" />
                            <span className="text-blue-400 text-sm">Testing connection...</span>
                          </>
                        )}
                        {connectionStatus === 'connected' && (
                          <>
                            <CheckCircle className="h-4 w-4 text-green-400" />
                            <span className="text-green-400 text-sm">Connected</span>
                          </>
                        )}
                        {connectionStatus === 'error' && (
                          <>
                            <AlertCircle className="h-4 w-4 text-red-400" />
                            <span className="text-red-400 text-sm">Connection Failed</span>
                          </>
                        )}
                        {connectionStatus === 'idle' && (
                          <span className="text-slate-400 text-sm">Ready to test</span>
                        )}
                      </div>
                    </div>

                    {connectionStatus === 'connected' && (
                      <div className="grid grid-cols-2 gap-4 p-4 bg-slate-800 rounded-lg">
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-slate-400">Account:</span>
                            <span className="text-white font-mono">{credentials.login}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Server:</span>
                            <span className="text-white">{credentials.server}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Type:</span>
                            <span className="text-white capitalize">{credentials.accountType}</span>
                          </div>
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-slate-400">Bridge Host:</span>
                            <span className="text-white">{credentials.bridgeHost}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Bridge Port:</span>
                            <span className="text-white">{credentials.bridgePort}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Status:</span>
                            <span className="text-green-400">Connected</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {connectionStatus === 'error' && (
                      <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                        <h4 className="text-red-300 font-medium mb-2">Connection Failed</h4>
                        <p className="text-red-200 text-sm mb-3">
                          {error || 'Unable to connect to your MT5 account. Please check:'}
                        </p>
                        <ul className="text-red-200 text-sm space-y-1 list-disc list-inside">
                          <li>MT5 terminal is running and logged in</li>
                          <li>MT5 bridge is running on your computer</li>
                          <li>Bridge host and port are correct</li>
                          <li>If using a public IP, check port forwarding on your router</li>
                          <li>Internet connection is stable</li>
                        </ul>
                      </div>
                    )}

                    <div className="flex space-x-3">
                      <button
                        onClick={handleTestConnection}
                        disabled={connectionStatus === 'connecting'}
                        className="flex-1 bg-blue-500 text-white py-3 px-4 rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                      >
                        {connectionStatus === 'connecting' ? 'Testing Connection...' : 'Test Connection'}
                      </button>
                      
                      {connectionStatus === 'error' && (
                        <button
                          onClick={() => setCurrentStep(2)}
                          className="px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors"
                        >
                          Edit Connection Settings
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {currentStep === 4 && (
              <div className="space-y-6">
                <div className="text-center">
                  <div className="p-6 bg-green-500/20 rounded-full w-24 h-24 mx-auto mb-6 flex items-center justify-center">
                    <CheckCircle className="h-12 w-12 text-green-400" />
                  </div>
                  <h3 className="text-3xl font-semibold text-white mb-2">Ready to Trade!</h3>
                  <p className="text-slate-400 mb-8">
                    Your MT5 account is now securely connected to Pipnosis AI. You can start using prompts to execute trades.
                  </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-slate-900 rounded-xl border border-slate-600 p-6">
                    <h4 className="text-white font-semibold mb-4 flex items-center space-x-2">
                      <Play className="h-5 w-5 text-green-400" />
                      <span>What happens next:</span>
                    </h4>
                    <div className="space-y-4">
                      <div className="flex items-start space-x-3">
                        <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold">1</div>
                        <div>
                          <p className="text-white font-medium">Real-time Data Access</p>
                          <p className="text-slate-400 text-sm">AI can now pull live OHLCV data and account information</p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-3">
                        <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold">2</div>
                        <div>
                          <p className="text-white font-medium">Intelligent Position Sizing</p>
                          <p className="text-slate-400 text-sm">Automatic risk calculation based on your account balance</p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-3">
                        <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold">3</div>
                        <div>
                          <p className="text-white font-medium">Trade Execution</p>
                          <p className="text-slate-400 text-sm">Market orders, SL/TP management, and position monitoring</p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-3">
                        <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold">4</div>
                        <div>
                          <p className="text-white font-medium">AI Decision Logging</p>
                          <p className="text-slate-400 text-sm">Real-time explanations and trade journal updates</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-900 rounded-xl border border-slate-600 p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-white font-semibold">Connection Information</h4>
                      <button 
                        onClick={handleEditCredentials}
                        className="p-1.5 text-blue-400 hover:text-blue-300 hover:bg-blue-500/20 rounded transition-colors"
                        title="Edit credentials"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                    </div>
                    
                    <div className="p-4 bg-slate-800 rounded-lg mb-4">
                      <div className="grid grid-cols-2 gap-y-3 text-sm">
                        <div>
                          <span className="text-slate-400">Account:</span>
                          <span className="text-white ml-2 font-mono">{credentials.login}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Server:</span>
                          <span className="text-white ml-2">{credentials.server}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Bridge Host:</span>
                          <span className="text-white ml-2">{credentials.bridgeHost}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Bridge Port:</span>
                          <span className="text-white ml-2">{credentials.bridgePort}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Type:</span>
                          <span className="text-white ml-2 capitalize">{credentials.accountType}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Status:</span>
                          <span className="text-green-400 ml-2">Connected</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                        <p className="text-blue-200 italic text-sm">
                          "Make me $300 this week with medium risk."
                        </p>
                      </div>
                      <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                        <p className="text-green-200 italic text-sm">
                          "Find the best EURUSD scalping opportunity right now."
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-center">
                  <button
                    onClick={onClose}
                    className="px-8 py-3 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg hover:from-green-600 hover:to-green-700 transition-all font-medium shadow-lg"
                  >
                    Start Trading with AI
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
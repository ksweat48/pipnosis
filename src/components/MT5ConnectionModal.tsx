import React, { useState } from 'react';
import { X, Download, CheckCircle, AlertCircle, Loader, Shield, Server, Key, User } from 'lucide-react';

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
  const [credentials, setCredentials] = useState({
    login: '',
    password: '',
    server: '',
    accountType: 'demo'
  });

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
    'Custom Server'
  ];

  const steps: ConnectionStep[] = [
    {
      id: 1,
      title: 'Connect Your MT5 Account',
      description: 'Enter your MetaTrader 5 credentials',
      completed: currentStep > 1,
      active: currentStep === 1
    },
    {
      id: 2,
      title: 'Install Pipnosis Connector',
      description: 'Download and run the bridge application',
      completed: currentStep > 2,
      active: currentStep === 2
    },
    {
      id: 3,
      title: 'Verify Connection',
      description: 'Test the connection and sync data',
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

  const handleCredentialChange = (field: string, value: string) => {
    setCredentials(prev => ({ ...prev, [field]: value }));
  };

  const handleTestConnection = async () => {
    setConnectionStatus('connecting');
    
    // Simulate connection test
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Simulate success/failure
    const success = Math.random() > 0.3; // 70% success rate for demo
    setConnectionStatus(success ? 'connected' : 'error');
    
    if (success) {
      setCurrentStep(4);
    }
  };

  const handleDownloadConnector = () => {
    // In a real implementation, this would trigger the download
    console.log('Downloading Pipnosis Connector...');
    setCurrentStep(3);
  };

  const handleNextStep = () => {
    if (currentStep < 4) {
      setCurrentStep(currentStep + 1);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-4xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <div className="flex items-center space-x-3">
            <Server className="h-6 w-6 text-blue-400" />
            <h2 className="text-xl font-semibold text-white">Connect MetaTrader 5</h2>
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
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
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

            {connectionStatus === 'connected' && (
              <div className="mt-6 p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                <div className="flex items-center space-x-2 text-green-400">
                  <CheckCircle className="h-4 w-4" />
                  <span className="text-sm font-medium">Connection Successful</span>
                </div>
                <p className="text-xs text-green-300 mt-1">
                  Your MT5 account is now synced with Pipnosis AI
                </p>
              </div>
            )}
          </div>

          {/* Main Content */}
          <div className="flex-1 p-6 overflow-y-auto">
            {currentStep === 1 && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-white mb-2">Enter MT5 Account Details</h3>
                  <p className="text-slate-400 mb-6">
                    Securely connect your MetaTrader 5 demo or live account to enable AI trading.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      <User className="h-4 w-4 inline mr-2" />
                      MT5 Login (Account Number)
                    </label>
                    <input
                      type="text"
                      value={credentials.login}
                      onChange={(e) => handleCredentialChange('login', e.target.value)}
                      placeholder="e.g., 12345678"
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
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

                <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                  <div className="flex items-start space-x-3">
                    <Shield className="h-5 w-5 text-blue-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <h4 className="text-blue-300 font-medium">Security Notice</h4>
                      <p className="text-sm text-blue-200 mt-1">
                        Your credentials are stored locally and encrypted. Pipnosis never sends your login details to the cloud.
                        Only trade metadata is transmitted for AI analysis.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={handleNextStep}
                    disabled={!credentials.login || !credentials.password || !credentials.server}
                    className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {currentStep === 2 && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-white mb-2">Install Pipnosis Connector</h3>
                  <p className="text-slate-400 mb-6">
                    Download and run the Pipnosis Connector app to securely bridge your MT5 terminal with our AI.
                  </p>
                </div>

                <div className="bg-slate-900 rounded-lg border border-slate-600 p-6">
                  <div className="flex items-center space-x-4 mb-4">
                    <div className="p-3 bg-blue-500/20 rounded-lg">
                      <Download className="h-8 w-8 text-blue-400" />
                    </div>
                    <div>
                      <h4 className="text-white font-semibold">Pipnosis Connector v2.1.0</h4>
                      <p className="text-slate-400 text-sm">Windows application (15.2 MB)</p>
                    </div>
                  </div>

                  <div className="space-y-3 mb-6">
                    <div className="flex items-center space-x-2 text-sm text-slate-300">
                      <CheckCircle className="h-4 w-4 text-green-400" />
                      <span>Runs the Python bridge in the background</span>
                    </div>
                    <div className="flex items-center space-x-2 text-sm text-slate-300">
                      <CheckCircle className="h-4 w-4 text-green-400" />
                      <span>Launches on startup automatically</span>
                    </div>
                    <div className="flex items-center space-x-2 text-sm text-slate-300">
                      <CheckCircle className="h-4 w-4 text-green-400" />
                      <span>Secure encrypted authentication</span>
                    </div>
                    <div className="flex items-center space-x-2 text-sm text-slate-300">
                      <CheckCircle className="h-4 w-4 text-green-400" />
                      <span>Auto-update functionality</span>
                    </div>
                  </div>

                  <button
                    onClick={handleDownloadConnector}
                    className="w-full bg-blue-500 text-white py-3 px-4 rounded-lg hover:bg-blue-600 transition-colors font-medium flex items-center justify-center space-x-2"
                  >
                    <Download className="h-4 w-4" />
                    <span>Download Pipnosis Connector</span>
                  </button>
                </div>

                <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                  <div className="flex items-start space-x-3">
                    <AlertCircle className="h-5 w-5 text-yellow-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <h4 className="text-yellow-300 font-medium">Installation Instructions</h4>
                      <ol className="text-sm text-yellow-200 mt-1 space-y-1 list-decimal list-inside">
                        <li>Download and run the installer as Administrator</li>
                        <li>Follow the setup wizard (default settings recommended)</li>
                        <li>The connector will start automatically after installation</li>
                        <li>Return here to complete the connection setup</li>
                      </ol>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {currentStep === 3 && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-white mb-2">Verify Connection</h3>
                  <p className="text-slate-400 mb-6">
                    Test the connection between Pipnosis AI and your MT5 account.
                  </p>
                </div>

                <div className="bg-slate-900 rounded-lg border border-slate-600 p-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-300">MT5 Terminal Connection</span>
                      <div className="flex items-center space-x-2">
                        {connectionStatus === 'connecting' && (
                          <>
                            <Loader className="h-4 w-4 text-blue-400 animate-spin" />
                            <span className="text-blue-400 text-sm">Testing...</span>
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
                            <span className="text-red-400 text-sm">Failed</span>
                          </>
                        )}
                        {connectionStatus === 'idle' && (
                          <span className="text-slate-400 text-sm">Ready to test</span>
                        )}
                      </div>
                    </div>

                    {connectionStatus === 'connected' && (
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
                          <span className="text-slate-400">Balance:</span>
                          <span className="text-green-400 font-semibold">$10,000.00</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Equity:</span>
                          <span className="text-white">$10,000.00</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Free Margin:</span>
                          <span className="text-white">$10,000.00</span>
                        </div>
                      </div>
                    )}

                    {connectionStatus === 'error' && (
                      <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                        <p className="text-red-300 text-sm">
                          Connection failed. Please check your credentials and ensure MT5 terminal is running.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="mt-6 flex space-x-3">
                    <button
                      onClick={handleTestConnection}
                      disabled={connectionStatus === 'connecting'}
                      className="flex-1 bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {connectionStatus === 'connecting' ? 'Testing Connection...' : 'Test Connection'}
                    </button>
                    
                    {connectionStatus === 'error' && (
                      <button
                        onClick={() => setCurrentStep(1)}
                        className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors"
                      >
                        Edit Credentials
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {currentStep === 4 && (
              <div className="space-y-6">
                <div className="text-center">
                  <div className="p-4 bg-green-500/20 rounded-full w-20 h-20 mx-auto mb-4 flex items-center justify-center">
                    <CheckCircle className="h-10 w-10 text-green-400" />
                  </div>
                  <h3 className="text-2xl font-semibold text-white mb-2">Ready to Trade!</h3>
                  <p className="text-slate-400 mb-6">
                    Your MT5 account is now synced with Pipnosis AI. You can start using prompts to execute trades.
                  </p>
                </div>

                <div className="bg-slate-900 rounded-lg border border-slate-600 p-6">
                  <h4 className="text-white font-semibold mb-4">What happens next:</h4>
                  <div className="space-y-3">
                    <div className="flex items-start space-x-3">
                      <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold">1</div>
                      <div>
                        <p className="text-white font-medium">Pipnosis AI can pull real-time chart data</p>
                        <p className="text-slate-400 text-sm">Live OHLCV data for analysis and decision making</p>
                      </div>
                    </div>
                    <div className="flex items-start space-x-3">
                      <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold">2</div>
                      <div>
                        <p className="text-white font-medium">AI assesses balance and risk profile</p>
                        <p className="text-slate-400 text-sm">Automatic position sizing based on your account</p>
                      </div>
                    </div>
                    <div className="flex items-start space-x-3">
                      <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold">3</div>
                      <div>
                        <p className="text-white font-medium">Execute trades dynamically</p>
                        <p className="text-slate-400 text-sm">Market orders, SL/TP management, trailing stops</p>
                      </div>
                    </div>
                    <div className="flex items-start space-x-3">
                      <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold">4</div>
                      <div>
                        <p className="text-white font-medium">Log journal entries back to dashboard</p>
                        <p className="text-slate-400 text-sm">Real-time AI decision explanations and updates</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                  <h4 className="text-blue-300 font-medium mb-2">Example Prompt:</h4>
                  <p className="text-blue-200 italic">
                    "Make me $300 this week with medium risk."
                  </p>
                  <p className="text-blue-200 text-sm mt-2">
                    AI will calculate assets to trade, entry/SL/TP levels, position sizing, and execute via your MT5 account.
                  </p>
                </div>

                <div className="flex justify-center">
                  <button
                    onClick={onClose}
                    className="px-8 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium"
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
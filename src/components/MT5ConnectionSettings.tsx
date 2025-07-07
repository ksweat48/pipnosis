import React, { useState, useEffect } from 'react';
import { Server, Save, RefreshCw, AlertCircle, CheckCircle, Globe } from 'lucide-react';
import { mt5Client } from '../services/mt5WebSocketClient';

interface MT5ConnectionSettingsProps {
  onSave?: () => void;
  onCancel?: () => void;
  className?: string;
}

export const MT5ConnectionSettings: React.FC<MT5ConnectionSettingsProps> = ({ 
  onSave, 
  onCancel,
  className = "" 
}) => {
  const [settings, setSettings] = useState({
    bridgeHost: '',
    bridgePort: '8765'
  });
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Load current settings
  useEffect(() => {
    try {
      // Set default bridge host based on environment
      const defaultHost = window.location.hostname === 'pipnosis.com' ? '' : 'localhost';
      setSettings(prev => ({
        ...prev,
        bridgeHost: defaultHost
      }));
      
      const accountData = localStorage.getItem('pipnosis_mt5_account');
      if (accountData) {
        const data = JSON.parse(accountData);
        if (data.bridgeHost && data.bridgePort) {
          setSettings({
            bridgeHost: data.bridgeHost,
            bridgePort: data.bridgePort.toString()
          });
        }
      }
    } catch (error) {
      console.error('Error loading MT5 account data:', error);
    }
  }, []);

  const handleInputChange = (field: string, value: string) => {
    setSettings(prev => ({ ...prev, [field]: value }));
    setTestResult(null);
  };

  const testConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    
    try {
      // Check if we're in WebContainer environment
      if (window.location.hostname.includes('webcontainer-api.io') || 
          window.location.hostname.includes('local-credentialless') ||
          window.location.hostname.includes('bolt.new') ||
          window.location.hostname.includes('stackblitz')) {
        setTestResult({
          success: false,
          message: 'MT5 connection is not available in this preview environment. Please run the application locally to connect to MT5.'
        });
        return;
      }
      
      // Configure the MT5 client with the provided host and port
      mt5Client.configure(settings.bridgeHost, parseInt(settings.bridgePort, 10));
      
      // Test connection
      const result = await mt5Client.testConnection();
      
      if (result.success) {
        setTestResult({
          success: true,
          message: 'Successfully connected to MT5 bridge!'
        });
      } else {
        setTestResult({
          success: false,
          message: result.error || 'Failed to connect to MT5 bridge'
        });
      }
    } catch (error) {
      console.error('Connection test error:', error);
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown connection error'
      });
    } finally {
      setIsTesting(false);
    }
  };

  const saveSettings = () => {
    setIsSaving(true);
    
    try {
      // Get existing account data
      const accountData = localStorage.getItem('pipnosis_mt5_account');
      let data = accountData ? JSON.parse(accountData) : {};
      
      // Update with new settings
      data = {
        ...data,
        bridgeHost: settings.bridgeHost,
        bridgePort: settings.bridgePort,
        lastUpdate: new Date().toISOString()
      };
      
      // Save to localStorage
      localStorage.setItem('pipnosis_mt5_account', JSON.stringify(data));
      
      // Configure the MT5 client with the new settings
      mt5Client.configure(settings.bridgeHost, parseInt(settings.bridgePort, 10));
      
      // Call onSave callback if provided
      if (onSave) {
        onSave();
      }
    } catch (error) {
      console.error('Error saving MT5 connection settings:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={`bg-slate-800 rounded-lg border border-slate-700 p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <Server className="h-5 w-5 text-blue-400" />
          <h4 className="text-white font-medium">MT5 Bridge Connection</h4>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            <Server className="h-4 w-4 inline mr-2" />
            Bridge Host
            {window.location.hostname === 'pipnosis.com' && (
              <span className="text-xs text-blue-400 ml-1">(Your Public IP)</span>
            )}
          </label>
          <input
            type="text"
            value={settings.bridgeHost}
            onChange={(e) => handleInputChange('bridgeHost', e.target.value)}
            placeholder="e.g., 192.168.1.100 or your public IP"
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {window.location.hostname === 'pipnosis.com' ? (
            <p className="text-xs text-slate-500 mt-1">Enter your public IP address (find it at <a href="https://whatismyip.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">whatismyip.com</a>)</p>
          ) : (
            <p className="text-xs text-slate-500 mt-1">Your computer's IP address or domain name where the MT5 bridge is running</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Bridge Port
          </label>
          <input
            type="text"
            value={settings.bridgePort}
            onChange={(e) => handleInputChange('bridgePort', e.target.value)}
            placeholder="e.g., 8765"
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <p className="text-xs text-slate-500 mt-1">Default is 8765. Change only if you modified the bridge port.</p>
        </div>

        {testResult && (
          <div className={`p-3 rounded-lg border ${
            testResult.success 
              ? 'bg-green-500/10 border-green-500/30 text-green-300' 
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}>
            <div className="flex items-start space-x-2">
              {testResult.success ? (
                <CheckCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              )}
              <div>
                <p className="font-medium">{testResult.success ? 'Connection Successful' : 'Connection Failed'}</p>
                <p className="text-sm mt-1">{testResult.message}</p>
              </div>
            </div>
          </div>
        )}

        <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <div className="flex items-start space-x-2">
            <Globe className="h-4 w-4 text-blue-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-blue-300 text-sm font-medium">Production Setup</p>
              <p className="text-blue-200 text-xs mt-1">
                For production use, you need to set up port forwarding on your router to make your MT5 bridge accessible from the internet.
                Use your public IP address or domain name as the Bridge Host.
              </p>
            </div>
          </div>
        </div>

        <div className="flex space-x-3 pt-2">
          <button
            onClick={testConnection}
            disabled={isTesting}
            className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
          >
            {isTesting ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span>Testing...</span>
              </>
            ) : (
              <>
                <Wifi className="h-4 w-4" />
                <span>Test Connection</span>
              </>
            )}
          </button>
          
          <button
            onClick={saveSettings}
            disabled={isSaving}
            className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
          >
            {isSaving ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                <span>Save Settings</span>
              </>
            )}
          </button>
          
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
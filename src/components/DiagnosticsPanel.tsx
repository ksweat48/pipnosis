import { useState } from 'react';
import { Activity, RefreshCw, CheckCircle, XCircle, AlertCircle, Copy, Terminal } from 'lucide-react';
import { metaApiDiagnostics, DiagnosticResult } from '@/utils/metaapi-diagnostics';

export function DiagnosticsPanel() {
  const [diagnostics, setDiagnostics] = useState<DiagnosticResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [showRawData, setShowRawData] = useState(false);

  const runDiagnostics = async () => {
    setIsRunning(true);
    try {
      const result = await metaApiDiagnostics.runFullDiagnostics();
      setDiagnostics(result);
    } catch (error) {
      console.error('Diagnostics failed:', error);
    } finally {
      setIsRunning(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const getStatusIcon = (success: boolean) => {
    return success ? (
      <CheckCircle className="w-5 h-5 text-green-500" />
    ) : (
      <XCircle className="w-5 h-5 text-red-500" />
    );
  };

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-blue-400" />
          <h2 className="text-xl font-bold text-white">MetaAPI Diagnostics</h2>
        </div>
        <button
          onClick={runDiagnostics}
          disabled={isRunning}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-lg transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${isRunning ? 'animate-spin' : ''}`} />
          {isRunning ? 'Running...' : 'Run Diagnostics'}
        </button>
      </div>

      {!diagnostics && !isRunning && (
        <div className="text-center py-12 text-gray-400">
          <Terminal className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Click "Run Diagnostics" to test your MetaAPI connection</p>
        </div>
      )}

      {isRunning && (
        <div className="text-center py-12">
          <RefreshCw className="w-12 h-12 mx-auto mb-4 text-blue-400 animate-spin" />
          <p className="text-gray-400">Running diagnostics...</p>
        </div>
      )}

      {diagnostics && !isRunning && (
        <div className="space-y-6">
          <div className={`p-4 rounded-lg border ${
            diagnostics.success
              ? 'bg-green-900/20 border-green-700/30'
              : 'bg-red-900/20 border-red-700/30'
          }`}>
            <div className="flex items-center gap-3 mb-2">
              {getStatusIcon(diagnostics.success)}
              <span className="text-lg font-semibold text-white">
                {diagnostics.success ? 'All Systems Operational' : 'Issues Detected'}
              </span>
            </div>
            <p className="text-sm text-gray-400">
              Test completed at {new Date(diagnostics.timestamp).toLocaleString()}
            </p>
          </div>

          {diagnostics.errors.length > 0 && (
            <div className="bg-red-900/20 border border-red-700/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <XCircle className="w-5 h-5 text-red-400" />
                <h3 className="font-semibold text-red-400">Errors</h3>
              </div>
              <ul className="space-y-1 text-sm text-red-300">
                {diagnostics.errors.map((error, index) => (
                  <li key={index}>• {error}</li>
                ))}
              </ul>
            </div>
          )}

          {diagnostics.warnings.length > 0 && (
            <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle className="w-5 h-5 text-yellow-400" />
                <h3 className="font-semibold text-yellow-400">Warnings</h3>
              </div>
              <ul className="space-y-1 text-sm text-yellow-300">
                {diagnostics.warnings.map((warning, index) => (
                  <li key={index}>• {warning}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="font-semibold text-white mb-3">Token Manager</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Has Token:</span>
                  <span className={diagnostics.results.tokenManager?.hasToken ? 'text-green-400' : 'text-red-400'}>
                    {diagnostics.results.tokenManager?.hasToken ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Type:</span>
                  <span className="text-white font-mono">
                    {diagnostics.results.tokenManager?.isAdminToken ? 'Admin' : 'Temporary'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Valid:</span>
                  <span className={diagnostics.results.tokenManager?.isValid ? 'text-green-400' : 'text-red-400'}>
                    {diagnostics.results.tokenManager?.isValid ? 'Yes' : 'No'}
                  </span>
                </div>
                {diagnostics.results.tokenManager?.expiresInMinutes !== null && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Expires:</span>
                    <span className="text-white font-mono">
                      {diagnostics.results.tokenManager.expiresInMinutes} min
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-400">Region:</span>
                  <span className="text-white font-mono">
                    {diagnostics.results.tokenManager?.region}
                  </span>
                </div>
              </div>
            </div>

            {diagnostics.results.edgeFunction && (
              <div className="bg-gray-800 rounded-lg p-4">
                <h3 className="font-semibold text-white mb-3">Edge Function</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Status:</span>
                    <span className="text-white">
                      {diagnostics.results.edgeFunction.status}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Token Format:</span>
                    <span className="text-white font-mono">
                      {diagnostics.results.edgeFunction.checks?.tokenFormat}
                    </span>
                  </div>
                  {diagnostics.results.edgeFunction.checks?.metaApiConnectivity && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-gray-400">MetaAPI:</span>
                        <span className={diagnostics.results.edgeFunction.checks.metaApiConnectivity.success ? 'text-green-400' : 'text-red-400'}>
                          {diagnostics.results.edgeFunction.checks.metaApiConnectivity.success ? 'Connected' : 'Failed'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Response Time:</span>
                        <span className="text-white font-mono">
                          {diagnostics.results.edgeFunction.checks.metaApiConnectivity.responseTime}ms
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <button
              onClick={() => setShowRawData(!showRawData)}
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              {showRawData ? 'Hide' : 'Show'} Raw Data
            </button>

            {showRawData && (
              <div className="bg-gray-800 rounded-lg p-4 relative">
                <button
                  onClick={() => copyToClipboard(JSON.stringify(diagnostics, null, 2))}
                  className="absolute top-2 right-2 p-2 text-gray-400 hover:text-white"
                  title="Copy to clipboard"
                >
                  <Copy className="w-4 h-4" />
                </button>
                <pre className="text-xs text-gray-300 overflow-x-auto">
                  {JSON.stringify(diagnostics, null, 2)}
                </pre>
              </div>
            )}
          </div>

          <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-4">
            <h3 className="font-semibold text-blue-400 mb-2">Console Commands</h3>
            <div className="space-y-1 text-sm text-gray-300 font-mono">
              <div>• window.testMetaAPIConnection()</div>
              <div>• window.getTokenInfo()</div>
              <div>• window.clearTokenCache()</div>
              <div>• window.testEdgeFunction(true)</div>
              <div>• window.getMetaAPIHealth()</div>
              <div>• window.validateTokenFormat()</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

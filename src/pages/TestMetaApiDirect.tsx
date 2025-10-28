import React, { useState } from 'react';
import { AlertCircle, CheckCircle, Loader2, Play } from 'lucide-react';

/**
 * DIRECT METAAPI TEST PAGE
 *
 * This page calls the bare-bones test function to check MetaAPI directly.
 * NO PIPNOSIS CODE INVOLVED - Pure process of elimination.
 */

interface TestResult {
  success: boolean;
  test: string;
  result: string;
  details?: any;
  error?: any;
}

export default function TestMetaApiDirect() {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      console.log('🧪 Starting direct MetaAPI test...');

      const response = await fetch('/.netlify/functions/test-metaapi-direct');
      const data = await response.json();

      console.log('Test result:', data);
      setTestResult(data);
    } catch (error: any) {
      console.error('Test failed:', error);
      setTestResult({
        success: false,
        test: 'DIRECT_METAAPI_CONNECTION',
        result: '🔴 RED LIGHT - Request failed',
        error: {
          message: error.message
        }
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">MetaAPI Direct Connection Test</h1>
          <p className="text-gray-400">
            This test bypasses all Pipnosis code and connects directly to MetaAPI.
          </p>
          <p className="text-gray-400 mt-1">
            <strong>Process of Elimination:</strong> If this shows 🟢 GREEN = Pipnosis code issue. If 🔴 RED = MetaAPI issue.
          </p>
        </div>

        {/* Test Button */}
        <div className="mb-8">
          <button
            onClick={runTest}
            disabled={testing}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
          >
            {testing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Testing Connection...
              </>
            ) : (
              <>
                <Play className="w-5 h-5" />
                Run Direct Test
              </>
            )}
          </button>
        </div>

        {/* Results */}
        {testResult && (
          <div className="space-y-4">
            {/* Result Banner */}
            <div
              className={`p-6 rounded-lg border-2 ${
                testResult.success
                  ? 'bg-green-900/20 border-green-500'
                  : 'bg-red-900/20 border-red-500'
              }`}
            >
              <div className="flex items-center gap-3 mb-3">
                {testResult.success ? (
                  <CheckCircle className="w-8 h-8 text-green-500" />
                ) : (
                  <AlertCircle className="w-8 h-8 text-red-500" />
                )}
                <h2 className="text-2xl font-bold">{testResult.result}</h2>
              </div>
              <p className="text-lg">Test: {testResult.test}</p>
            </div>

            {/* Success Details */}
            {testResult.success && testResult.details && (
              <div className="bg-gray-800 rounded-lg p-6">
                <h3 className="text-xl font-bold mb-4 text-green-400">✅ Connection Details</h3>

                <div className="space-y-4">
                  {/* Account Info */}
                  <div>
                    <h4 className="font-semibold text-gray-300 mb-2">Account Information</h4>
                    <pre className="bg-gray-900 p-4 rounded overflow-x-auto text-sm">
                      {JSON.stringify(testResult.details.accountInfo, null, 2)}
                    </pre>
                  </div>

                  {/* Symbol Count */}
                  <div>
                    <h4 className="font-semibold text-gray-300 mb-2">Available Symbols</h4>
                    <p className="text-2xl font-bold text-green-400">
                      {testResult.details.symbolCount} symbols available
                    </p>
                  </div>

                  {/* Current Price */}
                  <div>
                    <h4 className="font-semibold text-gray-300 mb-2">EURUSD Current Price</h4>
                    <pre className="bg-gray-900 p-4 rounded overflow-x-auto text-sm">
                      {JSON.stringify(testResult.details.currentPrice, null, 2)}
                    </pre>
                  </div>

                  {/* Configuration */}
                  <div>
                    <h4 className="font-semibold text-gray-300 mb-2">Configuration</h4>
                    <div className="bg-gray-900 p-4 rounded space-y-1 text-sm">
                      <p><strong>Region:</strong> {testResult.details.region}</p>
                      <p><strong>Account ID:</strong> {testResult.details.accountId}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-6 p-4 bg-green-900/30 border border-green-500 rounded">
                  <p className="text-green-400 font-semibold">
                    ✅ MetaAPI is working correctly! The issue is in the Pipnosis integration code.
                  </p>
                </div>
              </div>
            )}

            {/* Error Details */}
            {!testResult.success && testResult.error && (
              <div className="bg-gray-800 rounded-lg p-6">
                <h3 className="text-xl font-bold mb-4 text-red-400">❌ Error Details</h3>

                <div className="space-y-4">
                  <div>
                    <h4 className="font-semibold text-gray-300 mb-2">Error Message</h4>
                    <p className="bg-gray-900 p-4 rounded text-red-400">
                      {testResult.error.message}
                    </p>
                  </div>

                  {testResult.error.statusCode && (
                    <div>
                      <h4 className="font-semibold text-gray-300 mb-2">Status Code</h4>
                      <p className="bg-gray-900 p-4 rounded text-red-400">
                        {testResult.error.statusCode}
                      </p>
                    </div>
                  )}

                  {testResult.error.response && (
                    <div>
                      <h4 className="font-semibold text-gray-300 mb-2">Response</h4>
                      <pre className="bg-gray-900 p-4 rounded overflow-x-auto text-sm text-red-400">
                        {JSON.stringify(testResult.error.response, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>

                <div className="mt-6 p-4 bg-red-900/30 border border-red-500 rounded">
                  <p className="text-red-400 font-semibold mb-2">
                    ❌ MetaAPI connection failed! Possible causes:
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>Invalid or expired MetaAPI token</li>
                    <li>Incorrect account ID</li>
                    <li>Wrong region configured</li>
                    <li>Account not deployed/connected in MetaAPI dashboard</li>
                    <li>Network/firewall blocking MetaAPI</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Instructions */}
        {!testResult && !testing && (
          <div className="bg-gray-800 rounded-lg p-6">
            <h3 className="text-xl font-bold mb-4">What This Test Does</h3>
            <ul className="space-y-2 text-gray-300">
              <li className="flex items-start gap-2">
                <span className="text-blue-400 font-bold">1.</span>
                <span>Retrieves MetaAPI credentials from environment variables</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400 font-bold">2.</span>
                <span>Makes a direct HTTPS request to MetaAPI (no Pipnosis code)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400 font-bold">3.</span>
                <span>Tests: Account info, available symbols, and current EURUSD price</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400 font-bold">4.</span>
                <span>Shows 🟢 GREEN if MetaAPI works, 🔴 RED if it fails</span>
              </li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

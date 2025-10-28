import React, { useState } from 'react';
import { AlertCircle, CheckCircle, Loader2, Play, Key, Lock, Unlock } from 'lucide-react';

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
  const [manualToken, setManualToken] = useState('');
  const [manualAccountId, setManualAccountId] = useState('');
  const [manualRegion, setManualRegion] = useState('london');
  const [useManualToken, setUseManualToken] = useState(false);
  const [showToken, setShowToken] = useState(false);

  const runTest = async (useManual: boolean = false) => {
    setTesting(true);
    setTestResult(null);

    try {
      console.log('🧪 Starting direct MetaAPI test...');

      let response;
      if (useManual && manualToken) {
        console.log('🔑 Using manual token input');
        console.log(`  Token length: ${manualToken.length}`);
        console.log(`  Account ID: ${manualAccountId || 'from environment'}`);
        console.log(`  Region: ${manualRegion}`);

        response = await fetch('/.netlify/functions/test-metaapi-direct', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            token: manualToken,
            accountId: manualAccountId || undefined,
            region: manualRegion
          })
        });
      } else {
        console.log('🔑 Using environment variables');
        response = await fetch('/.netlify/functions/test-metaapi-direct');
      }

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

        {/* Manual Token Input Section */}
        <div className="mb-8 bg-gray-800 rounded-lg p-6 border-2 border-yellow-600">
          <div className="flex items-center gap-3 mb-4">
            <Key className="w-6 h-6 text-yellow-500" />
            <h2 className="text-xl font-bold">Manual Token Testing</h2>
          </div>

          <div className="bg-yellow-900/20 border border-yellow-600 rounded p-4 mb-4">
            <p className="text-yellow-200 text-sm">
              ⚠️ <strong>Security Warning:</strong> Only use this in a secure environment. Do not share screenshots containing your token.
            </p>
          </div>

          <div className="flex items-center gap-2 mb-4">
            <input
              type="checkbox"
              id="useManualToken"
              checked={useManualToken}
              onChange={(e) => setUseManualToken(e.target.checked)}
              className="w-4 h-4"
            />
            <label htmlFor="useManualToken" className="text-gray-300">
              Use manual token input (bypasses environment variables)
            </label>
          </div>

          {useManualToken && (
            <div className="space-y-4 animate-fadeIn">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  MetaAPI Token
                </label>
                <div className="relative">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={manualToken}
                    onChange={(e) => setManualToken(e.target.value)}
                    placeholder="Enter your MetaAPI token"
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white"
                  >
                    {showToken ? <Unlock className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                  </button>
                </div>
                {manualToken && (
                  <p className="text-xs text-gray-400 mt-1">
                    Token length: {manualToken.length} characters
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Account ID (optional - uses environment default if empty)
                </label>
                <input
                  type="text"
                  value={manualAccountId}
                  onChange={(e) => setManualAccountId(e.target.value)}
                  placeholder="e.g., 8845e940-c372-4a3d-9f7e-66288924c46f"
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Region
                </label>
                <select
                  value={manualRegion}
                  onChange={(e) => setManualRegion(e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="london">London</option>
                  <option value="new-york">New York</option>
                  <option value="singapore">Singapore</option>
                  <option value="tokyo">Tokyo</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Test Buttons */}
        <div className="mb-8 flex gap-4">
          <button
            onClick={() => runTest(false)}
            disabled={testing}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
          >
            {testing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <Play className="w-5 h-5" />
                Test with Environment Variables
              </>
            )}
          </button>

          {useManualToken && (
            <button
              onClick={() => runTest(true)}
              disabled={testing || !manualToken}
              className="flex items-center gap-2 px-6 py-3 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
            >
              {testing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <Key className="w-5 h-5" />
                  Test with Manual Token
                </>
              )}
            </button>
          )}
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
                      <p><strong>Token Source:</strong> <span className="text-yellow-400">{testResult.details.tokenSource}</span></p>
                      <p><strong>Token Length:</strong> {testResult.details.tokenLength} characters</p>
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

                  {testResult.error === 'No MetaAPI token found in any source (manual input, METAAPI_ADMIN_TOKEN, or METAAPI_TOKEN)' && (
                    <div className="mt-4 p-3 bg-yellow-900/30 border border-yellow-600 rounded">
                      <p className="text-yellow-200 font-semibold mb-2">
                        🔑 Token Not Found - Try Manual Input:
                      </p>
                      <ol className="list-decimal list-inside space-y-1 text-sm text-yellow-100">
                        <li>Check the "Use manual token input" checkbox above</li>
                        <li>Enter your MetaAPI token from the MetaAPI dashboard</li>
                        <li>Click "Test with Manual Token" to verify</li>
                      </ol>
                    </div>
                  )}
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

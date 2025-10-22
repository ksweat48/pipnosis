import React, { useState } from 'react';
import { CheckCircle2, XCircle, Clock, AlertCircle, ArrowLeft, PlayCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface TestStep {
  step: string;
  status: 'pending' | 'running' | 'success' | 'error';
  message: string;
  details?: any;
  timestamp: string;
}

interface TestResult {
  success: boolean;
  testResults: TestStep[];
  message?: string;
  error?: string;
  token?: {
    generated: boolean;
    prefix: string;
    length: number;
  };
}

export default function TestMetaApiToken() {
  const navigate = useNavigate();
  const [isRunning, setIsRunning] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [useCustomToken, setUseCustomToken] = useState(false);
  const [customAdminToken, setCustomAdminToken] = useState('');
  const [customAccountId, setCustomAccountId] = useState('');

  const runTest = async () => {
    setIsRunning(true);
    setTestResult(null);

    try {
      const requestBody: any = {};

      if (useCustomToken && customAdminToken) {
        requestBody.testAdminToken = customAdminToken;
      }

      if (useCustomToken && customAccountId) {
        requestBody.testAccountId = customAccountId;
      }

      const response = await fetch('/.netlify/functions/test-metaapi-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();
      setTestResult(data);
    } catch (error: any) {
      setTestResult({
        success: false,
        testResults: [
          {
            step: 'Network Error',
            status: 'error',
            message: error.message || 'Failed to connect to test function',
            timestamp: new Date().toISOString(),
          },
        ],
        error: 'Network request failed',
      });
    } finally {
      setIsRunning(false);
    }
  };

  const getStatusIcon = (status: TestStep['status']) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'running':
        return <Clock className="w-5 h-5 text-blue-500 animate-spin" />;
      default:
        return <Clock className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStatusColor = (status: TestStep['status']) => {
    switch (status) {
      case 'success':
        return 'bg-green-50 border-green-200';
      case 'error':
        return 'bg-red-50 border-red-200';
      case 'running':
        return 'bg-blue-50 border-blue-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </button>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="flex items-center gap-3 mb-6">
            <AlertCircle className="w-8 h-8 text-blue-600" />
            <div>
              <h1 className="text-3xl font-bold text-gray-900">MetaAPI Token Test</h1>
              <p className="text-gray-600 mt-1">
                Test and validate MetaAPI token generation and account verification
              </p>
            </div>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <p className="text-sm text-yellow-800">
              <strong>Purpose:</strong> This tool tests the MetaAPI token generation process step-by-step
              to identify any configuration or connectivity issues. By default, it uses environment variables
              from your Netlify deployment.
            </p>
          </div>

          <div className="mb-6">
            <label className="flex items-center gap-2 mb-4">
              <input
                type="checkbox"
                checked={useCustomToken}
                onChange={(e) => setUseCustomToken(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded"
              />
              <span className="text-sm text-gray-700">Use custom tokens for testing</span>
            </label>

            {useCustomToken && (
              <div className="space-y-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Admin Token (Optional)
                  </label>
                  <input
                    type="password"
                    value={customAdminToken}
                    onChange={(e) => setCustomAdminToken(e.target.value)}
                    placeholder="Leave blank to use environment variable"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Account ID (Optional)
                  </label>
                  <input
                    type="text"
                    value={customAccountId}
                    onChange={(e) => setCustomAccountId(e.target.value)}
                    placeholder="Leave blank to use environment variable"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                  />
                </div>
              </div>
            )}
          </div>

          <button
            onClick={runTest}
            disabled={isRunning}
            className={`w-full py-3 px-6 rounded-lg font-semibold text-white transition-all flex items-center justify-center gap-2 ${
              isRunning
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 shadow-md hover:shadow-lg'
            }`}
          >
            <PlayCircle className="w-5 h-5" />
            {isRunning ? 'Running Tests...' : 'Run MetaAPI Token Test'}
          </button>

          {testResult && (
            <div className="mt-8">
              <div
                className={`p-4 rounded-lg mb-6 ${
                  testResult.success
                    ? 'bg-green-50 border border-green-200'
                    : 'bg-red-50 border border-red-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  {testResult.success ? (
                    <CheckCircle2 className="w-6 h-6 text-green-600" />
                  ) : (
                    <XCircle className="w-6 h-6 text-red-600" />
                  )}
                  <div>
                    <h3
                      className={`font-semibold ${
                        testResult.success ? 'text-green-900' : 'text-red-900'
                      }`}
                    >
                      {testResult.success ? 'All Tests Passed!' : 'Tests Failed'}
                    </h3>
                    <p
                      className={`text-sm ${
                        testResult.success ? 'text-green-700' : 'text-red-700'
                      }`}
                    >
                      {testResult.message || testResult.error}
                    </p>
                  </div>
                </div>

                {testResult.token && testResult.success && (
                  <div className="mt-4 p-3 bg-white rounded border border-green-300">
                    <p className="text-sm font-medium text-gray-700">Generated Token:</p>
                    <p className="text-xs font-mono text-gray-600 mt-1">
                      {testResult.token.prefix} ({testResult.token.length} characters)
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">Test Steps:</h3>

                {testResult.testResults.map((step, index) => (
                  <div
                    key={index}
                    className={`p-4 rounded-lg border transition-all ${getStatusColor(
                      step.status
                    )}`}
                  >
                    <div className="flex items-start gap-3">
                      {getStatusIcon(step.status)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <h4 className="font-semibold text-gray-900">{step.step}</h4>
                          <span className="text-xs text-gray-500">
                            {new Date(step.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-sm text-gray-700 mt-1">{step.message}</p>

                        {step.details && (
                          <details className="mt-3">
                            <summary className="text-xs font-medium text-gray-600 cursor-pointer hover:text-gray-900">
                              Show Details
                            </summary>
                            <pre className="mt-2 p-3 bg-white rounded border border-gray-300 text-xs overflow-x-auto">
                              {JSON.stringify(step.details, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!testResult && !isRunning && (
            <div className="mt-8 text-center text-gray-500">
              <p>Click the button above to start testing your MetaAPI token configuration</p>
            </div>
          )}
        </div>

        <div className="mt-6 bg-white rounded-lg shadow-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">What This Test Does:</h3>
          <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
            <li>Checks if METAAPI_ADMIN_TOKEN is configured in Netlify environment</li>
            <li>Verifies the MetaAPI SDK can be imported and initialized</li>
            <li>Initializes a MetaAPI client with your admin token</li>
            <li>Generates a narrowed token scoped to your trading account</li>
            <li>Verifies the account can be accessed with the generated token</li>
          </ol>

          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800">
              <strong>Troubleshooting:</strong> If tests fail, check that METAAPI_ADMIN_TOKEN
              is set in your Netlify environment variables. The token should have full permissions
              for your trading account.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

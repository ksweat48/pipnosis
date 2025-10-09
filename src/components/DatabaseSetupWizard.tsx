import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle, Loader2, Database, Key, Network, Shield, RefreshCw } from 'lucide-react';
import { connectionValidator, ConnectionValidationResult } from '../lib/connection-validator';

interface DatabaseSetupWizardProps {
  onComplete: () => void;
}

export function DatabaseSetupWizard({ onComplete }: DatabaseSetupWizardProps) {
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<ConnectionValidationResult | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  useEffect(() => {
    validateConnection();
  }, []);

  const validateConnection = async () => {
    setIsValidating(true);
    try {
      const result = await connectionValidator.validateConnection();
      setValidationResult(result);

      if (result.isValid) {
        setTimeout(() => {
          onComplete();
        }, 1500);
      }
    } catch (error) {
      console.error('Validation error:', error);
      setValidationResult({
        isValid: false,
        errors: ['Failed to validate connection: ' + (error instanceof Error ? error.message : 'Unknown error')],
        warnings: [],
        details: {
          hasUrl: false,
          hasKey: false,
          canConnect: false,
          tablesExist: false,
          rlsConfigured: false,
          tableAccessible: false
        }
      });
    } finally {
      setIsValidating(false);
    }
  };

  const StatusIcon = ({ status }: { status: boolean | undefined }) => {
    if (status === undefined) {
      return <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />;
    }
    return status
      ? <CheckCircle className="w-5 h-5 text-green-500" />
      : <AlertCircle className="w-5 h-5 text-red-500" />;
  };

  const getSetupInstructions = () => {
    if (!validationResult) return null;

    const { errors, details } = validationResult;

    if (!details.hasUrl || !details.hasKey) {
      return (
        <div className="bg-red-900/20 border border-red-500 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-red-400 mb-3">Environment Variables Missing</h3>
          <p className="text-gray-300 mb-4">
            Your application is missing required Supabase credentials.
          </p>
          <div className="bg-gray-900 rounded p-4 mb-4">
            <p className="text-sm text-gray-400 mb-2">Create or update your <code className="text-cyan-400">.env</code> file:</p>
            <pre className="text-xs text-green-400 overflow-x-auto">
{`VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here`}
            </pre>
          </div>
          <ol className="space-y-2 text-sm text-gray-300">
            <li>1. Go to your Supabase Dashboard</li>
            <li>2. Navigate to Project Settings → API</li>
            <li>3. Copy your Project URL and anon/public key</li>
            <li>4. Update your .env file with these values</li>
            <li>5. Restart your development server</li>
          </ol>
        </div>
      );
    }

    if (!details.canConnect) {
      return (
        <div className="bg-red-900/20 border border-red-500 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-red-400 mb-3">Cannot Connect to Database</h3>
          <p className="text-gray-300 mb-4">
            The application cannot establish a connection to your Supabase database.
          </p>
          <div className="space-y-3 text-sm text-gray-300">
            <p className="font-semibold text-white">Troubleshooting steps:</p>
            <ul className="space-y-2 ml-4">
              <li>• Verify your Supabase project is active in the dashboard</li>
              <li>• Check that the VITE_SUPABASE_URL matches your project URL exactly</li>
              <li>• Ensure your internet connection is stable</li>
              <li>• Check browser console for CORS or network errors</li>
              <li>• Verify your Supabase project hasn't been paused</li>
            </ul>
          </div>
        </div>
      );
    }

    if (!details.tablesExist) {
      return (
        <div className="bg-yellow-900/20 border border-yellow-500 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-yellow-400 mb-3">Database Tables Missing</h3>
          <p className="text-gray-300 mb-4">
            Required database tables are missing. You need to run the database migrations.
          </p>
          <div className="bg-gray-900 rounded p-4 mb-4">
            <p className="text-sm text-gray-400 mb-2">Steps to fix:</p>
            <ol className="space-y-2 text-sm text-gray-300">
              <li>1. Open your Supabase Dashboard</li>
              <li>2. Go to SQL Editor (left sidebar)</li>
              <li>3. Click "New Query"</li>
              <li>4. Copy and paste the SQL from the migrations in <code className="text-cyan-400">supabase/migrations/</code></li>
              <li>5. Run each migration in order (by filename date)</li>
            </ol>
          </div>
          <p className="text-xs text-gray-400">
            See <code className="text-cyan-400">PRODUCTION_DATABASE_SETUP.md</code> for detailed instructions.
          </p>
        </div>
      );
    }

    if (!details.tableAccessible || !details.rlsConfigured) {
      return (
        <div className="bg-yellow-900/20 border border-yellow-500 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-yellow-400 mb-3">Row Level Security Issue</h3>
          <p className="text-gray-300 mb-4">
            The database tables exist, but Row Level Security (RLS) policies are blocking access.
          </p>
          <div className="bg-gray-900 rounded p-4 mb-4">
            <p className="text-sm text-gray-400 mb-2">To fix RLS policies:</p>
            <ol className="space-y-2 text-sm text-gray-300">
              <li>1. Open Supabase Dashboard → SQL Editor</li>
              <li>2. Run the RLS policy migration from <code className="text-cyan-400">supabase/migrations/20251008230709_fix_market_data_rls_policies.sql</code></li>
              <li>3. This will configure proper access policies for the market_data table</li>
            </ol>
          </div>
          <p className="text-xs text-gray-400">
            See <code className="text-cyan-400">PRODUCTION_DATABASE_SETUP.md</code> for more details.
          </p>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="fixed inset-0 bg-black/95 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="p-8">
          <div className="flex items-center gap-3 mb-6">
            <Database className="w-8 h-8 text-cyan-400" />
            <h2 className="text-2xl font-bold text-white">Database Setup Validation</h2>
          </div>

          {isValidating && !validationResult && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-12 h-12 text-cyan-400 animate-spin mb-4" />
              <p className="text-gray-400">Validating database connection...</p>
            </div>
          )}

          {validationResult && (
            <>
              <div className="space-y-4 mb-6">
                <div className="flex items-center justify-between p-4 bg-gray-800 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Key className="w-5 h-5 text-gray-400" />
                    <span className="text-gray-300">Environment Variables</span>
                  </div>
                  <StatusIcon status={validationResult.details.hasUrl && validationResult.details.hasKey} />
                </div>

                <div className="flex items-center justify-between p-4 bg-gray-800 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Network className="w-5 h-5 text-gray-400" />
                    <span className="text-gray-300">Database Connection</span>
                  </div>
                  <StatusIcon status={validationResult.details.canConnect} />
                </div>

                <div className="flex items-center justify-between p-4 bg-gray-800 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Database className="w-5 h-5 text-gray-400" />
                    <span className="text-gray-300">Required Tables</span>
                  </div>
                  <StatusIcon status={validationResult.details.tablesExist} />
                </div>

                <div className="flex items-center justify-between p-4 bg-gray-800 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Shield className="w-5 h-5 text-gray-400" />
                    <span className="text-gray-300">Table Access & RLS</span>
                  </div>
                  <StatusIcon status={validationResult.details.tableAccessible && validationResult.details.rlsConfigured} />
                </div>
              </div>

              {validationResult.isValid ? (
                <div className="bg-green-900/20 border border-green-500 rounded-lg p-6 mb-6">
                  <div className="flex items-center gap-3 mb-2">
                    <CheckCircle className="w-6 h-6 text-green-500" />
                    <h3 className="text-lg font-semibold text-green-400">Database Connected Successfully</h3>
                  </div>
                  <p className="text-gray-300">
                    All validation checks passed. Redirecting to application...
                  </p>
                </div>
              ) : (
                <>
                  {validationResult.errors.length > 0 && (
                    <div className="bg-red-900/20 border border-red-500 rounded-lg p-4 mb-6">
                      <h3 className="text-sm font-semibold text-red-400 mb-2">Errors Found:</h3>
                      <ul className="space-y-1">
                        {validationResult.errors.map((error, index) => (
                          <li key={index} className="text-sm text-gray-300 flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                            <span>{error}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {validationResult.warnings.length > 0 && (
                    <div className="bg-yellow-900/20 border border-yellow-500 rounded-lg p-4 mb-6">
                      <h3 className="text-sm font-semibold text-yellow-400 mb-2">Warnings:</h3>
                      <ul className="space-y-1">
                        {validationResult.warnings.map((warning, index) => (
                          <li key={index} className="text-sm text-gray-300 flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                            <span>{warning}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {getSetupInstructions()}

                  <div className="flex gap-3 mt-6">
                    <button
                      onClick={validateConnection}
                      disabled={isValidating}
                      className="flex items-center gap-2 px-6 py-3 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <RefreshCw className={`w-5 h-5 ${isValidating ? 'animate-spin' : ''}`} />
                      Retry Connection
                    </button>

                    <button
                      onClick={() => setShowDiagnostics(!showDiagnostics)}
                      className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition"
                    >
                      {showDiagnostics ? 'Hide' : 'Show'} Diagnostics
                    </button>
                  </div>

                  {showDiagnostics && (
                    <div className="mt-6 bg-gray-800 rounded-lg p-4">
                      <h3 className="text-sm font-semibold text-gray-300 mb-3">Technical Details:</h3>
                      <pre className="text-xs text-gray-400 overflow-x-auto">
                        {JSON.stringify(validationResult, null, 2)}
                      </pre>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

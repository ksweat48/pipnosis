import React, { useState } from 'react';
import { AlertCircle, CheckCircle, XCircle, ExternalLink, Copy, Check } from 'lucide-react';

interface SetupInstructionsScreenProps {
  missingCredentials: {
    token: boolean;
    accountId: boolean;
    region: boolean;
  };
}

export const SetupInstructionsScreen: React.FC<SetupInstructionsScreenProps> = ({
  missingCredentials
}) => {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const envExample = `# MetaAPI Configuration
VITE_METAAPI_TOKEN=your_metaapi_token_here
VITE_METAAPI_ACCOUNT_ID=your_metaapi_account_id_here
VITE_METAAPI_REGION=new-york

# Supabase Configuration (should already be set)
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key`;

  return (
    <div className="min-h-screen gradient-bg flex items-center justify-center p-4">
      <div className="max-w-4xl w-full">
        <div className="glass-card p-8">
          <div className="flex items-center gap-4 mb-6">
            <AlertCircle className="w-10 h-10 text-yellow-400 flex-shrink-0" />
            <div>
              <h1 className="text-2xl font-bold text-white">Configuration Required</h1>
              <p className="text-white/70">MetaAPI credentials must be configured to continue</p>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
              <h2 className="text-white font-semibold mb-3">Missing Configuration:</h2>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {missingCredentials.token ? (
                    <XCircle className="w-4 h-4 text-red-400" />
                  ) : (
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                  )}
                  <span className="text-white/80 text-sm">VITE_METAAPI_TOKEN</span>
                </div>
                <div className="flex items-center gap-2">
                  {missingCredentials.accountId ? (
                    <XCircle className="w-4 h-4 text-red-400" />
                  ) : (
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                  )}
                  <span className="text-white/80 text-sm">VITE_METAAPI_ACCOUNT_ID</span>
                </div>
                <div className="flex items-center gap-2">
                  {missingCredentials.region ? (
                    <XCircle className="w-4 h-4 text-red-400" />
                  ) : (
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                  )}
                  <span className="text-white/80 text-sm">VITE_METAAPI_REGION</span>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-white font-semibold mb-3">Setup Instructions:</h2>
              <ol className="space-y-4 text-white/80">
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500 text-white text-sm flex items-center justify-center font-semibold">
                    1
                  </span>
                  <div className="flex-1">
                    <p className="font-medium text-white mb-1">Create a MetaAPI Account</p>
                    <p className="text-sm text-white/70 mb-2">
                      If you don't have a MetaAPI account, sign up at metaapi.cloud
                    </p>
                    <a
                      href="https://app.metaapi.cloud/signup"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-emerald-400 hover:text-emerald-300 text-sm"
                    >
                      Sign up for MetaAPI
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </li>

                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500 text-white text-sm flex items-center justify-center font-semibold">
                    2
                  </span>
                  <div className="flex-1">
                    <p className="font-medium text-white mb-1">Get Your API Token</p>
                    <p className="text-sm text-white/70 mb-2">
                      Navigate to the API Tokens section in your MetaAPI dashboard
                    </p>
                    <a
                      href="https://app.metaapi.cloud/tokens"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-emerald-400 hover:text-emerald-300 text-sm"
                    >
                      View API Tokens
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </li>

                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500 text-white text-sm flex items-center justify-center font-semibold">
                    3
                  </span>
                  <div className="flex-1">
                    <p className="font-medium text-white mb-1">Connect Your MT5 Account</p>
                    <p className="text-sm text-white/70 mb-2">
                      Add your MetaTrader 5 account to MetaAPI and note your Account ID
                    </p>
                    <a
                      href="https://app.metaapi.cloud/accounts"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-emerald-400 hover:text-emerald-300 text-sm"
                    >
                      Manage Accounts
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </li>

                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500 text-white text-sm flex items-center justify-center font-semibold">
                    4
                  </span>
                  <div className="flex-1">
                    <p className="font-medium text-white mb-1">Configure Environment Variables</p>
                    <p className="text-sm text-white/70 mb-3">
                      Create or update your .env file in the project root with the following:
                    </p>
                    <div className="relative">
                      <pre className="bg-black/40 rounded-lg p-4 text-sm text-white/90 overflow-x-auto">
                        {envExample}
                      </pre>
                      <button
                        onClick={() => copyToClipboard(envExample, 'env')}
                        className="absolute top-2 right-2 p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                        title="Copy to clipboard"
                      >
                        {copiedField === 'env' ? (
                          <Check className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Copy className="w-4 h-4 text-white/60" />
                        )}
                      </button>
                    </div>
                  </div>
                </li>

                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500 text-white text-sm flex items-center justify-center font-semibold">
                    5
                  </span>
                  <div className="flex-1">
                    <p className="font-medium text-white mb-1">Choose Your Region</p>
                    <p className="text-sm text-white/70 mb-2">
                      Set VITE_METAAPI_REGION to match your account's region:
                    </p>
                    <ul className="space-y-1 text-sm text-white/70">
                      <li>• <span className="text-white font-mono">new-york</span> - US East Coast</li>
                      <li>• <span className="text-white font-mono">london</span> - Europe</li>
                      <li>• <span className="text-white font-mono">singapore</span> - Asia Pacific</li>
                    </ul>
                  </div>
                </li>

                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500 text-white text-sm flex items-center justify-center font-semibold">
                    6
                  </span>
                  <div className="flex-1">
                    <p className="font-medium text-white mb-1">Restart the Application</p>
                    <p className="text-sm text-white/70">
                      After saving your .env file, restart the development server or rebuild the application
                    </p>
                  </div>
                </li>
              </ol>
            </div>

            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
              <h3 className="text-white font-medium mb-2 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-blue-400" />
                Important Notes
              </h3>
              <ul className="space-y-1 text-sm text-white/70">
                <li>• Never commit your .env file to version control</li>
                <li>• Keep your API token secure and private</li>
                <li>• Ensure your MetaAPI account is deployed and connected</li>
                <li>• The region must match your MetaAPI account configuration</li>
              </ul>
            </div>

            <div className="flex gap-3 pt-4">
              <a
                href="https://metaapi.cloud/docs/"
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors inline-flex items-center gap-2"
              >
                View Documentation
                <ExternalLink className="w-4 h-4" />
              </a>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
              >
                Reload Application
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

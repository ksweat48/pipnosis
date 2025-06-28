import React, { useState } from 'react';
import { X, Database, CheckCircle, AlertCircle, ExternalLink, Copy, Eye, EyeOff, RefreshCw } from 'lucide-react';

interface DatabaseSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DatabaseSetupModal: React.FC<DatabaseSetupModalProps> = ({ isOpen, onClose }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [showEnvVars, setShowEnvVars] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  // Updated migration SQL that handles existing policies
  const migrationSQL = `-- Pipnosis Database Migration (Fixed for existing policies)
-- Copy and paste this entire script into your Supabase SQL Editor

-- Drop existing policies if they exist (prevents errors)
DROP POLICY IF EXISTS "Users can read own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can read own prompts" ON trading_prompts;
DROP POLICY IF EXISTS "Users can insert own prompts" ON trading_prompts;
DROP POLICY IF EXISTS "Users can update own prompts" ON trading_prompts;
DROP POLICY IF EXISTS "Users can read own trades" ON trade_records;
DROP POLICY IF EXISTS "Users can insert own trades" ON trade_records;
DROP POLICY IF EXISTS "Users can update own trades" ON trade_records;
DROP POLICY IF EXISTS "Users can read own journal" ON journal_entries;
DROP POLICY IF EXISTS "Users can insert own journal entries" ON journal_entries;

-- User Profiles Table
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  full_name text,
  avatar_url text,
  plan_type text DEFAULT 'free' CHECK (plan_type IN ('free', 'beta', 'premium')),
  account_balance decimal(15,2) DEFAULT 10000.00,
  risk_profile text DEFAULT 'auto' CHECK (risk_profile IN ('low', 'medium', 'high', 'auto')),
  trading_preferences jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Trading Prompts Table
CREATE TABLE IF NOT EXISTS trading_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES user_profiles(id) ON DELETE CASCADE,
  prompt_text text NOT NULL,
  account_balance decimal(15,2) NOT NULL,
  market_data jsonb,
  strategies_generated jsonb DEFAULT '[]',
  selected_strategy jsonb,
  ai_confidence text CHECK (ai_confidence IN ('high', 'medium', 'low')),
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'analyzing', 'completed', 'executed', 'failed')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Trade Records Table
CREATE TABLE IF NOT EXISTS trade_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES user_profiles(id) ON DELETE CASCADE,
  prompt_id uuid REFERENCES trading_prompts(id) ON DELETE SET NULL,
  symbol text NOT NULL,
  trade_type text NOT NULL CHECK (trade_type IN ('buy', 'sell')),
  lot_size decimal(10,2) NOT NULL,
  entry_price decimal(15,5) NOT NULL,
  current_price decimal(15,5),
  stop_loss decimal(15,5),
  take_profit decimal(15,5),
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'open', 'closed', 'cancelled')),
  pnl decimal(15,2) DEFAULT 0.00,
  opened_at timestamptz DEFAULT now(),
  closed_at timestamptz,
  mt5_ticket text,
  trade_metadata jsonb DEFAULT '{}'
);

-- Journal Entries Table
CREATE TABLE IF NOT EXISTS journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES user_profiles(id) ON DELETE CASCADE,
  trade_id uuid REFERENCES trade_records(id) ON DELETE SET NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('trade_entry', 'trade_exit', 'market_update', 'ai_decision', 'modification')),
  title text NOT NULL,
  content text NOT NULL,
  confidence_level text CHECK (confidence_level IN ('high', 'medium', 'low')),
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Waitlist Table
CREATE TABLE IF NOT EXISTS waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  plan_type text DEFAULT 'free' CHECK (plan_type IN ('free', 'beta')),
  referral_code text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;

-- Create policies with unique names (prevents conflicts)
CREATE POLICY "user_profiles_select_own" ON user_profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE POLICY "user_profiles_update_own" ON user_profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE POLICY "user_profiles_insert_own" ON user_profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE POLICY "trading_prompts_select_own" ON trading_prompts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "trading_prompts_insert_own" ON trading_prompts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "trading_prompts_update_own" ON trading_prompts
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "trade_records_select_own" ON trade_records
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "trade_records_insert_own" ON trade_records
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "trade_records_update_own" ON trade_records
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "journal_entries_select_own" ON journal_entries
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "journal_entries_insert_own" ON journal_entries
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_trading_prompts_user_id ON trading_prompts(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_records_user_id ON trade_records(user_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_user_id ON journal_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);`;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700 flex-shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-red-500/20 rounded-lg">
              <Database className="h-6 w-6 text-red-400" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">Database Tables Missing (404 Error)</h2>
              <p className="text-sm text-slate-400">The user_profiles table doesn't exist yet</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {/* Error Explanation */}
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
              <div className="flex items-start space-x-3">
                <AlertCircle className="h-5 w-5 text-red-400 mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="text-red-300 font-medium">404 Error Detected</h3>
                  <p className="text-red-200 text-sm mt-1">
                    The error you're seeing means the database tables don't exist yet. This is normal for a new Supabase project - you just need to run the migration SQL to create them.
                  </p>
                  <div className="mt-3 text-sm text-red-200">
                    <p><strong>Error:</strong> "Supabase request failed" with status 404</p>
                    <p><strong>Cause:</strong> The user_profiles table hasn't been created</p>
                    <p><strong>Solution:</strong> Run the migration SQL below</p>
                  </div>
                </div>
              </div>
            </div>

            {/* URL Mismatch Warning */}
            <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <div className="flex items-start space-x-3">
                <AlertCircle className="h-5 w-5 text-yellow-400 mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="text-yellow-300 font-medium">Check Your Supabase URL</h3>
                  <p className="text-yellow-200 text-sm mt-1">
                    Make sure you're using the correct Supabase project URL. The error showed a different URL than what's in your config.
                  </p>
                  <div className="mt-3 text-sm text-yellow-200 font-mono">
                    <p><strong>Expected:</strong> elykntifkdaqiafnjosk.supabase.co</p>
                    <p><strong>Error showed:</strong> rvhsvaejjofzkastkwej.supabase.co</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Setup Steps */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">Quick Fix (2 minutes)</h3>
              
              <div className="space-y-4">
                {/* Step 1 */}
                <div className={`p-4 rounded-lg border ${currentStep >= 1 ? 'border-blue-500 bg-blue-500/10' : 'border-slate-600 bg-slate-900'}`}>
                  <div className="flex items-start space-x-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold ${
                      currentStep >= 1 ? 'bg-blue-500 text-white' : 'bg-slate-600 text-slate-400'
                    }`}>
                      1
                    </div>
                    <div className="flex-1">
                      <h4 className="text-white font-medium">Open Supabase SQL Editor</h4>
                      <p className="text-slate-400 text-sm mt-1">Go to your Supabase dashboard and open the SQL editor</p>
                      <a
                        href="https://supabase.com/dashboard"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center space-x-2 mt-2 text-blue-400 hover:text-blue-300 text-sm"
                      >
                        <ExternalLink className="h-4 w-4" />
                        <span>Open Supabase Dashboard</span>
                      </a>
                    </div>
                  </div>
                </div>

                {/* Step 2 */}
                <div className={`p-4 rounded-lg border ${currentStep >= 2 ? 'border-blue-500 bg-blue-500/10' : 'border-slate-600 bg-slate-900'}`}>
                  <div className="flex items-start space-x-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold ${
                      currentStep >= 2 ? 'bg-blue-500 text-white' : 'bg-slate-600 text-slate-400'
                    }`}>
                      2
                    </div>
                    <div className="flex-1">
                      <h4 className="text-white font-medium">Run Migration SQL</h4>
                      <p className="text-slate-400 text-sm mt-1">Copy the SQL below and paste it into the SQL editor, then click "Run"</p>
                      
                      <div className="mt-3 bg-slate-900 rounded-lg border border-slate-600">
                        <div className="flex items-center justify-between p-3 border-b border-slate-600">
                          <span className="text-white text-sm font-medium">Database Migration SQL</span>
                          <button
                            onClick={() => copyToClipboard(migrationSQL, 'migration')}
                            className="flex items-center space-x-2 text-blue-400 hover:text-blue-300 text-sm"
                          >
                            <Copy className="h-4 w-4" />
                            <span>{copied === 'migration' ? 'Copied!' : 'Copy SQL'}</span>
                          </button>
                        </div>
                        <div className="p-3 max-h-40 overflow-y-auto">
                          <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono">
                            {migrationSQL}
                          </pre>
                        </div>
                      </div>
                      
                      <div className="mt-3 p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                        <p className="text-green-300 text-sm">
                          ✅ This SQL creates all the tables needed for Pipnosis to work properly.
                        </p>
                      </div>
                      
                      <button
                        onClick={() => setCurrentStep(Math.max(currentStep, 2))}
                        className="mt-2 text-blue-400 hover:text-blue-300 text-sm"
                      >
                        ✓ SQL executed successfully
                      </button>
                    </div>
                  </div>
                </div>

                {/* Step 3 */}
                <div className={`p-4 rounded-lg border ${currentStep >= 3 ? 'border-green-500 bg-green-500/10' : 'border-slate-600 bg-slate-900'}`}>
                  <div className="flex items-start space-x-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold ${
                      currentStep >= 3 ? 'bg-green-500 text-white' : 'bg-slate-600 text-slate-400'
                    }`}>
                      3
                    </div>
                    <div className="flex-1">
                      <h4 className="text-white font-medium">Refresh Pipnosis</h4>
                      <p className="text-slate-400 text-sm mt-1">Refresh this page to connect to your database</p>
                      <button
                        onClick={() => {
                          setCurrentStep(3);
                          setTimeout(() => window.location.reload(), 1000);
                        }}
                        className="mt-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-sm flex items-center space-x-2"
                      >
                        <RefreshCw className="h-4 w-4" />
                        <span>Refresh App</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Debug Information */}
            <div className="p-4 bg-slate-900 rounded-lg border border-slate-600">
              <h4 className="text-white font-medium mb-3">Debug Information</h4>
              <div className="space-y-2 text-sm text-slate-300 font-mono">
                <p><strong>Error Type:</strong> 404 - Resource Not Found</p>
                <p><strong>Missing Resource:</strong> user_profiles table</p>
                <p><strong>Expected URL:</strong> elykntifkdaqiafnjosk.supabase.co</p>
                <p><strong>Status:</strong> Database tables need to be created</p>
              </div>
              
              <div className="mt-3 p-2 bg-blue-500/10 border border-blue-500/30 rounded">
                <p className="text-blue-300 text-sm">
                  💡 <strong>Tip:</strong> You can test the database connection in the browser console by running <code>testSupabaseDirectly()</code>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-slate-700 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-400 hover:text-white transition-colors"
          >
            Continue in Demo Mode
          </button>
          <div className="flex space-x-3">
            <a
              href="https://supabase.com/docs/guides/getting-started"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 text-blue-400 hover:text-blue-300 transition-colors"
            >
              Supabase Docs
            </a>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              Refresh App
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
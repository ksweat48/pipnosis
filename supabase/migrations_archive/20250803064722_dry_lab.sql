/*
  # Create trade sessions table for MetaApi cost tracking

  1. New Tables
    - `trade_sessions`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to user_profiles)
      - `symbol` (text, trading pair)
      - `start_time` (timestamp, session start)
      - `end_time` (timestamp, session end)
      - `status` (text, session status)
      - `estimated_cost` (numeric, MetaApi cost)
      - `duration_minutes` (integer, calculated duration)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Security
    - Enable RLS on `trade_sessions` table
    - Add policy for users to read/write their own sessions
    - Add policy for admin access to all sessions

  3. Triggers
    - Auto-update `updated_at` timestamp on modifications
*/

-- Create trade_sessions table
CREATE TABLE IF NOT EXISTS trade_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  start_time timestamptz NOT NULL DEFAULT now(),
  end_time timestamptz,
  status text NOT NULL DEFAULT 'pending',
  estimated_cost numeric(10,4) DEFAULT 0.0000,
  duration_minutes integer,
  metaapi_account_id text,
  session_metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add constraints for status values
ALTER TABLE trade_sessions 
ADD CONSTRAINT trade_sessions_status_check 
CHECK (status = ANY (ARRAY['pending'::text, 'active'::text, 'closed'::text, 'failed'::text]));

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_trade_sessions_user_id ON trade_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_sessions_status ON trade_sessions(status);
CREATE INDEX IF NOT EXISTS idx_trade_sessions_start_time ON trade_sessions(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_trade_sessions_symbol ON trade_sessions(symbol);

-- Enable Row Level Security
ALTER TABLE trade_sessions ENABLE ROW LEVEL SECURITY;

-- Policy for users to manage their own sessions
CREATE POLICY "Users can manage own trade sessions"
  ON trade_sessions
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy for admin access (assuming admin role in user_profiles)
CREATE POLICY "Admins can access all trade sessions"
  ON trade_sessions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE id = auth.uid() 
      AND (plan_type = 'admin' OR trading_preferences->>'role' = 'admin')
    )
  );

-- Add updated_at trigger
CREATE TRIGGER update_trade_sessions_updated_at
  BEFORE UPDATE ON trade_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add role support to user_profiles if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_profiles' AND column_name = 'role'
  ) THEN
    ALTER TABLE user_profiles ADD COLUMN role text DEFAULT 'user';
    ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check 
    CHECK (role = ANY (ARRAY['user'::text, 'admin'::text, 'moderator'::text]));
  END IF;
END $$;
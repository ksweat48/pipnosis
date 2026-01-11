/*
  # Create PCVL Audit Log Table

  1. New Table
    - `pcvl_audit_log`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users)
      - `session_id` (uuid, foreign key to goal_sessions - nullable)
      - `trade_id` (uuid, foreign key to trade_records - nullable)
      - Position details (symbol, lot_size, stop_pips)
      - Risk calculations (intended_risk_dollars, calculated_risk_dollars, risk_variance_percent)
      - Pip value audit (pip_value, dollar_per_pip)
      - Validation result (approved, block_reason)
      - Timestamps

  2. Security
    - Enable RLS on `pcvl_audit_log` table
    - Add policy for users to read their own audit logs
    - Add policy for admins to read all audit logs

  3. Indexes
    - Index on user_id and created_at for user queries
    - Index on approved = false for monitoring blocked trades
    - Index on risk_variance_percent for anomaly detection

  4. Purpose
    - Complete audit trail of every PCVL validation
    - Meta-learning on blocked trades
    - Pip value error detection
    - Regulatory compliance
    - System monitoring and debugging
*/

-- Create PCVL audit log table
CREATE TABLE IF NOT EXISTS pcvl_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES goal_sessions(id) ON DELETE SET NULL,
  trade_id UUID REFERENCES trade_records(id) ON DELETE SET NULL,

  -- Position details
  symbol TEXT NOT NULL,
  lot_size DECIMAL(10, 3) NOT NULL,
  stop_pips DECIMAL(10, 2) NOT NULL,

  -- Risk calculations
  intended_risk_dollars DECIMAL(10, 2) NOT NULL,
  calculated_risk_dollars DECIMAL(10, 2) NOT NULL,
  risk_variance_percent DECIMAL(10, 4) NOT NULL,

  -- Pip value audit (for debugging pip value errors)
  pip_value DECIMAL(10, 6) NOT NULL,
  dollar_per_pip DECIMAL(10, 4) NOT NULL,

  -- Validation result
  approved BOOLEAN NOT NULL,
  block_reason TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_pcvl_audit_user_time
  ON pcvl_audit_log(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pcvl_audit_blocks
  ON pcvl_audit_log(approved, created_at DESC)
  WHERE approved = false;

CREATE INDEX IF NOT EXISTS idx_pcvl_audit_variance
  ON pcvl_audit_log(ABS(risk_variance_percent) DESC, created_at DESC)
  WHERE approved = true;

CREATE INDEX IF NOT EXISTS idx_pcvl_audit_session
  ON pcvl_audit_log(session_id, created_at DESC)
  WHERE session_id IS NOT NULL;

-- Enable RLS
ALTER TABLE pcvl_audit_log ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own audit logs
CREATE POLICY "Users can read own PCVL audit logs"
  ON pcvl_audit_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Admins can read all audit logs
CREATE POLICY "Admins can read all PCVL audit logs"
  ON pcvl_audit_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- No INSERT/UPDATE/DELETE policies - only backend can write audit logs
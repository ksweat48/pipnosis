/*
  # Restrict Auto-Trading to Admin Users Only

  1. Changes
    - Remove daily trade limits from auto_trading_status
    - Add admin_only flag to control access
    - Update to allow continuous trading without restrictions
    - Focus on learning and improvement mode

  2. Purpose
    - Enable continuous testing and AI improvement
    - Restrict access to admin users only
    - Remove trade count limitations
    - Allow 24/7 operation for data collection

  3. Notes
    - Auto-trading becomes a testing/training mode
    - System will execute as many quality trades as found
    - All outcomes feed into AI learning metrics
    - Only admins can start/stop auto-trading
*/

-- Add columns to track continuous operation mode
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'continuous_mode'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN continuous_mode boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'learning_mode'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN learning_mode boolean DEFAULT true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'total_trades_executed'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN total_trades_executed integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'started_by_admin'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN started_by_admin uuid REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'learning_session_id'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN learning_session_id uuid DEFAULT gen_random_uuid();
  END IF;
END $$;

-- Update the reset function to skip daily resets in continuous mode
CREATE OR REPLACE FUNCTION reset_daily_auto_trading_counts()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only reset for non-continuous mode (future regular users)
  UPDATE auto_trading_status
  SET
    trades_taken_today = 0,
    daily_pnl = 0,
    consecutive_no_opportunity_count = 0,
    emergency_stop = false,
    updated_at = now()
  WHERE enabled = true
    AND continuous_mode = false;
END;
$$;

-- Create function to check if user is admin
CREATE OR REPLACE FUNCTION is_admin_user(user_id_param uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  admin_role text;
BEGIN
  SELECT raw_user_meta_data->>'role'
  INTO admin_role
  FROM auth.users
  WHERE id = user_id_param;

  RETURN admin_role = 'admin';
END;
$$;

-- Update RLS policy for auto_trading_status to check admin status
DROP POLICY IF EXISTS "Users can update own auto trading status" ON auto_trading_status;

CREATE POLICY "Admin users can update auto trading status"
  ON auto_trading_status FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id AND
    is_admin_user(auth.uid())
  )
  WITH CHECK (
    auth.uid() = user_id AND
    is_admin_user(auth.uid())
  );

-- Create policy for admins to enable auto-trading
CREATE POLICY "Only admins can enable auto trading"
  ON auto_trading_status FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id AND
    is_admin_user(auth.uid())
  )
  WITH CHECK (
    auth.uid() = user_id AND
    is_admin_user(auth.uid())
  );

-- Add index for admin lookup
CREATE INDEX IF NOT EXISTS idx_auto_trading_status_continuous_mode ON auto_trading_status(continuous_mode);
CREATE INDEX IF NOT EXISTS idx_auto_trading_status_learning_mode ON auto_trading_status(learning_mode);

-- Create a view for admin auto-trading statistics
CREATE OR REPLACE VIEW admin_auto_trading_stats AS
SELECT
  ats.user_id,
  ats.enabled,
  ats.continuous_mode,
  ats.learning_mode,
  ats.total_trades_executed,
  ats.trades_taken_today,
  ats.daily_pnl,
  ats.last_trade_time,
  ats.learning_session_id,
  COUNT(DISTINCT alm.id) as total_learning_records,
  AVG(CASE WHEN alm.actual_outcome = 'win' THEN 1 ELSE 0 END) * 100 as win_rate,
  AVG(alm.accuracy_score) as avg_accuracy,
  SUM(alm.actual_pnl) as total_session_pnl
FROM auto_trading_status ats
LEFT JOIN ai_learning_metrics alm ON alm.user_id = ats.user_id
WHERE ats.continuous_mode = true
GROUP BY ats.user_id, ats.enabled, ats.continuous_mode, ats.learning_mode,
  ats.total_trades_executed, ats.trades_taken_today, ats.daily_pnl,
  ats.last_trade_time, ats.learning_session_id;

-- Grant access to admin users only
ALTER TABLE auto_trading_status ENABLE ROW LEVEL SECURITY;

-- Policy for viewing auto-trading stats (admin only)
CREATE POLICY "Admins can view auto trading stats"
  ON auto_trading_status FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id AND
    is_admin_user(auth.uid())
  );

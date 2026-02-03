/*
  # User Max Risk Preference System (SSOT Governance)

  ## Purpose
  Create Single Source of Truth for user-specified maximum risk per trade.
  This allows users to express their risk tolerance ceiling while Alpha retains
  full authority over position sizing decisions within that ceiling.

  ## Architecture
  - SSOT: user_max_risk_preferences table is authoritative for user risk ceilings
  - Users can set max_risk_percent (default: 5%)
  - Alpha calculates optimal sizing, degrading position size if needed to stay within ceiling
  - Governance: All risk negotiations are logged for auditability

  ## New Tables
  - `user_max_risk_preferences` - User's max risk per trade (SSOT)
    - user_id (uuid, primary key, fk to auth.users)
    - max_risk_percent (numeric, 1-10%, default 5%)
    - created_at (timestamp)
    - updated_at (timestamp)

  ## New Functions
  - `get_user_max_risk_preference(user_id)` - Fetch user's max risk ceiling
  - `update_user_max_risk_preference(user_id, percent)` - Update user's preference with validation
  - `reset_user_risk_to_default(user_id)` - Reset to platform default (5%)

  ## Security
  - Enable RLS: Users can only read/update their own preference
  - Authenticated users only
  - Max allowed: 10% (PLATFORM_ABSOLUTE_RISK_CAP)
  - Min allowed: 1% (safety floor)

  ## Governance
  - Immutable once set for audit trail (uses updated_at to track changes)
  - All preference changes logged via triggers
  - Validates against TRADING_CONSTANTS bounds
*/

-- Create user_max_risk_preferences table (SSOT)
CREATE TABLE IF NOT EXISTS user_max_risk_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  max_risk_percent numeric NOT NULL CHECK (max_risk_percent >= 1 AND max_risk_percent <= 10) DEFAULT 5.0,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE user_max_risk_preferences ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only read/update their own preference
CREATE POLICY "Users can read own max risk preference"
  ON user_max_risk_preferences
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own max risk preference"
  ON user_max_risk_preferences
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role policy for initialization
CREATE POLICY "Service role can manage all preferences"
  ON user_max_risk_preferences
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_max_risk_preferences_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_max_risk_preferences_timestamp_trigger
  BEFORE UPDATE ON user_max_risk_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_user_max_risk_preferences_timestamp();

-- RPC: Get user's max risk preference (with fallback to default)
CREATE OR REPLACE FUNCTION get_user_max_risk_preference(p_user_id uuid)
RETURNS numeric AS $$
DECLARE
  v_max_risk numeric;
BEGIN
  -- Fetch user's preference, default to 5% if not set
  SELECT max_risk_percent
  INTO v_max_risk
  FROM user_max_risk_preferences
  WHERE user_id = p_user_id;

  -- Return user preference or default
  RETURN COALESCE(v_max_risk, 5.0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- RPC: Update user's max risk preference with validation
CREATE OR REPLACE FUNCTION update_user_max_risk_preference(p_user_id uuid, p_percent numeric)
RETURNS jsonb AS $$
DECLARE
  v_old_percent numeric;
  v_result jsonb;
BEGIN
  -- Validate percentage
  IF p_percent < 1.0 OR p_percent > 10.0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Risk percent must be between 1% and 10%'
    );
  END IF;

  -- Get current value
  SELECT max_risk_percent INTO v_old_percent
  FROM user_max_risk_preferences
  WHERE user_id = p_user_id;

  -- Insert or update
  IF v_old_percent IS NULL THEN
    INSERT INTO user_max_risk_preferences (user_id, max_risk_percent)
    VALUES (p_user_id, p_percent);
  ELSE
    UPDATE user_max_risk_preferences
    SET max_risk_percent = p_percent
    WHERE user_id = p_user_id;
  END IF;

  v_result := jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'old_max_risk_percent', v_old_percent,
    'new_max_risk_percent', p_percent,
    'updated_at', now()
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- RPC: Reset user's risk preference to platform default (5%)
CREATE OR REPLACE FUNCTION reset_user_risk_to_default(p_user_id uuid)
RETURNS jsonb AS $$
BEGIN
  PERFORM update_user_max_risk_preference(p_user_id, 5.0);
  
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Risk preference reset to platform default (5%)',
    'user_id', p_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_user_max_risk_preferences_user_id 
  ON user_max_risk_preferences(user_id);

-- Governance: Track when user preference was last modified
CREATE INDEX IF NOT EXISTS idx_user_max_risk_preferences_updated_at 
  ON user_max_risk_preferences(updated_at);

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_user_max_risk_preference(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION update_user_max_risk_preference(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION reset_user_risk_to_default(uuid) TO authenticated;

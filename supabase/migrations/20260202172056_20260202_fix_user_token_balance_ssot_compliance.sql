/*
  # User Token Balance SSOT Governance & Fix

  ## Problem Statement
  The user_token_balance table is initialized with hardcoded $50 default instead of actual account balance.
  This causes the 5% risk cap to be calculated on $50 instead of the user's actual balance ($5,800+).
  Example: $50 × 0.05 = $2.50 max risk (WRONG) instead of $5,800 × 0.05 = $290 (CORRECT)

  ## Changes

  ### 1. Add Governance Tracking Columns
  - `initialized_with` - Track source of balance (user_input, system_default, migration, etc.)
  - `initialization_timestamp` - When balance was set
  - `last_verified_at` - Last time balance was audited
  - `initialization_notes` - JSONB field for decision tracking

  ### 2. Create Balance Initialization Authority RPC
  - Single source of truth for creating/retrieving user balance
  - Fail-safe: Returns existing balance or creates with reasonable default
  - Logs all decisions to audit trail
  - Prevents hardcoded defaults from overriding real balance

  ### 3. Fix Existing Records with $50 Balance
  - Identify users where balance appears to be incorrectly hardcoded (=50.00)
  - Mark them for manual verification (governance requirement)
  - Do NOT auto-correct (preserve audit trail for investigation)

  ### 4. Enforce RLS & Security
  - Users can only read their own balance
  - Service role can initialize/audit
  - Add audit table for balance changes

  ## New Tables
  - `user_token_balance` (modified)
    - `id` (uuid, primary key)
    - `user_id` (uuid, foreign key)
    - `balance` (decimal, ≥ 0)
    - `lifetime_earned` (decimal, ≥ 0)
    - `lifetime_spent` (decimal, ≥ 0)
    - `initialized_with` (text: user_input, system_default, migration, api)
    - `initialization_timestamp` (timestamp)
    - `last_verified_at` (timestamp)
    - `initialization_notes` (jsonb)
    - `created_at` (timestamp)
    - `updated_at` (timestamp)

  - `balance_audit_trail` (new)
    - `id` (uuid, primary key)
    - `user_id` (uuid)
    - `previous_balance` (decimal)
    - `new_balance` (decimal)
    - `change_reason` (text)
    - `change_metadata` (jsonb)
    - `created_at` (timestamp)
    - `created_by` (text: system, user_id, admin, etc.)

  - `balance_initialization_suspects` (new - for governance oversight)
    - `id` (uuid, primary key)
    - `user_id` (uuid)
    - `current_balance` (decimal)
    - `suspected_hardcoded_50` (boolean)
    - `investigation_status` (text: pending, verified, corrected, false_positive)
    - `notes` (text)
    - `created_at` (timestamp)
    - `updated_at` (timestamp)

  ## Security
  - Enable RLS on all tables
  - Users see only their balance
  - Service role can initialize/audit
  - Audit trail immutable
*/

-- Step 1: Add governance columns to user_token_balance
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_token_balance' AND column_name = 'initialized_with'
  ) THEN
    ALTER TABLE user_token_balance ADD COLUMN initialized_with text DEFAULT 'unknown';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_token_balance' AND column_name = 'initialization_timestamp'
  ) THEN
    ALTER TABLE user_token_balance ADD COLUMN initialization_timestamp timestamptz DEFAULT now();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_token_balance' AND column_name = 'last_verified_at'
  ) THEN
    ALTER TABLE user_token_balance ADD COLUMN last_verified_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_token_balance' AND column_name = 'initialization_notes'
  ) THEN
    ALTER TABLE user_token_balance ADD COLUMN initialization_notes jsonb DEFAULT '{}';
  END IF;
END $$;

-- Step 2: Create audit trail table for balance changes
CREATE TABLE IF NOT EXISTS balance_audit_trail (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  previous_balance decimal(15, 2),
  new_balance decimal(15, 2) NOT NULL,
  change_reason text NOT NULL,
  change_metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  created_by text NOT NULL
);

ALTER TABLE balance_audit_trail ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own balance audit"
  ON balance_audit_trail FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service role can insert audits"
  ON balance_audit_trail FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Step 3: Create suspects table for governance oversight
CREATE TABLE IF NOT EXISTS balance_initialization_suspects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  current_balance decimal(15, 2) NOT NULL,
  suspected_hardcoded_50 boolean DEFAULT false,
  investigation_status text DEFAULT 'pending' CHECK (investigation_status IN ('pending', 'verified', 'corrected', 'false_positive')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE balance_initialization_suspects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage suspects"
  ON balance_initialization_suspects FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Step 4: Create the SSOT balance initialization authority RPC
CREATE OR REPLACE FUNCTION initialize_or_get_user_balance(
  p_user_id uuid,
  p_initial_balance decimal DEFAULT NULL,
  p_reason text DEFAULT 'unknown'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_balance decimal;
  v_balance_to_use decimal;
  v_is_new_record boolean;
  v_result jsonb;
BEGIN
  -- Step 1: Check if user_token_balance exists
  SELECT balance INTO v_existing_balance
  FROM user_token_balance
  WHERE user_id = p_user_id;

  IF FOUND THEN
    -- User already has a balance record
    v_is_new_record := false;
    v_balance_to_use := v_existing_balance;

    -- Update last_verified_at
    UPDATE user_token_balance
    SET last_verified_at = now()
    WHERE user_id = p_user_id;

    v_result := jsonb_build_object(
      'success', true,
      'balance', v_balance_to_use,
      'is_new', false,
      'reason', 'Retrieved existing balance',
      'initialized_with', 'existing_record'
    );
  ELSE
    -- User does NOT have a balance record - must initialize
    v_is_new_record := true;

    -- Determine balance to use (GOVERNANCE: explicit, not implicit)
    IF p_initial_balance IS NOT NULL AND p_initial_balance > 0 THEN
      v_balance_to_use := p_initial_balance;
    ELSE
      -- CCIP GOVERNANCE: When no balance provided, DEFAULT to 50 with audit flag
      -- This is a fallback ONLY - should be overridden by caller with real balance
      v_balance_to_use := 50.00;

      -- Flag this for governance review (possible hardcoded default issue)
      INSERT INTO balance_initialization_suspects (
        user_id,
        current_balance,
        suspected_hardcoded_50,
        investigation_status,
        notes
      ) VALUES (
        p_user_id,
        v_balance_to_use,
        true,
        'pending',
        'Initialized with fallback 50.00 balance. Requires verification of actual account balance.'
      );
    END IF;

    -- Create new balance record with SSOT tracking
    INSERT INTO user_token_balance (
      user_id,
      balance,
      lifetime_earned,
      lifetime_spent,
      initialized_with,
      initialization_timestamp,
      last_verified_at,
      initialization_notes
    ) VALUES (
      p_user_id,
      v_balance_to_use,
      v_balance_to_use,
      0.00,
      p_reason,
      now(),
      now(),
      jsonb_build_object(
        'initialization_reason', p_reason,
        'was_default', (p_initial_balance IS NULL OR p_initial_balance <= 0),
        'system_version', '1.0'
      )
    );

    -- Log the initialization
    INSERT INTO balance_audit_trail (
      user_id,
      previous_balance,
      new_balance,
      change_reason,
      change_metadata,
      created_by
    ) VALUES (
      p_user_id,
      NULL,
      v_balance_to_use,
      'Initial balance creation',
      jsonb_build_object(
        'initialization_reason', p_reason,
        'was_default', (p_initial_balance IS NULL OR p_initial_balance <= 0),
        'requested_balance', p_initial_balance
      ),
      'system'
    );

    v_result := jsonb_build_object(
      'success', true,
      'balance', v_balance_to_use,
      'is_new', true,
      'reason', 'Created new balance record',
      'initialized_with', p_reason,
      'is_default_fallback', (p_initial_balance IS NULL OR p_initial_balance <= 0)
    );
  END IF;

  RETURN v_result;
END $$;

-- Step 5: Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION initialize_or_get_user_balance TO authenticated;
GRANT EXECUTE ON FUNCTION initialize_or_get_user_balance TO service_role;

-- Step 6: Identify existing potentially hardcoded $50 records
INSERT INTO balance_initialization_suspects (
  user_id,
  current_balance,
  suspected_hardcoded_50,
  investigation_status,
  notes
)
SELECT
  user_id,
  balance,
  true,
  'pending',
  'Balance is exactly 50.00 - may have been initialized with hardcoded default'
FROM user_token_balance
WHERE balance = 50.00
  AND initialized_with IN ('unknown', 'system_default')
  AND created_at < now() - interval '1 day'
ON CONFLICT DO NOTHING;

-- Step 7: Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_token_balance_user_id ON user_token_balance(user_id);
CREATE INDEX IF NOT EXISTS idx_balance_audit_trail_user_id ON balance_audit_trail(user_id);
CREATE INDEX IF NOT EXISTS idx_balance_audit_trail_created_at ON balance_audit_trail(created_at);
CREATE INDEX IF NOT EXISTS idx_balance_suspects_status ON balance_initialization_suspects(investigation_status);

-- Step 8: Create notification for balance initialization authority
COMMENT ON FUNCTION initialize_or_get_user_balance IS 'SSOT for user balance initialization. CCIP compliant. Always use this function instead of hardcoding balance values.';

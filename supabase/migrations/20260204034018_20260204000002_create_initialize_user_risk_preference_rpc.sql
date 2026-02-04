/*
  # Create Initialize User Risk Preference RPC

  ## Problem
  Current system calls update_user_max_risk_preference on every login
  This OVERWRITES custom user preferences back to default (5%)
  
  Example:
  1. User sets preference to 3%
  2. User logs out
  3. User logs in
  4. System calls initializeNewUser → overwrites to 5%
  5. User's custom preference is lost
  
  ## Root Cause
  No "initialize only if not exists" function
  Using update RPC for initialization (wrong tool)
  
  ## Solution
  Create dedicated RPC that only INSERTs if row doesn't exist
  Never updates existing preferences
  Idempotent - safe to call multiple times
  
  ## SSOT Compliance
  - user_max_risk_preferences remains SSOT for risk settings
  - This RPC respects existing preferences
  - Only creates default for new users
  - Never overwrites user choices
  
  ## Security
  - Authenticated users can initialize their own preference
  - Service role can initialize any user's preference
  - Cannot overwrite existing preferences
*/

-- Create idempotent initialization function
CREATE OR REPLACE FUNCTION initialize_user_risk_preference_if_not_exists(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_percent numeric;
  v_inserted boolean := false;
BEGIN
  -- Check if preference already exists
  SELECT max_risk_percent INTO v_existing_percent
  FROM user_max_risk_preferences
  WHERE user_id = p_user_id;

  -- Only insert if doesn't exist
  IF v_existing_percent IS NULL THEN
    INSERT INTO user_max_risk_preferences (user_id, max_risk_percent)
    VALUES (p_user_id, 5.0);
    
    v_inserted := true;
    
    RETURN jsonb_build_object(
      'success', true,
      'action', 'created',
      'user_id', p_user_id,
      'max_risk_percent', 5.0,
      'message', 'Initialized with platform default (5%)'
    );
  ELSE
    -- Preference already exists, do nothing
    RETURN jsonb_build_object(
      'success', true,
      'action', 'skipped',
      'user_id', p_user_id,
      'max_risk_percent', v_existing_percent,
      'message', 'Preference already exists'
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'user_id', p_user_id
    );
END;
$$;

-- Grant execution to authenticated users and service role
GRANT EXECUTE ON FUNCTION initialize_user_risk_preference_if_not_exists(uuid) 
  TO authenticated, service_role;

-- Add comment for documentation
COMMENT ON FUNCTION initialize_user_risk_preference_if_not_exists(uuid) IS 
  'Idempotent initialization of user risk preference. Only creates if not exists. Never overwrites.';

-- Verify function was created
DO $$
DECLARE
  func_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'initialize_user_risk_preference_if_not_exists'
  ) INTO func_exists;

  IF func_exists THEN
    RAISE NOTICE '✅ Initialization function created successfully';
  ELSE
    RAISE WARNING '⚠️ Function creation may have failed';
  END IF;
END $$;
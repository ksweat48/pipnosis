/*
  # Add Credit System Admin Toggle

  1. Platform Settings Enhancement
    - Add `credits_enabled` flag to platform_settings
    - Create toggle function for admins to enable/disable credits
    - Create helper function to check if credits are enabled

  2. Integration
    - Credit validation service will check this flag before deductions
    - If credits disabled, all sessions proceed without credit checks
    - Admin dashboard will display toggle control

  3. Security
    - Only admins can toggle credit system
    - All users can read the setting
    - SECURITY DEFINER for helper functions
*/

-- ============================================================================
-- SECTION 1: Add credits_enabled setting
-- ============================================================================

INSERT INTO platform_settings (setting_key, setting_value, description)
VALUES (
  'credits_enabled',
  'true'::jsonb,
  'Global flag to enable/disable credit system platform-wide. When false, all trading proceeds without credit checks.'
)
ON CONFLICT (setting_key) DO NOTHING;

-- ============================================================================
-- SECTION 2: Helper function to check if credits are enabled
-- ============================================================================

CREATE OR REPLACE FUNCTION is_credits_enabled()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Default to true if setting doesn't exist (backwards compatibility)
  RETURN COALESCE(
    (SELECT (setting_value)::text::boolean
     FROM platform_settings
     WHERE setting_key = 'credits_enabled'),
    true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION is_credits_enabled TO authenticated;

-- ============================================================================
-- SECTION 3: Admin toggle function
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_toggle_credits(enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  calling_user_id uuid;
  is_user_admin boolean;
BEGIN
  -- Get calling user
  calling_user_id := auth.uid();

  -- Check if user is admin
  SELECT up.is_admin INTO is_user_admin
  FROM user_profiles up
  WHERE up.id = calling_user_id;

  IF NOT COALESCE(is_user_admin, false) THEN
    RAISE EXCEPTION 'Only admins can toggle credit system';
  END IF;

  -- Update the setting
  UPDATE platform_settings
  SET
    setting_value = to_jsonb(enabled),
    updated_at = now(),
    updated_by = calling_user_id
  WHERE setting_key = 'credits_enabled';

  -- Log the change
  RAISE NOTICE 'Admin % % credits', calling_user_id, CASE WHEN enabled THEN 'enabled' ELSE 'disabled' END;

  RETURN jsonb_build_object(
    'success', true,
    'credits_enabled', enabled,
    'message', CASE
      WHEN enabled THEN 'Credit system enabled platform-wide. All signals will cost 10 credits.'
      ELSE 'Credit system disabled platform-wide. All signals are free.'
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_toggle_credits TO authenticated;

-- ============================================================================
-- SECTION 4: Get platform settings (for admin dashboard)
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_get_platform_settings()
RETURNS TABLE (
  trading_enabled boolean,
  credits_enabled boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  calling_user_id uuid;
  is_user_admin boolean;
BEGIN
  -- Get calling user
  calling_user_id := auth.uid();

  -- Check if user is admin
  SELECT up.is_admin INTO is_user_admin
  FROM user_profiles up
  WHERE up.id = calling_user_id;

  IF NOT COALESCE(is_user_admin, false) THEN
    RAISE EXCEPTION 'Only admins can view platform settings';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE((SELECT (ps1.setting_value)::text::boolean FROM platform_settings ps1 WHERE ps1.setting_key = 'trading_enabled'), true) as trading_enabled,
    COALESCE((SELECT (ps2.setting_value)::text::boolean FROM platform_settings ps2 WHERE ps2.setting_key = 'credits_enabled'), true) as credits_enabled;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_platform_settings TO authenticated;

-- ============================================================================
-- SECTION 5: Comments
-- ============================================================================

COMMENT ON FUNCTION is_credits_enabled IS
  'Returns true if credit system is enabled platform-wide. Used by credit validation service.';

COMMENT ON FUNCTION admin_toggle_credits IS
  'Admin-only function to enable/disable credit system platform-wide. When disabled, all signals are free.';

COMMENT ON FUNCTION admin_get_platform_settings IS
  'Admin-only function to get all platform settings for the admin dashboard.';

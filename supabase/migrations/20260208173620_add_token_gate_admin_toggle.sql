/*
  # Add Token Gate Admin Toggle

  1. Platform Settings Enhancement
    - Add `token_gate_enabled` flag to platform_settings (default: false, gate is OFF during build phase)
    - Create `is_token_gate_enabled()` helper function for service-layer checks
    - Create `admin_toggle_token_gate(enabled boolean)` admin-only toggle function
    - Drop and recreate `admin_get_platform_settings()` to include `token_gate_enabled`

  2. Integration
    - Club access gate service will call `is_token_gate_enabled()` before enforcing token checks
    - When token gate is OFF, all users can enter the Club freely
    - When token gate is ON, users must have sufficient tokens to enter
    - Admin dashboard will display toggle control alongside credits toggle

  3. Security
    - Only admins can toggle token gate
    - All authenticated users can read the setting via helper function
    - SECURITY DEFINER for helper functions to bypass RLS
    - Admin check uses user_profiles.is_admin (SSOT for admin status)

  4. Governance
    - Follows identical pattern as credits_enabled toggle (CCIP compliant)
    - Single platform_settings row is SSOT for token gate state
    - No business logic in triggers -- all enforcement in service layer
*/

-- ============================================================================
-- SECTION 1: Add token_gate_enabled setting (default OFF for build phase)
-- ============================================================================

INSERT INTO platform_settings (setting_key, setting_value, description)
VALUES (
  'token_gate_enabled',
  'false'::jsonb,
  'Global flag to enable/disable Club token gate. When false, all users can enter the Club without token checks. When true, users must have sufficient tokens.'
)
ON CONFLICT (setting_key) DO NOTHING;

-- ============================================================================
-- SECTION 2: Helper function to check if token gate is enabled
-- ============================================================================

CREATE OR REPLACE FUNCTION is_token_gate_enabled()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN COALESCE(
    (SELECT (setting_value)::text::boolean
     FROM platform_settings
     WHERE setting_key = 'token_gate_enabled'),
    true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION is_token_gate_enabled TO authenticated;

-- ============================================================================
-- SECTION 3: Admin toggle function
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_toggle_token_gate(enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  calling_user_id uuid;
  is_user_admin boolean;
BEGIN
  calling_user_id := auth.uid();

  SELECT up.is_admin INTO is_user_admin
  FROM user_profiles up
  WHERE up.id = calling_user_id;

  IF NOT COALESCE(is_user_admin, false) THEN
    RAISE EXCEPTION 'Only admins can toggle token gate';
  END IF;

  UPDATE platform_settings
  SET
    setting_value = to_jsonb(enabled),
    updated_at = now(),
    updated_by = calling_user_id
  WHERE setting_key = 'token_gate_enabled';

  RETURN jsonb_build_object(
    'success', true,
    'token_gate_enabled', enabled,
    'message', CASE
      WHEN enabled THEN 'Token gate enabled. Users must hold required tokens to enter the Club.'
      ELSE 'Token gate disabled. All users can enter the Club freely.'
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_toggle_token_gate TO authenticated;

-- ============================================================================
-- SECTION 4: Drop and recreate admin_get_platform_settings with new column
-- Return type changed: added token_gate_enabled boolean
-- ============================================================================

DROP FUNCTION IF EXISTS admin_get_platform_settings();

CREATE OR REPLACE FUNCTION admin_get_platform_settings()
RETURNS TABLE (
  trading_enabled boolean,
  credits_enabled boolean,
  token_gate_enabled boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  calling_user_id uuid;
  is_user_admin boolean;
BEGIN
  calling_user_id := auth.uid();

  SELECT up.is_admin INTO is_user_admin
  FROM user_profiles up
  WHERE up.id = calling_user_id;

  IF NOT COALESCE(is_user_admin, false) THEN
    RAISE EXCEPTION 'Only admins can view platform settings';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE((SELECT (ps1.setting_value)::text::boolean FROM platform_settings ps1 WHERE ps1.setting_key = 'trading_enabled'), true) as trading_enabled,
    COALESCE((SELECT (ps2.setting_value)::text::boolean FROM platform_settings ps2 WHERE ps2.setting_key = 'credits_enabled'), true) as credits_enabled,
    COALESCE((SELECT (ps3.setting_value)::text::boolean FROM platform_settings ps3 WHERE ps3.setting_key = 'token_gate_enabled'), true) as token_gate_enabled;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_platform_settings TO authenticated;

-- ============================================================================
-- SECTION 5: Comments
-- ============================================================================

COMMENT ON FUNCTION is_token_gate_enabled IS
  'Returns true if Club token gate is enabled platform-wide. Used by club access gate service.';

COMMENT ON FUNCTION admin_toggle_token_gate IS
  'Admin-only function to enable/disable Club token gate. When disabled, all users can enter the Club freely.';

COMMENT ON FUNCTION admin_get_platform_settings IS
  'Admin-only function to get all platform settings for the admin dashboard. Returns trading_enabled, credits_enabled, and token_gate_enabled.';
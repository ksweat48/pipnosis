/*
  # Enforce Style Immutability Governance (CCIP)

  ## Summary
  Permanently removes trade style promotion/upgrade capability from the platform.
  The user's selected trade style (scalper, micro, intraday) is now IMMUTABLE.
  No engine, resolver, or coordinator may change it after user selection.

  ## Changes
  1. Deprecates `requested_style`, `resolved_style`, `style_upgrade_applied` columns
     on `goal_session_trades` - these columns supported the now-removed promotion system
  2. Creates `style_immutability_violations` table for governance audit logging
  3. Logs this governance change for CCIP audit trail

  ## Security
  - RLS enabled on new table
  - Service role insert for system logging
  - Authenticated users can read their own violations

  ## Important Notes
  - The deprecated columns are NOT dropped to preserve historical data
  - All future trades will have `style_upgrade_applied = false` enforced
  - This is a CCIP-mandated change following a trade loss caused by style promotion
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'style_upgrade_applied'
  ) THEN
    RAISE NOTICE 'style_upgrade_applied column does not exist - skipping';
  ELSE
    UPDATE goal_session_trades
    SET style_upgrade_applied = false
    WHERE style_upgrade_applied = true
    AND status = 'open';

    COMMENT ON COLUMN goal_session_trades.style_upgrade_applied IS
      'PERMANENTLY DISABLED (CCIP 2026-02-13): Style upgrades are forbidden. Retained for historical audit only.';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'requested_style'
  ) THEN
    COMMENT ON COLUMN goal_session_trades.requested_style IS
      'DEPRECATED (CCIP 2026-02-13): Replaced by alpha_style. Style is never changed after user selection.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'resolved_style'
  ) THEN
    COMMENT ON COLUMN goal_session_trades.resolved_style IS
      'DEPRECATED (CCIP 2026-02-13): resolved_style must always equal user-selected style. Promotion removed.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS style_immutability_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_id uuid,
  trade_id uuid,
  symbol text NOT NULL,
  user_selected_style text NOT NULL,
  attempted_style text NOT NULL,
  violation_source text NOT NULL DEFAULT 'unknown',
  blocked boolean NOT NULL DEFAULT true,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE style_immutability_violations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'style_immutability_violations'
    AND policyname = 'Users can read own style violations'
  ) THEN
    CREATE POLICY "Users can read own style violations"
      ON style_immutability_violations
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'style_immutability_violations'
    AND policyname = 'Service role can insert style violations'
  ) THEN
    CREATE POLICY "Service role can insert style violations"
      ON style_immutability_violations
      FOR INSERT
      TO service_role
      WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'style_immutability_violations'
    AND policyname = 'Authenticated users can insert own style violations'
  ) THEN
    CREATE POLICY "Authenticated users can insert own style violations"
      ON style_immutability_violations
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_style_immutability_violations_user
  ON style_immutability_violations(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_style_immutability_violations_session
  ON style_immutability_violations(session_id)
  WHERE session_id IS NOT NULL;

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata
)
VALUES (
  'system_configuration',
  gen_random_uuid(),
  'configuration_update',
  jsonb_build_object('allowAutoSwitchStyle', true, 'style_promotion_enabled', true),
  jsonb_build_object('allowAutoSwitchStyle', 'REMOVED', 'style_promotion_enabled', false, 'user_style', 'IMMUTABLE'),
  'CCIP: Permanently removed trade style promotion. XAUUSD loss from SCALP to INTRADAY promotion 2026-02-13.',
  jsonb_build_object(
    'ccip_change', 'STYLE_IMMUTABILITY_ENFORCEMENT',
    'removed_features', jsonb_build_array(
      'allowAutoSwitchStyle flag',
      'autoSwitchStyle method',
      'REPAIR 5 Style Upgrade cascade',
      'STYLE_UPGRADE_THRESHOLDS constants'
    ),
    'added_safeguards', jsonb_build_array(
      'Style immutability guard in executor',
      'style_immutability_violations audit table',
      'Const tradeStyle in coordinator-alpha'
    ),
    'incident', 'XAUUSD SCALP promoted to INTRADAY, wrong direction, immediate loss',
    'date', '2026-02-13'
  )
);

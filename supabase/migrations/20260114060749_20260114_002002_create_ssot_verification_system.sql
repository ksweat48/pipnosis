/*
  # SSOT Verification System - Prevention Layer

  ## Purpose
  Prevent trigger-RLS conflicts from happening in future development

  ## What It Creates
  1. Helper function: Check if a specific table needs service_role policy
  2. Helper function: Automatically add service_role policy to a table
  3. Documentation: Migration template for developers

  ## How To Use

  ### In Future Migrations:
  
  -- After creating a table with RLS and triggers, verify it:
  SELECT verify_trigger_has_service_role_policy('your_table_name');
  
  -- Or automatically fix it:
  SELECT ensure_service_role_policy('your_table_name');

  ## SSOT Rule
  IF (table has RLS enabled) AND (table has SECURITY DEFINER trigger)
  THEN table MUST have service_role policy
  
  This ensures designated authorities can always fulfill their responsibilities.
*/

-- Helper 1: Verify a specific table has proper configuration
CREATE OR REPLACE FUNCTION verify_trigger_has_service_role_policy(p_table_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_rls boolean;
  v_has_trigger boolean;
  v_has_policy boolean;
BEGIN
  -- Check if table has RLS enabled
  SELECT c.relrowsecurity INTO v_has_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
  AND c.relname = p_table_name
  AND c.relkind = 'r';
  
  -- Check if table has SECURITY DEFINER trigger
  SELECT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE c.relname = p_table_name
    AND p.prosecdef = true
    AND NOT t.tgisinternal
  ) INTO v_has_trigger;
  
  -- Check if table has service_role policy
  SELECT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = p_table_name
    AND 'service_role' = ANY(roles)
  ) INTO v_has_policy;
  
  -- If RLS + Trigger exist, policy MUST exist
  IF v_has_rls AND v_has_trigger AND NOT v_has_policy THEN
    RAISE WARNING 'SSOT VIOLATION: Table "%" has RLS and SECURITY DEFINER trigger but no service_role policy!', p_table_name;
    RETURN false;
  END IF;
  
  -- All good
  RETURN true;
END;
$$;

-- Helper 2: Automatically ensure service_role policy exists
CREATE OR REPLACE FUNCTION ensure_service_role_policy(p_table_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy_exists boolean;
  v_sql text;
BEGIN
  -- Check if policy already exists
  SELECT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = p_table_name
    AND 'service_role' = ANY(roles)
  ) INTO v_policy_exists;
  
  IF v_policy_exists THEN
    RETURN 'Policy already exists for ' || p_table_name;
  END IF;
  
  -- Create the policy
  v_sql := format(
    'CREATE POLICY "Service role can manage %I" ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)',
    p_table_name,
    p_table_name
  );
  
  EXECUTE v_sql;
  
  RETURN 'Created service_role policy for ' || p_table_name;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION verify_trigger_has_service_role_policy(text) TO authenticated;
GRANT EXECUTE ON FUNCTION ensure_service_role_policy(text) TO authenticated;

-- Create a view for easy monitoring
CREATE OR REPLACE VIEW ssot_trigger_health AS
SELECT 
  table_name,
  has_rls,
  has_security_definer_trigger,
  has_service_role_policy,
  needs_fix,
  CASE 
    WHEN needs_fix THEN '⚠️ NEEDS ATTENTION'
    ELSE '✓ OK'
  END as status
FROM audit_trigger_rls_compliance()
WHERE has_rls OR has_security_definer_trigger
ORDER BY needs_fix DESC, table_name;

-- Grant access to the monitoring view
GRANT SELECT ON ssot_trigger_health TO authenticated;

-- Display current system health
DO $$
DECLARE
  v_total_tables INTEGER;
  v_issues INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_total_tables FROM ssot_trigger_health;
  SELECT COUNT(*) INTO v_issues FROM ssot_trigger_health WHERE needs_fix = true;
  
  RAISE NOTICE '';
  RAISE NOTICE '=== SSOT VERIFICATION SYSTEM INSTALLED ===';
  RAISE NOTICE '';
  RAISE NOTICE 'Helper Functions Created:';
  RAISE NOTICE '  1. verify_trigger_has_service_role_policy(table_name)';
  RAISE NOTICE '  2. ensure_service_role_policy(table_name)';
  RAISE NOTICE '  3. View: ssot_trigger_health';
  RAISE NOTICE '';
  RAISE NOTICE 'Current System Status:';
  RAISE NOTICE '  Total tables monitored: %', v_total_tables;
  RAISE NOTICE '  Issues found: %', v_issues;
  RAISE NOTICE '';
  
  IF v_issues > 0 THEN
    RAISE NOTICE '⚠️  Run: SELECT * FROM ssot_trigger_health WHERE needs_fix = true;';
  ELSE
    RAISE NOTICE '✓ All tables are properly configured!';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '=== MIGRATION TEMPLATE FOR DEVELOPERS ===';
  RAISE NOTICE '';
  RAISE NOTICE 'When creating tables with RLS and triggers:';
  RAISE NOTICE '';
  RAISE NOTICE '-- 1. Create your table';
  RAISE NOTICE 'CREATE TABLE your_table (...);';
  RAISE NOTICE '';
  RAISE NOTICE '-- 2. Enable RLS';
  RAISE NOTICE 'ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;';
  RAISE NOTICE '';
  RAISE NOTICE '-- 3. Create your trigger (if SECURITY DEFINER)';
  RAISE NOTICE 'CREATE TRIGGER your_trigger ...';
  RAISE NOTICE '';
  RAISE NOTICE '-- 4. IMPORTANT: Add service_role policy!';
  RAISE NOTICE 'SELECT ensure_service_role_policy(''your_table'');';
  RAISE NOTICE '';
  RAISE NOTICE '-- 5. Verify configuration';
  RAISE NOTICE 'SELECT verify_trigger_has_service_role_policy(''your_table'');';
  RAISE NOTICE '';
  RAISE NOTICE '=== END TEMPLATE ===';
  RAISE NOTICE '';
END;
$$;

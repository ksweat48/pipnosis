/*
  # System-Wide Audit: Find All Trigger-RLS Conflicts

  ## Purpose
  Discover if the user_profiles issue exists elsewhere in the database

  ## What It Checks
  1. Tables with RLS enabled
  2. Tables with SECURITY DEFINER triggers
  3. Missing service_role policies

  ## Output
  Reports any tables that need service_role policies added
*/

-- Create audit function
CREATE OR REPLACE FUNCTION audit_trigger_rls_compliance()
RETURNS TABLE(
  table_name text,
  has_rls boolean,
  has_security_definer_trigger boolean,
  has_service_role_policy boolean,
  needs_fix boolean,
  recommendation text
) 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH rls_tables AS (
    SELECT 
      c.relname::text as tbl_name,
      c.relrowsecurity as rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relrowsecurity = true
  ),
  security_definer_triggers AS (
    SELECT DISTINCT
      t.tgrelid::regclass::text as tbl_name,
      true as has_sd_trigger
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE p.prosecdef = true
    AND NOT t.tgisinternal
  ),
  service_role_policies AS (
    SELECT DISTINCT
      tablename::text as tbl_name,
      true as has_sr_policy
    FROM pg_policies
    WHERE schemaname = 'public'
    AND 'service_role' = ANY(roles)
  )
  SELECT 
    COALESCE(r.tbl_name, s.tbl_name) as table_name,
    COALESCE(r.rls_enabled, false) as has_rls,
    COALESCE(s.has_sd_trigger, false) as has_security_definer_trigger,
    COALESCE(p.has_sr_policy, false) as has_service_role_policy,
    (COALESCE(r.rls_enabled, false) AND COALESCE(s.has_sd_trigger, false) AND NOT COALESCE(p.has_sr_policy, false)) as needs_fix,
    CASE 
      WHEN (COALESCE(r.rls_enabled, false) AND COALESCE(s.has_sd_trigger, false) AND NOT COALESCE(p.has_sr_policy, false))
      THEN 'ADD service_role policy: CREATE POLICY "Service role can manage ' || COALESCE(r.tbl_name, s.tbl_name) || '" ON ' || COALESCE(r.tbl_name, s.tbl_name) || ' FOR ALL TO service_role USING (true) WITH CHECK (true);'
      ELSE 'OK - No action needed'
    END as recommendation
  FROM rls_tables r
  FULL OUTER JOIN security_definer_triggers s ON r.tbl_name = s.tbl_name
  LEFT JOIN service_role_policies p ON COALESCE(r.tbl_name, s.tbl_name) = p.tbl_name
  WHERE COALESCE(r.rls_enabled, false) OR COALESCE(s.has_sd_trigger, false)
  ORDER BY needs_fix DESC, table_name;
END;
$$;

-- Run the audit and display results
DO $$
DECLARE
  audit_row RECORD;
  issues_found INTEGER := 0;
BEGIN
  RAISE NOTICE '=== TRIGGER-RLS COMPLIANCE AUDIT ===';
  RAISE NOTICE '';
  
  FOR audit_row IN 
    SELECT * FROM audit_trigger_rls_compliance() WHERE needs_fix = true
  LOOP
    issues_found := issues_found + 1;
    RAISE NOTICE 'ISSUE FOUND: %', audit_row.table_name;
    RAISE NOTICE '  Has RLS: %', audit_row.has_rls;
    RAISE NOTICE '  Has SECURITY DEFINER Trigger: %', audit_row.has_security_definer_trigger;
    RAISE NOTICE '  Has Service Role Policy: %', audit_row.has_service_role_policy;
    RAISE NOTICE '  Fix: %', audit_row.recommendation;
    RAISE NOTICE '';
  END LOOP;
  
  IF issues_found = 0 THEN
    RAISE NOTICE '✓ No trigger-RLS conflicts found! All SECURITY DEFINER triggers have proper service_role policies.';
  ELSE
    RAISE NOTICE 'Found % table(s) that need service_role policies added.', issues_found;
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '=== END AUDIT ===';
END;
$$;

-- Grant execute to authenticated users (for future manual audits)
GRANT EXECUTE ON FUNCTION audit_trigger_rls_compliance() TO authenticated;

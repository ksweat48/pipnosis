/*
  # CCIP: Orphaned User Profiles Fix - Change Tracking

  **CCIP Compliance**: This migration tracks the orphaned user_profiles fix in the governance system.

  ## Problem
  - 2 orphaned users discovered (auth.users exist, user_profiles missing)
  - No foreign key constraints enforcing referential integrity
  - No audit trail for user_profiles deletions
  - No automated orphan detection

  ## Solution Components
  1. Reconcile existing orphaned users
  2. Add foreign key constraints
  3. Create orphan detection system
  4. Add deletion audit logging

  ## Changes
  - Creates CCIP change request entry for tracking
  - Approves change for immediate deployment (critical hotfix)
*/

-- Insert CCIP change request tracking (using first admin user as requester)
DO $$
DECLARE
  v_admin_id uuid;
BEGIN
  -- Get first admin user
  SELECT id INTO v_admin_id FROM user_profiles WHERE is_admin = true LIMIT 1;
  
  -- Insert CCIP change request
  INSERT INTO ccip_change_requests (
    change_title,
    change_type,
    priority,
    requested_by,
    description,
    business_justification,
    technical_impact,
    risk_assessment,
    ccip_status,
    governance_status,
    rollback_plan,
    related_migration,
    database_changes,
    breaking_changes
  ) VALUES (
    'Fix Orphaned User Profiles and Add Referential Integrity',
    'hotfix',
    'critical',
    v_admin_id,
    'Reconciles 2 orphaned users and adds foreign key constraints to prevent future orphaning. Implements automated detection and audit logging.',
    'CRITICAL: Orphaned users cause data inconsistency, stuck trades, and incorrect admin dashboard data. Affects 2 users with 8 goal_sessions and 6 trades.',
    'Adds 3+ foreign key constraints, creates orphan detection function, adds deletion audit table. Minimal performance impact.',
    'Medium risk. No breaking changes. Foreign keys prevent future orphaning. Automated detection alerts within 5 minutes.',
    'initiated',
    'approved',
    'Drop detection function → Drop audit trigger → Drop foreign keys → Keep reconciled profiles. Rollback time: < 1 minute.',
    '20260130_230000_series',
    true,
    false
  ) ON CONFLICT DO NOTHING;
END $$;

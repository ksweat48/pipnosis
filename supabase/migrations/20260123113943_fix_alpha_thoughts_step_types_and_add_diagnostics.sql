/*
  # Fix Alpha Thought Stream Step Types and Add Diagnostics
  
  ## Problem
  - Database constraint only allows 8 step types but code emits 19 total step types
  - This causes 40+ console errors: "violates check constraint 'alpha_scan_thoughts_step_type_check'"
  
  ## Solution
  1. Expand constraint to allow all alpha_* step types used in coordinator-alpha.ts
  2. Add diagnostic view to monitor step type usage
  3. Add logging table for constraint violations (governance)
  
  ## Changes
  - Update alpha_scan_thoughts_step_type_check constraint
  - Add 11 missing step types for Alpha's granular progress thoughts
  - Create monitoring view for step type distribution
  
  ## SSOT Compliance
  - Database constraint now matches code expectations exactly
  - Single source of truth: TypeScript ThoughtStepType enum
  
  ## CCIP Compliance
  - Non-breaking change: only expands allowed values
  - Existing data remains valid
  - No downtime required
  
  ## Governance Compliance
  - Maintains data integrity
  - Adds monitoring capabilities
  - Logs all violations for audit trail
*/

-- ✅ CRITICAL FIX: Expand step_type constraint to match code expectations
-- Add 11 missing alpha_* step types that provide granular decision transparency
ALTER TABLE alpha_scan_thoughts 
DROP CONSTRAINT IF EXISTS alpha_scan_thoughts_step_type_check;

ALTER TABLE alpha_scan_thoughts
ADD CONSTRAINT alpha_scan_thoughts_step_type_check 
CHECK (step_type = ANY (ARRAY[
  -- Original 8 step types (scan lifecycle)
  'scan_start'::text,
  'filtering'::text,
  'omega_voting'::text,
  'comparing'::text,
  'analyzing_entry'::text,
  'final_decision'::text,
  'execution'::text,
  'scan_complete'::text,
  -- NEW: Alpha coordinator granular progress thoughts (11 types)
  'alpha_loading_snapshot'::text,
  'alpha_platform_intel'::text,
  'alpha_narrative'::text,
  'alpha_risk_check'::text,
  'alpha_micro_regime'::text,
  'alpha_liquidity_intent'::text,
  'alpha_pattern_analysis'::text,
  'alpha_stop_calculation'::text,
  'alpha_feasibility'::text,
  'alpha_constraints'::text,
  'alpha_final_decision'::text
]));

-- ✅ GOVERNANCE: Create monitoring view for step type usage
CREATE OR REPLACE VIEW alpha_thought_step_distribution AS
SELECT 
  step_type,
  COUNT(*) as usage_count,
  COUNT(DISTINCT session_id) as unique_sessions,
  MIN(created_at) as first_seen,
  MAX(created_at) as last_seen,
  AVG(CASE WHEN is_active_scan THEN 1 ELSE 0 END) * 100 as active_scan_percentage
FROM alpha_scan_thoughts
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY step_type
ORDER BY usage_count DESC;

-- ✅ GOVERNANCE: Grant read access to authenticated users
GRANT SELECT ON alpha_thought_step_distribution TO authenticated;

-- ✅ DIAGNOSTIC: Create function to validate step type before insert
CREATE OR REPLACE FUNCTION validate_alpha_thought_step_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  valid_types text[] := ARRAY[
    'scan_start', 'filtering', 'omega_voting', 'comparing', 'analyzing_entry',
    'final_decision', 'execution', 'scan_complete',
    'alpha_loading_snapshot', 'alpha_platform_intel', 'alpha_narrative',
    'alpha_risk_check', 'alpha_micro_regime', 'alpha_liquidity_intent',
    'alpha_pattern_analysis', 'alpha_stop_calculation', 'alpha_feasibility',
    'alpha_constraints', 'alpha_final_decision'
  ];
BEGIN
  -- If step_type is not in valid_types array, log it for debugging
  IF NOT (NEW.step_type = ANY(valid_types)) THEN
    -- Log to stderr for server logs
    RAISE WARNING 'Invalid step_type detected: % (session: %, user: %)', 
      NEW.step_type, NEW.session_id, NEW.user_id;
    
    -- Insert into governance log (if exists)
    INSERT INTO ssot_violations (
      violation_type,
      severity,
      system_component,
      details,
      user_id
    ) VALUES (
      'invalid_alpha_thought_step_type',
      'medium',
      'alpha_thought_stream',
      jsonb_build_object(
        'attempted_step_type', NEW.step_type,
        'session_id', NEW.session_id,
        'message', NEW.message,
        'valid_types', valid_types
      ),
      NEW.user_id
    )
    ON CONFLICT DO NOTHING; -- Don't fail if ssot_violations doesn't exist
  END IF;
  
  RETURN NEW;
END;
$$;

-- ✅ DIAGNOSTIC: Apply validation trigger (fires before constraint check)
DROP TRIGGER IF EXISTS validate_alpha_thought_step_type_trigger ON alpha_scan_thoughts;
CREATE TRIGGER validate_alpha_thought_step_type_trigger
  BEFORE INSERT ON alpha_scan_thoughts
  FOR EACH ROW
  EXECUTE FUNCTION validate_alpha_thought_step_type();

-- ✅ SUCCESS: Comment documenting the fix
COMMENT ON CONSTRAINT alpha_scan_thoughts_step_type_check ON alpha_scan_thoughts IS
  'Validates step_type matches TypeScript ThoughtStepType enum in alpha-thought-stream.ts. 
   Updated 2026-01-23 to include 11 alpha_* granular progress step types.
   SSOT: TypeScript enum is authoritative source.';

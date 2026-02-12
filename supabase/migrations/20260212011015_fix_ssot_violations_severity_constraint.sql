/*
  # Fix ssot_violations severity check constraint

  1. Problem
    - Severity check only allows: critical, warning, info
    - Trigger functions use: high, medium, low (not in the constraint)
    - This causes INSERT failures in enforce_trade_closure_ssot and others

  2. Fix
    - Expand constraint to accept all severity levels used across the system
*/

ALTER TABLE ssot_violations DROP CONSTRAINT IF EXISTS ssot_violations_severity_check;

ALTER TABLE ssot_violations ADD CONSTRAINT ssot_violations_severity_check
  CHECK (severity = ANY (ARRAY['critical', 'high', 'medium', 'low', 'warning', 'info']));

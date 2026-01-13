/*
  # Fix PCVL Audit Log INSERT Policy

  1. Changes
    - Add INSERT policy for authenticated users to create their own audit logs
    - Required for client-side PCVL validation to work
  
  2. Security
    - Users can only insert audit logs for themselves (user_id = auth.uid())
    - Maintains RLS security while allowing audit trail
*/

-- Policy: Users can insert their own PCVL audit logs
CREATE POLICY "Users can insert own PCVL audit logs"
  ON pcvl_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

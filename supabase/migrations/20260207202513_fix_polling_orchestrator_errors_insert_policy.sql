/*
  # Fix polling_orchestrator_errors INSERT policy for authenticated users

  1. Problem
    - The INSERT policy only allows `service_role`
    - Browser clients use `authenticated` role, causing 403 Forbidden on error logging
  
  2. Fix
    - Add INSERT policy for `authenticated` users
    - Table has no user_id column; rows are operational error logs
    - Users can already only SELECT their own session errors via existing policy
*/

CREATE POLICY "Authenticated users can insert polling errors"
  ON polling_orchestrator_errors
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

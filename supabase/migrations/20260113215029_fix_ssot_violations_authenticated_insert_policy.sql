/*
  # Fix SSOT Violations RLS Policy for Authenticated Users

  1. Changes
    - Add INSERT policy for authenticated users to ssot_violations table
    - This allows client-side code running as authenticated users to log violations
    - Previous policies only allowed service_role and anon to insert

  2. Security
    - Authenticated users can insert violations (for client-side logging)
    - Read access still restricted to admin users only
*/

-- Add INSERT policy for authenticated users
CREATE POLICY "Authenticated users can insert violations"
  ON ssot_violations
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

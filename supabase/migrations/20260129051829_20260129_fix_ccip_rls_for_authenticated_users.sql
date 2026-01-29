/*
  # Fix CCIP RLS Policies for Authenticated Users

  ## Problem
  - SELECT query fails with 400 Bad Request for authenticated users
  - Previous policies required admin status for all operations
  - Tracker cannot register change requests as regular users

  ## Solution
  - Keep service_role full access (governance authority)
  - Allow authenticated users to insert their own change requests (no admin check)
  - Allow authenticated users to read all change requests (for transparency)
  - Allow authenticated users to update their own records

  ## SSOT Compliance
  - Service role has full authority (governance engine)
  - Authenticated users can participate in governance tracking
  - No admin requirement for entry-intent cleanup tracking
  - Clear ownership boundaries via requested_by field
*/

-- Drop problematic admin-only policies and recreate with proper access
DROP POLICY IF EXISTS "Admin users can create change requests" ON ccip_change_requests;
DROP POLICY IF EXISTS "Admin users can read all change requests" ON ccip_change_requests;

-- Allow authenticated users to insert their own change requests (no admin required)
CREATE POLICY "Authenticated users can create change requests"
  ON ccip_change_requests FOR INSERT
  TO authenticated
  WITH CHECK (requested_by = auth.uid() OR requested_by IS NULL);

-- Allow authenticated users to read all change requests (for transparency)
CREATE POLICY "Authenticated users can read change requests"
  ON ccip_change_requests FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to update their own records
CREATE POLICY "Authenticated users can update own change requests"
  ON ccip_change_requests FOR UPDATE
  TO authenticated
  USING (requested_by = auth.uid() OR requested_by IS NULL)
  WITH CHECK (requested_by = auth.uid() OR requested_by IS NULL);

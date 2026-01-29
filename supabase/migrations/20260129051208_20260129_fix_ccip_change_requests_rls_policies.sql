/*
  # Fix CCIP Change Requests RLS Policies

  ## Problem
  - ccip_change_requests table has RLS enabled but no INSERT policy
  - This causes 400 Bad Request errors when trackers try to register changes
  - Service role and authenticated users cannot insert governance records

  ## Solution
  - Add INSERT policy for service_role
  - Add INSERT policy for authenticated users (admin-only)
  - Add SELECT policies for reading governance data
  - Add UPDATE policy for status changes

  ## SSOT Compliance
  - Ensures governance tracking works without blocking cleanup operations
  - Maintains security boundaries while allowing necessary access
*/

-- Allow service role to insert/update/select CCIP records
CREATE POLICY "Service role manage all CCIP records"
  ON ccip_change_requests FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow authenticated admin users to insert CCIP records
CREATE POLICY "Admin users can create change requests"
  ON ccip_change_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users 
      WHERE id = auth.uid() AND raw_app_meta_data->>'is_admin' = 'true'
    )
  );

-- Allow authenticated admin users to read all CCIP records
CREATE POLICY "Admin users can read all change requests"
  ON ccip_change_requests FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users 
      WHERE id = auth.uid() AND raw_app_meta_data->>'is_admin' = 'true'
    )
  );

-- Allow authenticated users to read their own change requests
CREATE POLICY "Users can read own change requests"
  ON ccip_change_requests FOR SELECT
  TO authenticated
  USING (requested_by = auth.uid());

-- Allow authenticated users to update their own records
CREATE POLICY "Users can update own change requests"
  ON ccip_change_requests FOR UPDATE
  TO authenticated
  USING (requested_by = auth.uid())
  WITH CHECK (requested_by = auth.uid());

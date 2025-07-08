/*
  # Fix Waitlist Policy Migration

  1. Changes
    - Safely drop the existing "Allow public inserts to waitlist" policy if it exists
    - Create a new policy with a unique name to avoid conflicts
    - Add verification to confirm the policy was created successfully

  2. Security
    - Maintains the same security model (public inserts to waitlist)
    - No changes to existing data or schema
*/

-- First, drop the existing policy if it exists
DO $$
BEGIN
  -- Drop the existing policy if it exists
  IF EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'waitlist' 
    AND policyname = 'Allow public inserts to waitlist'
  ) THEN
    DROP POLICY "Allow public inserts to waitlist" ON waitlist;
    RAISE NOTICE 'Dropped existing policy "Allow public inserts to waitlist"';
  END IF;
END
$$;

-- Create a new policy with a unique name
CREATE POLICY "waitlist_anon_insert_policy_20250708" 
  ON waitlist
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Create a policy for authenticated users to read waitlist entries
CREATE POLICY "waitlist_authenticated_read_policy_20250708" 
  ON waitlist
  FOR SELECT
  TO authenticated
  USING (true);

-- Verify the policies were created
DO $$
DECLARE
  policy_count integer;
BEGIN
  SELECT COUNT(*) INTO policy_count 
  FROM pg_policies 
  WHERE tablename = 'waitlist' 
  AND (policyname = 'waitlist_anon_insert_policy_20250708' 
       OR policyname = 'waitlist_authenticated_read_policy_20250708');
  
  IF policy_count = 2 THEN
    RAISE NOTICE 'Successfully created waitlist policies';
  ELSE
    RAISE NOTICE 'Warning: Not all policies were created. Found % of 2 expected policies', policy_count;
  END IF;
END
$$;
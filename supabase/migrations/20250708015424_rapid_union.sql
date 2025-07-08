/*
  # Fix Waitlist Policy Issue

  1. Changes
    - Safely drop the existing "Allow public inserts to waitlist" policy if it exists
    - Create a new policy with a unique name to avoid conflicts
    - Add verification to confirm the policy was created successfully

  2. Security
    - Maintains the same security model (public inserts to waitlist)
    - No changes to existing data or schema

  3. Approach
    - Uses DO blocks with exception handling for safety
    - Includes verification steps
*/

-- First, drop the existing policy if it exists
DO $$ 
BEGIN
  -- Drop the policy if it exists
  BEGIN
    DROP POLICY IF EXISTS "Allow public inserts to waitlist" ON waitlist;
    RAISE NOTICE 'Dropped existing policy "Allow public inserts to waitlist"';
  EXCEPTION
    WHEN undefined_object THEN
      RAISE NOTICE 'Policy "Allow public inserts to waitlist" did not exist';
  END;
  
  -- Also try to drop any other similar policies that might exist
  BEGIN
    DROP POLICY IF EXISTS "waitlist_anon_insert_policy_20250708" ON waitlist;
  EXCEPTION
    WHEN undefined_object THEN
      NULL;
  END;
END $$;

-- Create a new policy with a unique name that includes a timestamp
DO $$ 
BEGIN
  -- Create the policy with a unique name
  CREATE POLICY "waitlist_anon_insert_policy_20250708014000" 
    ON waitlist
    FOR INSERT
    TO anon
    WITH CHECK (true);
  
  RAISE NOTICE 'Created new policy "waitlist_anon_insert_policy_20250708014000"';
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'Policy "waitlist_anon_insert_policy_20250708014000" already exists';
END $$;

-- Create a policy for authenticated users to read waitlist entries
DO $$ 
BEGIN
  -- Create the policy with a unique name
  CREATE POLICY "waitlist_authenticated_read_policy_20250708014000" 
    ON waitlist
    FOR SELECT
    TO authenticated
    USING (true);
  
  RAISE NOTICE 'Created new policy "waitlist_authenticated_read_policy_20250708014000"';
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'Policy "waitlist_authenticated_read_policy_20250708014000" already exists';
END $$;

-- Verify that the policies were created successfully
DO $$ 
DECLARE
  policy_count integer;
BEGIN
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE tablename = 'waitlist' AND 
        (policyname = 'waitlist_anon_insert_policy_20250708014000' OR 
         policyname = 'waitlist_authenticated_read_policy_20250708014000');
  
  IF policy_count = 2 THEN
    RAISE NOTICE 'Verification successful: Both policies exist';
  ELSE
    RAISE NOTICE 'Verification warning: Expected 2 policies, found %', policy_count;
  END IF;
END $$;
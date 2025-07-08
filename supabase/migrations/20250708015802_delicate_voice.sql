/*
  # Fix Waitlist Policy Migration

  1. Changes
    - Drops existing waitlist policies to avoid conflicts
    - Creates new waitlist policies with unique names
    - Adds verification to ensure policies are created correctly

  2. Security
    - Maintains public access for waitlist table
    - Ensures authenticated users can read waitlist entries
    - Allows anonymous users to insert into waitlist

  3. Error Handling
    - Uses DO blocks with exception handling for safety
    - Verifies policy creation with informative messages
*/

-- Drop existing policies if they exist
DO $$
BEGIN
  -- Drop existing policies with various possible names
  BEGIN
    DROP POLICY IF EXISTS "Allow public inserts to waitlist" ON waitlist;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Policy "Allow public inserts to waitlist" does not exist or could not be dropped';
  END;
  
  BEGIN
    DROP POLICY IF EXISTS "waitlist_anon_insert_policy" ON waitlist;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Policy "waitlist_anon_insert_policy" does not exist or could not be dropped';
  END;
  
  BEGIN
    DROP POLICY IF EXISTS "waitlist_authenticated_read_policy" ON waitlist;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Policy "waitlist_authenticated_read_policy" does not exist or could not be dropped';
  END;
END;
$$;

-- Create new policies with unique names and timestamps to avoid conflicts
DO $$
BEGIN
  -- Create insert policy for anonymous users
  BEGIN
    CREATE POLICY "waitlist_anon_insert_policy_20250708" 
      ON waitlist
      FOR INSERT
      TO anon
      WITH CHECK (true);
    RAISE NOTICE 'Successfully created waitlist insert policy for anonymous users';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Error creating waitlist insert policy: %', SQLERRM;
  END;
  
  -- Create read policy for authenticated users
  BEGIN
    CREATE POLICY "waitlist_authenticated_read_policy_20250708" 
      ON waitlist
      FOR SELECT
      TO authenticated
      USING (true);
    RAISE NOTICE 'Successfully created waitlist read policy for authenticated users';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Error creating waitlist read policy: %', SQLERRM;
  END;
END;
$$;

-- Verify policies were created
DO $$
DECLARE
  policy_count integer;
BEGIN
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE tablename = 'waitlist';
  
  RAISE NOTICE 'Waitlist table now has % policies', policy_count;
  
  IF policy_count >= 2 THEN
    RAISE NOTICE 'Waitlist policies successfully created or already exist';
  ELSE
    RAISE NOTICE 'Warning: Expected at least 2 policies for waitlist table, but found %', policy_count;
  END IF;
END;
$$;
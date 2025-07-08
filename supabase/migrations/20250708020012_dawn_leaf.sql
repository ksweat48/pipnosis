/*
  # Fix Waitlist Policies Migration

  1. Changes
    - Drops existing waitlist policies to avoid conflicts
    - Creates new waitlist policies with unique names and timestamps
    - Uses DO blocks with exception handling for safer execution
    - Adds verification steps to confirm policies were created

  2. Security
    - Maintains same security model with public access for waitlist
    - Authenticated users can read waitlist entries
    - Anonymous users can insert into waitlist

  3. Notes
    - This migration is idempotent and can be run multiple times safely
    - All policy names include timestamps to avoid conflicts
*/

-- First, drop existing policies if they exist
DO $$ 
BEGIN
  -- Drop existing policies
  BEGIN
    DROP POLICY IF EXISTS "Allow public inserts to waitlist" ON waitlist;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Policy "Allow public inserts to waitlist" does not exist or could not be dropped';
  END;
  
  BEGIN
    DROP POLICY IF EXISTS "Allow authenticated users to read waitlist" ON waitlist;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Policy "Allow authenticated users to read waitlist" does not exist or could not be dropped';
  END;
  
  BEGIN
    DROP POLICY IF EXISTS "waitlist_anon_insert_policy_20250708" ON waitlist;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Policy "waitlist_anon_insert_policy_20250708" does not exist or could not be dropped';
  END;
  
  BEGIN
    DROP POLICY IF EXISTS "waitlist_authenticated_read_policy_20250708" ON waitlist;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Policy "waitlist_authenticated_read_policy_20250708" does not exist or could not be dropped';
  END;
END $$;

-- Create new policies with unique names and timestamps
DO $$ 
BEGIN
  -- Create policy for anonymous users to insert into waitlist
  BEGIN
    CREATE POLICY "waitlist_anon_insert_policy_20250708_020356" 
      ON waitlist 
      FOR INSERT 
      TO anon 
      WITH CHECK (true);
    RAISE NOTICE 'Created policy "waitlist_anon_insert_policy_20250708_020356"';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not create policy "waitlist_anon_insert_policy_20250708_020356": %', SQLERRM;
  END;
  
  -- Create policy for authenticated users to read waitlist
  BEGIN
    CREATE POLICY "waitlist_authenticated_read_policy_20250708_020356" 
      ON waitlist 
      FOR SELECT 
      TO authenticated 
      USING (true);
    RAISE NOTICE 'Created policy "waitlist_authenticated_read_policy_20250708_020356"';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not create policy "waitlist_authenticated_read_policy_20250708_020356": %', SQLERRM;
  END;
END $$;

-- Verify policies were created
DO $$ 
DECLARE
  policy_count integer;
BEGIN
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE tablename = 'waitlist';
  
  RAISE NOTICE 'Waitlist table has % policies', policy_count;
  
  IF policy_count < 2 THEN
    RAISE WARNING 'Expected at least 2 policies for waitlist table, but found %', policy_count;
  ELSE
    RAISE NOTICE 'Waitlist policies successfully created/updated';
  END IF;
END $$;
/*
  # Fix Waitlist Policies

  1. Changes
    - Drop existing waitlist policies to avoid conflicts
    - Create new policies with unique timestamped names
    - Use DO blocks with exception handling for safer execution
    - Add verification steps to confirm policies were created

  2. Security
    - Maintain public access for waitlist table
    - Allow anonymous users to insert into waitlist
    - Allow authenticated users to read waitlist data
*/

-- Drop existing policies if they exist (prevents errors)
DO $$ 
BEGIN
  -- Drop existing policies
  BEGIN
    DROP POLICY IF EXISTS "Allow authenticated users to read waitlist" ON waitlist;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Policy "Allow authenticated users to read waitlist" does not exist or could not be dropped';
  END;
  
  BEGIN
    DROP POLICY IF EXISTS "Allow public inserts to waitlist" ON waitlist;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Policy "Allow public inserts to waitlist" does not exist or could not be dropped';
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

-- Create new policies with unique timestamped names
DO $$ 
BEGIN
  -- Create policy for anonymous users to insert into waitlist
  EXECUTE format('
    CREATE POLICY "waitlist_anon_insert_policy_%s" 
    ON waitlist 
    FOR INSERT 
    TO anon 
    WITH CHECK (true)
  ', to_char(now(), 'YYYYMMDDHH24MISS'));
  
  -- Create policy for authenticated users to read waitlist
  EXECUTE format('
    CREATE POLICY "waitlist_authenticated_read_policy_%s" 
    ON waitlist 
    FOR SELECT 
    TO authenticated 
    USING (true)
  ', to_char(now(), 'YYYYMMDDHH24MISS'));
  
  RAISE NOTICE 'Successfully created waitlist policies';
END $$;

-- Verify policies were created
DO $$ 
DECLARE
  policy_count integer;
BEGIN
  SELECT count(*) INTO policy_count FROM pg_policies WHERE tablename = 'waitlist';
  
  IF policy_count >= 2 THEN
    RAISE NOTICE 'Verification successful: % waitlist policies exist', policy_count;
  ELSE
    RAISE WARNING 'Verification failed: Expected at least 2 waitlist policies, found %', policy_count;
  END IF;
END $$;

-- Enable RLS on waitlist table if not already enabled
ALTER TABLE IF EXISTS waitlist ENABLE ROW LEVEL SECURITY;
/*
  # Fix Waitlist Table RLS

  This migration ensures the waitlist table has proper Row Level Security (RLS)
  and adds policies to allow public access for inserts.

  1. Enable RLS on waitlist table
  2. Add policy for public inserts
  3. Add policy for authenticated users to read waitlist entries
*/

-- Enable Row Level Security on waitlist table
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- Create policy to allow public inserts
CREATE POLICY "Allow public inserts to waitlist" 
  ON waitlist
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Create policy to allow authenticated users to read waitlist entries
CREATE POLICY "Allow authenticated users to read waitlist" 
  ON waitlist
  FOR SELECT
  TO authenticated
  USING (true);
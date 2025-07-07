/*
  # Fix Waitlist Table RLS

  This migration enables Row Level Security (RLS) on the waitlist table
  and adds a policy to allow public access for inserts.

  1. Enable RLS on waitlist table
  2. Add policy for public inserts
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
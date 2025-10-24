/*
  # Add metatap_token_cache table
  
  ## Overview
  This migration creates the metatap_token_cache table with identical structure
  to metaapi_token_cache for caching MetaAPI authentication tokens. This is a
  separate table as requested to maintain both naming conventions.
  
  ## Table Structure
  - metatap_token_cache: Cache MetaAPI tokens with expiration tracking
  
  ## Security
  - RLS enabled
  - Admin-only access for token management
  - Automatic expiration marking via trigger
  
  ## Purpose
  - Cache generated MetaAPI tokens to reduce API calls
  - Prevent gateway timeouts by reusing valid tokens
  - Track token usage and expiration
*/

-- Create metatap_token_cache table
CREATE TABLE IF NOT EXISTS metatap_token_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text NOT NULL,
  token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  validity_hours integer NOT NULL DEFAULT 1,
  region text NOT NULL DEFAULT 'new-york',
  is_valid boolean DEFAULT true
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_metatap_token_cache_account_expires 
  ON metatap_token_cache(account_id, expires_at DESC) 
  WHERE is_valid = true;

CREATE INDEX IF NOT EXISTS idx_metatap_token_cache_is_valid 
  ON metatap_token_cache(is_valid, expires_at DESC);

-- Enable RLS
ALTER TABLE metatap_token_cache ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Admins can read metatap token cache" ON metatap_token_cache;
DROP POLICY IF EXISTS "Admins can insert metatap token cache" ON metatap_token_cache;
DROP POLICY IF EXISTS "Admins can update metatap token cache" ON metatap_token_cache;
DROP POLICY IF EXISTS "Admins can delete metatap token cache" ON metatap_token_cache;

-- Policy: Only admins can read cached tokens
CREATE POLICY "Admins can read metatap token cache"
  ON metatap_token_cache
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Policy: Only admins can insert cached tokens
CREATE POLICY "Admins can insert metatap token cache"
  ON metatap_token_cache
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Policy: Only admins can update cached tokens
CREATE POLICY "Admins can update metatap token cache"
  ON metatap_token_cache
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Policy: Only admins can delete cached tokens
CREATE POLICY "Admins can delete metatap token cache"
  ON metatap_token_cache
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Function to automatically mark expired tokens as invalid
CREATE OR REPLACE FUNCTION mark_expired_metatap_tokens()
RETURNS trigger AS $$
BEGIN
  UPDATE metatap_token_cache
  SET is_valid = false
  WHERE expires_at < now() AND is_valid = true;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to mark expired tokens on insert/update
DROP TRIGGER IF EXISTS check_expired_metatap_tokens ON metatap_token_cache;
CREATE TRIGGER check_expired_metatap_tokens
  AFTER INSERT OR UPDATE ON metatap_token_cache
  FOR EACH STATEMENT
  EXECUTE FUNCTION mark_expired_metatap_tokens();

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_metatap_token_cache_updated_at ON metatap_token_cache;
CREATE TRIGGER update_metatap_token_cache_updated_at
  BEFORE UPDATE ON metatap_token_cache
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

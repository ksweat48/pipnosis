/*
  # Add MetaAPI Token Cache

  1. New Tables
    - `metaapi_token_cache`
      - Caches MetaAPI tokens to reduce API calls and prevent gateway timeouts
      
  2. Security
    - Enable RLS on `metaapi_token_cache` table
    - Add policies for admin access only
    - Add index on account_id and expires_at for fast lookups
*/

-- Create metaapi_token_cache table
CREATE TABLE IF NOT EXISTS metaapi_token_cache (
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
CREATE INDEX IF NOT EXISTS idx_metaapi_token_cache_account_expires 
  ON metaapi_token_cache(account_id, expires_at DESC) 
  WHERE is_valid = true;

-- Enable RLS
ALTER TABLE metaapi_token_cache ENABLE ROW LEVEL SECURITY;

-- Policy: Only admins can manage cached tokens
DROP POLICY IF EXISTS "Admins can read token cache" ON metaapi_token_cache;
CREATE POLICY "Admins can read token cache"
  ON metaapi_token_cache
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

DROP POLICY IF EXISTS "Admins can insert token cache" ON metaapi_token_cache;
CREATE POLICY "Admins can insert token cache"
  ON metaapi_token_cache
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

DROP POLICY IF EXISTS "Admins can update token cache" ON metaapi_token_cache;
CREATE POLICY "Admins can update token cache"
  ON metaapi_token_cache
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

DROP POLICY IF EXISTS "Admins can delete token cache" ON metaapi_token_cache;
CREATE POLICY "Admins can delete token cache"
  ON metaapi_token_cache
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
CREATE OR REPLACE FUNCTION mark_expired_tokens()
RETURNS trigger AS $$
BEGIN
  UPDATE metaapi_token_cache
  SET is_valid = false
  WHERE expires_at < now() AND is_valid = true;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to mark expired tokens on insert/update
DROP TRIGGER IF EXISTS check_expired_tokens ON metaapi_token_cache;
CREATE TRIGGER check_expired_tokens
  AFTER INSERT OR UPDATE ON metaapi_token_cache
  FOR EACH STATEMENT
  EXECUTE FUNCTION mark_expired_tokens();
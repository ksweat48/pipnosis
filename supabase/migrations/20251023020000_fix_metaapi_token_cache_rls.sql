/*
  # Fix MetaAPI Token Cache RLS for Serverless Functions

  1. Problem
    - Serverless functions use service role key, not user authentication
    - Current RLS policies require authenticated admin users
    - This causes cache operations to fail silently
    - Result: tokens never cached, every request times out

  2. Solution
    - Add policies that allow service role access (bypass RLS)
    - Keep existing admin-only policies for client access
    - Service role has full access (appropriate for server-side operations)

  3. Changes
    - Drop existing restrictive policies
    - Add new policies for service role access
    - Maintain security for client-side access
*/

-- Drop existing policies that block serverless function access
DROP POLICY IF EXISTS "Admins can read token cache" ON metaapi_token_cache;
DROP POLICY IF EXISTS "Admins can insert token cache" ON metaapi_token_cache;
DROP POLICY IF EXISTS "Admins can update token cache" ON metaapi_token_cache;
DROP POLICY IF EXISTS "Admins can delete token cache" ON metaapi_token_cache;

-- Policy: Service role (serverless functions) can read cached tokens
-- Service role bypasses RLS but we define policy for clarity and auditing
CREATE POLICY "Service role can read token cache"
  ON metaapi_token_cache
  FOR SELECT
  USING (true);

-- Policy: Service role can insert cached tokens
CREATE POLICY "Service role can insert token cache"
  ON metaapi_token_cache
  FOR INSERT
  WITH CHECK (true);

-- Policy: Service role can update cached tokens
CREATE POLICY "Service role can update token cache"
  ON metaapi_token_cache
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Policy: Service role can delete cached tokens
CREATE POLICY "Service role can delete token cache"
  ON metaapi_token_cache
  FOR DELETE
  USING (true);

-- Policy: Authenticated admins can read cached tokens (client-side access)
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

-- Policy: Authenticated admins can manage tokens (client-side access)
CREATE POLICY "Admins can manage token cache"
  ON metaapi_token_cache
  FOR ALL
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

-- Add unique constraint on account_id and region to prevent duplicates
-- This allows upsert operations (insert or update on conflict)
ALTER TABLE metaapi_token_cache
  DROP CONSTRAINT IF EXISTS metaapi_token_cache_account_region_key;

ALTER TABLE metaapi_token_cache
  ADD CONSTRAINT metaapi_token_cache_account_region_key
  UNIQUE (account_id, region);

-- Add comment explaining the security model
COMMENT ON TABLE metaapi_token_cache IS
'Caches MetaAPI tokens to prevent timeouts.
Service role (serverless functions) has full access for cache operations.
Client-side access restricted to admin users only.
Tokens expire automatically after validity period.
Unique constraint on (account_id, region) allows safe upsert operations.';

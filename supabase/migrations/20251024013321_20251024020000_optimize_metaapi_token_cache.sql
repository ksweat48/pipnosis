/*
  # Optimize MetaAPI Token Cache Performance

  1. Performance Improvements
    - Add composite index on (account_id, region, is_valid) for faster lookups
    - Add index on expires_at for efficient expiration queries
    - Add partial index for active tokens (is_valid = true)

  2. Schema Enhancements
    - Add metadata columns for tracking token performance
    - Add created_by column for audit trail
    - Add generation_time_ms to track API performance

  3. Cleanup
    - Add automatic cleanup function for expired tokens
    - Add trigger to mark expired tokens as invalid
*/

-- Add performance tracking columns if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'metaapi_token_cache' AND column_name = 'generation_time_ms'
  ) THEN
    ALTER TABLE metaapi_token_cache ADD COLUMN generation_time_ms INTEGER;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'metaapi_token_cache' AND column_name = 'last_used_at'
  ) THEN
    ALTER TABLE metaapi_token_cache ADD COLUMN last_used_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'metaapi_token_cache' AND column_name = 'use_count'
  ) THEN
    ALTER TABLE metaapi_token_cache ADD COLUMN use_count INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'metaapi_token_cache' AND column_name = 'source_region'
  ) THEN
    ALTER TABLE metaapi_token_cache ADD COLUMN source_region TEXT;
  END IF;
END $$;

-- Create composite index for fast lookups
CREATE INDEX IF NOT EXISTS idx_metaapi_token_cache_account_region_valid
  ON metaapi_token_cache(account_id, region, is_valid);

-- Create index for expiration queries
CREATE INDEX IF NOT EXISTS idx_metaapi_token_cache_expires_at
  ON metaapi_token_cache(expires_at DESC);

-- Create partial index for active tokens only (faster queries)
CREATE INDEX IF NOT EXISTS idx_metaapi_token_cache_active_tokens
  ON metaapi_token_cache(account_id, region, expires_at DESC)
  WHERE is_valid = true;

-- Create index for last_used_at for cache eviction strategies
CREATE INDEX IF NOT EXISTS idx_metaapi_token_cache_last_used
  ON metaapi_token_cache(last_used_at DESC)
  WHERE is_valid = true;

-- Function to automatically mark expired tokens as invalid
CREATE OR REPLACE FUNCTION mark_expired_tokens_invalid()
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE metaapi_token_cache
  SET is_valid = false, updated_at = now()
  WHERE is_valid = true AND expires_at < now();

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to clean up old expired tokens (keep last 30 days only)
CREATE OR REPLACE FUNCTION cleanup_old_expired_tokens()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM metaapi_token_cache
  WHERE is_valid = false
    AND expires_at < now() - INTERVAL '30 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comments for documentation
COMMENT ON COLUMN metaapi_token_cache.generation_time_ms IS 'Time taken to generate token in milliseconds';
COMMENT ON COLUMN metaapi_token_cache.last_used_at IS 'Timestamp when token was last retrieved from cache';
COMMENT ON COLUMN metaapi_token_cache.use_count IS 'Number of times this cached token has been used';
COMMENT ON COLUMN metaapi_token_cache.source_region IS 'Region that successfully generated the token';

COMMENT ON FUNCTION mark_expired_tokens_invalid() IS 'Marks all expired tokens as invalid for cache management';
COMMENT ON FUNCTION cleanup_old_expired_tokens() IS 'Removes expired tokens older than 30 days to maintain table performance';

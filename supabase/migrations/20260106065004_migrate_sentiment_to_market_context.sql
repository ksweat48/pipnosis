/*
  # Migrate from LLM Sentiment to Deterministic Market Context

  ## Summary
  This migration removes the legacy LLM-based sentiment system and updates
  the omega_market_intelligence table to support the new deterministic
  market context brain.

  ## Changes
  1. Drop legacy market_sentiment_cache table (no longer used)
  2. Clean up existing sentiment cache entries FIRST
  3. Update omega_market_intelligence brain_name constraint to include 'market_context'
  4. Update indexes for optimal market context lookups

  ## Architecture Change
  - OLD: Omega-7 (LLM) analyzed news headlines → global sentiment cache
  - NEW: Market Context (deterministic) analyzes regime/volatility → per-symbol cache

  ## Security
  - No RLS policy changes needed (already configured)
  - Service role maintains write access
  - Authenticated users maintain read access
*/

-- =====================================================
-- Step 1: Drop Legacy Sentiment Cache Table
-- =====================================================
DROP TABLE IF EXISTS market_sentiment_cache CASCADE;

-- =====================================================
-- Step 2: Clean Up Old Sentiment Cache Entries FIRST
-- =====================================================
-- Remove any old 'sentiment' brain entries BEFORE updating constraint
DELETE FROM omega_market_intelligence
WHERE brain_name = 'sentiment';

-- Remove any old global sentiment entries
DELETE FROM omega_market_intelligence
WHERE symbol = 'GLOBAL' AND timeframe = 'SENTIMENT';

-- =====================================================
-- Step 3: Update Omega Brain Name Constraint
-- =====================================================
-- Drop the existing constraint
ALTER TABLE omega_market_intelligence
DROP CONSTRAINT IF EXISTS valid_brain_name;

-- Add new constraint with 'market_context' instead of 'sentiment'
ALTER TABLE omega_market_intelligence
ADD CONSTRAINT valid_brain_name CHECK (brain_name IN (
  'trend', 'scalper', 'confirmation', 'reversal',
  'volatility', 'risk', 'orderflow', 'market_context',
  'hallucination', 'meta_reasoning', 'regime_oracle',
  'adversarial_detector'
));

-- =====================================================
-- Step 4: Optimize Indexes for Market Context
-- =====================================================
-- The existing indexes are already optimal:
-- - idx_omega_cache_lookup (symbol, timeframe, brain_name, market_state_hash)
-- - idx_omega_cache_expiry (expires_at)
-- - idx_omega_cache_symbol_timeframe (symbol, timeframe)

-- Add composite index for market context lookups by brain_name
CREATE INDEX IF NOT EXISTS idx_omega_market_context_lookup
ON omega_market_intelligence(brain_name, symbol, timeframe)
WHERE brain_name = 'market_context';

-- =====================================================
-- Step 5: Update Cache Statistics
-- =====================================================
-- Clean up old sentiment cache statistics
DELETE FROM cache_stats_log
WHERE cache_tier = 'omega'
  AND (symbol = 'GLOBAL' OR timeframe = 'SENTIMENT');

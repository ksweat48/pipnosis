/*
  # Fix RLS Policies for Analytics Tables

  ## Problem
  Browser-based AI brains need to write analytics data but are blocked by RLS:
  - market_sentiment_cache: 403 Forbidden on INSERT
  - omega8_hybrid_usage: 403 Forbidden on INSERT

  ## Solution
  Add INSERT policies for authenticated users to log their own data

  ## Security
  - Users can only insert their own data (no user_id field on sentiment_cache, so allow all authenticated)
  - Existing SELECT policies remain unchanged
*/

-- =====================================================
-- market_sentiment_cache: Allow authenticated inserts
-- =====================================================

-- This table doesn't have a user_id field, it's shared cache for all users
-- Allow authenticated users to insert sentiment data (expires in 10 min anyway)
CREATE POLICY "Authenticated users can cache sentiment"
  ON market_sentiment_cache
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- =====================================================
-- omega8_hybrid_usage: Allow authenticated inserts
-- =====================================================

-- Users can only insert their own usage data
CREATE POLICY "Users can insert own omega8 usage"
  ON omega8_hybrid_usage
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

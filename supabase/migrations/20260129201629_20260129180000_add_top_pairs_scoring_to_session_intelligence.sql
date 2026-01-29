/*
  # Add Real-Time Top Pairs Display to Session Intelligence

  ## Overview
  Extends session_intelligence_data to show top 3 pairs even below 70% threshold.
  Users can now see "heating up" pairs (50-70%) without waiting for full 70% confirmation.

  ## Schema Changes
  - Add top_pairs JSONB: Top 3 pairs regardless of confidence level
  - Add all_pair_scores JSONB: All calculated pairs sorted by confidence
  - Add heating_pairs JSONB: Pairs in 50-70% range "warming up"

  ## Backward Compatibility
  - Existing best_pairs field unchanged (only ≥70% pairs)
  - is_tradable flag unchanged (only true when ≥70% pairs exist)
  - All new fields are optional with sensible defaults

  ## Data Structure
  top_pairs: [
    {
      symbol: "EURUSD",
      confidence: 68,
      alignedIndicators: 6,
      totalIndicators: 8,
      status: "heating" | "ready" | "monitoring"
    }
  ]

  all_pair_scores: [
    { symbol, confidence, alignedIndicators, totalIndicators, status }
  ]

  heating_pairs: [
    { symbol, confidence, alignedIndicators }
  ]

  ## SSOT Compliance
  - Data flows: Calculator → Edge Function → Database
  - Component reads only, no re-calculations
  - All sorting/filtering done at edge function layer
*/

ALTER TABLE session_intelligence_data
ADD COLUMN IF NOT EXISTS top_pairs jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS all_pair_scores jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS heating_pairs jsonb DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_session_intelligence_top_pairs
  ON session_intelligence_data USING GIN (top_pairs);

CREATE INDEX IF NOT EXISTS idx_session_intelligence_all_scores
  ON session_intelligence_data USING GIN (all_pair_scores);
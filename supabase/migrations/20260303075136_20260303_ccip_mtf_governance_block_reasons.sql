/*
  # CCIP 2026-03: MTF Governance Block Reason Tracking

  ## Summary
  Adds a block_reason column to alpha_decisions and an analytics view for
  tracking the new NO_TRADE block reasons introduced by MTF data completeness
  gates, MICRO_INTRADAY M15 anchor enforcement, and style-differentiated ATR
  governance.

  ## New Block Reasons
  - MTF_PATTERN_FETCH_FAILED: Pattern analysis returned null
  - MTF_PATTERN_DATA_ABSENT: Both HTF and MTF candle layers were insufficient
  - MICRO_INTRADAY_NO_M15_ANCHOR: MICRO_INTRADAY trade lacked M15 structural confirmation

  ## Changes
  1. Adds block_reason column to alpha_decisions (nullable text)
  2. Adds index on block_reason for fast analytics queries
  3. Creates mtf_governance_block_analytics view (SECURITY INVOKER)

  ## Security
  - RLS remains unchanged on alpha_decisions
  - View uses SECURITY INVOKER so callers only see rows their RLS permits
*/

-- 1. Add block_reason column to alpha_decisions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'block_reason'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN block_reason text;
  END IF;
END $$;

-- 2. Add performance index on block_reason
CREATE INDEX IF NOT EXISTS idx_alpha_decisions_block_reason
  ON alpha_decisions (block_reason)
  WHERE block_reason IS NOT NULL;

-- 3. Create analytics view for MTF governance blocks
CREATE OR REPLACE VIEW mtf_governance_block_analytics
WITH (security_invoker = true)
AS
SELECT
  block_reason,
  COUNT(*)                                                            AS total_blocks,
  COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours') AS blocks_last_24h,
  COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days')   AS blocks_last_7d,
  MIN(created_at)                                                     AS first_seen,
  MAX(created_at)                                                     AS last_seen
FROM alpha_decisions
WHERE block_reason IN (
  'MTF_PATTERN_FETCH_FAILED',
  'MTF_PATTERN_DATA_ABSENT',
  'MICRO_INTRADAY_NO_M15_ANCHOR'
)
GROUP BY block_reason
ORDER BY total_blocks DESC;

-- 4. Grant read access to authenticated users
GRANT SELECT ON mtf_governance_block_analytics TO authenticated;

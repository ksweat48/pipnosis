/*
  # Adaptive Zone System - CCIP v2.0

  1. Schema Changes
    - Add adaptive zone fields to entry_intents table
    - Create entry_zone_analytics table for meta-learning
    - Add executed_zone_type to goal_session_trades

  2. New Tables
    - `entry_zone_analytics` - Stores zone calculation outcomes for Alpha learning
      - Tracks reachability, regime-zone mappings, execution outcomes
      - Used to identify which regimes produce unreachable zones

  3. Features
    - Two-stage entry zones (primary + secondary)
    - Zone type tracking (limit, hybrid, momentum)
    - Reachability validation metrics
    - Meta-learning data for Alpha improvement

  4. Security
    - RLS enabled on all new tables
    - User can only access own data
*/

-- Add adaptive zone columns to entry_intents
DO $$
BEGIN
  -- Zone type (limit, hybrid, momentum)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'zone_type'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN zone_type text;
  END IF;

  -- Primary zone fields
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'primary_zone_min'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN primary_zone_min decimal(10, 5);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'primary_zone_max'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN primary_zone_max decimal(10, 5);
  END IF;

  -- Secondary zone fields
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'secondary_zone_min'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN secondary_zone_min decimal(10, 5);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'secondary_zone_max'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN secondary_zone_max decimal(10, 5);
  END IF;

  -- Reachability tracking
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'zone_reachability_distance_pips'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN zone_reachability_distance_pips decimal(6, 2);
  END IF;

  -- Model versioning
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'zone_model_version'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN zone_model_version text DEFAULT 'v2.0-regime-adaptive';
  END IF;

  -- Regime tracking
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'micro_regime_used'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN micro_regime_used text;
  END IF;

  -- Downgrade flag
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'zone_downgrade_applied'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN zone_downgrade_applied boolean DEFAULT false;
  END IF;
END $$;

-- Create entry_zone_analytics table for meta-learning
CREATE TABLE IF NOT EXISTS entry_zone_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_intent_id uuid REFERENCES entry_intents(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES goal_sessions(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  micro_regime text NOT NULL,
  selected_zone_type text NOT NULL CHECK (selected_zone_type IN ('limit', 'hybrid', 'momentum')),
  reachability_passed boolean NOT NULL,
  distance_from_price_atr decimal(5, 2) NOT NULL,
  downgrade_applied boolean DEFAULT false,
  original_zone_type text CHECK (original_zone_type IN ('limit', 'hybrid', 'momentum')),
  price_reached_primary_zone boolean,
  price_reached_secondary_zone boolean,
  time_to_reach_zone_seconds integer,
  executed_from_zone text CHECK (executed_from_zone IN ('primary', 'secondary', 'none')),
  created_at timestamptz DEFAULT now()
);

-- Add executed_zone_type to goal_session_trades
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'executed_zone_type'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN executed_zone_type text CHECK (executed_zone_type IN ('primary', 'secondary', 'none'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'zone_hit_time_seconds'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN zone_hit_time_seconds integer;
  END IF;
END $$;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_entry_zone_analytics_session_id ON entry_zone_analytics(session_id);
CREATE INDEX IF NOT EXISTS idx_entry_zone_analytics_symbol ON entry_zone_analytics(symbol);
CREATE INDEX IF NOT EXISTS idx_entry_zone_analytics_regime ON entry_zone_analytics(micro_regime);
CREATE INDEX IF NOT EXISTS idx_entry_zone_analytics_zone_type ON entry_zone_analytics(selected_zone_type);
CREATE INDEX IF NOT EXISTS idx_entry_zone_analytics_reachability ON entry_zone_analytics(reachability_passed);
CREATE INDEX IF NOT EXISTS idx_entry_zone_analytics_executed ON entry_zone_analytics(executed_from_zone);

-- Enable RLS on entry_zone_analytics
ALTER TABLE entry_zone_analytics ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can read their own zone analytics
CREATE POLICY "Users can read own zone analytics"
  ON entry_zone_analytics
  FOR SELECT
  TO authenticated
  USING (
    session_id IN (
      SELECT id FROM goal_sessions WHERE user_id = auth.uid()
    )
  );

-- RLS Policy: System can insert zone analytics
CREATE POLICY "System can insert zone analytics"
  ON entry_zone_analytics
  FOR INSERT
  TO authenticated
  WITH CHECK (
    session_id IN (
      SELECT id FROM goal_sessions WHERE user_id = auth.uid()
    )
  );

-- RLS Policy: System can update zone analytics
CREATE POLICY "System can update zone analytics"
  ON entry_zone_analytics
  FOR UPDATE
  TO authenticated
  USING (
    session_id IN (
      SELECT id FROM goal_sessions WHERE user_id = auth.uid()
    )
  );

-- Create helper function to get zone analytics summary
CREATE OR REPLACE FUNCTION get_zone_analytics_summary(p_session_id uuid)
RETURNS TABLE (
  total_zones bigint,
  reachable_zones bigint,
  reachability_rate numeric,
  avg_distance_atr numeric,
  downgrade_rate numeric,
  zone_type_distribution jsonb,
  regime_distribution jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH stats AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE reachability_passed = true) as reachable,
      AVG(distance_from_price_atr) as avg_dist,
      COUNT(*) FILTER (WHERE downgrade_applied = true) as downgrades
    FROM entry_zone_analytics
    WHERE session_id = p_session_id
  ),
  zone_types AS (
    SELECT jsonb_object_agg(selected_zone_type, cnt) as distribution
    FROM (
      SELECT selected_zone_type, COUNT(*) as cnt
      FROM entry_zone_analytics
      WHERE session_id = p_session_id
      GROUP BY selected_zone_type
    ) t
  ),
  regimes AS (
    SELECT jsonb_object_agg(micro_regime, cnt) as distribution
    FROM (
      SELECT micro_regime, COUNT(*) as cnt
      FROM entry_zone_analytics
      WHERE session_id = p_session_id
      GROUP BY micro_regime
    ) r
  )
  SELECT
    s.total,
    s.reachable,
    CASE WHEN s.total > 0 THEN ROUND((s.reachable::numeric / s.total::numeric), 2) ELSE 0 END,
    ROUND(s.avg_dist, 2),
    CASE WHEN s.total > 0 THEN ROUND((s.downgrades::numeric / s.total::numeric), 2) ELSE 0 END,
    COALESCE(zt.distribution, '{}'::jsonb),
    COALESCE(r.distribution, '{}'::jsonb)
  FROM stats s
  CROSS JOIN zone_types zt
  CROSS JOIN regimes r;
END;
$$;

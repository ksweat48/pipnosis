/*
  # CCIP-2026-0427-A: Alpha Profitability Instrumentation

  This migration installs measurement infrastructure required before any
  changes are made to Alpha's reasoning prompt. We must be able to answer
  three questions before changing the brain:

  1. Are Alpha's executed trades profitable? (outcome pipeline)
  2. What is Alpha's NO_TRADE costing? (counterfactual EV)
  3. When monitor is off, is Alpha being forced into NO_TRADE for trades
     that would have qualified as wait intents? (subclass tracking)

  This migration is purely additive measurement. It does NOT change any
  decision logic. The brain rewrite ships in a separate CCIP after we
  have a profitability baseline.

  ## New Tables

  ### `alpha_no_trade_counterfactuals`
  Captures price snapshots at 30 / 60 / 120 minutes after every NO_TRADE
  decision that had non-zero directional lean. Measures the realized EV of
  NOT executing — the cost of being too restrictive.

    - `id` (uuid, primary key)
    - `decision_id` (uuid, FK alpha_decisions, unique)
    - `user_id` (uuid, FK auth.users)
    - `symbol` (text)
    - `direction_lean` (text: 'BUY' | 'SELL') — what direction Alpha was leaning
    - `lean_confidence` (numeric) — Alpha's lean strength when declining
    - `entry_reference_price` (numeric) — price at moment of decision
    - `price_30m` (numeric, nullable)
    - `price_60m` (numeric, nullable)
    - `price_120m` (numeric, nullable)
    - `mfe_pips_60m` (numeric, nullable) — max favorable excursion @ 60m
    - `mae_pips_60m` (numeric, nullable) — max adverse excursion @ 60m
    - `would_have_won` (boolean, nullable) — true if 60m mfe > typical SL distance
    - `created_at`, `updated_at`

  ### `alpha_brain_promotion_announcements`
  Records every promotion/rollback of Alpha's brain version per style.
  Drives user-facing notifications when Alpha's reasoning expands.

    - `id` (uuid, primary key)
    - `event_type` (text: 'PROMOTION' | 'ROLLBACK')
    - `style` (text: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY' | 'ALL')
    - `from_version` (text, nullable)
    - `to_version` (text)
    - `summary` (text) — one-sentence user-facing message
    - `metrics_snapshot` (jsonb) — win-rate, expectancy at decision time
    - `announced_to_users` (boolean, default false)
    - `announced_at` (timestamptz, nullable)
    - `created_at`

  ## Modified Tables

  ### `alpha_decisions`
  - Add `wait_intent_available_for_monitor_off` (boolean, default false):
    Set TRUE when Alpha's reasoning would have produced a wait_pullback or
    push_confirmation entry mode but the user has Entry Monitor disabled.
    The decision is then converted to NO_TRADE. This subclass lets us
    measure how much value monitor-off users are leaving on the table.
  - Add `wait_intent_metadata` (jsonb, nullable): zone/trigger captured
    from the suppressed wait intent for UI hint and future replay.

  ## New Views

  ### `alpha_profitability_dashboard`
  Per-user / per-style / per-confidence_tier rollup of executed-trade
  performance. Built on `alpha_decisions` joined to `alpha_decision_outcomes`.
  Used by admin dashboard and the staged-rollout kill switch.

  ## Security

  - All new tables: RLS enabled
  - Users can SELECT their own rows
  - Service role manages all writes (counterfactual scheduler, promotion
    announcer, monitor-off detector all run via service-role context)
  - View is SECURITY INVOKER (inherits caller's RLS)

  ## Notes

  1. Counterfactual rows are inserted lazily by a scheduled job — not by
     the decision path — to avoid latency in the trade-decision loop.
  2. The `wait_intent_available_for_monitor_off` flag is written by
     coordinator-alpha at decision time and is the only behavior change
     this migration enables. It does not affect EXISTING wait-intent
     execution; it only labels NO_TRADE decisions that arose because
     Entry Monitor was off.
  3. No data is altered. No RPC signatures change. No business logic moves.
*/

-- ============================================================================
-- 1. alpha_no_trade_counterfactuals
-- ============================================================================
CREATE TABLE IF NOT EXISTS alpha_no_trade_counterfactuals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES alpha_decisions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  direction_lean text NOT NULL CHECK (direction_lean IN ('BUY','SELL')),
  lean_confidence numeric NOT NULL DEFAULT 0,
  entry_reference_price numeric NOT NULL,
  price_30m numeric,
  price_60m numeric,
  price_120m numeric,
  mfe_pips_60m numeric,
  mae_pips_60m numeric,
  would_have_won boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alpha_no_trade_counterfactuals_decision_unique UNIQUE (decision_id)
);

CREATE INDEX IF NOT EXISTS idx_alpha_ntcf_user ON alpha_no_trade_counterfactuals(user_id);
CREATE INDEX IF NOT EXISTS idx_alpha_ntcf_symbol_created ON alpha_no_trade_counterfactuals(symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alpha_ntcf_pending_30m ON alpha_no_trade_counterfactuals(created_at) WHERE price_30m IS NULL;
CREATE INDEX IF NOT EXISTS idx_alpha_ntcf_pending_60m ON alpha_no_trade_counterfactuals(created_at) WHERE price_60m IS NULL;
CREATE INDEX IF NOT EXISTS idx_alpha_ntcf_pending_120m ON alpha_no_trade_counterfactuals(created_at) WHERE price_120m IS NULL;

ALTER TABLE alpha_no_trade_counterfactuals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own counterfactuals" ON alpha_no_trade_counterfactuals;
CREATE POLICY "Users read own counterfactuals"
  ON alpha_no_trade_counterfactuals FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role manages counterfactuals" ON alpha_no_trade_counterfactuals;
CREATE POLICY "Service role manages counterfactuals"
  ON alpha_no_trade_counterfactuals FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 2. alpha_brain_promotion_announcements
-- ============================================================================
CREATE TABLE IF NOT EXISTS alpha_brain_promotion_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type IN ('PROMOTION','ROLLBACK')),
  style text NOT NULL CHECK (style IN ('SCALP','MICRO_INTRADAY','INTRADAY','ALL')),
  from_version text,
  to_version text NOT NULL,
  summary text NOT NULL,
  metrics_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  announced_to_users boolean NOT NULL DEFAULT false,
  announced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_promo_pending ON alpha_brain_promotion_announcements(created_at)
  WHERE announced_to_users = false;
CREATE INDEX IF NOT EXISTS idx_brain_promo_style_created ON alpha_brain_promotion_announcements(style, created_at DESC);

ALTER TABLE alpha_brain_promotion_announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read promotion announcements" ON alpha_brain_promotion_announcements;
CREATE POLICY "Authenticated read promotion announcements"
  ON alpha_brain_promotion_announcements FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role manages promotion announcements" ON alpha_brain_promotion_announcements;
CREATE POLICY "Service role manages promotion announcements"
  ON alpha_brain_promotion_announcements FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 3. alpha_decisions: wait_intent_available_for_monitor_off
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'wait_intent_available_for_monitor_off'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN wait_intent_available_for_monitor_off boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'wait_intent_metadata'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN wait_intent_metadata jsonb;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_alpha_decisions_wait_intent_monitor_off
  ON alpha_decisions(user_id, created_at DESC)
  WHERE wait_intent_available_for_monitor_off = true;

-- ============================================================================
-- 4. alpha_profitability_dashboard view
-- ============================================================================
DROP VIEW IF EXISTS alpha_profitability_dashboard;
CREATE VIEW alpha_profitability_dashboard
WITH (security_invoker = true) AS
SELECT
  ad.user_id,
  ad.trade_style,
  ad.confidence_tier,
  COUNT(*) FILTER (WHERE ad.trade_executed = true) AS executed_count,
  COUNT(*) FILTER (WHERE ado.outcome = 'WIN') AS wins,
  COUNT(*) FILTER (WHERE ado.outcome = 'LOSS') AS losses,
  COUNT(*) FILTER (WHERE ado.outcome = 'BREAKEVEN') AS breakevens,
  ROUND(
    (COUNT(*) FILTER (WHERE ado.outcome = 'WIN'))::numeric
      / NULLIF(COUNT(*) FILTER (WHERE ado.outcome IN ('WIN','LOSS','BREAKEVEN')), 0) * 100,
    2
  ) AS win_rate_pct,
  ROUND(AVG(ado.pnl) FILTER (WHERE ado.outcome = 'WIN'), 2) AS avg_win,
  ROUND(AVG(ado.pnl) FILTER (WHERE ado.outcome = 'LOSS'), 2) AS avg_loss,
  ROUND(SUM(ado.pnl), 2) AS total_pnl,
  ROUND(AVG(ado.pnl), 2) AS expectancy_per_trade,
  COUNT(*) FILTER (WHERE ad.action = 'NO_TRADE') AS no_trade_count,
  COUNT(*) FILTER (WHERE ad.wait_intent_available_for_monitor_off = true) AS no_trade_due_to_monitor_off,
  MAX(ad.created_at) AS last_decision_at
FROM alpha_decisions ad
LEFT JOIN alpha_decision_outcomes ado ON ado.decision_id = ad.id
WHERE ad.created_at > now() - interval '30 days'
GROUP BY ad.user_id, ad.trade_style, ad.confidence_tier;

GRANT SELECT ON alpha_profitability_dashboard TO authenticated;
GRANT SELECT ON alpha_profitability_dashboard TO service_role;

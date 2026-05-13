/*
  # CCIP-2026-0513G + 0513H: TP1 Distinctness & M5 Entry Sharpness Doctrines

  Two stacked amendments to Alpha's reasoning obligations:
  1. CCIP-2026-0513G — TP1 Partial-Value Doctrine (preserved as historical layer)
  2. CCIP-2026-0513H — M5 Entry-Sharpness Doctrine (new active SSOT)

  Both inherit all prior doctrine. Constraint
  idx_alpha_engineering_doctrine_active_one allows only one active=true row, so
  we deactivate 0513F first, insert 0513G inactive (history), then 0513H active.

  Also creates alpha_mae_outcomes for post-trade entry-sharpness learning. This
  table is read by post-trade analytics ONLY — never by prompt builders. RLS
  permits service_role full access and authenticated read of own rows.
*/

DO $$
DECLARE
  v_prev_id uuid;
  v_g_id uuid;
BEGIN
  SELECT id INTO v_prev_id FROM alpha_engineering_doctrine WHERE active = true LIMIT 1;
  UPDATE alpha_engineering_doctrine SET active = false WHERE active = true;

  INSERT INTO alpha_engineering_doctrine (ccip_reference, ratified_at, doctrine_text, active, supersedes)
  VALUES (
    'CCIP-2026-0513G-TP1-DISTINCTNESS',
    NOW(),
    'TP1 Partial-Value Doctrine. A TP1 worth less than 35% of risk is not a partial profit — it is a stop in disguise. Alpha must reason: if the move only delivers one structural target, take a single TP. If it delivers two distinct destinations, the first must be far enough from entry to materially de-risk the trade. Required audit fields: tp1_partial_value_pips, tp1_partial_value_ratio, tp1_omitted (boolean). Inherits CCIP-2026-0511ZZ, 0512A, 0513A, 0513B, 0513F.',
    false,
    v_prev_id
  )
  RETURNING id INTO v_g_id;

  INSERT INTO alpha_engineering_doctrine (ccip_reference, ratified_at, doctrine_text, active, supersedes)
  VALUES (
    'CCIP-2026-0513H-M5-ENTRY-SHARPNESS',
    NOW(),
    'M5 Entry-Sharpness Doctrine. A hunter who pays for his entry is not a hunter — he is prey paying tuition. On M5, entries must be sharp: Alpha must reason about expected adverse excursion (MAE) before execute_now and route to wait_intent at a better level when MAE-to-risk would exceed 0.45. Required audit fields: m5_expected_mae_pips, m5_mae_vs_risk_ratio, entry_sharpness_thesis, entry_sharpness_check (SHARP|ACCEPTABLE|DULL). Coordinator emits semantic-contradiction findings (DULL+execute_now, MAE>0.45+execute_now) for post-trade learning, not as execution gates. Inherits all prior doctrine including CCIP-2026-0513G.',
    true,
    v_g_id
  );
END $$;

CREATE TABLE IF NOT EXISTS alpha_mae_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid,
  user_id uuid,
  symbol text NOT NULL,
  trade_style text,
  entry_mode text,
  entry_price numeric,
  stop_loss numeric,
  planned_risk_pips numeric,
  predicted_mae_pips numeric,
  predicted_mae_ratio numeric,
  observed_mae_pips numeric,
  observed_mae_ratio numeric,
  entry_sharpness_check text,
  outcome text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alpha_mae_outcomes_user ON alpha_mae_outcomes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alpha_mae_outcomes_symbol ON alpha_mae_outcomes(symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alpha_mae_outcomes_trade ON alpha_mae_outcomes(trade_id);

ALTER TABLE alpha_mae_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access alpha_mae_outcomes"
  ON alpha_mae_outcomes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users read own MAE outcomes"
  ON alpha_mae_outcomes
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

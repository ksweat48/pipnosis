/*
  # Session-Phase-Style Performance Mirror

  ## Purpose
  Close the most critical gap in Alpha's learning loop: Alpha can now receive empirical win-rate
  feedback broken down by the exact intersection he reasons about — session name × market phase
  × trade style. This is the SSOT authority for this three-way performance breakdown.

  ## New Tables

  ### alpha_session_phase_performance
  Persists aggregated win/loss counts and confidence calibration per user for each unique
  combination of (session_name, market_phase, trade_style). Written by the post-trade processor
  and read by the intelligence aggregator on every scan.

  Columns:
  - id (uuid, PK)
  - user_id (uuid, FK auth.users)
  - session_name (text) — 'asian', 'london', 'new_york', 'overlap'
  - market_phase (text) — 'accumulation', 'expansion', 'distribution', 'retracement', 'reversal'
  - trade_style (text) — 'scalp', 'micro_intraday', 'intraday', 'swing'
  - total_trades (int)
  - wins (int)
  - losses (int)
  - win_rate (numeric) — computed: wins / total_trades
  - avg_confidence (numeric) — mean confidence score at entry
  - avg_pnl (numeric) — mean dollar PnL
  - total_pnl (numeric)
  - last_updated (timestamptz)
  - created_at (timestamptz)

  ### alpha_setup_type_context_performance
  Persists win/loss counts per (session_name, market_phase, thesis_type / setup_type).
  Written by the post-trade processor. Gives Alpha empirical grounding when choosing which
  setup type to apply in each session-phase combination.

  Columns:
  - id (uuid, PK)
  - user_id (uuid, FK auth.users)
  - session_name (text)
  - market_phase (text)
  - setup_type (text) — e.g. 'momentum_scalp', 'liquidity_sweep_reversal', 'trend_pullback', etc.
  - total_trades (int)
  - wins (int)
  - losses (int)
  - win_rate (numeric)
  - avg_pnl (numeric)
  - last_updated (timestamptz)
  - created_at (timestamptz)

  ## Security
  - RLS enabled on both tables
  - Users may only read/write their own rows
  - Service role has unrestricted access for the post-trade processor

  ## Governance Notes
  - SSOT: This table is the single authority for session-phase-style win rate data
  - CCIP: All writes go through upsert_session_phase_performance RPC (no direct DML)
  - No business logic is encoded in the table — raw aggregates only
*/

-- ─── TABLE 1: session × phase × style ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alpha_session_phase_performance (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_name      text        NOT NULL,
  market_phase      text        NOT NULL,
  trade_style       text        NOT NULL,
  total_trades      integer     NOT NULL DEFAULT 0,
  wins              integer     NOT NULL DEFAULT 0,
  losses            integer     NOT NULL DEFAULT 0,
  win_rate          numeric(5,4) NOT NULL DEFAULT 0,
  avg_confidence    numeric(5,2) NOT NULL DEFAULT 0,
  avg_pnl           numeric(10,4) NOT NULL DEFAULT 0,
  total_pnl         numeric(12,4) NOT NULL DEFAULT 0,
  last_updated      timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT alpha_spp_unique UNIQUE (user_id, session_name, market_phase, trade_style),
  CONSTRAINT alpha_spp_session_name_check CHECK (
    session_name IN ('asian', 'london', 'new_york', 'overlap', 'unknown')
  ),
  CONSTRAINT alpha_spp_market_phase_check CHECK (
    market_phase IN ('accumulation', 'expansion', 'distribution', 'retracement', 'reversal', 'unknown')
  ),
  CONSTRAINT alpha_spp_trade_style_check CHECK (
    trade_style IN ('scalp', 'micro_intraday', 'intraday', 'swing', 'unknown')
  ),
  CONSTRAINT alpha_spp_wins_non_negative CHECK (wins >= 0),
  CONSTRAINT alpha_spp_losses_non_negative CHECK (losses >= 0),
  CONSTRAINT alpha_spp_total_non_negative CHECK (total_trades >= 0)
);

ALTER TABLE alpha_session_phase_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own session phase performance"
  ON alpha_session_phase_performance FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own session phase performance"
  ON alpha_session_phase_performance FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own session phase performance"
  ON alpha_session_phase_performance FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access session phase performance"
  ON alpha_session_phase_performance FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_alpha_spp_user_session_phase
  ON alpha_session_phase_performance (user_id, session_name, market_phase);

CREATE INDEX IF NOT EXISTS idx_alpha_spp_user_style
  ON alpha_session_phase_performance (user_id, trade_style);

-- ─── TABLE 2: session × phase × setup_type ───────────────────────────────────

CREATE TABLE IF NOT EXISTS alpha_setup_type_context_performance (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_name      text        NOT NULL,
  market_phase      text        NOT NULL,
  setup_type        text        NOT NULL,
  total_trades      integer     NOT NULL DEFAULT 0,
  wins              integer     NOT NULL DEFAULT 0,
  losses            integer     NOT NULL DEFAULT 0,
  win_rate          numeric(5,4) NOT NULL DEFAULT 0,
  avg_pnl           numeric(10,4) NOT NULL DEFAULT 0,
  last_updated      timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT alpha_stcp_unique UNIQUE (user_id, session_name, market_phase, setup_type),
  CONSTRAINT alpha_stcp_session_name_check CHECK (
    session_name IN ('asian', 'london', 'new_york', 'overlap', 'unknown')
  ),
  CONSTRAINT alpha_stcp_market_phase_check CHECK (
    market_phase IN ('accumulation', 'expansion', 'distribution', 'retracement', 'reversal', 'unknown')
  ),
  CONSTRAINT alpha_stcp_wins_non_negative CHECK (wins >= 0),
  CONSTRAINT alpha_stcp_losses_non_negative CHECK (losses >= 0),
  CONSTRAINT alpha_stcp_total_non_negative CHECK (total_trades >= 0)
);

ALTER TABLE alpha_setup_type_context_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own setup type context performance"
  ON alpha_setup_type_context_performance FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own setup type context performance"
  ON alpha_setup_type_context_performance FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own setup type context performance"
  ON alpha_setup_type_context_performance FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access setup type context performance"
  ON alpha_setup_type_context_performance FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_alpha_stcp_user_session_phase
  ON alpha_setup_type_context_performance (user_id, session_name, market_phase);

-- ─── RPC: upsert_session_phase_performance ────────────────────────────────────
-- SSOT write authority. Called by post-trade processor only.
-- All write logic lives here; no direct DML elsewhere.

CREATE OR REPLACE FUNCTION upsert_session_phase_performance(
  p_user_id       uuid,
  p_session_name  text,
  p_market_phase  text,
  p_trade_style   text,
  p_is_win        boolean,
  p_pnl           numeric,
  p_confidence    numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing record;
  v_new_wins     integer;
  v_new_losses   integer;
  v_new_total    integer;
  v_new_win_rate numeric;
  v_new_avg_pnl  numeric;
  v_new_total_pnl numeric;
  v_new_avg_conf numeric;
  v_session text;
  v_phase   text;
  v_style   text;
BEGIN
  -- Normalise to constraint-safe values
  v_session := lower(COALESCE(p_session_name, 'unknown'));
  IF v_session NOT IN ('asian', 'london', 'new_york', 'overlap') THEN
    v_session := 'unknown';
  END IF;

  v_phase := lower(COALESCE(p_market_phase, 'unknown'));
  IF v_phase NOT IN ('accumulation', 'expansion', 'distribution', 'retracement', 'reversal') THEN
    v_phase := 'unknown';
  END IF;

  v_style := lower(COALESCE(p_trade_style, 'unknown'));
  IF v_style NOT IN ('scalp', 'micro_intraday', 'intraday', 'swing') THEN
    v_style := 'unknown';
  END IF;

  SELECT * INTO v_existing
  FROM alpha_session_phase_performance
  WHERE user_id = p_user_id
    AND session_name = v_session
    AND market_phase = v_phase
    AND trade_style  = v_style;

  IF FOUND THEN
    v_new_wins    := v_existing.wins    + CASE WHEN p_is_win THEN 1 ELSE 0 END;
    v_new_losses  := v_existing.losses  + CASE WHEN p_is_win THEN 0 ELSE 1 END;
    v_new_total   := v_existing.total_trades + 1;
    v_new_total_pnl := v_existing.total_pnl + COALESCE(p_pnl, 0);
    v_new_win_rate  := CASE WHEN v_new_total > 0 THEN v_new_wins::numeric / v_new_total ELSE 0 END;
    v_new_avg_pnl   := v_new_total_pnl / v_new_total;
    -- Rolling average for confidence
    v_new_avg_conf  := ((v_existing.avg_confidence * v_existing.total_trades) + COALESCE(p_confidence, 0)) / v_new_total;

    UPDATE alpha_session_phase_performance SET
      wins          = v_new_wins,
      losses        = v_new_losses,
      total_trades  = v_new_total,
      win_rate      = v_new_win_rate,
      avg_confidence = v_new_avg_conf,
      avg_pnl       = v_new_avg_pnl,
      total_pnl     = v_new_total_pnl,
      last_updated  = now()
    WHERE user_id = p_user_id
      AND session_name = v_session
      AND market_phase = v_phase
      AND trade_style  = v_style;
  ELSE
    v_new_wins    := CASE WHEN p_is_win THEN 1 ELSE 0 END;
    v_new_losses  := CASE WHEN p_is_win THEN 0 ELSE 1 END;
    v_new_total   := 1;
    v_new_total_pnl := COALESCE(p_pnl, 0);
    v_new_win_rate  := CASE WHEN p_is_win THEN 1.0 ELSE 0.0 END;
    v_new_avg_pnl   := v_new_total_pnl;
    v_new_avg_conf  := COALESCE(p_confidence, 0);

    INSERT INTO alpha_session_phase_performance
      (user_id, session_name, market_phase, trade_style,
       wins, losses, total_trades, win_rate, avg_confidence, avg_pnl, total_pnl)
    VALUES
      (p_user_id, v_session, v_phase, v_style,
       v_new_wins, v_new_losses, v_new_total, v_new_win_rate, v_new_avg_conf, v_new_avg_pnl, v_new_total_pnl);
  END IF;
END;
$$;

-- ─── RPC: upsert_setup_type_context_performance ──────────────────────────────

CREATE OR REPLACE FUNCTION upsert_setup_type_context_performance(
  p_user_id      uuid,
  p_session_name text,
  p_market_phase text,
  p_setup_type   text,
  p_is_win       boolean,
  p_pnl          numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing record;
  v_new_wins    integer;
  v_new_losses  integer;
  v_new_total   integer;
  v_new_win_rate numeric;
  v_new_avg_pnl  numeric;
  v_session text;
  v_phase   text;
  v_type    text;
BEGIN
  v_session := lower(COALESCE(p_session_name, 'unknown'));
  IF v_session NOT IN ('asian', 'london', 'new_york', 'overlap') THEN v_session := 'unknown'; END IF;

  v_phase := lower(COALESCE(p_market_phase, 'unknown'));
  IF v_phase NOT IN ('accumulation', 'expansion', 'distribution', 'retracement', 'reversal') THEN v_phase := 'unknown'; END IF;

  v_type := COALESCE(p_setup_type, 'unknown');

  SELECT * INTO v_existing
  FROM alpha_setup_type_context_performance
  WHERE user_id    = p_user_id
    AND session_name = v_session
    AND market_phase = v_phase
    AND setup_type   = v_type;

  IF FOUND THEN
    v_new_wins   := v_existing.wins   + CASE WHEN p_is_win THEN 1 ELSE 0 END;
    v_new_losses := v_existing.losses + CASE WHEN p_is_win THEN 0 ELSE 1 END;
    v_new_total  := v_existing.total_trades + 1;
    v_new_win_rate := CASE WHEN v_new_total > 0 THEN v_new_wins::numeric / v_new_total ELSE 0 END;
    v_new_avg_pnl  := ((v_existing.avg_pnl * v_existing.total_trades) + COALESCE(p_pnl, 0)) / v_new_total;

    UPDATE alpha_setup_type_context_performance SET
      wins         = v_new_wins,
      losses       = v_new_losses,
      total_trades = v_new_total,
      win_rate     = v_new_win_rate,
      avg_pnl      = v_new_avg_pnl,
      last_updated = now()
    WHERE user_id    = p_user_id
      AND session_name = v_session
      AND market_phase = v_phase
      AND setup_type   = v_type;
  ELSE
    INSERT INTO alpha_setup_type_context_performance
      (user_id, session_name, market_phase, setup_type,
       wins, losses, total_trades, win_rate, avg_pnl)
    VALUES
      (p_user_id, v_session, v_phase, v_type,
       CASE WHEN p_is_win THEN 1 ELSE 0 END,
       CASE WHEN p_is_win THEN 0 ELSE 1 END,
       1,
       CASE WHEN p_is_win THEN 1.0 ELSE 0.0 END,
       COALESCE(p_pnl, 0));
  END IF;
END;
$$;

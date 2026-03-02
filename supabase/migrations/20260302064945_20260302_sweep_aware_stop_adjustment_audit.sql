/*
  # Sweep-Aware Stop Adjustment Audit System

  ## Purpose
  Provides governance-level audit trail for every trade where the stop loss was
  mathematically repositioned beyond a detected liquidity sweep zone.

  ## Background
  The liquidity sweep upgrade (CCIP-2026-03-02) closes the gap between Omega-8
  sweep detection and actual stop placement. When Alpha executes after a sweep,
  `risk-aware-stop-calculator.ts` now computes a sweep-aware stop that clears
  the sweep candle's wick extreme. This table persists that adjustment for:

  - Governance review (was the adjustment justified?)
  - Learning feedback (did sweep-repositioned stops perform better?)
  - Regulatory audit trail (stop widening is intentional, not random)

  ## New Tables
  - `sweep_aware_stop_adjustments`
    - `id` (uuid PK)
    - `user_id` (uuid FK → auth.users)
    - `trade_id` (uuid FK → trades, nullable — set after trade is placed)
    - `session_id` (uuid FK → goal_sessions, nullable)
    - `symbol` (text)
    - `trade_style` (text — SCALP | MICRO_INTRADAY | INTRADAY)
    - `direction` (text — buy | sell)
    - `entry_price` (numeric)
    - `sweep_type` (text — high | low)
    - `sweep_extreme_price` (numeric)
    - `nearest_cluster_price` (numeric, nullable)
    - `candles_ago` (int)
    - `has_bos` (boolean)
    - `original_stop_price` (numeric)
    - `original_stop_pips` (numeric)
    - `adjusted_stop_price` (numeric)
    - `adjusted_stop_pips` (numeric)
    - `buffer_pips` (numeric)
    - `atr_buffer_multiplier` (numeric — e.g., 0.20 for SCALP)
    - `reason` (text)
    - `created_at` (timestamptz)

  ## Security
  - RLS enabled, restrictive policies
  - Users can only read their own records
  - Service role can insert (stop calculator runs server-side)
  - Admins can read all records

  ## Notes
  1. Records are written at scan time (before the trade is placed)
  2. `trade_id` is NULL initially and backfilled when the trade is executed
  3. This table is append-only — no UPDATE policies for non-admins
  4. Indexed on user_id + created_at for dashboard queries
*/

CREATE TABLE IF NOT EXISTS sweep_aware_stop_adjustments (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_id              uuid        NULL,
  session_id            uuid        NULL,
  symbol                text        NOT NULL,
  trade_style           text        NOT NULL CHECK (trade_style IN ('SCALP', 'MICRO_INTRADAY', 'INTRADAY')),
  direction             text        NOT NULL CHECK (direction IN ('buy', 'sell')),
  entry_price           numeric     NOT NULL,
  sweep_type            text        NOT NULL CHECK (sweep_type IN ('high', 'low')),
  sweep_extreme_price   numeric     NOT NULL,
  nearest_cluster_price numeric     NULL,
  candles_ago           integer     NOT NULL DEFAULT 0,
  has_bos               boolean     NOT NULL DEFAULT false,
  original_stop_price   numeric     NOT NULL,
  original_stop_pips    numeric     NOT NULL,
  adjusted_stop_price   numeric     NOT NULL,
  adjusted_stop_pips    numeric     NOT NULL,
  buffer_pips           numeric     NOT NULL,
  atr_buffer_multiplier numeric     NOT NULL,
  reason                text        NOT NULL DEFAULT '',
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sweep_aware_stop_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own sweep stop adjustments"
  ON sweep_aware_stop_adjustments
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert sweep stop adjustments"
  ON sweep_aware_stop_adjustments
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Authenticated users can insert own sweep stop adjustments"
  ON sweep_aware_stop_adjustments
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can read all sweep stop adjustments"
  ON sweep_aware_stop_adjustments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE INDEX IF NOT EXISTS idx_sweep_aware_stop_adjustments_user_id_created
  ON sweep_aware_stop_adjustments (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sweep_aware_stop_adjustments_trade_id
  ON sweep_aware_stop_adjustments (trade_id)
  WHERE trade_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sweep_aware_stop_adjustments_symbol
  ON sweep_aware_stop_adjustments (symbol, created_at DESC);

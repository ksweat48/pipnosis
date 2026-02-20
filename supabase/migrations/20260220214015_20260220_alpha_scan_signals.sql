/*
  # Alpha Scan Signals Table

  ## Purpose
  Stores the output of manual "Scan Now" alpha pipeline runs triggered from the
  Intelligence Monitor. This is the SSOT for monitor-level alpha signals — distinct
  from goal_session_scan_results which is session-scoped.

  ## New Tables
  - `alpha_scan_signals`
    - `id` (uuid, pk)
    - `symbol` (text) — e.g. EURUSD, NAS100
    - `direction` (text) — 'buy' | 'sell'
    - `trade_style` (text) — 'scalp' | 'micro_intraday' | 'intraday'
    - `timeframe` (text) — M5 | M15 | H1 etc
    - `alpha_confidence` (numeric) — 0–100
    - `entry_price` (numeric, nullable)
    - `stop_loss` (numeric, nullable)
    - `take_profit_1` (numeric, nullable)
    - `take_profit_2` (numeric, nullable)
    - `reasoning` (text, nullable)
    - `omega_consensus_percent` (numeric, nullable)
    - `resolved_style` (text, nullable)
    - `scanned_at` (timestamptz) — when the scan was run
    - `expires_at` (timestamptz) — 15 min after scanned_at
    - `scan_batch_id` (uuid) — groups signals from the same scan run

  ## Security
  - RLS enabled
  - Authenticated users can SELECT
  - Service role only can INSERT/UPDATE/DELETE

  ## Indexes
  - scanned_at DESC for latest-first queries
  - alpha_confidence DESC for priority ordering
  - expires_at for freshness filtering
  - scan_batch_id for grouping
*/

CREATE TABLE IF NOT EXISTS alpha_scan_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('buy', 'sell')),
  trade_style text NOT NULL CHECK (trade_style IN ('scalp', 'micro_intraday', 'intraday')),
  timeframe text NOT NULL DEFAULT 'M15',
  alpha_confidence numeric NOT NULL DEFAULT 0 CHECK (alpha_confidence >= 0 AND alpha_confidence <= 100),
  entry_price numeric,
  stop_loss numeric,
  take_profit_1 numeric,
  take_profit_2 numeric,
  reasoning text,
  omega_consensus_percent numeric,
  resolved_style text,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  scan_batch_id uuid NOT NULL DEFAULT gen_random_uuid()
);

ALTER TABLE alpha_scan_signals ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_alpha_scan_signals_scanned_at
  ON alpha_scan_signals (scanned_at DESC);

CREATE INDEX IF NOT EXISTS idx_alpha_scan_signals_confidence
  ON alpha_scan_signals (alpha_confidence DESC);

CREATE INDEX IF NOT EXISTS idx_alpha_scan_signals_expires_at
  ON alpha_scan_signals (expires_at);

CREATE INDEX IF NOT EXISTS idx_alpha_scan_signals_batch
  ON alpha_scan_signals (scan_batch_id);

CREATE POLICY "Authenticated users can read alpha scan signals"
  ON alpha_scan_signals
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert alpha scan signals"
  ON alpha_scan_signals
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update alpha scan signals"
  ON alpha_scan_signals
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can delete alpha scan signals"
  ON alpha_scan_signals
  FOR DELETE
  TO service_role
  USING (true);

/*
  Convenience RPC: get_latest_alpha_scan_signals
  Returns all non-expired signals from the most recent scan batch,
  ordered by confidence descending.
*/
CREATE OR REPLACE FUNCTION get_latest_alpha_scan_signals()
RETURNS TABLE (
  id uuid,
  symbol text,
  direction text,
  trade_style text,
  timeframe text,
  alpha_confidence numeric,
  entry_price numeric,
  stop_loss numeric,
  take_profit_1 numeric,
  take_profit_2 numeric,
  reasoning text,
  omega_consensus_percent numeric,
  resolved_style text,
  scanned_at timestamptz,
  expires_at timestamptz,
  scan_batch_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    s.id,
    s.symbol,
    s.direction,
    s.trade_style,
    s.timeframe,
    s.alpha_confidence,
    s.entry_price,
    s.stop_loss,
    s.take_profit_1,
    s.take_profit_2,
    s.reasoning,
    s.omega_consensus_percent,
    s.resolved_style,
    s.scanned_at,
    s.expires_at,
    s.scan_batch_id
  FROM alpha_scan_signals s
  WHERE s.expires_at > now()
    AND s.scan_batch_id = (
      SELECT scan_batch_id
      FROM alpha_scan_signals
      ORDER BY scanned_at DESC
      LIMIT 1
    )
  ORDER BY s.alpha_confidence DESC;
$$;

GRANT EXECUTE ON FUNCTION get_latest_alpha_scan_signals() TO authenticated;

/*
  RPC: get_last_alpha_scan_time
  Returns the timestamp of the most recent scan, used for cooldown enforcement in the UI.
*/
CREATE OR REPLACE FUNCTION get_last_alpha_scan_time()
RETURNS timestamptz
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT max(scanned_at)
  FROM alpha_scan_signals;
$$;

GRANT EXECUTE ON FUNCTION get_last_alpha_scan_time() TO authenticated;

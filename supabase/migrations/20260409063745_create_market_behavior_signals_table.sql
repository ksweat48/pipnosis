/*
  # Create market_behavior_signals table

  ## Purpose
  Replaces the indicator-based readiness system with a market behavior alerting system.
  Instead of trying to pre-approve trades (Alpha's job), this table records raw market
  behaviors — candle momentum, compression breaks, EMA closes, engulfing candles, etc. —
  that signal it is worth paying attention to a pair right now.

  ## New Tables
  - `market_behavior_signals`
    - `id` (uuid, primary key)
    - `symbol` (text) — trading pair
    - `style` (text) — SCALP | MICRO_INTRADAY | INTRADAY
    - `controlling_timeframe` (text) — M1 | M5 | M15
    - `firing_signals` (text[]) — array of signal keys currently detected
    - `signal_details` (jsonb) — per-signal metadata (direction, strength, description)
    - `attention_score` (int) — 0-100 composite heat score
    - `heat_level` (text) — QUIET | ACTIVE | HOT
    - `direction_lean` (text) — BUY | SELL | NEUTRAL
    - `dominant_behavior` (text) — most significant single signal description
    - `signal_count` (int)
    - `last_scanned_at` (timestamptz)
    - `expires_at` (timestamptz)
    - `created_at` (timestamptz)

  ## Security
  - RLS enabled
  - Authenticated users can read all rows (market data is not user-private)
  - Service role can insert/update (scanner runs server-side)

  ## Notes
  - One row per symbol + style combination (upserted by scanner)
  - expires_at allows stale detection on the frontend
  - heat_level is the primary display signal replacing GREEN/YELLOW/RED readiness tier
*/

CREATE TABLE IF NOT EXISTS market_behavior_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  style text NOT NULL CHECK (style IN ('SCALP', 'MICRO_INTRADAY', 'INTRADAY')),
  controlling_timeframe text NOT NULL CHECK (controlling_timeframe IN ('M1', 'M5', 'M15')),
  firing_signals text[] NOT NULL DEFAULT '{}',
  signal_details jsonb NOT NULL DEFAULT '{}',
  attention_score integer NOT NULL DEFAULT 0 CHECK (attention_score >= 0 AND attention_score <= 100),
  heat_level text NOT NULL DEFAULT 'QUIET' CHECK (heat_level IN ('QUIET', 'ACTIVE', 'HOT')),
  direction_lean text NOT NULL DEFAULT 'NEUTRAL' CHECK (direction_lean IN ('BUY', 'SELL', 'NEUTRAL')),
  dominant_behavior text NOT NULL DEFAULT '',
  signal_count integer NOT NULL DEFAULT 0,
  last_scanned_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (symbol, style)
);

ALTER TABLE market_behavior_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read market behavior signals"
  ON market_behavior_signals FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert market behavior signals"
  ON market_behavior_signals FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update market behavior signals"
  ON market_behavior_signals FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_market_behavior_signals_symbol_style
  ON market_behavior_signals (symbol, style);

CREATE INDEX IF NOT EXISTS idx_market_behavior_signals_heat_level
  ON market_behavior_signals (heat_level);

CREATE INDEX IF NOT EXISTS idx_market_behavior_signals_last_scanned
  ON market_behavior_signals (last_scanned_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE market_behavior_signals;

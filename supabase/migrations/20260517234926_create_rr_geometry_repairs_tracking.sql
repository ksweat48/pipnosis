/*
  # Create RR Geometry Repairs Tracking Table

  1. New Tables
    - `rr_geometry_repairs`
      - `id` (uuid, primary key) - unique repair event ID
      - `symbol` (text) - trading symbol
      - `direction` (text) - BUY or SELL
      - `entry_price` (numeric) - trade entry price
      - `original_sl` (numeric) - Alpha's original stop loss before repair
      - `repaired_sl` (numeric) - corrected stop loss after repair
      - `original_tp` (numeric) - Alpha's original take profit before repair
      - `repaired_tp` (numeric) - corrected take profit after repair
      - `original_rr` (numeric) - original reward-to-risk ratio
      - `repaired_rr` (numeric) - corrected reward-to-risk ratio
      - `repair_successful` (boolean) - whether repair achieved RR >= 1.0
      - `user_id` (uuid, nullable) - user associated with the session
      - `created_at` (timestamptz) - when the repair occurred

  2. Security
    - Enable RLS on `rr_geometry_repairs` table
    - Add policy for authenticated users to read their own data
    - Add service role insert policy for the coordinator

  3. Purpose
    - Track how often Alpha submits sub-1.0 RR geometry
    - Monitor repair effectiveness over time
    - Provide data for Alpha reasoning improvements
*/

CREATE TABLE IF NOT EXISTS rr_geometry_repairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  direction text NOT NULL,
  entry_price numeric NOT NULL,
  original_sl numeric NOT NULL,
  repaired_sl numeric NOT NULL,
  original_tp numeric NOT NULL,
  repaired_tp numeric NOT NULL,
  original_rr numeric NOT NULL,
  repaired_rr numeric NOT NULL,
  repair_successful boolean NOT NULL DEFAULT false,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE rr_geometry_repairs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own RR repairs"
  ON rr_geometry_repairs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert RR repairs"
  ON rr_geometry_repairs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Authenticated users can insert RR repairs"
  ON rr_geometry_repairs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_rr_geometry_repairs_symbol_created
  ON rr_geometry_repairs (symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rr_geometry_repairs_user_created
  ON rr_geometry_repairs (user_id, created_at DESC);
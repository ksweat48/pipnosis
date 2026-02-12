/*
  # Create Style Gate Blocks Table

  1. Purpose
    - Track all trades blocked by the style qualification gate
    - Governance & compliance tracking for style execution enforcement
    - Analytics on which violations are most common

  2. New Tables
    - `style_gate_blocks`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `session_id` (uuid, references goal_sessions)
      - `symbol` (text, trading pair)
      - `style` (text, requested style: SCALP, MICRO_INTRADAY, INTRADAY)
      - `asset_class` (text, FOREX, CRYPTO, METAL, INDEX)
      - `block_reason` (text, summary reason for block)
      - `violations` (jsonb, detailed violation list)
      - `expected_fill_time_hours` (numeric, expected duration)
      - `omega_consensus_percent` (numeric, real Omega voting consensus)
      - `alpha_final_confidence` (numeric, Alpha's inflated confidence)
      - `atr_percent` (numeric, current ATR%)
      - `target_pips` (numeric, target distance in pips)
      - `stop_pips` (numeric, stop distance in pips)
      - `goal_amount` (numeric, goal target if applicable)
      - `created_at` (timestamptz, record creation)

  3. Security
    - Enable RLS on `style_gate_blocks` table
    - Users can view their own blocks
    - Service role can insert blocks
    - Admin can view all blocks for governance

  4. Indexes
    - Index on user_id for user-specific queries
    - Index on session_id for session-specific queries
    - Index on created_at for time-based analytics
    - Index on style for style-specific analysis
*/

-- Drop table if exists to start fresh
DROP TABLE IF EXISTS style_gate_blocks CASCADE;

-- Create style_gate_blocks table
CREATE TABLE style_gate_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  style text NOT NULL CHECK (style IN ('SCALP', 'MICRO_INTRADAY', 'INTRADAY')),
  asset_class text NOT NULL CHECK (asset_class IN ('FOREX', 'CRYPTO', 'METAL', 'INDEX')),
  block_reason text NOT NULL,
  violations jsonb DEFAULT '[]'::jsonb,
  expected_fill_time_hours numeric,
  omega_consensus_percent numeric,
  alpha_final_confidence numeric,
  atr_percent numeric,
  target_pips numeric,
  stop_pips numeric,
  goal_amount numeric,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE style_gate_blocks ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own blocks
CREATE POLICY "Users can view own style gate blocks"
  ON style_gate_blocks
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Service role can insert blocks
CREATE POLICY "Service role can insert style gate blocks"
  ON style_gate_blocks
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Policy: Service role can select all blocks
CREATE POLICY "Service role can select all style gate blocks"
  ON style_gate_blocks
  FOR SELECT
  TO service_role
  USING (true);

-- Indexes for performance
CREATE INDEX idx_style_gate_blocks_user_id ON style_gate_blocks(user_id);
CREATE INDEX idx_style_gate_blocks_session_id ON style_gate_blocks(session_id);
CREATE INDEX idx_style_gate_blocks_created_at ON style_gate_blocks(created_at DESC);
CREATE INDEX idx_style_gate_blocks_style ON style_gate_blocks(style);
CREATE INDEX idx_style_gate_blocks_symbol ON style_gate_blocks(symbol);

/*
  # Create Trade Cost Quotes System

  1. New Tables
    - `trade_cost_quotes`
      - `id` (uuid, primary key) - Quote identifier
      - `user_id` (uuid, FK to auth.users) - Quote owner
      - `trade_intent_id` (uuid, UNIQUE) - Idempotency key tied to trade intent
      - `membership_tier` (integer) - Tier level at quote time
      - `tier_name` (text) - Tier name at quote time
      - `discount_pct` (numeric) - Discount percentage applied
      - `base_credit_cost` (numeric) - Base cost before discount (always 10)
      - `credit_discount_amount` (numeric) - Credits saved
      - `final_credit_cost` (numeric) - Actual credits charged
      - `pip_to_burn` (numeric) - PIP tokens to burn for this discount
      - `status` (text) - Quote lifecycle: pending/approved/rejected/executed/expired
      - `reject_reason` (text) - Why quote was rejected (if applicable)
      - `degraded` (boolean) - True if discount was removed due to insufficient PIP
      - `quoted_at` (timestamptz) - When quote was created
      - `executed_at` (timestamptz) - When quote was executed
      - `expires_at` (timestamptz) - Quote expiry (5 minutes from creation)

  2. Modified Tables
    - `credit_deduction_history`
      - Added `tier_level` (integer) - Tier at deduction time
      - Added `discount_pct` (numeric) - Discount applied
      - Added `base_cost` (numeric) - Base cost before discount
      - Added `final_cost` (numeric) - Actual cost charged
      - Added `pip_burned` (numeric) - PIP burned for this trade
      - Added `quote_id` (uuid) - Link to trade_cost_quotes

    - `club_analytics_snapshots`
      - Added `total_pip_burned` (numeric) - Cumulative PIP burned
      - Added `discount_trades_count` (integer) - Trades with discount
      - Added `total_discount_savings` (numeric) - Total credits saved
      - Added `burn_velocity_24h` (numeric) - PIP burned in last 24h

  3. Security
    - RLS enabled on `trade_cost_quotes`
    - Users can read their own quotes
    - Service role can manage all quotes
*/

-- Step 1: Create trade_cost_quotes table
CREATE TABLE IF NOT EXISTS trade_cost_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  trade_intent_id UUID NOT NULL,
  membership_tier INTEGER NOT NULL DEFAULT 0,
  tier_name TEXT NOT NULL DEFAULT 'None',
  discount_pct NUMERIC(5,4) NOT NULL DEFAULT 0.0000,
  base_credit_cost NUMERIC(10,2) NOT NULL DEFAULT 10.00,
  credit_discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  final_credit_cost NUMERIC(10,2) NOT NULL DEFAULT 10.00,
  pip_to_burn NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  status TEXT NOT NULL DEFAULT 'pending',
  reject_reason TEXT,
  degraded BOOLEAN NOT NULL DEFAULT false,
  quoted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT trade_cost_quotes_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'executed', 'expired')),

  CONSTRAINT trade_cost_quotes_final_cost_floor
    CHECK (final_credit_cost >= 8.00),

  CONSTRAINT trade_cost_quotes_discount_cap
    CHECK (discount_pct <= 0.2000),

  CONSTRAINT trade_cost_quotes_intent_unique
    UNIQUE (trade_intent_id)
);

CREATE INDEX IF NOT EXISTS idx_trade_cost_quotes_user_status
  ON trade_cost_quotes(user_id, status);

CREATE INDEX IF NOT EXISTS idx_trade_cost_quotes_intent
  ON trade_cost_quotes(trade_intent_id);

ALTER TABLE trade_cost_quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own quotes"
  ON trade_cost_quotes FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages quotes"
  ON trade_cost_quotes FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Step 2: Add structured discount tracking to credit_deduction_history
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'credit_deduction_history' AND column_name = 'tier_level'
  ) THEN
    ALTER TABLE credit_deduction_history ADD COLUMN tier_level INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'credit_deduction_history' AND column_name = 'discount_pct'
  ) THEN
    ALTER TABLE credit_deduction_history ADD COLUMN discount_pct NUMERIC(5,4) DEFAULT 0.0000;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'credit_deduction_history' AND column_name = 'base_cost'
  ) THEN
    ALTER TABLE credit_deduction_history ADD COLUMN base_cost NUMERIC(10,2) DEFAULT 10.00;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'credit_deduction_history' AND column_name = 'final_cost'
  ) THEN
    ALTER TABLE credit_deduction_history ADD COLUMN final_cost NUMERIC(10,2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'credit_deduction_history' AND column_name = 'pip_burned'
  ) THEN
    ALTER TABLE credit_deduction_history ADD COLUMN pip_burned NUMERIC(10,2) DEFAULT 0.00;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'credit_deduction_history' AND column_name = 'quote_id'
  ) THEN
    ALTER TABLE credit_deduction_history ADD COLUMN quote_id UUID;
  END IF;
END $$;

-- Step 3: Add burn/discount columns to club_analytics_snapshots
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'club_analytics_snapshots' AND column_name = 'total_pip_burned'
  ) THEN
    ALTER TABLE club_analytics_snapshots ADD COLUMN total_pip_burned NUMERIC(14,2) DEFAULT 0.00;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'club_analytics_snapshots' AND column_name = 'discount_trades_count'
  ) THEN
    ALTER TABLE club_analytics_snapshots ADD COLUMN discount_trades_count INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'club_analytics_snapshots' AND column_name = 'total_discount_savings'
  ) THEN
    ALTER TABLE club_analytics_snapshots ADD COLUMN total_discount_savings NUMERIC(14,2) DEFAULT 0.00;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'club_analytics_snapshots' AND column_name = 'burn_velocity_24h'
  ) THEN
    ALTER TABLE club_analytics_snapshots ADD COLUMN burn_velocity_24h NUMERIC(14,2) DEFAULT 0.00;
  END IF;
END $$;

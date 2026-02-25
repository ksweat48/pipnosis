/*
  # User Broker Lot Calibration Config

  ## Purpose
  Allows users to configure the broker contract size (lot tier) for each of the 9
  in-scope trading symbols. This corrects position sizing when a broker uses non-standard
  contract sizes (mini or micro lots) rather than the industry-standard full lot.

  ## New Table: user_broker_lot_config
  - `id` (uuid, primary key)
  - `user_id` (uuid, FK to auth.users)
  - `symbol` (text) — one of the 9 calibratable symbols
  - `lot_tier` (text) — 'standard' | 'mini' | 'micro'
  - `updated_at` (timestamptz)

  Unique constraint on (user_id, symbol) — one config row per user per symbol.

  ## Security
  - RLS enabled, users can only read/write their own rows.
  - Service role retains unrestricted access for admin diagnostics.

  ## Behaviour
  - If no row exists for a (user_id, symbol) pair the runtime service falls back
    to 'standard' (1.0x multiplier). Trading is never blocked by missing calibration.

  ## Valid Symbols
  Constrained to the 9 in-scope instruments:
  XAUUSD, US30, NAS100, SPX500, EURUSD, GBPUSD, USDJPY, BTCUSD, ETHUSD

  ## Valid Tiers
  - standard: full lot (1.0x multiplier, industry default)
  - mini:      1/10 lot (0.1x multiplier)
  - micro:     1/100 lot (0.01x multiplier)
*/

CREATE TABLE IF NOT EXISTS user_broker_lot_config (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol      text        NOT NULL,
  lot_tier    text        NOT NULL DEFAULT 'standard',
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_broker_lot_config_symbol_check
    CHECK (symbol IN ('XAUUSD','US30','NAS100','SPX500','EURUSD','GBPUSD','USDJPY','BTCUSD','ETHUSD')),

  CONSTRAINT user_broker_lot_config_tier_check
    CHECK (lot_tier IN ('standard','mini','micro')),

  CONSTRAINT user_broker_lot_config_unique_user_symbol
    UNIQUE (user_id, symbol)
);

ALTER TABLE user_broker_lot_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own broker lot config"
  ON user_broker_lot_config
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own broker lot config"
  ON user_broker_lot_config
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own broker lot config"
  ON user_broker_lot_config
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own broker lot config"
  ON user_broker_lot_config
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_user_broker_lot_config_user_id
  ON user_broker_lot_config (user_id);

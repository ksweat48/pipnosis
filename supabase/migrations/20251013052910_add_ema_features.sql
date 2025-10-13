/*
  # Add EMA Features

  1. Schema Changes
    - Add EMA display preferences to chart_preferences table
    - Create ema_alerts table for EMA crossover notifications
    - Create ema_crossovers table for historical crossover tracking

  2. New Tables
    - `ema_alerts`: Stores user preferences for EMA crossover alerts
    - `ema_crossovers`: Historical record of all EMA crossovers detected

  3. Security
    - Enable RLS on new tables
    - Users can only access their own alert preferences
    - Crossovers are readable by all authenticated users
*/

-- Add EMA preferences to chart_preferences
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'chart_preferences' AND column_name = 'show_all_emas'
  ) THEN
    ALTER TABLE chart_preferences
      ADD COLUMN show_all_emas boolean DEFAULT false,
      ADD COLUMN ema_5_color text DEFAULT '#00ff95',
      ADD COLUMN ema_9_color text DEFAULT '#facc15',
      ADD COLUMN ema_21_color text DEFAULT '#44c0ff',
      ADD COLUMN ema_50_color text DEFAULT '#ff6b6b',
      ADD COLUMN ema_200_color text DEFAULT '#aa44ff';
  END IF;
END $$;

-- Create EMA alerts table
CREATE TABLE IF NOT EXISTS ema_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  ema_short integer NOT NULL,
  ema_long integer NOT NULL,
  alert_type text NOT NULL CHECK (alert_type IN ('bullish_cross', 'bearish_cross', 'both')),
  enabled boolean DEFAULT true NOT NULL,
  last_triggered_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id, symbol, timeframe, ema_short, ema_long)
);

-- Create EMA crossovers table
CREATE TABLE IF NOT EXISTS ema_crossovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  ema_short integer NOT NULL,
  ema_long integer NOT NULL,
  crossover_type text NOT NULL CHECK (crossover_type IN ('bullish', 'bearish')),
  crossover_time timestamptz NOT NULL,
  short_ema_value numeric(20, 8) NOT NULL,
  long_ema_value numeric(20, 8) NOT NULL,
  price_at_cross numeric(20, 8) NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Create indexes for ema_crossovers
CREATE INDEX IF NOT EXISTS idx_ema_crossovers_symbol_timeframe 
  ON ema_crossovers(symbol, timeframe, crossover_time DESC);

CREATE INDEX IF NOT EXISTS idx_ema_crossovers_time 
  ON ema_crossovers(crossover_time DESC);

-- Enable RLS
ALTER TABLE ema_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ema_crossovers ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ema_alerts
CREATE POLICY "Users can read own EMA alerts"
  ON ema_alerts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own EMA alerts"
  ON ema_alerts
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own EMA alerts"
  ON ema_alerts
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own EMA alerts"
  ON ema_alerts
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for ema_crossovers
CREATE POLICY "Anyone can read EMA crossovers"
  ON ema_crossovers
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service can insert EMA crossovers"
  ON ema_crossovers
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Function to update ema_alerts updated_at
CREATE OR REPLACE FUNCTION update_ema_alerts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for ema_alerts
DROP TRIGGER IF EXISTS ema_alerts_updated_at ON ema_alerts;
CREATE TRIGGER ema_alerts_updated_at
  BEFORE UPDATE ON ema_alerts
  FOR EACH ROW
  EXECUTE FUNCTION update_ema_alerts_updated_at();
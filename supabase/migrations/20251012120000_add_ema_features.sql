/*
  # Add EMA Features to Pipnosis

  1. Changes to Existing Tables
    - Add EMA preference columns to `chart_preferences` table
      - `show_all_emas` (boolean) - Toggle to show all 5 EMAs or just EMA 21 and 200
      - `ema_5_color` (text) - Color for EMA 5 line
      - `ema_9_color` (text) - Color for EMA 9 line
      - `ema_21_color` (text) - Color for EMA 21 line
      - `ema_50_color` (text) - Color for EMA 50 line
      - `ema_200_color` (text) - Color for EMA 200 line

  2. New Tables
    - `ema_alerts`
      - Stores EMA event notifications (crossovers, pullbacks, trend changes)
      - Columns: id, user_id, symbol, timeframe, alert_type, event_data, is_read, created_at

    - `ema_levels`
      - Stores calculated EMA-based trade levels per symbol and timeframe
      - Columns: id, user_id, symbol, timeframe, entry, stop_loss, take_profit, reasoning, created_at

  3. Security
    - Enable RLS on all new tables
    - Add policies for authenticated users to read/write their own data
    - Create indexes for efficient querying

  4. Important Notes
    - Default EMA colors match intrascalping specifications
    - Alert system supports real-time notifications
    - EMA levels are time-stamped for historical tracking
*/

-- Add EMA columns to chart_preferences
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

-- Create ema_alerts table
CREATE TABLE IF NOT EXISTS ema_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  alert_type text NOT NULL,
  event_data jsonb NOT NULL,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Create ema_levels table
CREATE TABLE IF NOT EXISTS ema_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  entry numeric,
  stop_loss numeric,
  take_profit numeric,
  reasoning text,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS on ema_alerts
ALTER TABLE ema_alerts ENABLE ROW LEVEL SECURITY;

-- Enable RLS on ema_levels
ALTER TABLE ema_levels ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ema_alerts
CREATE POLICY "Users can view own EMA alerts"
  ON ema_alerts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own EMA alerts"
  ON ema_alerts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own EMA alerts"
  ON ema_alerts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own EMA alerts"
  ON ema_alerts FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for ema_levels
CREATE POLICY "Users can view own EMA levels"
  ON ema_levels FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own EMA levels"
  ON ema_levels FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own EMA levels"
  ON ema_levels FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own EMA levels"
  ON ema_levels FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_ema_alerts_user_id ON ema_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_ema_alerts_symbol ON ema_alerts(symbol);
CREATE INDEX IF NOT EXISTS idx_ema_alerts_timeframe ON ema_alerts(timeframe);
CREATE INDEX IF NOT EXISTS idx_ema_alerts_created_at ON ema_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ema_alerts_is_read ON ema_alerts(is_read);

CREATE INDEX IF NOT EXISTS idx_ema_levels_user_id ON ema_levels(user_id);
CREATE INDEX IF NOT EXISTS idx_ema_levels_symbol ON ema_levels(symbol);
CREATE INDEX IF NOT EXISTS idx_ema_levels_timeframe ON ema_levels(timeframe);
CREATE INDEX IF NOT EXISTS idx_ema_levels_created_at ON ema_levels(created_at DESC);

-- Create composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_ema_alerts_user_symbol_tf ON ema_alerts(user_id, symbol, timeframe);
CREATE INDEX IF NOT EXISTS idx_ema_levels_user_symbol_tf ON ema_levels(user_id, symbol, timeframe);

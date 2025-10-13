/*
  # Add Auto-Trading Analysis Features

  1. Schema Changes
    - Add `analysis_view_mode` column to `chart_preferences` table
    - Create `auto_trading_status` table for real-time monitoring
    - Create `auto_trading_scan_history` table for historical tracking

  2. New Tables
    - `auto_trading_status`: Real-time auto-trading scanning status
    - `auto_trading_scan_history`: Historical record of symbol scans

  3. Security
    - Enable RLS on new tables
    - Users can only access their own data
*/

-- Add analysis view mode to chart_preferences
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'chart_preferences' AND column_name = 'analysis_view_mode'
  ) THEN
    ALTER TABLE chart_preferences ADD COLUMN analysis_view_mode text DEFAULT 'technical' NOT NULL;
  END IF;
END $$;

-- Create auto_trading_status table for real-time monitoring
CREATE TABLE IF NOT EXISTS auto_trading_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  is_active boolean DEFAULT false NOT NULL,
  monitored_symbols text[] DEFAULT '{}' NOT NULL,
  last_scan_at timestamptz,
  next_scan_at timestamptz,
  trades_today integer DEFAULT 0 NOT NULL,
  trades_remaining integer DEFAULT 0 NOT NULL,
  current_phase text,
  scanning_symbol text,
  session_start_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id)
);

ALTER TABLE auto_trading_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own auto trading status"
  ON auto_trading_status FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own auto trading status"
  ON auto_trading_status FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own auto trading status"
  ON auto_trading_status FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own auto trading status"
  ON auto_trading_status FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Create auto_trading_scan_history table
CREATE TABLE IF NOT EXISTS auto_trading_scan_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  symbol text NOT NULL,
  scan_timestamp timestamptz DEFAULT now() NOT NULL,
  phase1_passed boolean DEFAULT false NOT NULL,
  phase1_confidence integer,
  phase1_reason text,
  phase2_passed boolean DEFAULT false NOT NULL,
  phase2_confidence integer,
  phase2_reason text,
  phase3_passed boolean DEFAULT false NOT NULL,
  phase3_confidence integer,
  phase3_reason text,
  overall_confidence integer,
  signal_generated boolean DEFAULT false NOT NULL,
  trade_direction text,
  entry_price numeric,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE auto_trading_scan_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own scan history"
  ON auto_trading_scan_history FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own scan history"
  ON auto_trading_scan_history FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_scan_history_user_timestamp
  ON auto_trading_scan_history(user_id, scan_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_scan_history_symbol
  ON auto_trading_scan_history(user_id, symbol, scan_timestamp DESC);

-- Create updated_at trigger for auto_trading_status
CREATE OR REPLACE FUNCTION update_auto_trading_status_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_trading_status_updated_at
  BEFORE UPDATE ON auto_trading_status
  FOR EACH ROW
  EXECUTE FUNCTION update_auto_trading_status_updated_at();

-- Add check constraint for analysis_view_mode
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'chart_preferences'
    AND constraint_name = 'chart_preferences_analysis_view_mode_check'
  ) THEN
    ALTER TABLE chart_preferences
      ADD CONSTRAINT chart_preferences_analysis_view_mode_check
      CHECK (analysis_view_mode IN ('technical', 'autotrading'));
  END IF;
END $$;
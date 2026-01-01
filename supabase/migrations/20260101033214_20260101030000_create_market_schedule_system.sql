/*
  # Market Schedule System

  ## Purpose
  Create a comprehensive, database-driven market schedule system that serves as the
  single source of truth for all market hours, holidays, and early closures.

  ## New Tables

  ### `market_holidays`
  Stores all market holidays including full-day closures and early closures.
  - `id` (uuid, primary key) - Unique identifier
  - `date` (date, unique) - Holiday date in YYYY-MM-DD format
  - `name` (text) - Holiday name (e.g., "Christmas Day")
  - `type` (text) - Either 'full_day' or 'early_close'
  - `early_close_time_est` (text, nullable) - Time in HH:MM format for early closures
  - `market` (text) - Market this applies to (default: 'forex')
  - `created_at` (timestamptz) - Record creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### `market_schedule_overrides`
  Stores temporary schedule overrides for exceptional circumstances.
  - `id` (uuid, primary key) - Unique identifier
  - `date` (date, unique) - Override date in YYYY-MM-DD format
  - `type` (text) - Either 'closed' or 'early_close'
  - `close_time_est` (text, nullable) - Close time in HH:MM format
  - `reason` (text) - Reason for the override
  - `created_by` (uuid, nullable) - User who created the override
  - `created_at` (timestamptz) - Record creation timestamp

  ## Initial Data
  Seeds comprehensive 2025-2026 US forex market holiday calendar including:
  - New Year's Day
  - Martin Luther King Jr. Day
  - Presidents Day
  - Good Friday
  - Memorial Day
  - Independence Day
  - Labor Day
  - Thanksgiving
  - Christmas Eve (early close at 1:00 PM EST)
  - Christmas Day
  - New Year's Eve (early close at 1:00 PM EST)

  ## Security
  - Enable RLS on both tables
  - Allow public read access (holidays are public information)
  - Restrict write access to admin users only

  ## Notes
  - All times are in EST (Eastern Standard Time)
  - Early closures typically occur at 1:00 PM EST for major holidays
  - This system replaces hardcoded holiday logic scattered across the codebase
*/

-- =====================================================================================
-- TABLE: market_holidays
-- =====================================================================================

CREATE TABLE IF NOT EXISTS market_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL UNIQUE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('full_day', 'early_close')),
  early_close_time_est text,
  market text NOT NULL DEFAULT 'forex',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT valid_early_close_time CHECK (
    (type = 'early_close' AND early_close_time_est IS NOT NULL) OR
    (type = 'full_day' AND early_close_time_est IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_market_holidays_date ON market_holidays(date);
CREATE INDEX IF NOT EXISTS idx_market_holidays_market ON market_holidays(market);
CREATE INDEX IF NOT EXISTS idx_market_holidays_type ON market_holidays(type);

-- =====================================================================================
-- TABLE: market_schedule_overrides
-- =====================================================================================

CREATE TABLE IF NOT EXISTS market_schedule_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL UNIQUE,
  type text NOT NULL CHECK (type IN ('closed', 'early_close')),
  close_time_est text,
  reason text NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),

  CONSTRAINT valid_override_time CHECK (
    (type = 'early_close' AND close_time_est IS NOT NULL) OR
    (type = 'closed' AND close_time_est IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_market_overrides_date ON market_schedule_overrides(date);

-- =====================================================================================
-- ROW LEVEL SECURITY
-- =====================================================================================

ALTER TABLE market_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_schedule_overrides ENABLE ROW LEVEL SECURITY;

-- Anyone can read holidays (public information)
CREATE POLICY "Anyone can read market holidays"
  ON market_holidays FOR SELECT
  TO public
  USING (true);

-- Only admins can modify holidays
CREATE POLICY "Only admins can insert holidays"
  ON market_holidays FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Only admins can update holidays"
  ON market_holidays FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Only admins can delete holidays"
  ON market_holidays FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Anyone can read overrides
CREATE POLICY "Anyone can read schedule overrides"
  ON market_schedule_overrides FOR SELECT
  TO public
  USING (true);

-- Only admins can create overrides
CREATE POLICY "Only admins can insert overrides"
  ON market_schedule_overrides FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Only admins can update overrides
CREATE POLICY "Only admins can update overrides"
  ON market_schedule_overrides FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Only admins can delete overrides
CREATE POLICY "Only admins can delete overrides"
  ON market_schedule_overrides FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- =====================================================================================
-- SEED DATA: 2025-2026 Forex Market Holidays
-- =====================================================================================

INSERT INTO market_holidays (date, name, type, early_close_time_est, market) VALUES
  -- 2025 Holidays
  ('2025-01-01', 'New Year''s Day', 'full_day', NULL, 'forex'),
  ('2025-01-20', 'Martin Luther King Jr. Day', 'full_day', NULL, 'forex'),
  ('2025-02-17', 'Presidents Day', 'full_day', NULL, 'forex'),
  ('2025-04-18', 'Good Friday', 'full_day', NULL, 'forex'),
  ('2025-05-26', 'Memorial Day', 'full_day', NULL, 'forex'),
  ('2025-07-04', 'Independence Day', 'full_day', NULL, 'forex'),
  ('2025-09-01', 'Labor Day', 'full_day', NULL, 'forex'),
  ('2025-11-27', 'Thanksgiving', 'full_day', NULL, 'forex'),
  ('2025-12-24', 'Christmas Eve', 'early_close', '13:00', 'forex'),
  ('2025-12-25', 'Christmas Day', 'full_day', NULL, 'forex'),
  ('2025-12-31', 'New Year''s Eve', 'early_close', '13:00', 'forex'),

  -- 2026 Holidays
  ('2026-01-01', 'New Year''s Day', 'full_day', NULL, 'forex'),
  ('2026-01-19', 'Martin Luther King Jr. Day', 'full_day', NULL, 'forex'),
  ('2026-02-16', 'Presidents Day', 'full_day', NULL, 'forex'),
  ('2026-04-03', 'Good Friday', 'full_day', NULL, 'forex'),
  ('2026-05-25', 'Memorial Day', 'full_day', NULL, 'forex'),
  ('2026-07-03', 'Independence Day (Observed)', 'full_day', NULL, 'forex'),
  ('2026-09-07', 'Labor Day', 'full_day', NULL, 'forex'),
  ('2026-11-26', 'Thanksgiving', 'full_day', NULL, 'forex'),
  ('2026-12-24', 'Christmas Eve', 'early_close', '13:00', 'forex'),
  ('2026-12-25', 'Christmas Day', 'full_day', NULL, 'forex'),
  ('2026-12-31', 'New Year''s Eve', 'early_close', '13:00', 'forex')
ON CONFLICT (date) DO NOTHING;

-- =====================================================================================
-- HELPER FUNCTIONS
-- =====================================================================================

-- Function to check if market is open on a specific date
CREATE OR REPLACE FUNCTION is_market_open_on_date(check_date date)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  day_of_week integer;
  holiday_record market_holidays%ROWTYPE;
  override_record market_schedule_overrides%ROWTYPE;
BEGIN
  day_of_week := EXTRACT(DOW FROM check_date);

  IF day_of_week = 6 THEN
    RETURN false;
  END IF;

  SELECT * INTO holiday_record
  FROM market_holidays
  WHERE date = check_date AND type = 'full_day';

  IF FOUND THEN
    RETURN false;
  END IF;

  SELECT * INTO override_record
  FROM market_schedule_overrides
  WHERE date = check_date AND type = 'closed';

  IF FOUND THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

-- Function to get next market open date
CREATE OR REPLACE FUNCTION get_next_market_open_date(from_date date DEFAULT CURRENT_DATE)
RETURNS date
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  check_date date;
  max_iterations integer := 30;
  iteration integer := 0;
BEGIN
  check_date := from_date + 1;

  WHILE iteration < max_iterations LOOP
    IF is_market_open_on_date(check_date) THEN
      RETURN check_date;
    END IF;

    check_date := check_date + 1;
    iteration := iteration + 1;
  END LOOP;

  RETURN from_date + 30;
END;
$$;

GRANT EXECUTE ON FUNCTION is_market_open_on_date(date) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_next_market_open_date(date) TO authenticated, anon;
/*
  # Add Chart Preferences

  1. New Tables
    - `chart_preferences`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users)
      - `theme` (text, chart color theme)
      - `show_volume` (boolean, display volume bars)
      - `show_grid` (boolean, display grid lines)
      - `show_ai_analysis` (boolean, display AI analysis)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Security
    - Enable RLS on `chart_preferences` table
    - Add policy for authenticated users to read their own preferences
    - Add policy for authenticated users to insert their own preferences
    - Add policy for authenticated users to update their own preferences
*/

CREATE TABLE IF NOT EXISTS chart_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  theme text DEFAULT 'dark' NOT NULL,
  show_volume boolean DEFAULT true NOT NULL,
  show_grid boolean DEFAULT true NOT NULL,
  show_ai_analysis boolean DEFAULT true NOT NULL,
  candlestick_up_color text DEFAULT '#10b981',
  candlestick_down_color text DEFAULT '#ef4444',
  background_color text DEFAULT 'rgba(15, 23, 42, 0.5)',
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id)
);

ALTER TABLE chart_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own chart preferences"
  ON chart_preferences
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own chart preferences"
  ON chart_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own chart preferences"
  ON chart_preferences
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_chart_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chart_preferences_updated_at
  BEFORE UPDATE ON chart_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_chart_preferences_updated_at();

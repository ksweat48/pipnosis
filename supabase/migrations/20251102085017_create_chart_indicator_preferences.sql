/*
  # Create chart indicator display preferences table

  1. New Tables
    - `chart_indicator_preferences`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users)
      - `symbol` (text) - Trading pair symbol
      - `vwap_visible` (boolean) - Display VWAP on chart
      - `ema20_visible` (boolean) - Display EMA 20 on chart
      - `ema50_visible` (boolean) - Display EMA 50 on chart
      - `ema200_visible` (boolean) - Display EMA 200 on chart
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      
  2. Security
    - Enable RLS on `chart_indicator_preferences` table
    - Add policy for users to read their own preferences
    - Add policy for users to insert their own preferences
    - Add policy for users to update their own preferences
    - Add policy for users to delete their own preferences
    
  3. Indexes
    - Index on user_id for fast lookups
    - Unique index on (user_id, symbol) to prevent duplicates
    
  4. Notes
    - These preferences control VISUAL DISPLAY ONLY
    - All indicators continue to be calculated for AI/system usage
    - Default values are TRUE (all indicators visible by default)
*/

-- Create the chart_indicator_preferences table
CREATE TABLE IF NOT EXISTS chart_indicator_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  vwap_visible boolean NOT NULL DEFAULT true,
  ema20_visible boolean NOT NULL DEFAULT true,
  ema50_visible boolean NOT NULL DEFAULT true,
  ema200_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create unique index to prevent duplicate preferences per user per symbol
CREATE UNIQUE INDEX IF NOT EXISTS idx_chart_indicator_preferences_user_symbol 
  ON chart_indicator_preferences(user_id, symbol);

-- Create index for faster lookups by user_id
CREATE INDEX IF NOT EXISTS idx_chart_indicator_preferences_user_id 
  ON chart_indicator_preferences(user_id);

-- Enable Row Level Security
ALTER TABLE chart_indicator_preferences ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own preferences
CREATE POLICY "Users can read own chart indicator preferences"
  ON chart_indicator_preferences
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own preferences
CREATE POLICY "Users can insert own chart indicator preferences"
  ON chart_indicator_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own preferences
CREATE POLICY "Users can update own chart indicator preferences"
  ON chart_indicator_preferences
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own preferences
CREATE POLICY "Users can delete own chart indicator preferences"
  ON chart_indicator_preferences
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_chart_indicator_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to call the function
CREATE TRIGGER trigger_update_chart_indicator_preferences_updated_at
  BEFORE UPDATE ON chart_indicator_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_chart_indicator_preferences_updated_at();
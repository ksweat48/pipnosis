/*
  # Add Individual EMA Toggle Preferences

  1. New Columns
    - `show_ema_9` (boolean) - Show/hide EMA 9 line
    - `show_ema_21` (boolean) - Show/hide EMA 21 line
    - `show_ema_50` (boolean) - Show/hide EMA 50 line
    - `show_ema_100` (boolean) - Show/hide EMA 100 line
    - `show_ema_200` (boolean) - Show/hide EMA 200 line

  2. Changes
    - Add individual EMA toggle controls to chart_preferences table
    - Set default values to match existing behavior
    - Maintains backward compatibility with show_all_emas setting

  3. Notes
    - EMA 9, 21, and 200 are enabled by default (most commonly used)
    - EMA 50 and 100 are disabled by default to reduce chart clutter
    - Users can customize which EMAs to display via Settings modal
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'chart_preferences' AND column_name = 'show_ema_9'
  ) THEN
    ALTER TABLE chart_preferences ADD COLUMN show_ema_9 boolean DEFAULT true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'chart_preferences' AND column_name = 'show_ema_21'
  ) THEN
    ALTER TABLE chart_preferences ADD COLUMN show_ema_21 boolean DEFAULT true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'chart_preferences' AND column_name = 'show_ema_50'
  ) THEN
    ALTER TABLE chart_preferences ADD COLUMN show_ema_50 boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'chart_preferences' AND column_name = 'show_ema_100'
  ) THEN
    ALTER TABLE chart_preferences ADD COLUMN show_ema_100 boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'chart_preferences' AND column_name = 'show_ema_200'
  ) THEN
    ALTER TABLE chart_preferences ADD COLUMN show_ema_200 boolean DEFAULT true;
  END IF;
END $$;

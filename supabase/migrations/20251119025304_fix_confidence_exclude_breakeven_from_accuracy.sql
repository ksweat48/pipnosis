/*
  # Fix Confidence Tracking to Exclude Breakeven Trades from Accuracy

  ## Problem
  Breakeven trades were being marked as "accurate" which inflated the confidence accuracy percentage.
  Breakeven trades provide no signal about whether the AI's confidence was correct or not.

  ## Changes
  1. Update is_confidence_accurate() function to return false for breakeven trades
  2. Add comment explaining that breakeven trades are excluded from accuracy calculations
  3. Accuracy should only measure: "When AI is confident, does it win?" and "When AI is uncertain, does it lose?"

  ## Impact
  - Breakeven trades will still be tracked in ai_confidence_calibration table
  - They will be marked as was_accurate = false
  - Accuracy calculations will exclude them from both numerator and denominator
  - This gives a true measure of whether confidence predictions match profitable/losing outcomes
*/

-- Drop and recreate the is_confidence_accurate function
DROP FUNCTION IF EXISTS is_confidence_accurate(integer, text);

CREATE OR REPLACE FUNCTION is_confidence_accurate(
  confidence integer,
  outcome text
)
RETURNS boolean AS $$
BEGIN
  -- IMPORTANT: Breakeven trades are NOT counted in accuracy calculations
  -- They provide no information about whether the AI's confidence was correct
  IF outcome = 'breakeven' THEN
    RETURN false;
  END IF;

  -- High confidence (>= 70) should result in wins
  IF confidence >= 70 AND outcome = 'win' THEN
    RETURN true;
  END IF;

  -- Low confidence (< 50) is okay with losses  
  IF confidence < 50 AND outcome = 'loss' THEN
    RETURN true;
  END IF;

  -- Medium confidence (50-70) is neutral - always considered reasonable
  IF confidence >= 50 AND confidence < 70 THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION is_confidence_accurate(integer, text) IS 
'Determines if AI confidence prediction was accurate. Breakeven trades are excluded (return false) as they provide no signal about prediction quality.';

-- Update existing breakeven trades to have was_accurate = false
UPDATE ai_confidence_calibration
SET was_accurate = false
WHERE actual_outcome = 'breakeven';

-- Log the update
DO $$
DECLARE
  updated_count integer;
BEGIN
  SELECT COUNT(*) INTO updated_count
  FROM ai_confidence_calibration
  WHERE actual_outcome = 'breakeven';
  
  RAISE NOTICE '✅ Updated % breakeven trades to was_accurate = false', updated_count;
  RAISE NOTICE 'Breakeven trades are now excluded from accuracy calculations';
END $$;

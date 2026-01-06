/*
  # Fix Market Context Brain Name Constraint
  
  1. Problem
     - sentiment-aggregator.ts saves market context with brain_name='market_context'
     - omega_market_intelligence table constraint only allows specific brain names
     - 'market_context' is not in the allowed list, causing 400 Bad Request errors
  
  2. Solution
     - Add 'market_context' to the valid_brain_name constraint
     - This allows the 3-tier cache system to work properly for market context
  
  3. Impact
     - Fixes all 400 errors when saving market context
     - Enables proper caching for sentiment/market context analysis
     - No breaking changes - only adds a new allowed value
*/

-- Drop the old constraint
ALTER TABLE omega_market_intelligence 
DROP CONSTRAINT IF EXISTS valid_brain_name;

-- Add the new constraint with 'market_context' included
ALTER TABLE omega_market_intelligence
ADD CONSTRAINT valid_brain_name CHECK (brain_name IN (
  'trend', 'scalper', 'confirmation', 'reversal', 
  'volatility', 'risk', 'orderflow', 'sentiment',
  'hallucination', 'meta_reasoning', 'regime_oracle',
  'adversarial_detector', 'market_context'
));

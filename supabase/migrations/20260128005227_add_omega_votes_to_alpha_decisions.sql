/*
  # Add omega_votes column to alpha_decisions table

  1. Problem
    - The alpha_decisions table is missing the omega_votes JSONB column
    - Attempting to insert records with omega_votes data causes PGRST204 error
    - AlphaLearningTracker.logDecision() cannot properly log Omega council voting data
    
  2. Solution
    - Add omega_votes column as JSONB type to store complete OmegaCouncilVotes structure
    - Column is optional (nullable) for backward compatibility with existing records
    - Enable NOT NULL after data validation if needed
    
  3. New Columns
    - `omega_votes` (JSONB) - Stores OmegaCouncilVotes structure containing Omega8, Omega9, etc. votes
    
  4. Notes
    - Fully backward compatible - existing records will have NULL omega_votes
    - Data structure should match OmegaCouncilVotes interface:
      {
        omega8?: { confidence, reasoning, used_llm, deterministic_bias, ... },
        omega9?: { pass, flags, confidence_adjustment, ... },
        omega10?: { ... },
        ...
      }
*/

DO $$
BEGIN
  -- Add omega_votes column if it doesn't already exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'omega_votes'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN omega_votes jsonb;
    
    -- Add index on omega_votes for query performance
    CREATE INDEX idx_alpha_decisions_omega_votes 
    ON alpha_decisions USING GIN (omega_votes);
    
    RAISE NOTICE 'Successfully added omega_votes column to alpha_decisions table';
  ELSE
    RAISE NOTICE 'omega_votes column already exists in alpha_decisions table';
  END IF;
END $$;

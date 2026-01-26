
/*
  # CCIP Governance: Audit Tables Schema Compliance V2
  
  ## Root Cause Analysis
  - goal_target_audit missing 13 expected columns (code-db mismatch)
  - confidence_calculation_audit missing user_id column for RLS enforcement
  - Missing feasibility_mechanism_detail table (dependency)
  - RLS policies exist but table schema incomplete
  
  ## Fix Strategy (SSOT + CCIP Compliant)
  - Add all missing columns to goal_target_audit with proper types
  - Add user_id to confidence_calculation_audit for RLS enforcement
  - Ensure feasibility_mechanism_detail table with complete schema
  - Enforce RLS on all audit tables (governance authority)
  
  ## CCIP Phases
  - Phase 1: Schema correction (this migration)
  - Phase 2: RLS policy verification
  - Phase 3: Code refactoring to match schema
*/

-- 1. Fix goal_target_audit schema
DO $$
BEGIN
  -- Add symbol column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_target_audit' AND column_name = 'symbol'
  ) THEN
    ALTER TABLE goal_target_audit ADD COLUMN symbol text;
  END IF;

  -- Add goal_requested if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_target_audit' AND column_name = 'goal_requested'
  ) THEN
    ALTER TABLE goal_target_audit ADD COLUMN goal_requested numeric;
  END IF;

  -- Add goal_recommended if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_target_audit' AND column_name = 'goal_recommended'
  ) THEN
    ALTER TABLE goal_target_audit ADD COLUMN goal_recommended numeric;
  END IF;

  -- Add goal_user_choice if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_target_audit' AND column_name = 'goal_user_choice'
  ) THEN
    ALTER TABLE goal_target_audit ADD COLUMN goal_user_choice numeric;
  END IF;

  -- Add mechanisms_evaluated if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_target_audit' AND column_name = 'mechanisms_evaluated'
  ) THEN
    ALTER TABLE goal_target_audit ADD COLUMN mechanisms_evaluated text[] DEFAULT '{}';
  END IF;

  -- Add mechanisms_suppressed if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_target_audit' AND column_name = 'mechanisms_suppressed'
  ) THEN
    ALTER TABLE goal_target_audit ADD COLUMN mechanisms_suppressed text[] DEFAULT '{}';
  END IF;

  -- Add mechanisms_applied if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_target_audit' AND column_name = 'mechanisms_applied'
  ) THEN
    ALTER TABLE goal_target_audit ADD COLUMN mechanisms_applied text[] DEFAULT '{}';
  END IF;

  -- Add atr_value if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_target_audit' AND column_name = 'atr_value'
  ) THEN
    ALTER TABLE goal_target_audit ADD COLUMN atr_value numeric;
  END IF;

  -- Add atr_typical if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_target_audit' AND column_name = 'atr_typical'
  ) THEN
    ALTER TABLE goal_target_audit ADD COLUMN atr_typical numeric;
  END IF;

  -- Add atr_multiplier_from_typical if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_target_audit' AND column_name = 'atr_multiplier_from_typical'
  ) THEN
    ALTER TABLE goal_target_audit ADD COLUMN atr_multiplier_from_typical numeric;
  END IF;

  -- Add session_liquidity if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_target_audit' AND column_name = 'session_liquidity'
  ) THEN
    ALTER TABLE goal_target_audit ADD COLUMN session_liquidity text CHECK (session_liquidity IN ('high', 'medium', 'low'));
  END IF;

  -- Add current_spread if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_target_audit' AND column_name = 'current_spread'
  ) THEN
    ALTER TABLE goal_target_audit ADD COLUMN current_spread numeric;
  END IF;

  -- Add account_balance if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_target_audit' AND column_name = 'account_balance'
  ) THEN
    ALTER TABLE goal_target_audit ADD COLUMN account_balance numeric;
  END IF;

  -- Add min_goal_retention_met if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_target_audit' AND column_name = 'min_goal_retention_met'
  ) THEN
    ALTER TABLE goal_target_audit ADD COLUMN min_goal_retention_met boolean;
  END IF;

  -- Add meaningful_trade_floor_details if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_target_audit' AND column_name = 'meaningful_trade_floor_details'
  ) THEN
    ALTER TABLE goal_target_audit ADD COLUMN meaningful_trade_floor_details jsonb;
  END IF;

  -- Add volatility_advisory_applied if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_target_audit' AND column_name = 'volatility_advisory_applied'
  ) THEN
    ALTER TABLE goal_target_audit ADD COLUMN volatility_advisory_applied boolean;
  END IF;

  -- Add goal_size_advisory_applied if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_target_audit' AND column_name = 'goal_size_advisory_applied'
  ) THEN
    ALTER TABLE goal_target_audit ADD COLUMN goal_size_advisory_applied boolean;
  END IF;

  -- Add user_choice if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_target_audit' AND column_name = 'user_choice'
  ) THEN
    ALTER TABLE goal_target_audit ADD COLUMN user_choice text CHECK (user_choice IN ('accept_recommended', 'accept_full', 'accept_custom', 'wait'));
  END IF;

  -- Add user_choice_value if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_target_audit' AND column_name = 'user_choice_value'
  ) THEN
    ALTER TABLE goal_target_audit ADD COLUMN user_choice_value numeric;
  END IF;

  -- Add suppressed_mechanisms_reason if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_target_audit' AND column_name = 'suppressed_mechanisms_reason'
  ) THEN
    ALTER TABLE goal_target_audit ADD COLUMN suppressed_mechanisms_reason jsonb;
  END IF;

  -- Add reduction_breakdown if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_target_audit' AND column_name = 'reduction_breakdown'
  ) THEN
    ALTER TABLE goal_target_audit ADD COLUMN reduction_breakdown jsonb;
  END IF;

  -- Add governance_notes if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_target_audit' AND column_name = 'governance_notes'
  ) THEN
    ALTER TABLE goal_target_audit ADD COLUMN governance_notes text;
  END IF;
END $$;

-- 2. Create or update feasibility_mechanism_detail table
CREATE TABLE IF NOT EXISTS feasibility_mechanism_detail (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES goal_target_audit(id) ON DELETE CASCADE,
  mechanism_name text NOT NULL,
  mechanism_type text NOT NULL CHECK (mechanism_type IN ('FLOOR', 'ADVISORY', 'MULTIPLIER', 'SIZE_CHECK')),
  evaluated boolean NOT NULL DEFAULT true,
  passed boolean NOT NULL DEFAULT false,
  threshold_value numeric,
  actual_value numeric,
  unit text,
  applied_reason text,
  suppressed_reason text,
  impact_factor numeric,
  impact_dollar_amount numeric,
  created_at timestamptz DEFAULT now()
);

-- 3. Enable RLS on audit tables
ALTER TABLE goal_target_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE confidence_calculation_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE feasibility_mechanism_detail ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS policies if they don't exist
DO $$
BEGIN
  -- goal_target_audit - SELECT
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'goal_target_audit' AND policyname = 'Users can read own goal target audits'
  ) THEN
    CREATE POLICY "Users can read own goal target audits"
      ON goal_target_audit FOR SELECT
      TO authenticated
      USING (user_id = auth.uid());
  END IF;

  -- goal_target_audit - INSERT
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'goal_target_audit' AND policyname = 'Authenticated can insert own audit logs'
  ) THEN
    CREATE POLICY "Authenticated can insert own audit logs"
      ON goal_target_audit FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;

  -- confidence_calculation_audit - SELECT
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'confidence_calculation_audit' AND policyname = 'Users can read own confidence audits'
  ) THEN
    CREATE POLICY "Users can read own confidence audits"
      ON confidence_calculation_audit FOR SELECT
      TO authenticated
      USING (user_id = auth.uid());
  END IF;

  -- confidence_calculation_audit - INSERT (authenticated)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'confidence_calculation_audit' AND policyname = 'Authenticated can insert confidence audits'
  ) THEN
    CREATE POLICY "Authenticated can insert confidence audits"
      ON confidence_calculation_audit FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;

  -- feasibility_mechanism_detail - SELECT (via parent)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'feasibility_mechanism_detail' AND policyname = 'Users can read own mechanism details'
  ) THEN
    CREATE POLICY "Users can read own mechanism details"
      ON feasibility_mechanism_detail FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM goal_target_audit
          WHERE goal_target_audit.id = feasibility_mechanism_detail.audit_id
          AND goal_target_audit.user_id = auth.uid()
        )
      );
  END IF;

  -- feasibility_mechanism_detail - INSERT (via parent)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'feasibility_mechanism_detail' AND policyname = 'Authenticated can insert mechanism details'
  ) THEN
    CREATE POLICY "Authenticated can insert mechanism details"
      ON feasibility_mechanism_detail FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM goal_target_audit
          WHERE goal_target_audit.id = feasibility_mechanism_detail.audit_id
          AND goal_target_audit.user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- 5. Create indexes for audit queries (CCIP optimization)
CREATE INDEX IF NOT EXISTS idx_goal_target_audit_user_session 
  ON goal_target_audit(user_id, goal_session_id);

CREATE INDEX IF NOT EXISTS idx_confidence_calculation_audit_user_trade
  ON confidence_calculation_audit(user_id, trade_id);

CREATE INDEX IF NOT EXISTS idx_feasibility_mechanism_detail_audit
  ON feasibility_mechanism_detail(audit_id);

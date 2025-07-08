/*
  # Optimize Database Policies

  1. Consolidate Policies
    - Remove duplicate policies for the same role and action
    - Keep only one policy per role/action combination
  
  2. Performance Optimization
    - Replace auth.uid() with (select auth.uid()) for better performance
    - Apply to all tables with user-specific policies
  
  3. Clean Up
    - Drop all timestamp-suffixed policies
    - Create new optimized policies with consistent naming
*/

-- Step 1: Drop all existing policies with timestamp suffixes
DO $$ 
DECLARE
    policy_record RECORD;
BEGIN
    -- Find and drop all policies with timestamp suffixes
    FOR policy_record IN 
        SELECT policyname, tablename 
        FROM pg_policies 
        WHERE policyname LIKE 'pipnosis_%\_20%' ESCAPE '\'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 
                      policy_record.policyname, 
                      policy_record.tablename);
        RAISE NOTICE 'Dropped policy: % on table %', 
                    policy_record.policyname, 
                    policy_record.tablename;
    END LOOP;
END $$;

-- Step 2: Create optimized policies with better performance using (select auth.uid())

-- User Profiles policies
CREATE POLICY "pipnosis_user_profiles_select" 
  ON user_profiles
  FOR SELECT 
  TO authenticated
  USING ((select auth.uid()) = id);

CREATE POLICY "pipnosis_user_profiles_insert" 
  ON user_profiles
  FOR INSERT 
  TO authenticated
  WITH CHECK ((select auth.uid()) = id);

CREATE POLICY "pipnosis_user_profiles_update" 
  ON user_profiles
  FOR UPDATE 
  TO authenticated
  USING ((select auth.uid()) = id);

-- Trading Prompts policies
CREATE POLICY "pipnosis_trading_prompts_select" 
  ON trading_prompts
  FOR SELECT 
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "pipnosis_trading_prompts_insert" 
  ON trading_prompts
  FOR INSERT 
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "pipnosis_trading_prompts_update" 
  ON trading_prompts
  FOR UPDATE 
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- Trade Records policies
CREATE POLICY "pipnosis_trade_records_select" 
  ON trade_records
  FOR SELECT 
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "pipnosis_trade_records_insert" 
  ON trade_records
  FOR INSERT 
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "pipnosis_trade_records_update" 
  ON trade_records
  FOR UPDATE 
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- Journal Entries policies
CREATE POLICY "pipnosis_journal_entries_select" 
  ON journal_entries
  FOR SELECT 
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "pipnosis_journal_entries_insert" 
  ON journal_entries
  FOR INSERT 
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

-- Trading Sessions policies
CREATE POLICY "pipnosis_trading_sessions_select" 
  ON trading_sessions
  FOR SELECT 
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "pipnosis_trading_sessions_insert" 
  ON trading_sessions
  FOR INSERT 
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "pipnosis_trading_sessions_update" 
  ON trading_sessions
  FOR UPDATE 
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- Waitlist policies (ensure they exist)
CREATE POLICY IF NOT EXISTS "waitlist_anon_insert_policy" 
  ON waitlist
  FOR INSERT 
  TO anon
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "waitlist_authenticated_read_policy" 
  ON waitlist
  FOR SELECT 
  TO authenticated
  USING (true);

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✅ Database policies optimized successfully!';
  RAISE NOTICE '✅ Duplicate policies removed and auth.uid() optimized for better performance';
END $$;
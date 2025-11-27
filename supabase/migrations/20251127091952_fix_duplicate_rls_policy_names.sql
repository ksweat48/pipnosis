/*
  # Fix Duplicate RLS Policy Names
  
  **Problem**: Two tables have policies with identical names, causing conflicts.
  PostgreSQL requires unique policy names across the entire database.
  
  **Affected Tables**:
  - ai_recommendation_tracker (from 20251115120000 migration)
  - recommendations (from 20251126195050 migration)
  
  **Solution**: Drop conflicting policies and recreate with unique names
  that include the table identifier.
  
  **Changes**:
  1. Drop all conflicting policies from both tables
  2. Recreate policies with unique names:
     - ai_recommendation_tracker: "tracker_[action]"
     - recommendations: "recommendations_[action]"
  
  **Security**: All policies maintain the same security rules (user_id = auth.uid())
*/

-- ============================================================
-- STEP 1: Drop Conflicting Policies
-- ============================================================

-- Drop from ai_recommendation_tracker
DROP POLICY IF EXISTS "Users can view own recommendations" ON ai_recommendation_tracker;
DROP POLICY IF EXISTS "Users can insert own recommendations" ON ai_recommendation_tracker;
DROP POLICY IF EXISTS "Users can update own recommendations" ON ai_recommendation_tracker;
DROP POLICY IF EXISTS "Users can delete own recommendations" ON ai_recommendation_tracker;

-- Drop from recommendations
DROP POLICY IF EXISTS "Users can view own recommendations" ON recommendations;
DROP POLICY IF EXISTS "Users can insert own recommendations" ON recommendations;
DROP POLICY IF EXISTS "Users can update own recommendations" ON recommendations;
DROP POLICY IF EXISTS "Users can delete own recommendations" ON recommendations;

-- ============================================================
-- STEP 2: Recreate Policies for ai_recommendation_tracker
-- ============================================================

CREATE POLICY "tracker_users_can_view_own"
  ON ai_recommendation_tracker
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "tracker_users_can_insert_own"
  ON ai_recommendation_tracker
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "tracker_users_can_update_own"
  ON ai_recommendation_tracker
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "tracker_users_can_delete_own"
  ON ai_recommendation_tracker
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- STEP 3: Recreate Policies for recommendations
-- ============================================================

CREATE POLICY "recommendations_users_can_view_own"
  ON recommendations
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "recommendations_users_can_insert_own"
  ON recommendations
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "recommendations_users_can_update_own"
  ON recommendations
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "recommendations_users_can_delete_own"
  ON recommendations
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- Verification
-- ============================================================

-- Both tables should still have RLS enabled
-- Verify with: SELECT tablename, rowsecurity FROM pg_tables WHERE tablename IN ('ai_recommendation_tracker', 'recommendations');

-- All policies should now have unique names
-- Verify with: SELECT tablename, policyname FROM pg_policies WHERE tablename IN ('ai_recommendation_tracker', 'recommendations');

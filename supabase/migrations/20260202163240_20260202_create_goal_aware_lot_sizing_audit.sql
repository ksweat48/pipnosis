/*
  # Goal-Aware Lot Sizing Audit System

  1. New Tables
    - `goal_aware_lot_sizing_decisions`
      - Records every goal-aware lot sizing decision with full context
      - Tracks: required_lot (for goal), safe_lot (for risk), chosen_lot (executed)
      - Enables post-trade learning and governance compliance

  2. New RLS Policies
    - Users can only view/insert their own decisions
    - Service role can read for audits

  3. New Indexes
    - Fast lookup by session for post-trade analysis
    - Fast lookup by user for trend tracking

  4. Governance Integration
    - Immutable audit trail for CCIP compliance
    - Linked to goal_sessions for traceability
    - Tracks all three lot sizes for learning

  CRITICAL NOTES:
  - This is advisory data only (does not block execution)
  - Lot size logic owned by GoalAwareLotSizingCoordinator (single source of truth)
  - Database records decisions, does NOT make decisions
*/

CREATE TABLE IF NOT EXISTS goal_aware_lot_sizing_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_session_id uuid NOT NULL REFERENCES goal_sessions(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('long', 'short')),
  
  -- CONTEXT: What was the state when decision was made?
  account_balance numeric NOT NULL,
  goal_amount numeric NOT NULL,
  current_progress numeric NOT NULL,
  remaining_goal numeric NOT NULL,
  risk_percentage_allowed numeric NOT NULL, -- 5% from trade style, etc.
  
  -- ENTRY/EXIT GEOMETRY
  entry_price numeric NOT NULL,
  stop_loss_price numeric NOT NULL,
  take_profit_price numeric NOT NULL,
  
  -- THE THREE LOT SIZES (for learning and transparency)
  required_lot_for_goal numeric NOT NULL, -- What's needed to reach goal
  safe_lot_from_risk numeric NOT NULL, -- What risk constraints allow
  chosen_lot_size numeric NOT NULL, -- What was actually used
  
  -- DECISION LOGIC (which constraint won?)
  decision_reason text NOT NULL CHECK (decision_reason IN (
    'goal_achievable_within_risk',      -- Required lot <= safe lot
    'goal_requires_more_risk',           -- Required lot > safe lot, chose safe lot
    'market_cannot_deliver_goal',        -- Even max safe lot won't reach goal
    'fallback_risk_constraint',          -- Used only risk constraint (no goal)
    'degraded_to_safe_lot'               -- Chose safe lot over larger required
  )),
  
  -- EXPECTED OUTCOMES (for post-trade comparison)
  expected_profit_at_tp numeric,        -- What this lot size should make at TP
  expected_loss_at_sl numeric,          -- What this lot size should lose at SL
  expected_risk_dollars numeric,        -- Actual $ at risk with chosen lot
  
  -- GOVERNANCE TRACKING
  created_at timestamptz DEFAULT now() NOT NULL,
  trade_id uuid, -- Links to actual executed trade for post-trade learning
  
  CONSTRAINT valid_prices CHECK (
    (direction = 'long' AND stop_loss_price < entry_price AND take_profit_price > entry_price) OR
    (direction = 'short' AND stop_loss_price > entry_price AND take_profit_price < entry_price)
  ),
  
  CONSTRAINT lot_sizes_positive CHECK (
    required_lot_for_goal > 0 AND
    safe_lot_from_risk > 0 AND
    chosen_lot_size > 0
  )
);

-- RLS POLICIES
ALTER TABLE goal_aware_lot_sizing_decisions ENABLE ROW LEVEL SECURITY;

-- Users can see their own decisions
CREATE POLICY "Users can view own lot sizing decisions"
  ON goal_aware_lot_sizing_decisions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own decisions (via coordinator service)
CREATE POLICY "System can insert lot sizing decisions"
  ON goal_aware_lot_sizing_decisions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Service role can read all for audits
CREATE POLICY "Service role can audit lot sizing decisions"
  ON goal_aware_lot_sizing_decisions FOR SELECT
  TO service_role
  USING (true);

-- INDEXES FOR PERFORMANCE
CREATE INDEX idx_lot_sizing_session
  ON goal_aware_lot_sizing_decisions(goal_session_id);

CREATE INDEX idx_lot_sizing_user_date
  ON goal_aware_lot_sizing_decisions(user_id, created_at DESC);

CREATE INDEX idx_lot_sizing_trade_link
  ON goal_aware_lot_sizing_decisions(trade_id)
  WHERE trade_id IS NOT NULL;

-- Governance table linking lot sizing decisions to confidence audits
ALTER TABLE goal_sessions
  ADD COLUMN IF NOT EXISTS last_lot_sizing_decision_id uuid REFERENCES goal_aware_lot_sizing_decisions(id);

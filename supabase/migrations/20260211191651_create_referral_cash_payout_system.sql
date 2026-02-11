/*
  # Referral Cash Payout Request System - SSOT Governance Compliant

  ## Summary
  Creates infrastructure for manual cash payout requests from referral earnings.
  Users can request payouts once they reach $100 minimum balance.
  Admin approval workflow with full audit trail.

  ## New Tables
  1. `club_referral_cash_payouts`
     - Tracks all payout requests and their status
     - Links to user and referral earnings
     - Stores payment method details (for future automation)
     - Full audit trail with status transitions

  ## Security
  - Enable RLS on all tables
  - Users can only see their own payout requests
  - Admins can see and approve all requests
  - Service role can create system entries

  ## SSOT Compliance
  - Cash balance tracked in club_referral_stats (existing SSOT)
  - Payout requests reference but don't duplicate balance data
  - Status transitions tracked with governance audit trail
  
  ## CCIP Reference
  - Change Type: New Feature - Cash Payout Request System
  - Impact: Enables users to withdraw referral cash earnings
  - Risk Level: Low (read-only for users, admin approval required)
*/

-- Create cash payout requests table
CREATE TABLE IF NOT EXISTS club_referral_cash_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  
  -- Payout details
  requested_amount_usd NUMERIC(10,2) NOT NULL CHECK (requested_amount_usd >= 100),
  available_balance_at_request NUMERIC(10,2) NOT NULL,
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'rejected', 'cancelled')),
  
  -- Payment details
  payment_method TEXT DEFAULT 'manual', -- Future: 'stripe', 'paypal', etc.
  payment_details JSONB DEFAULT '{}'::jsonb,
  
  -- Admin approval
  reviewed_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  admin_notes TEXT,
  
  -- Payment confirmation
  paid_at TIMESTAMPTZ,
  payment_reference TEXT,
  
  -- Audit trail
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_club_referral_cash_payouts_user_id 
  ON club_referral_cash_payouts(user_id);

CREATE INDEX IF NOT EXISTS idx_club_referral_cash_payouts_status 
  ON club_referral_cash_payouts(status) 
  WHERE status IN ('pending', 'approved');

CREATE INDEX IF NOT EXISTS idx_club_referral_cash_payouts_requested_at 
  ON club_referral_cash_payouts(requested_at DESC);

-- Enable RLS
ALTER TABLE club_referral_cash_payouts ENABLE ROW LEVEL SECURITY;

-- Users can view their own payout requests
CREATE POLICY "Users can view own payout requests"
  ON club_referral_cash_payouts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can create their own payout requests
CREATE POLICY "Users can create own payout requests"
  ON club_referral_cash_payouts
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

-- Users can cancel their own pending requests
CREATE POLICY "Users can cancel own pending requests"
  ON club_referral_cash_payouts
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id AND status = 'pending')
  WITH CHECK (auth.uid() = user_id AND status = 'cancelled');

-- Admins can view all payout requests
CREATE POLICY "Admins can view all payout requests"
  ON club_referral_cash_payouts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Admins can update any payout request
CREATE POLICY "Admins can update payout requests"
  ON club_referral_cash_payouts
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Service role can perform all operations
CREATE POLICY "Service role full access to payouts"
  ON club_referral_cash_payouts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create RPC function to request cash payout
CREATE OR REPLACE FUNCTION request_referral_cash_payout(
  p_user_id UUID,
  p_requested_amount NUMERIC
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_available_balance NUMERIC;
  v_pending_payouts NUMERIC;
  v_withdrawable_balance NUMERIC;
  v_payout_id UUID;
BEGIN
  -- Get user's available cash balance from referral stats
  SELECT COALESCE(total_cash_earned_usd, 0)
  INTO v_available_balance
  FROM club_referral_stats
  WHERE user_id = p_user_id;

  -- Calculate total pending/approved payouts
  SELECT COALESCE(SUM(requested_amount_usd), 0)
  INTO v_pending_payouts
  FROM club_referral_cash_payouts
  WHERE user_id = p_user_id
    AND status IN ('pending', 'approved');

  -- Calculate withdrawable balance
  v_withdrawable_balance := v_available_balance - v_pending_payouts;

  -- Validate minimum amount
  IF p_requested_amount < 100 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Minimum payout amount is $100',
      'available_balance', v_available_balance,
      'pending_payouts', v_pending_payouts,
      'withdrawable_balance', v_withdrawable_balance
    );
  END IF;

  -- Validate sufficient balance
  IF p_requested_amount > v_withdrawable_balance THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient balance for requested payout',
      'available_balance', v_available_balance,
      'pending_payouts', v_pending_payouts,
      'withdrawable_balance', v_withdrawable_balance
    );
  END IF;

  -- Create payout request
  INSERT INTO club_referral_cash_payouts (
    user_id,
    requested_amount_usd,
    available_balance_at_request,
    status,
    requested_at
  ) VALUES (
    p_user_id,
    p_requested_amount,
    v_available_balance,
    'pending',
    now()
  )
  RETURNING id INTO v_payout_id;

  RETURN jsonb_build_object(
    'success', true,
    'payout_id', v_payout_id,
    'requested_amount', p_requested_amount,
    'available_balance', v_available_balance,
    'withdrawable_balance', v_withdrawable_balance - p_requested_amount
  );
END;
$$;

-- Create RPC function for admin to approve/reject payout
CREATE OR REPLACE FUNCTION admin_review_payout(
  p_payout_id UUID,
  p_admin_id UUID,
  p_action TEXT, -- 'approve' or 'reject'
  p_admin_notes TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status TEXT;
  v_new_status TEXT;
BEGIN
  -- Verify admin privileges
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = p_admin_id AND is_admin = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admin privileges required');
  END IF;

  -- Get current status
  SELECT status INTO v_current_status
  FROM club_referral_cash_payouts
  WHERE id = p_payout_id;

  IF v_current_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payout request not found');
  END IF;

  IF v_current_status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only pending requests can be reviewed');
  END IF;

  -- Determine new status
  v_new_status := CASE 
    WHEN p_action = 'approve' THEN 'approved'
    WHEN p_action = 'reject' THEN 'rejected'
    ELSE NULL
  END;

  IF v_new_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid action');
  END IF;

  -- Update payout request
  UPDATE club_referral_cash_payouts
  SET 
    status = v_new_status,
    reviewed_by = p_admin_id,
    reviewed_at = now(),
    admin_notes = p_admin_notes,
    updated_at = now()
  WHERE id = p_payout_id;

  RETURN jsonb_build_object(
    'success', true,
    'payout_id', p_payout_id,
    'new_status', v_new_status
  );
END;
$$;

-- Create RPC function to mark payout as paid
CREATE OR REPLACE FUNCTION admin_mark_payout_paid(
  p_payout_id UUID,
  p_admin_id UUID,
  p_payment_reference TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status TEXT;
BEGIN
  -- Verify admin privileges
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = p_admin_id AND is_admin = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admin privileges required');
  END IF;

  -- Get current status
  SELECT status INTO v_current_status
  FROM club_referral_cash_payouts
  WHERE id = p_payout_id;

  IF v_current_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payout request not found');
  END IF;

  IF v_current_status != 'approved' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only approved requests can be marked as paid');
  END IF;

  -- Update payout request
  UPDATE club_referral_cash_payouts
  SET 
    status = 'paid',
    paid_at = now(),
    payment_reference = p_payment_reference,
    updated_at = now()
  WHERE id = p_payout_id;

  RETURN jsonb_build_object(
    'success', true,
    'payout_id', p_payout_id,
    'paid_at', now()
  );
END;
$$;

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_club_referral_cash_payouts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_club_referral_cash_payouts_updated_at
  BEFORE UPDATE ON club_referral_cash_payouts
  FOR EACH ROW
  EXECUTE FUNCTION update_club_referral_cash_payouts_updated_at();

-- Add notification type for payout status changes
ALTER TABLE goal_notifications DROP CONSTRAINT IF EXISTS valid_notification_type;

ALTER TABLE goal_notifications ADD CONSTRAINT valid_notification_type
  CHECK (type IN (
    'goal_achieved', 'goal_progress', 'trade_opened', 'trade_entry', 'trade_closed',
    'trade_signal', 'stop_loss_hit', 'take_profit_hit', 'sl_triggered',
    'session_started', 'session_update', 'session_paused', 'session_ended',
    'session_auto_closed', 'session_timeout', 'scanning_timeout',
    'entry_abandoned', 'entry_monitoring_started', 'entry_quality_improving',
    'entry_quality_ready', 'mid_trade_alert', 'mid_trade_trigger',
    'mid_trade_evaluation', 'mid_trade_action', 'continuation',
    'continuation_required', 'signal', 'alert', 'completion', 'forecast',
    'general', 'wellness_check', 'progress', 'system_alert',
    'balance_update', 'referral_commission_earned', 'referral_payout_requested',
    'referral_payout_approved', 'referral_payout_rejected', 'referral_payout_paid'
  ));

COMMENT ON TABLE club_referral_cash_payouts IS 
  'SSOT for referral cash payout requests. Tracks manual withdrawal requests with admin approval workflow.';

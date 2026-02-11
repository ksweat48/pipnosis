/*
  # Ongoing Referral Commission System - Phase 1: Schema

  ## Problem
  Current system pays referrers ONCE on first purchase. If referred user upgrades later, referrer gets NOTHING.

  ## Solution  
  Permanent user-to-referrer relationship that pays commissions on ALL membership payments.

  ## Changes
  1. Add `referred_by_user_id` to `user_profiles`
  2. Backfill from existing `club_referrals`
  3. Add `commission_model` to `club_referrals`
  4. Extend `club_token_ledger` transaction types
  5. Add notification type
*/

-- Add permanent referrer tracking
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS referred_by_user_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_profiles_referred_by
ON user_profiles(referred_by_user_id)
WHERE referred_by_user_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'no_self_referral' AND conrelid = 'user_profiles'::regclass
  ) THEN
    ALTER TABLE user_profiles
    ADD CONSTRAINT no_self_referral CHECK (id != referred_by_user_id);
  END IF;
END $$;

COMMENT ON COLUMN user_profiles.referred_by_user_id IS
  'Permanent referrer relationship. SSOT for referral commissions.';

-- Backfill from existing completed referrals
UPDATE user_profiles up
SET referred_by_user_id = cr.referrer_id
FROM (
  SELECT DISTINCT ON (referee_id)
    referee_id,
    referrer_id
  FROM club_referrals
  WHERE status = 'completed'
    AND referee_id IS NOT NULL
    AND referrer_id IS NOT NULL
  ORDER BY referee_id, completed_at DESC
) cr
WHERE cr.referee_id = up.id
  AND up.referred_by_user_id IS NULL;

-- Add commission model tracking
ALTER TABLE club_referrals
ADD COLUMN IF NOT EXISTS commission_model TEXT DEFAULT 'one_time';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'valid_commission_model' AND conrelid = 'club_referrals'::regclass
  ) THEN
    ALTER TABLE club_referrals
    ADD CONSTRAINT valid_commission_model CHECK (commission_model IN ('one_time', 'ongoing'));
  END IF;
END $$;

UPDATE club_referrals
SET commission_model = 'one_time'
WHERE commission_model IS NULL;

-- Extend token ledger transaction types
ALTER TABLE club_token_ledger DROP CONSTRAINT IF EXISTS valid_transaction_type;
ALTER TABLE club_token_ledger DROP CONSTRAINT IF EXISTS club_token_ledger_transaction_type_check;

ALTER TABLE club_token_ledger ADD CONSTRAINT valid_transaction_type
  CHECK (transaction_type IN (
    'membership_purchase', 'membership_lock', 'membership_upgrade_unlock',
    'membership_upgrade_grant', 'membership_upgrade_lock', 'referral_reward',
    'referral_commission_initial', 'referral_commission_upgrade',
    'staking_reward', 'admin_grant', 'admin_deduct', 'cashout_deduction',
    'promotion_bonus', 'migration_adjustment', 'discount_burn',
    'staking_lock', 'staking_unlock', 'stake', 'unstake', 'reward_claim'
  ));

-- Add notification type
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
    'balance_update', 'referral_commission_earned'
  ));
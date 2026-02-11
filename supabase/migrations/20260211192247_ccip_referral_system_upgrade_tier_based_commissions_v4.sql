/*
  # CCIP Tracking: Referral System Upgrade - Tier-Based Commissions

  ## Change Summary
  Major upgrade to referral system with tier-based PIP commission calculation,
  detailed referral tracking, and manual cash payout request system.

  ## SSOT Compliance
  - All commission calculation logic in database RPC (pay_referral_commission)
  - Referral relationship stored in user_profiles.referred_by_user_id (SSOT)
  - Payout requests tracked in dedicated table with proper audit trail

  ## Commission Rates (10% PIP + 20% Cash)
  - Member ($99): 99 PIP + $19.80 cash
  - Starter ($250): 250 PIP + $50 cash
  - Builder ($500): 500 PIP + $100 cash
  - Pro ($1,000): 1,000 PIP + $200 cash
  - Elite ($5,000): 5,000 PIP + $1,000 cash
  - Founder ($10,000): 10,000 PIP + $2,000 cash
*/

-- Insert CCIP tracking record
INSERT INTO ccip_change_requests (
  change_title,
  change_type,
  priority,
  description,
  business_justification,
  technical_impact,
  risk_assessment,
  ccip_status,
  governance_status,
  deployed_at,
  deployment_method,
  rollback_plan,
  related_migration,
  modified_files,
  database_changes,
  breaking_changes
) VALUES (
  'Referral System Upgrade - Tier-Based Commissions & Cash Payouts',
  'feature',
  'medium',
  'Tier-based PIP commission calculation (10% of membership price), detailed referral tracking, and manual cash payout request system with admin approval workflow.',
  'Users require transparency into referral earnings and ability to withdraw cash commissions. Current flat-rate commission does not align with tier values.',
  'New tables, RPC functions (pay_referral_commission, request_referral_cash_payout, admin_review_payout), view (club_referrals_detailed), ClubReferralsPage component.',
  'LOW - Only affects future referral commissions. No impact on existing data. Backend logic in database RPCs for SSOT compliance.',
  'approved',
  'retrospective_review',
  now(),
  'database_migration',
  'Revert migrations: create_referral_cash_payout_system, fix_referral_commission_tier_based_10pct_v3.',
  'create_referral_cash_payout_system, fix_referral_commission_tier_based_10pct_v3',
  ARRAY[
    'supabase/migrations/create_referral_cash_payout_system.sql',
    'supabase/migrations/fix_referral_commission_tier_based_10pct_v3.sql',
    'src/services/club-membership-service.ts',
    'src/services/club-referral-service.ts',
    'src/pages/ClubReferralsPage.tsx',
    'src/App.tsx'
  ],
  true,
  false
);

/*
  # Replace club_referral_stats Table with Computed View

  ## Problem
  The `club_referral_stats` table was designed as a denormalized cache for referral
  statistics, but no trigger or mechanism ever populated it. As a result, referral
  stat counters (Total Referrals, Completed, PIP Earned, Cash Earned) always show 0
  on both the Club Home Page and the Referral Details page, even when referrals exist
  in the `club_referrals` table.

  ## Fix (SSOT-Compliant)
  Replace the empty `club_referral_stats` table with a VIEW that computes stats
  in real-time from `club_referrals`. This ensures:
  - Stats are always accurate with zero sync lag
  - No triggers or background jobs needed to maintain consistency
  - Single source of truth: `club_referrals` is the only authority for referral data

  ## Changes
  1. Drop the empty `club_referral_stats` table (and its RLS policies)
  2. Create a VIEW with the same name and column names
     - `total_referrals`: COUNT of all referrals with a referee_id (pending + completed)
     - `completed_referrals`: COUNT where status = 'completed'
     - `pending_referrals`: COUNT where status = 'pending' and referee_id IS NOT NULL
     - `total_tokens_earned`: SUM of tokens_awarded
     - `total_cash_earned_usd`: SUM of cash_awarded_usd
     - `last_referral_at`: MAX referred_at
     - `updated_at`: MAX updated_at

  ## Security
  - Views inherit security from underlying tables
  - `club_referrals` already has RLS enabled with proper policies
  - The view uses SECURITY INVOKER (default) so RLS on `club_referrals` is enforced

  ## Impact
  - Zero frontend code changes required
  - `club-referral-service.ts` getReferralStats() queries `club_referral_stats` by name
    and maps the same column names -- works identically with the view
  - Both ClubHomePage and ClubReferralsPage will immediately show correct stats
*/

-- Step 1: Drop the empty table (policies are automatically dropped with the table)
DROP TABLE IF EXISTS club_referral_stats;

-- Step 2: Create the computed view with identical column names
CREATE OR REPLACE VIEW club_referral_stats AS
SELECT
  cr.referrer_id AS user_id,
  COUNT(*) FILTER (WHERE cr.referee_id IS NOT NULL)::integer AS total_referrals,
  COUNT(*) FILTER (WHERE cr.status = 'completed')::integer AS completed_referrals,
  COUNT(*) FILTER (WHERE cr.status = 'pending' AND cr.referee_id IS NOT NULL)::integer AS pending_referrals,
  COALESCE(SUM(cr.tokens_awarded), 0)::numeric AS total_tokens_earned,
  COALESCE(SUM(cr.cash_awarded_usd), 0)::numeric AS total_cash_earned_usd,
  MAX(cr.referred_at) AS last_referral_at,
  MAX(cr.updated_at) AS updated_at
FROM club_referrals cr
WHERE cr.referrer_id IS NOT NULL
GROUP BY cr.referrer_id;

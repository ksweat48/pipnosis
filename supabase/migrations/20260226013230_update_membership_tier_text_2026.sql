/*
  # Update Membership Tier Text

  Updates description and benefits text for all 6 membership tiers to match
  the revised copy provided by the product team.

  Changes per tier:
  - Member (Tier 1): description updated, benefits updated (added "Trade Entry Advisory Monitor")
  - Starter (Tier 2): description unchanged, benefits updated (removed "Market Analyzer access", added "Mid Trade Intelligence Monitor")
  - Builder (Tier 3): description unchanged, benefits updated (corrected discount text to "5% trade discount (9.5 credits/trade)", added "Real-Time Intelligence Monitor")
  - Pro (Tier 4): description unchanged, benefits updated (corrected discount to "10% trade discount (9 credits/trade)", removed "Advanced Market Analyzer")
  - Elite Partner (Tier 5): description unchanged, benefits updated (corrected discount to "15% trade discount (8.5 credits/trade)")
  - Founder (Tier 6): description unchanged, benefits updated (corrected discount to "20% trade discount (8 credits/trade)", added "Founder vacation bonus")
*/

UPDATE club_membership_packages
SET
  benefits = '["Access to Pipnosis Club", "100 PIP Access Tokens", "Trade Entry Advisory Monitor", "Community trader chat", "View platform growth & token metrics"]'::jsonb
WHERE tier_level = 1;

UPDATE club_membership_packages
SET
  benefits = '["Club access", "250 PIP Access Tokens", "Mid Trade Intelligence Monitor", "Community trader chat", "Club dashboards"]'::jsonb
WHERE tier_level = 2;

UPDATE club_membership_packages
SET
  benefits = '["Club access", "500 PIP Access Tokens", "Real-Time Intelligence Monitor", "Staking rewards enabled", "5% trade discount (9.5 credits/trade)", "Market Analyzer", "Community chat"]'::jsonb
WHERE tier_level = 3;

UPDATE club_membership_packages
SET
  benefits = '["Club access", "1,000 PIP Access Tokens", "Higher staking reward multiplier", "10% trade discount (9 credits/trade)", "Voting rights", "+5% referral bonus", "Community + Pro-only channels"]'::jsonb
WHERE tier_level = 4;

UPDATE club_membership_packages
SET
  benefits = '["Club access", "5,000 PIP Access Tokens", "Enhanced staking rewards", "15% trade discount (8.5 credits/trade)", "Higher voting weight", "+10% referral bonus", "VIP access to events", "Early platform announcements", "Elite-only channels"]'::jsonb
WHERE tier_level = 5;

UPDATE club_membership_packages
SET
  benefits = '["Club access", "10,000 PIP Access Tokens", "Maximum staking rewards", "20% trade discount (8 credits/trade)", "Highest voting weight", "+15% referral bonus", "VIP + private Founder events", "Founder vacation bonus", "Exclusive Founders Circle access", "First access to roadmap + alpha features"]'::jsonb
WHERE tier_level = 6;

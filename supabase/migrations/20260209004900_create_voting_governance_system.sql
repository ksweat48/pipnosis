/*
  # Create Voting & Governance System

  1. New Tables
    - `club_proposals` - Governance proposals created by eligible members
      - `id` (uuid, primary key)
      - `author_id` (uuid) - User who created the proposal
      - `title` (text) - Proposal title
      - `description` (text) - Full proposal description
      - `category` (text) - feature_request/policy_change/community/platform
      - `status` (text) - draft/active/passed/rejected/expired
      - `voting_starts_at` (timestamptz) - When voting opens
      - `voting_ends_at` (timestamptz) - When voting closes
      - `votes_for` (numeric) - Weighted votes in favor
      - `votes_against` (numeric) - Weighted votes against
      - `total_voters` (integer) - Number of unique voters
      - `quorum_threshold` (numeric) - Minimum weighted votes needed
      - `pass_threshold_pct` (integer) - Percentage of for-votes needed to pass

    - `club_votes` - Individual vote records
      - `id` (uuid, primary key)
      - `proposal_id` (uuid) - Which proposal
      - `user_id` (uuid) - Who voted
      - `vote` (text) - for/against/abstain
      - `weight` (numeric) - Voting weight from tier
      - `tier_level` (integer) - Voter's tier at time of vote

  2. New Functions
    - `cast_club_vote(p_user_id, p_proposal_id, p_vote)` - Atomically cast a vote with tier-based weighting
    - `finalize_club_proposal(p_proposal_id)` - Close voting and determine outcome

  3. Security
    - RLS on all tables
    - Users can view all proposals and their own votes
    - Only Pro+ members (tier >= 4) can create proposals and vote
    - Votes are immutable once cast
*/

-- Proposals table
CREATE TABLE IF NOT EXISTS club_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'feature_request' CHECK (category IN ('feature_request', 'policy_change', 'community', 'platform')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'passed', 'rejected', 'expired')),
  voting_starts_at TIMESTAMPTZ,
  voting_ends_at TIMESTAMPTZ,
  votes_for NUMERIC(12,2) NOT NULL DEFAULT 0,
  votes_against NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_voters INTEGER NOT NULL DEFAULT 0,
  quorum_threshold NUMERIC(12,2) NOT NULL DEFAULT 10,
  pass_threshold_pct INTEGER NOT NULL DEFAULT 60,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE club_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view active proposals"
  ON club_proposals FOR SELECT
  TO authenticated
  USING (status IN ('active', 'passed', 'rejected', 'expired'));

CREATE POLICY "Authors can view own drafts"
  ON club_proposals FOR SELECT
  TO authenticated
  USING (author_id = auth.uid() AND status = 'draft');

CREATE POLICY "Eligible members can create proposals"
  ON club_proposals FOR INSERT
  TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM club_memberships cm
      JOIN club_membership_packages cmp ON cmp.id = cm.package_id
      WHERE cm.user_id = auth.uid()
        AND cm.status = 'active'
        AND cmp.voting_enabled = true
    )
  );

CREATE POLICY "Authors can update own drafts"
  ON club_proposals FOR UPDATE
  TO authenticated
  USING (author_id = auth.uid() AND status = 'draft')
  WITH CHECK (author_id = auth.uid());

CREATE POLICY "Service role full access to proposals"
  ON club_proposals FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Votes table
CREATE TABLE IF NOT EXISTS club_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES club_proposals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  vote TEXT NOT NULL CHECK (vote IN ('for', 'against', 'abstain')),
  weight NUMERIC(5,2) NOT NULL DEFAULT 1.0,
  tier_level INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(proposal_id, user_id)
);

ALTER TABLE club_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own votes"
  ON club_votes FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can view all votes"
  ON club_votes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Service role full access to votes"
  ON club_votes FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Cast vote RPC
CREATE OR REPLACE FUNCTION cast_club_vote(
  p_user_id UUID,
  p_proposal_id UUID,
  p_vote TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_proposal RECORD;
  v_membership RECORD;
  v_existing RECORD;
  v_weight NUMERIC(5,2);
  v_tier_level INTEGER;
BEGIN
  -- Validate vote value
  IF p_vote NOT IN ('for', 'against', 'abstain') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid vote value');
  END IF;

  -- Check proposal exists and is active
  SELECT * INTO v_proposal
  FROM club_proposals
  WHERE id = p_proposal_id AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Proposal not found or not active');
  END IF;

  -- Check voting window
  IF NOW() < v_proposal.voting_starts_at OR NOW() > v_proposal.voting_ends_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'Voting window is closed');
  END IF;

  -- Check user has voting-eligible membership
  SELECT cm.tier_level, cmp.voting_weight
  INTO v_tier_level, v_weight
  FROM club_memberships cm
  JOIN club_membership_packages cmp ON cmp.id = cm.package_id
  WHERE cm.user_id = p_user_id
    AND cm.status = 'active'
    AND cmp.voting_enabled = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Voting requires Pro tier or above');
  END IF;

  -- Check not already voted
  SELECT * INTO v_existing
  FROM club_votes
  WHERE proposal_id = p_proposal_id AND user_id = p_user_id;

  IF FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already voted on this proposal');
  END IF;

  -- Cast vote
  INSERT INTO club_votes (proposal_id, user_id, vote, weight, tier_level)
  VALUES (p_proposal_id, p_user_id, p_vote, v_weight, v_tier_level);

  -- Update proposal tallies
  IF p_vote = 'for' THEN
    UPDATE club_proposals
    SET votes_for = votes_for + v_weight,
        total_voters = total_voters + 1,
        updated_at = NOW()
    WHERE id = p_proposal_id;
  ELSIF p_vote = 'against' THEN
    UPDATE club_proposals
    SET votes_against = votes_against + v_weight,
        total_voters = total_voters + 1,
        updated_at = NOW()
    WHERE id = p_proposal_id;
  ELSE
    UPDATE club_proposals
    SET total_voters = total_voters + 1,
        updated_at = NOW()
    WHERE id = p_proposal_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'vote', p_vote,
    'weight', v_weight,
    'tier_level', v_tier_level
  );
END;
$$;

-- Finalize proposal RPC (called by admin or scheduled job)
CREATE OR REPLACE FUNCTION finalize_club_proposal(p_proposal_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_proposal RECORD;
  v_total_votes NUMERIC(12,2);
  v_for_pct NUMERIC(5,2);
  v_new_status TEXT;
BEGIN
  SELECT * INTO v_proposal
  FROM club_proposals
  WHERE id = p_proposal_id AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Proposal not found or not active');
  END IF;

  v_total_votes := v_proposal.votes_for + v_proposal.votes_against;

  -- Check quorum
  IF v_total_votes < v_proposal.quorum_threshold THEN
    v_new_status := 'expired';
  ELSE
    v_for_pct := CASE WHEN v_total_votes > 0
      THEN (v_proposal.votes_for / v_total_votes) * 100
      ELSE 0
    END;

    IF v_for_pct >= v_proposal.pass_threshold_pct THEN
      v_new_status := 'passed';
    ELSE
      v_new_status := 'rejected';
    END IF;
  END IF;

  UPDATE club_proposals
  SET status = v_new_status, updated_at = NOW()
  WHERE id = p_proposal_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', v_new_status,
    'votes_for', v_proposal.votes_for,
    'votes_against', v_proposal.votes_against,
    'total_voters', v_proposal.total_voters,
    'for_percentage', ROUND(CASE WHEN v_total_votes > 0
      THEN (v_proposal.votes_for / v_total_votes) * 100 ELSE 0 END, 1)
  );
END;
$$;

-- Index for fast proposal lookups
CREATE INDEX IF NOT EXISTS idx_club_proposals_status ON club_proposals(status);
CREATE INDEX IF NOT EXISTS idx_club_proposals_author ON club_proposals(author_id);
CREATE INDEX IF NOT EXISTS idx_club_votes_proposal ON club_votes(proposal_id);
CREATE INDEX IF NOT EXISTS idx_club_votes_user ON club_votes(user_id);

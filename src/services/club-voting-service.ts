import { supabase } from '@/lib/supabase';

export interface Proposal {
  id: string;
  authorId: string;
  title: string;
  description: string;
  category: 'feature_request' | 'policy_change' | 'community' | 'platform';
  status: 'draft' | 'active' | 'passed' | 'rejected' | 'expired';
  votingStartsAt: string | null;
  votingEndsAt: string | null;
  votesFor: number;
  votesAgainst: number;
  totalVoters: number;
  quorumThreshold: number;
  passThresholdPct: number;
  createdAt: string;
}

export interface UserVote {
  id: string;
  proposalId: string;
  vote: 'for' | 'against' | 'abstain';
  weight: number;
  tierLevel: number;
  createdAt: string;
}

export type VoteValue = 'for' | 'against' | 'abstain';

const CATEGORY_LABELS: Record<string, string> = {
  feature_request: 'Feature Request',
  policy_change: 'Policy Change',
  community: 'Community',
  platform: 'Platform',
};

class ClubVotingService {
  async getActiveProposals(): Promise<Proposal[]> {
    const { data, error } = await supabase
      .from('club_proposals')
      .select('*')
      .eq('status', 'active')
      .order('voting_ends_at', { ascending: true });

    if (error) {
      console.error('[ClubVoting] Error fetching proposals:', error);
      return [];
    }

    return (data || []).map(this.mapProposal);
  }

  async getAllProposals(): Promise<Proposal[]> {
    const { data, error } = await supabase
      .from('club_proposals')
      .select('*')
      .in('status', ['active', 'passed', 'rejected', 'expired'])
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[ClubVoting] Error fetching proposals:', error);
      return [];
    }

    return (data || []).map(this.mapProposal);
  }

  async getProposalById(proposalId: string): Promise<Proposal | null> {
    const { data, error } = await supabase
      .from('club_proposals')
      .select('*')
      .eq('id', proposalId)
      .maybeSingle();

    if (error || !data) return null;
    return this.mapProposal(data);
  }

  async getUserVotes(userId: string): Promise<UserVote[]> {
    const { data, error } = await supabase
      .from('club_votes')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[ClubVoting] Error fetching votes:', error);
      return [];
    }

    return (data || []).map((v: any) => ({
      id: v.id,
      proposalId: v.proposal_id,
      vote: v.vote,
      weight: parseFloat(v.weight),
      tierLevel: v.tier_level,
      createdAt: v.created_at,
    }));
  }

  async getUserVoteForProposal(userId: string, proposalId: string): Promise<UserVote | null> {
    const { data, error } = await supabase
      .from('club_votes')
      .select('*')
      .eq('user_id', userId)
      .eq('proposal_id', proposalId)
      .maybeSingle();

    if (error || !data) return null;

    return {
      id: data.id,
      proposalId: data.proposal_id,
      vote: data.vote,
      weight: parseFloat(data.weight),
      tierLevel: data.tier_level,
      createdAt: data.created_at,
    };
  }

  async castVote(userId: string, proposalId: string, vote: VoteValue): Promise<{ success: boolean; error?: string }> {
    const { data, error } = await supabase.rpc('cast_club_vote', {
      p_user_id: userId,
      p_proposal_id: proposalId,
      p_vote: vote,
    });

    if (error) {
      console.error('[ClubVoting] Error casting vote:', error);
      return { success: false, error: error.message };
    }

    const result = data as any;
    return { success: result?.success || false, error: result?.error };
  }

  async createProposal(
    userId: string,
    title: string,
    description: string,
    category: string,
    votingDurationDays: number = 7
  ): Promise<{ success: boolean; proposalId?: string; error?: string }> {
    const votingStartsAt = new Date();
    const votingEndsAt = new Date(votingStartsAt.getTime() + votingDurationDays * 24 * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from('club_proposals')
      .insert({
        author_id: userId,
        title,
        description,
        category,
        status: 'active',
        voting_starts_at: votingStartsAt.toISOString(),
        voting_ends_at: votingEndsAt.toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      console.error('[ClubVoting] Error creating proposal:', error);
      return { success: false, error: error.message };
    }

    return { success: true, proposalId: data.id };
  }

  formatCategory(category: string): string {
    return CATEGORY_LABELS[category] || category;
  }

  getForPercentage(proposal: Proposal): number {
    const total = proposal.votesFor + proposal.votesAgainst;
    if (total === 0) return 0;
    return Math.round((proposal.votesFor / total) * 100);
  }

  isVotingOpen(proposal: Proposal): boolean {
    if (proposal.status !== 'active') return false;
    const now = new Date();
    const start = proposal.votingStartsAt ? new Date(proposal.votingStartsAt) : null;
    const end = proposal.votingEndsAt ? new Date(proposal.votingEndsAt) : null;
    if (start && now < start) return false;
    if (end && now > end) return false;
    return true;
  }

  getTimeRemaining(proposal: Proposal): string {
    if (!proposal.votingEndsAt) return '';
    const end = new Date(proposal.votingEndsAt).getTime();
    const now = Date.now();
    const diff = end - now;
    if (diff <= 0) return 'Ended';
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days > 0) return `${days}d ${hours}h left`;
    return `${hours}h left`;
  }

  private mapProposal(data: any): Proposal {
    return {
      id: data.id,
      authorId: data.author_id,
      title: data.title,
      description: data.description,
      category: data.category,
      status: data.status,
      votingStartsAt: data.voting_starts_at,
      votingEndsAt: data.voting_ends_at,
      votesFor: parseFloat(data.votes_for || '0'),
      votesAgainst: parseFloat(data.votes_against || '0'),
      totalVoters: data.total_voters || 0,
      quorumThreshold: parseFloat(data.quorum_threshold || '10'),
      passThresholdPct: data.pass_threshold_pct || 60,
      createdAt: data.created_at,
    };
  }
}

export const clubVotingService = new ClubVotingService();

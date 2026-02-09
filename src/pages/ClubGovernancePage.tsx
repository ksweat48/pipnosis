import React, { useEffect, useState } from 'react';
import { Vote, Plus, Clock, CheckCircle, XCircle, AlertCircle, ChevronDown, ChevronUp, Users, ThumbsUp, ThumbsDown, Minus } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { ClubLayout } from '@/components/ClubLayout';
import { clubVotingService, type Proposal, type UserVote, type VoteValue } from '@/services/club-voting-service';
import { clubMembershipService } from '@/services/club-membership-service';

const CATEGORIES = [
  { value: 'feature_request', label: 'Feature Request' },
  { value: 'policy_change', label: 'Policy Change' },
  { value: 'community', label: 'Community' },
  { value: 'platform', label: 'Platform' },
];

export function ClubGovernancePage() {
  const { user } = useAuth();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [userVotes, setUserVotes] = useState<Map<string, UserVote>>(new Map());
  const [canVote, setCanVote] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [votingId, setVotingId] = useState<string | null>(null);

  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newCategory, setNewCategory] = useState('feature_request');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user]);

  const loadData = async () => {
    if (!user) return;
    setLoading(true);

    try {
      const [proposalList, votes, membership] = await Promise.all([
        clubVotingService.getAllProposals(),
        clubVotingService.getUserVotes(user.id),
        clubMembershipService.getUserMembership(user.id),
      ]);

      setProposals(proposalList);

      const voteMap = new Map<string, UserVote>();
      votes.forEach(v => voteMap.set(v.proposalId, v));
      setUserVotes(voteMap);

      setCanVote(!!membership && membership.tierLevel >= 4);
    } catch (error) {
      console.error('[Governance] Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleVote = async (proposalId: string, vote: VoteValue) => {
    if (!user) return;
    setVotingId(proposalId);

    const result = await clubVotingService.castVote(user.id, proposalId, vote);
    if (!result.success) {
      alert(result.error || 'Failed to cast vote');
    }

    await loadData();
    setVotingId(null);
  };

  const handleCreateProposal = async () => {
    if (!user || !newTitle.trim() || !newDescription.trim()) return;
    setCreating(true);

    const result = await clubVotingService.createProposal(
      user.id, newTitle.trim(), newDescription.trim(), newCategory
    );

    if (result.success) {
      setNewTitle('');
      setNewDescription('');
      setNewCategory('feature_request');
      setShowCreate(false);
      await loadData();
    } else {
      alert(result.error || 'Failed to create proposal');
    }

    setCreating(false);
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'active': return <Clock size={16} className="text-blue-500" />;
      case 'passed': return <CheckCircle size={16} className="text-emerald-500" />;
      case 'rejected': return <XCircle size={16} className="text-red-500" />;
      case 'expired': return <AlertCircle size={16} className="text-slate-400" />;
      default: return null;
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'passed': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'rejected': return 'bg-red-50 text-red-700 border-red-200';
      case 'expired': return 'bg-slate-50 text-slate-500 border-slate-200';
      default: return 'bg-slate-50 text-slate-500 border-slate-200';
    }
  };

  if (!user) return null;

  return (
    <ClubLayout>
      <div className="space-y-4 sm:space-y-6 pb-8">
        {/* Header */}
        <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl sm:rounded-2xl p-4 sm:p-8 shadow-lg">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-3xl font-bold text-slate-900 mb-1 flex items-center gap-3">
                <Vote size={28} className="text-slate-700" />
                Governance
              </h1>
              <p className="text-slate-600 text-sm sm:text-base">
                Vote on proposals that shape the future of Pipnosis
              </p>
            </div>

            {canVote && (
              <button
                onClick={() => setShowCreate(!showCreate)}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl transition-all shadow-md text-sm"
              >
                <Plus size={16} />
                <span className="hidden sm:inline">New Proposal</span>
              </button>
            )}
          </div>

          {!canVote && (
            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm">
              Voting requires Pro tier (Level 4) or above. Upgrade your membership to participate.
            </div>
          )}
        </div>

        {/* Create Proposal Form */}
        {showCreate && canVote && (
          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl sm:rounded-2xl p-4 sm:p-6 shadow-lg">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Create Proposal</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-slate-600 text-sm mb-1">Title</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Short, descriptive title"
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
                  maxLength={120}
                />
              </div>

              <div>
                <label className="block text-slate-600 text-sm mb-1">Category</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
                >
                  {CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-600 text-sm mb-1">Description</label>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Explain your proposal in detail..."
                  rows={5}
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 resize-none"
                  maxLength={2000}
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleCreateProposal}
                  disabled={creating || !newTitle.trim() || !newDescription.trim()}
                  className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white font-semibold rounded-xl transition-all text-sm"
                >
                  {creating ? 'Submitting...' : 'Submit Proposal'}
                </button>
                <button
                  onClick={() => setShowCreate(false)}
                  className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-all text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Proposals List */}
        {loading ? (
          <div className="text-center py-12 text-slate-500">Loading proposals...</div>
        ) : proposals.length === 0 ? (
          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl p-12 shadow-lg text-center">
            <Vote size={48} className="text-slate-300 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-slate-900 mb-2">No Proposals Yet</h3>
            <p className="text-slate-500 text-sm">
              {canVote
                ? 'Be the first to create a governance proposal.'
                : 'Proposals from Pro+ members will appear here.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {proposals.map((proposal) => {
              const isExpanded = expandedId === proposal.id;
              const userVote = userVotes.get(proposal.id);
              const forPct = clubVotingService.getForPercentage(proposal);
              const isOpen = clubVotingService.isVotingOpen(proposal);
              const timeLeft = clubVotingService.getTimeRemaining(proposal);

              return (
                <div
                  key={proposal.id}
                  className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl shadow-md overflow-hidden"
                >
                  {/* Proposal Header */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : proposal.id)}
                    className="w-full p-4 sm:p-5 text-left flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ${statusColor(proposal.status)}`}>
                          {statusIcon(proposal.status)}
                          {proposal.status.charAt(0).toUpperCase() + proposal.status.slice(1)}
                        </span>
                        <span className="text-slate-400 text-xs">
                          {clubVotingService.formatCategory(proposal.category)}
                        </span>
                        {isOpen && timeLeft && (
                          <span className="text-blue-500 text-xs font-medium">{timeLeft}</span>
                        )}
                      </div>
                      <h3 className="text-base sm:text-lg font-bold text-slate-900 truncate">
                        {proposal.title}
                      </h3>
                      <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Users size={12} />
                          {proposal.totalVoters} voter{proposal.totalVoters !== 1 ? 's' : ''}
                        </span>
                        <span className="text-emerald-600 font-medium">{forPct}% for</span>
                      </div>
                    </div>
                    {isExpanded ? <ChevronUp size={20} className="text-slate-400 flex-shrink-0 mt-1" /> : <ChevronDown size={20} className="text-slate-400 flex-shrink-0 mt-1" />}
                  </button>

                  {/* Expanded Content */}
                  {isExpanded && (
                    <div className="px-4 sm:px-5 pb-4 sm:pb-5 border-t border-slate-100 pt-4">
                      <p className="text-slate-700 text-sm mb-4 whitespace-pre-wrap">{proposal.description}</p>

                      {/* Vote Progress Bar */}
                      <div className="mb-4">
                        <div className="flex justify-between text-xs text-slate-500 mb-1">
                          <span>For: {proposal.votesFor.toFixed(1)}</span>
                          <span>Against: {proposal.votesAgainst.toFixed(1)}</span>
                        </div>
                        <div className="h-3 bg-slate-100 rounded-full overflow-hidden flex">
                          {proposal.votesFor > 0 && (
                            <div
                              className="bg-emerald-500 h-full transition-all"
                              style={{ width: `${forPct}%` }}
                            />
                          )}
                          {proposal.votesAgainst > 0 && (
                            <div
                              className="bg-red-400 h-full transition-all"
                              style={{ width: `${100 - forPct}%` }}
                            />
                          )}
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          Quorum: {(proposal.votesFor + proposal.votesAgainst).toFixed(1)} / {proposal.quorumThreshold.toFixed(1)} | Pass: {proposal.passThresholdPct}% needed
                        </div>
                      </div>

                      {/* Voting Buttons */}
                      {isOpen && canVote && !userVote && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleVote(proposal.id, 'for')}
                            disabled={votingId === proposal.id}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-semibold rounded-xl transition-all text-sm"
                          >
                            <ThumbsUp size={16} /> For
                          </button>
                          <button
                            onClick={() => handleVote(proposal.id, 'against')}
                            disabled={votingId === proposal.id}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-500 hover:bg-red-600 disabled:bg-slate-300 text-white font-semibold rounded-xl transition-all text-sm"
                          >
                            <ThumbsDown size={16} /> Against
                          </button>
                          <button
                            onClick={() => handleVote(proposal.id, 'abstain')}
                            disabled={votingId === proposal.id}
                            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-200 hover:bg-slate-300 disabled:bg-slate-100 text-slate-700 font-semibold rounded-xl transition-all text-sm"
                          >
                            <Minus size={16} />
                          </button>
                        </div>
                      )}

                      {/* Already Voted */}
                      {userVote && (
                        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-600">
                          You voted <span className="font-bold">{userVote.vote}</span> with weight {userVote.weight.toFixed(1)}x
                        </div>
                      )}

                      {/* Not eligible */}
                      {isOpen && !canVote && (
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
                          Pro tier or above required to vote
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ClubLayout>
  );
}

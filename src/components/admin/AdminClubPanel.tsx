import { useEffect, useState } from 'react';
import { Crown, Users, Coins, TrendingUp, RefreshCw, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface MemberSummary {
  id: string;
  userId: string;
  email: string;
  tierLevel: number;
  tierName: string;
  status: string;
  availableTokens: number;
  lockedTokens: number;
  stakedTokens: number;
  purchasedAt: string;
}

interface ClubStats {
  totalMembers: number;
  activeMembers: number;
  totalTokensCirculating: number;
  totalTokensLocked: number;
  totalTokensStaked: number;
  totalRevenue: number;
  tierBreakdown: Record<string, number>;
}

const TIER_NAMES: Record<number, string> = {
  1: 'Member', 2: 'Starter', 3: 'Builder', 4: 'Pro', 5: 'Elite', 6: 'Founder',
};

const TIER_COLORS: Record<number, string> = {
  1: 'bg-slate-500', 2: 'bg-sky-500', 3: 'bg-emerald-500', 4: 'bg-amber-500', 5: 'bg-red-500', 6: 'bg-fuchsia-500',
};

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function AdminClubPanel() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<ClubStats>({
    totalMembers: 0, activeMembers: 0, totalTokensCirculating: 0,
    totalTokensLocked: 0, totalTokensStaked: 0, totalRevenue: 0, tierBreakdown: {},
  });
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedMember, setExpandedMember] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    await Promise.all([loadStats(), loadMembers()]);
    setLoading(false);
  };

  const loadStats = async () => {
    try {
      const { data: memberships } = await supabase
        .from('club_memberships')
        .select('tier_level, status, amount_paid_usd, tokens_locked');

      const { data: balances } = await supabase
        .from('club_token_balances')
        .select('total_tokens, locked_tokens, available_tokens');

      const { data: stakes } = await supabase
        .from('club_staking_positions')
        .select('amount_staked')
        .eq('status', 'active');

      const totalMembers = memberships?.length || 0;
      const activeMembers = memberships?.filter(m => m.status === 'active').length || 0;
      const totalRevenue = memberships?.reduce((sum, m) => sum + parseFloat(m.amount_paid_usd || '0'), 0) || 0;

      const tierBreakdown: Record<string, number> = {};
      memberships?.forEach(m => {
        const name = TIER_NAMES[m.tier_level] || `Tier ${m.tier_level}`;
        tierBreakdown[name] = (tierBreakdown[name] || 0) + 1;
      });

      const totalTokensCirculating = balances?.reduce((sum, b) => sum + parseFloat(b.total_tokens || '0'), 0) || 0;
      const totalTokensLocked = balances?.reduce((sum, b) => sum + parseFloat(b.locked_tokens || '0'), 0) || 0;
      const totalTokensStaked = stakes?.reduce((sum, s) => sum + parseFloat(s.amount_staked || '0'), 0) || 0;

      setStats({ totalMembers, activeMembers, totalTokensCirculating, totalTokensLocked, totalTokensStaked, totalRevenue, tierBreakdown });
    } catch (error) {
      console.error('[AdminClub] Error loading stats:', error);
    }
  };

  const loadMembers = async () => {
    try {
      const { data: memberships } = await supabase
        .from('club_memberships')
        .select('id, user_id, tier_level, status, amount_paid_usd, purchased_at, tokens_locked')
        .order('purchased_at', { ascending: false });

      if (!memberships || memberships.length === 0) {
        setMembers([]);
        return;
      }

      const userIds = memberships.map(m => m.user_id);

      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, email')
        .in('id', userIds);

      const { data: balances } = await supabase
        .from('club_token_balances')
        .select('user_id, available_tokens, locked_tokens')
        .in('user_id', userIds);

      const { data: stakes } = await supabase
        .from('club_staking_positions')
        .select('user_id, amount_staked')
        .eq('status', 'active')
        .in('user_id', userIds);

      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
      const balanceMap = new Map(balances?.map(b => [b.user_id, b]) || []);

      const stakeMap = new Map<string, number>();
      stakes?.forEach(s => {
        const current = stakeMap.get(s.user_id) || 0;
        stakeMap.set(s.user_id, current + parseFloat(s.amount_staked || '0'));
      });

      const mapped: MemberSummary[] = memberships.map(m => {
        const profile = profileMap.get(m.user_id);
        const balance = balanceMap.get(m.user_id);
        return {
          id: m.id,
          userId: m.user_id,
          email: profile?.email || 'Unknown',
          tierLevel: m.tier_level,
          tierName: TIER_NAMES[m.tier_level] || `Tier ${m.tier_level}`,
          status: m.status,
          availableTokens: parseFloat(balance?.available_tokens || '0'),
          lockedTokens: parseFloat(balance?.locked_tokens || '0'),
          stakedTokens: stakeMap.get(m.user_id) || 0,
          purchasedAt: m.purchased_at,
        };
      });

      setMembers(mapped);
    } catch (error) {
      console.error('[AdminClub] Error loading members:', error);
    }
  };

  const filteredMembers = members.filter(m =>
    m.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.tierName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-gray-400" />
        <span className="ml-3 text-gray-400">Loading Club data...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/20 rounded-xl">
            <Crown className="w-6 h-6 text-amber-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">Club Management</h2>
            <p className="text-gray-400 text-sm">Memberships, tokens, and staking overview</p>
          </div>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors text-sm"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Total Members" value={stats.totalMembers.toString()} icon={<Users className="w-4 h-4 text-blue-400" />} />
        <StatCard label="Active" value={stats.activeMembers.toString()} icon={<Users className="w-4 h-4 text-green-400" />} />
        <StatCard label="Revenue" value={`$${fmt(stats.totalRevenue)}`} icon={<TrendingUp className="w-4 h-4 text-emerald-400" />} />
        <StatCard label="Circulating PIP" value={fmt(stats.totalTokensCirculating)} icon={<Coins className="w-4 h-4 text-amber-400" />} />
        <StatCard label="Locked PIP" value={fmt(stats.totalTokensLocked)} icon={<Coins className="w-4 h-4 text-red-400" />} />
        <StatCard label="Staked PIP" value={fmt(stats.totalTokensStaked)} icon={<Coins className="w-4 h-4 text-cyan-400" />} />
      </div>

      {Object.keys(stats.tierBreakdown).length > 0 && (
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
          <h3 className="text-base font-semibold text-white mb-4">Tier Distribution</h3>
          <div className="flex flex-wrap gap-3">
            {Object.entries(stats.tierBreakdown).map(([tier, count]) => {
              const tierNum = Object.entries(TIER_NAMES).find(([, n]) => n === tier)?.[0];
              const bgColor = TIER_COLORS[Number(tierNum)] || 'bg-gray-500';
              return (
                <div key={tier} className="flex items-center gap-2 px-3 py-2 bg-gray-700/50 rounded-lg">
                  <div className={`w-3 h-3 rounded-full ${bgColor}`} />
                  <span className="text-sm text-white font-medium">{tier}</span>
                  <span className="text-sm text-gray-400">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
        <div className="p-4 border-b border-gray-700 flex items-center gap-3">
          <Search className="w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search members by email or tier..."
            className="flex-1 bg-transparent text-sm text-white placeholder:text-gray-500 focus:outline-none"
          />
          <span className="text-xs text-gray-500">{filteredMembers.length} members</span>
        </div>

        <div className="max-h-[500px] overflow-y-auto">
          {filteredMembers.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No members found</div>
          ) : (
            filteredMembers.map((member) => {
              const isExpanded = expandedMember === member.id;
              return (
                <div key={member.id} className="border-b border-gray-700/50 last:border-b-0">
                  <button
                    onClick={() => setExpandedMember(isExpanded ? null : member.id)}
                    className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-700/30 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${member.status === 'active' ? 'bg-green-400' : 'bg-gray-500'}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-white truncate">{member.email}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-gray-400">{member.tierName}</span>
                          <span className="text-[10px] text-gray-500">{new Date(member.purchasedAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right hidden sm:block">
                        <div className="text-sm text-amber-400 font-medium">{fmt(member.availableTokens)} PIP</div>
                      </div>
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-3 pl-10">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div className="bg-gray-700/40 rounded-lg p-2.5">
                          <div className="text-gray-400 mb-0.5">Available</div>
                          <div className="text-white font-medium">{fmt(member.availableTokens)} PIP</div>
                        </div>
                        <div className="bg-gray-700/40 rounded-lg p-2.5">
                          <div className="text-gray-400 mb-0.5">Locked</div>
                          <div className="text-white font-medium">{fmt(member.lockedTokens)} PIP</div>
                        </div>
                        <div className="bg-gray-700/40 rounded-lg p-2.5">
                          <div className="text-gray-400 mb-0.5">Staked</div>
                          <div className="text-white font-medium">{fmt(member.stakedTokens)} PIP</div>
                        </div>
                        <div className="bg-gray-700/40 rounded-lg p-2.5">
                          <div className="text-gray-400 mb-0.5">Status</div>
                          <div className={`font-medium capitalize ${member.status === 'active' ? 'text-green-400' : 'text-gray-400'}`}>
                            {member.status}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
      <div className="flex items-center gap-1.5 text-gray-400 text-xs mb-1">
        {icon}
        {label}
      </div>
      <div className="text-xl font-bold text-white truncate">{value}</div>
    </div>
  );
}

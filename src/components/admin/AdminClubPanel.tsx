import { useEffect, useState } from 'react';
import { Crown, Users, Coins, TrendingUp, RefreshCw, Search, ChevronDown, ChevronUp, Flame, Package, AlertCircle, Lock, DollarSign, Activity, TrendingDown } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { tokenPoolAuthority } from '@/services/token-pool-authority';
import { clubTokenLedgerCoordinator } from '@/services/club-token-ledger-coordinator';
import { pipUtilityIndexEngine } from '@/services/pip-utility-index-engine';
import { logger } from '@/lib/logger';
import { TokenPoolManagement } from './TokenPoolManagement';

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

interface BurnAnalytics {
  totalPipBurned: number;
  totalDiscountTrades: number;
  totalCreditsSaved: number;
  burnVelocity24h: number;
  avgDiscountPct: number;
  tierBreakdown: Array<{
    tierName: string;
    tierLevel: number;
    tradeCount: number;
    totalPipBurned: number;
    totalCreditsSaved: number;
    avgDiscountPct: number;
  }>;
}

const TIER_NAMES: Record<number, string> = {
  1: 'Member', 2: 'Starter', 3: 'Builder', 4: 'Pro', 5: 'Elite', 6: 'Founder',
};

const TIER_COLORS: Record<number, string> = {
  1: 'bg-slate-500', 2: 'bg-sky-500', 3: 'bg-emerald-500', 4: 'bg-amber-500', 5: 'bg-red-500', 6: 'bg-fuchsia-500',
};

function fmt(n: number | undefined | null): string {
  if (n === null || n === undefined) return '0.00';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type Section = 'members' | 'treasury' | 'pools' | 'utility';

export function AdminClubPanel() {
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<Section>('members');

  const [stats, setStats] = useState<ClubStats>({
    totalMembers: 0, activeMembers: 0, totalTokensCirculating: 0,
    totalTokensLocked: 0, totalTokensStaked: 0, totalRevenue: 0, tierBreakdown: {},
  });
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [burnAnalytics, setBurnAnalytics] = useState<BurnAnalytics | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedMember, setExpandedMember] = useState<string | null>(null);

  // Treasury state
  const [poolSummary, setPoolSummary] = useState<any>(null);
  const [integrityChecks, setIntegrityChecks] = useState<any[]>([]);
  const [lifecycleMetrics, setLifecycleMetrics] = useState<any>(null);

  // Utility index state
  const [currentUtilityValue, setCurrentUtilityValue] = useState<any>(null);
  const [indexHistory, setIndexHistory] = useState<any[]>([]);
  const [indexChange30d, setIndexChange30d] = useState<any>(null);
  const [utilityPressure, setUtilityPressure] = useState<string>('Medium');
  const [computingIndex, setComputingIndex] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    await Promise.all([
      loadStats(),
      loadMembers(),
      loadBurnAnalytics(),
      loadTreasuryData(),
      loadUtilityData()
    ]);
    setLoading(false);
  };

  const loadStats = async () => {
    try {
      // Use RPC function to bypass RLS
      const { data: clubStats, error: statsError } = await supabase.rpc('admin_get_club_stats');

      if (statsError) {
        console.error('[AdminClub] Error loading stats:', statsError);
        return;
      }

      // Get additional data for revenue and tier breakdown
      const { data: memberships } = await supabase
        .from('club_memberships')
        .select('tier_level, status, amount_paid_usd')
        .eq('status', 'active');

      const { data: stakes } = await supabase
        .from('club_staking_positions')
        .select('amount_staked')
        .eq('status', 'active');

      const totalRevenue = memberships?.reduce((sum, m) => sum + parseFloat(m.amount_paid_usd || '0'), 0) || 0;

      const tierBreakdown: Record<string, number> = {};
      memberships?.forEach(m => {
        const name = TIER_NAMES[m.tier_level] || `Tier ${m.tier_level}`;
        tierBreakdown[name] = (tierBreakdown[name] || 0) + 1;
      });

      const totalTokensStaked = stakes?.reduce((sum, s) => sum + parseFloat(s.amount_staked || '0'), 0) || 0;

      setStats({
        totalMembers: clubStats.total_members || 0,
        activeMembers: clubStats.total_members || 0,
        totalTokensCirculating: parseFloat(clubStats.circulating_pip || '0'),
        totalTokensLocked: parseFloat(clubStats.locked_pip || '0'),
        totalTokensStaked,
        totalRevenue,
        tierBreakdown
      });
    } catch (error) {
      console.error('[AdminClub] Error loading stats:', error);
    }
  };

  const loadMembers = async () => {
    try {
      // Use RPC function to bypass RLS
      const { data: memberData, error: membersError } = await supabase.rpc('admin_get_club_members');

      if (membersError) {
        console.error('[AdminClub] Error loading members:', membersError);
        setMembers([]);
        return;
      }

      if (!memberData || memberData.length === 0) {
        setMembers([]);
        return;
      }

      // Get staking data separately
      const userIds = memberData.map((m: any) => m.user_id);
      const { data: stakes } = await supabase
        .from('club_staking_positions')
        .select('user_id, amount_staked')
        .eq('status', 'active')
        .in('user_id', userIds);

      const stakeMap = new Map<string, number>();
      stakes?.forEach(s => {
        const current = stakeMap.get(s.user_id) || 0;
        stakeMap.set(s.user_id, current + parseFloat(s.amount_staked || '0'));
      });

      const mapped: MemberSummary[] = memberData.map((m: any) => {
        return {
          id: `${m.user_id}-${m.tier_level}`,
          userId: m.user_id,
          email: m.email || 'Unknown',
          tierLevel: m.tier_level,
          tierName: m.tier_name,
          status: m.status,
          availableTokens: parseFloat(m.available_tokens || '0'),
          lockedTokens: parseFloat(m.locked_tokens || '0'),
          stakedTokens: stakeMap.get(m.user_id) || 0,
          purchasedAt: m.purchased_at,
        };
      });

      setMembers(mapped);
    } catch (error) {
      console.error('[AdminClub] Error loading members:', error);
    }
  };

  const loadBurnAnalytics = async () => {
    try {
      const { data, error } = await supabase.rpc('get_discount_burn_analytics');
      if (error || !data) {
        console.error('[AdminClub] Error loading burn analytics:', error);
        return;
      }

      const result = data as Record<string, unknown>;
      setBurnAnalytics({
        totalPipBurned: Number(result.total_pip_burned ?? 0),
        totalDiscountTrades: Number(result.total_discount_trades ?? 0),
        totalCreditsSaved: Number(result.total_credits_saved ?? 0),
        burnVelocity24h: Number(result.burn_velocity_24h ?? 0),
        avgDiscountPct: Number(result.avg_discount_pct ?? 0),
        tierBreakdown: Array.isArray(result.tier_breakdown) ? (result.tier_breakdown as Array<Record<string, unknown>>).map(t => ({
          tierName: String(t.tier_name ?? 'Unknown'),
          tierLevel: Number(t.tier_level ?? 0),
          tradeCount: Number(t.trade_count ?? 0),
          totalPipBurned: Number(t.total_pip_burned ?? 0),
          totalCreditsSaved: Number(t.total_credits_saved ?? 0),
          avgDiscountPct: Number(t.avg_discount_pct ?? 0),
        })) : [],
      });
    } catch (error) {
      console.error('[AdminClub] Error loading burn analytics:', error);
    }
  };

  const loadTreasuryData = async () => {
    try {
      const [summary, integrity, lifecycle30d] = await Promise.all([
        tokenPoolAuthority.getPoolAllocationSummary(),
        tokenPoolAuthority.verifySupplyIntegrity(),
        clubTokenLedgerCoordinator.getLifecycleFlowMetrics(30)
      ]);

      setPoolSummary(summary);
      setIntegrityChecks(integrity);
      setLifecycleMetrics(lifecycle30d);
    } catch (error: any) {
      logger.error('Failed to load token treasury data', { error });
    }
  };

  const loadUtilityData = async () => {
    try {
      const [currentValue, history, change, pressure] = await Promise.all([
        pipUtilityIndexEngine.getCurrentUtilityValue(),
        pipUtilityIndexEngine.getIndexHistory(90),
        pipUtilityIndexEngine.getIndexChange(30),
        pipUtilityIndexEngine.getUtilityPressure()
      ]);

      setCurrentUtilityValue(currentValue);
      setIndexHistory(history);
      setIndexChange30d(change);
      setUtilityPressure(pressure);
    } catch (error: any) {
      logger.error('Failed to load utility index data', { error });
    }
  };

  const handleComputeFirstIndex = async () => {
    setComputingIndex(true);
    try {
      await pipUtilityIndexEngine.computeDailyIndex();
      await loadUtilityData();
    } catch (error) {
      logger.error('Failed to compute first index', { error });
    } finally {
      setComputingIndex(false);
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
            <p className="text-gray-400 text-sm">Memberships, treasury, and utility ecosystem</p>
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

      {/* Section Tabs */}
      <div className="flex gap-2 bg-gray-800 p-1 rounded-lg border border-gray-700">
        <button
          onClick={() => setActiveSection('members')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md font-medium transition-all text-sm ${
            activeSection === 'members'
              ? 'bg-amber-600 text-white'
              : 'text-gray-400 hover:text-white hover:bg-gray-700'
          }`}
        >
          <Users className="w-4 h-4" />
          Members & Burn
        </button>
        <button
          onClick={() => setActiveSection('treasury')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md font-medium transition-all text-sm ${
            activeSection === 'treasury'
              ? 'bg-emerald-600 text-white'
              : 'text-gray-400 hover:text-white hover:bg-gray-700'
          }`}
        >
          <Package className="w-4 h-4" />
          Token Treasury
        </button>
        <button
          onClick={() => setActiveSection('pools')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md font-medium transition-all text-sm ${
            activeSection === 'pools'
              ? 'bg-sky-600 text-white'
              : 'text-gray-400 hover:text-white hover:bg-gray-700'
          }`}
        >
          <Coins className="w-4 h-4" />
          Pool Grants
        </button>
        <button
          onClick={() => setActiveSection('utility')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md font-medium transition-all text-sm ${
            activeSection === 'utility'
              ? 'bg-blue-600 text-white'
              : 'text-gray-400 hover:text-white hover:bg-gray-700'
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          PIP Utility Index
        </button>
      </div>

      {/* Members & Burn Section */}
      {activeSection === 'members' && (
        <div className="space-y-6">
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

          {burnAnalytics && (burnAnalytics.totalDiscountTrades > 0 || burnAnalytics.totalPipBurned > 0) && (
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <div className="flex items-center gap-2 mb-4">
                <Flame className="w-5 h-5 text-orange-400" />
                <h3 className="text-base font-semibold text-white">Discount & Burn Analytics</h3>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                <div className="bg-gray-700/50 rounded-lg p-3">
                  <div className="text-gray-400 text-xs mb-0.5">PIP Burned (Total)</div>
                  <div className="text-orange-400 text-lg font-bold">{fmt(burnAnalytics.totalPipBurned)}</div>
                </div>
                <div className="bg-gray-700/50 rounded-lg p-3">
                  <div className="text-gray-400 text-xs mb-0.5">Discount Trades</div>
                  <div className="text-white text-lg font-bold">{burnAnalytics.totalDiscountTrades}</div>
                </div>
                <div className="bg-gray-700/50 rounded-lg p-3">
                  <div className="text-gray-400 text-xs mb-0.5">Credits Saved</div>
                  <div className="text-emerald-400 text-lg font-bold">{fmt(burnAnalytics.totalCreditsSaved)}</div>
                </div>
                <div className="bg-gray-700/50 rounded-lg p-3">
                  <div className="text-gray-400 text-xs mb-0.5">Burn Rate (24h)</div>
                  <div className="text-amber-400 text-lg font-bold">{fmt(burnAnalytics.burnVelocity24h)} PIP</div>
                </div>
                <div className="bg-gray-700/50 rounded-lg p-3">
                  <div className="text-gray-400 text-xs mb-0.5">Avg Discount</div>
                  <div className="text-cyan-400 text-lg font-bold">{((burnAnalytics.avgDiscountPct || 0) * 100).toFixed(1)}%</div>
                </div>
              </div>

              {burnAnalytics.tierBreakdown.length > 0 && (
                <div>
                  <div className="text-gray-400 text-xs mb-2">Per-Tier Breakdown</div>
                  <div className="space-y-1.5">
                    {burnAnalytics.tierBreakdown.map(tier => (
                      <div key={tier.tierLevel} className="flex items-center justify-between bg-gray-700/30 rounded-lg px-3 py-2 text-xs">
                        <div className="flex items-center gap-2">
                          <div className={`w-2.5 h-2.5 rounded-full ${TIER_COLORS[tier.tierLevel] || 'bg-gray-500'}`} />
                          <span className="text-white font-medium">{tier.tierName}</span>
                        </div>
                        <div className="flex items-center gap-4 text-gray-300">
                          <span>{tier.tradeCount} trades</span>
                          <span className="text-orange-400">{fmt(tier.totalPipBurned)} burned</span>
                          <span className="text-emerald-400">{fmt(tier.totalCreditsSaved)} saved</span>
                          <span className="text-cyan-400">{((tier.avgDiscountPct || 0) * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
      )}

      {/* Treasury Section */}
      {activeSection === 'treasury' && (
        <div className="space-y-6">
          {/* Lifecycle Flows */}
          {lifecycleMetrics && (
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5 text-green-400" />
                Token Lifecycle Flows (30 Days)
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="bg-green-500/10 p-3 rounded-lg border border-green-500/30">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-green-400" />
                    <p className="text-xs text-green-400 font-medium">Granted</p>
                  </div>
                  <p className="text-lg font-bold text-white">
                    {(lifecycleMetrics.tokens_granted || 0).toLocaleString()} PIP
                  </p>
                </div>

                <div className="bg-red-500/10 p-3 rounded-lg border border-red-500/30">
                  <div className="flex items-center gap-2 mb-2">
                    <Flame className="w-4 h-4 text-red-400" />
                    <p className="text-xs text-red-400 font-medium">Burned</p>
                  </div>
                  <p className="text-lg font-bold text-white">
                    {(lifecycleMetrics.tokens_burned || 0).toLocaleString()} PIP
                  </p>
                </div>

                <div className="bg-purple-500/10 p-3 rounded-lg border border-purple-500/30">
                  <div className="flex items-center gap-2 mb-2">
                    <Lock className="w-4 h-4 text-purple-400" />
                    <p className="text-xs text-purple-400 font-medium">Staked (Net)</p>
                  </div>
                  <p className="text-lg font-bold text-white">
                    {((lifecycleMetrics.tokens_staked || 0) - (lifecycleMetrics.tokens_unstaked || 0)).toLocaleString()} PIP
                  </p>
                </div>

                <div className="bg-blue-500/10 p-3 rounded-lg border border-blue-500/30">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-blue-400" />
                    <p className="text-xs text-blue-400 font-medium">Rewards Accrued</p>
                  </div>
                  <p className="text-lg font-bold text-white">
                    {(lifecycleMetrics.rewards_accrued || 0).toLocaleString()} PIP
                  </p>
                </div>

                <div className="bg-yellow-500/10 p-3 rounded-lg border border-yellow-500/30">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-yellow-400" />
                    <p className="text-xs text-yellow-400 font-medium">Rewards Claimed</p>
                  </div>
                  <p className="text-lg font-bold text-white">
                    {(lifecycleMetrics.rewards_claimed || 0).toLocaleString()} PIP
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Pool Allocation Summary */}
          {poolSummary && (
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                <Package className="w-5 h-5 text-purple-400" />
                Token Pool Allocation
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                <div className="bg-blue-500/10 p-3 rounded-lg border border-blue-500/30">
                  <p className="text-xs text-blue-400 font-medium">Total Supply</p>
                  <p className="text-xl font-bold text-white mt-1">{(poolSummary.total_supply || 0).toLocaleString()} PIP</p>
                </div>
                <div className="bg-green-500/10 p-3 rounded-lg border border-green-500/30">
                  <p className="text-xs text-green-400 font-medium">Pool Balance</p>
                  <p className="text-xl font-bold text-white mt-1">{(poolSummary.pool_sum || 0).toLocaleString()} PIP</p>
                </div>
                <div className="bg-red-500/10 p-3 rounded-lg border border-red-500/30">
                  <p className="text-xs text-red-400 font-medium">Burned</p>
                  <p className="text-xl font-bold text-white mt-1">{(poolSummary.burned_total || 0).toLocaleString()} PIP</p>
                </div>
                <div className="bg-purple-500/10 p-3 rounded-lg border border-purple-500/30">
                  <p className="text-xs text-purple-400 font-medium">Circulating</p>
                  <p className="text-xl font-bold text-white mt-1">{(poolSummary.circulating_total || 0).toLocaleString()} PIP</p>
                </div>
              </div>

              <div className="space-y-2.5">
                {(poolSummary.pools || []).map((pool: any) => (
                  <div key={pool.pool_id} className="bg-gray-700/50 rounded-lg p-3 border border-gray-600/50">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="font-medium text-white text-sm">{pool.pool_name}</p>
                        <p className="text-xs text-gray-400">{pool.pool_id}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-base font-semibold text-white">
                          {(pool.current_balance || 0).toLocaleString()} PIP
                        </p>
                        <p className="text-xs text-gray-400">
                          {(pool.percentage_of_supply || 0).toFixed(2)}% of supply
                        </p>
                        {pool.pool_id !== 'BURNED' && (
                          <p className="text-[10px] text-gray-500">
                            {(pool.percentage_remaining || 0).toFixed(1)}% remaining
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Integrity Checks */}
          <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
            <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-blue-400" />
              System Integrity Checks
            </h3>
            <div className="space-y-3">
              {integrityChecks.map((check, index) => (
                <div
                  key={index}
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    check.passed ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'
                  }`}
                >
                  <div className="flex-1">
                    <p className={`font-medium ${check.passed ? 'text-green-400' : 'text-red-400'}`}>
                      {check.check_name}
                    </p>
                    <p className="text-sm text-gray-400 mt-1">{check.details}</p>
                  </div>
                  <div className="text-right">
                    <div className={`text-2xl ${check.passed ? 'text-green-400' : 'text-red-400'}`}>
                      {check.passed ? '✓' : '✗'}
                    </div>
                    {!check.passed && (
                      <p className="text-xs text-red-400 mt-1">
                        Expected: {(check.expected_value || 0).toFixed(4)}
                        <br />
                        Actual: {(check.actual_value || 0).toFixed(4)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Pool Grants Section */}
      {activeSection === 'pools' && <TokenPoolManagement />}

      {/* Utility Index Section */}
      {activeSection === 'utility' && (
        <div className="space-y-6">
          {!currentUtilityValue ? (
            <div className="bg-gray-800 rounded-xl p-8 border border-gray-700 text-center">
              <Activity className="w-12 h-12 text-gray-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">No Utility Index Data Yet</h3>
              <p className="text-gray-400 text-sm mb-5 max-w-md mx-auto">
                The PIP Utility Index has not been computed yet. Click below to compute the first index value based on current platform metrics.
              </p>
              <button
                onClick={handleComputeFirstIndex}
                disabled={computingIndex}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {computingIndex ? 'Computing...' : 'Compute First Index'}
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gradient-to-br from-blue-600 to-cyan-600 p-5 rounded-xl text-white border border-blue-500/30">
                  <p className="text-sm opacity-90 mb-2">Current Utility Value</p>
                  <p className="text-3xl font-bold">
                    ${(currentUtilityValue.display_value_usd || 0).toFixed(4)}
                  </p>
                  <p className="text-xs mt-2 opacity-75">
                    Last updated: {currentUtilityValue.date ? new Date(currentUtilityValue.date).toLocaleDateString() : 'N/A'}
                  </p>
                </div>

                {indexChange30d && (
                  <div className={`p-5 rounded-xl border ${
                    (indexChange30d.change_percentage || 0) >= 0
                      ? 'bg-green-500/10 border-green-500/30'
                      : 'bg-red-500/10 border-red-500/30'
                  }`}>
                    <p className="text-sm text-gray-400 mb-2">30-Day Change</p>
                    <div className="flex items-center gap-2">
                      {(indexChange30d.change_percentage || 0) >= 0 ? (
                        <TrendingUp className="w-5 h-5 text-green-400" />
                      ) : (
                        <TrendingDown className="w-5 h-5 text-red-400" />
                      )}
                      <p className={`text-3xl font-bold ${
                        (indexChange30d.change_percentage || 0) >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {(indexChange30d.change_percentage || 0) >= 0 ? '+' : ''}
                        {(indexChange30d.change_percentage || 0).toFixed(2)}%
                      </p>
                    </div>
                    <p className="text-xs text-gray-400 mt-2">
                      ${(indexChange30d.change_amount || 0).toFixed(4)} absolute change
                    </p>
                  </div>
                )}

                <div className="bg-yellow-500/10 p-5 rounded-xl border border-yellow-500/30">
                  <p className="text-sm text-gray-400 mb-2">Utility Pressure</p>
                  <p className="text-3xl font-bold text-yellow-400">{utilityPressure}</p>
                  <p className="text-xs text-gray-400 mt-2">
                    Based on 90-day percentile
                  </p>
                </div>
              </div>

              {indexHistory.length > 0 && (
                <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                  <h3 className="text-base font-semibold text-white mb-4">90-Day History</h3>
                  <div className="h-48 flex items-end space-x-1">
                    {indexHistory.slice(-30).map((point, index) => {
                      const sliced = indexHistory.slice(-30);
                      const maxValue = Math.max(...sliced.map(p => Number(p.display_value_usd || 0)), 0.0001);
                      const height = (Number(point.display_value_usd || 0) / maxValue) * 100;
                      return (
                        <div
                          key={index}
                          className="flex-1 bg-blue-500 rounded-t hover:bg-blue-400 transition-colors"
                          style={{ height: `${Math.max(height, 2)}%` }}
                          title={`${new Date(point.date).toLocaleDateString()}: $${Number(point.display_value_usd || 0).toFixed(4)}`}
                        />
                      );
                    })}
                  </div>
                  <div className="flex justify-between text-xs text-gray-500 mt-2">
                    <span>{new Date(indexHistory[Math.max(indexHistory.length - 30, 0)]?.date || indexHistory[0]?.date).toLocaleDateString()}</span>
                    <span>{new Date(indexHistory[indexHistory.length - 1]?.date).toLocaleDateString()}</span>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="bg-blue-500/10 rounded-xl p-4 border border-blue-500/30">
            <p className="text-xs text-blue-300 leading-relaxed">
              <strong>Note:</strong> The PIP Utility Value is a display-only metric that reflects platform activity and token usage.
              This is not a cash value or redemption guarantee. The index is calculated daily using platform metrics:
              credits spent, PIP burned, staking participation, active users, and liquid supply.
            </p>
          </div>
        </div>
      )}
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

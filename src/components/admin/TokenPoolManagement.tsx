import { useEffect, useState } from 'react';
import {
  Package, TrendingUp, TrendingDown, Shield, AlertCircle,
  RefreshCw, Send, Lock, Eye, History, CheckCircle, XCircle,
  ArrowRightLeft, Coins, Activity
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { tokenPoolAuthority, type PoolId } from '@/services/token-pool-authority';
import { ManualTokenTransferDialog } from './ManualTokenTransferDialog';
import { logger } from '@/lib/logger';

interface PoolWithAccess {
  pool_id: PoolId;
  pool_name: string;
  current_balance: number;
  initial_allocation: number;
  distributed: number;
  pct_remaining: number;
  access_rules: Array<{
    access_level: string;
    max_single_grant: number;
    requires_approval: boolean;
    description: string;
  }>;
}

interface PoolEvent {
  event_id: string;
  ts: string;
  pool_id: string;
  pool_name: string;
  event_type: string;
  amount_pip: number;
  ref_type: string;
  metadata: any;
}

interface IntegrityCheck {
  check_name: string;
  passed: boolean;
  expected_value: number;
  actual_value: number;
  details: string;
}

const POOL_COLORS: Record<string, { bg: string; border: string; text: string; accent: string }> = {
  COMMUNITY_INCENTIVES: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400', accent: 'bg-emerald-500' },
  MARKETING_PARTNERS: { bg: 'bg-sky-500/10', border: 'border-sky-500/30', text: 'text-sky-400', accent: 'bg-sky-500' },
  FOUNDERS_TEAM: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400', accent: 'bg-amber-500' },
  OPERATIONS_RESERVE: { bg: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-400', accent: 'bg-orange-500' },
  PUBLIC_LIQUIDITY_FUTURE: { bg: 'bg-cyan-500/10', border: 'border-cyan-500/30', text: 'text-cyan-400', accent: 'bg-cyan-500' },
  BURNED: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400', accent: 'bg-red-500' },
};

const ACCESS_ICONS: Record<string, React.ReactNode> = {
  manual_grant: <Send className="w-3.5 h-3.5" />,
  transfer_out: <ArrowRightLeft className="w-3.5 h-3.5" />,
  view_only: <Eye className="w-3.5 h-3.5" />,
  locked: <Lock className="w-3.5 h-3.5" />,
};

const ACCESS_LABELS: Record<string, string> = {
  manual_grant: 'Manual Grant',
  transfer_out: 'Transfer Out',
  view_only: 'View Only',
  locked: 'Locked',
};

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtPrecise(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export function TokenPoolManagement() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [pools, setPools] = useState<PoolWithAccess[]>([]);
  const [events, setEvents] = useState<PoolEvent[]>([]);
  const [integrityChecks, setIntegrityChecks] = useState<IntegrityCheck[]>([]);
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [selectedPool, setSelectedPool] = useState<PoolId | null>(null);
  const [activeView, setActiveView] = useState<'pools' | 'history' | 'integrity'>('pools');

  useEffect(() => {
    loadData();
  }, [user]);

  const loadData = async () => {
    if (!user) return;
    setLoading(true);
    await Promise.all([loadPools(), loadEvents(), loadIntegrity()]);
    setLoading(false);
  };

  const loadPools = async () => {
    if (!user) return;
    try {
      const { data: flowData } = await supabase.rpc('get_pool_to_user_flow_summary', {
        p_admin_user_id: user.id
      });

      const { data: accessData } = await supabase
        .from('admin_pool_access_rules')
        .select('*');

      const accessMap = new Map<string, typeof accessData>();
      (accessData || []).forEach((rule: any) => {
        const existing = accessMap.get(rule.pool_id) || [];
        existing.push(rule);
        accessMap.set(rule.pool_id, existing);
      });

      const mapped: PoolWithAccess[] = (flowData || []).map((p: any) => ({
        pool_id: p.pool_id as PoolId,
        pool_name: p.pool_name,
        current_balance: Number(p.current_balance),
        initial_allocation: Number(p.initial_allocation),
        distributed: Number(p.total_distributed),
        pct_remaining: Number(p.pct_remaining),
        access_rules: (accessMap.get(p.pool_id) || []).map((r: any) => ({
          access_level: r.access_level,
          max_single_grant: Number(r.max_single_grant),
          requires_approval: r.requires_approval,
          description: r.description,
        })),
      }));

      setPools(mapped);
    } catch (error) {
      logger.error('Failed to load pool data', { error });
    }
  };

  const loadEvents = async () => {
    if (!user) return;
    try {
      const { data } = await supabase.rpc('get_pool_transaction_history', {
        p_admin_user_id: user.id,
        p_pool_id: null,
        p_limit: 50
      });
      setEvents((data || []).map((e: any) => ({
        ...e,
        amount_pip: Number(e.amount_pip),
      })));
    } catch (error) {
      logger.error('Failed to load pool events', { error });
    }
  };

  const loadIntegrity = async () => {
    try {
      const checks = await tokenPoolAuthority.verifySupplyIntegrity();
      setIntegrityChecks(checks);
    } catch (error) {
      logger.error('Failed to load integrity checks', { error });
    }
  };

  const handleGrantFromPool = (poolId: PoolId) => {
    setSelectedPool(poolId);
    setShowTransferDialog(true);
  };

  const handleTransferComplete = async () => {
    setShowTransferDialog(false);
    setSelectedPool(null);
    await loadData();
  };

  const totalSupply = 100000000;
  const totalInPools = pools.reduce((sum, p) => p.pool_id !== 'BURNED' ? sum + p.current_balance : sum, 0);
  const totalDistributed = pools.reduce((sum, p) => sum + p.distributed, 0);
  const totalBurned = pools.find(p => p.pool_id === 'BURNED')?.current_balance || 0;
  const allChecksPassed = integrityChecks.length > 0 && integrityChecks.every(c => c.passed);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-gray-400" />
        <span className="ml-3 text-gray-400">Loading pool data...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-500/20 rounded-xl">
            <Package className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Token Pool Management</h2>
            <p className="text-gray-400 text-sm">Manage pool-to-user token flows</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
            allChecksPassed
              ? 'bg-emerald-500/20 text-emerald-400'
              : 'bg-red-500/20 text-red-400'
          }`}>
            {allChecksPassed ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
            {allChecksPassed ? 'Supply Verified' : 'Integrity Issue'}
          </div>
          <button
            onClick={loadData}
            className="flex items-center gap-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors text-sm"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Total Supply" value={`${fmt(totalSupply)} PIP`} color="text-white" />
        <SummaryCard label="In Pools" value={`${fmt(totalInPools)} PIP`} color="text-emerald-400" />
        <SummaryCard label="Distributed" value={`${fmt(totalDistributed)} PIP`} color="text-sky-400" />
        <SummaryCard label="Burned" value={`${fmt(totalBurned)} PIP`} color="text-red-400" />
      </div>

      {/* View Tabs */}
      <div className="flex gap-2 bg-gray-800 p-1 rounded-lg border border-gray-700">
        {[
          { id: 'pools' as const, label: 'Pool Allocation', icon: Package },
          { id: 'history' as const, label: 'Transaction History', icon: History },
          { id: 'integrity' as const, label: 'Supply Integrity', icon: Shield },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveView(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md font-medium transition-all text-sm ${
              activeView === tab.id
                ? 'bg-gray-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Pool Allocation View */}
      {activeView === 'pools' && (
        <div className="space-y-3">
          {pools.map(pool => {
            const colors = POOL_COLORS[pool.pool_id] || POOL_COLORS.BURNED;
            const canGrant = pool.access_rules.some(r => r.access_level === 'manual_grant');
            const isLocked = pool.access_rules.some(r => r.access_level === 'locked');
            const pctUsed = pool.initial_allocation > 0
              ? ((pool.initial_allocation - pool.current_balance) / pool.initial_allocation) * 100
              : 0;

            return (
              <div key={pool.pool_id} className={`${colors.bg} rounded-xl p-4 border ${colors.border}`}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-white font-semibold text-sm">{pool.pool_name}</h3>
                      {isLocked && <Lock className="w-3.5 h-3.5 text-gray-500" />}
                    </div>
                    <p className="text-gray-400 text-xs">{pool.pool_id}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-white font-bold text-lg">{fmt(pool.current_balance)}</div>
                    <div className="text-gray-400 text-xs">of {fmt(pool.initial_allocation)} PIP</div>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mb-3">
                  <div className="h-2 bg-gray-700/50 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${colors.accent} rounded-full transition-all duration-500`}
                      style={{ width: `${Math.max(100 - pctUsed, 0)}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1 text-xs text-gray-500">
                    <span>{pool.pct_remaining.toFixed(2)}% remaining</span>
                    <span>{fmt(pool.distributed)} distributed</span>
                  </div>
                </div>

                {/* Access rules and actions */}
                <div className="flex items-center justify-between">
                  <div className="flex flex-wrap gap-1.5">
                    {pool.access_rules.map((rule, i) => (
                      <span
                        key={i}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${
                          rule.access_level === 'manual_grant' ? 'bg-emerald-500/20 text-emerald-400' :
                          rule.access_level === 'transfer_out' ? 'bg-sky-500/20 text-sky-400' :
                          rule.access_level === 'locked' ? 'bg-gray-500/20 text-gray-400' :
                          'bg-gray-500/20 text-gray-400'
                        }`}
                      >
                        {ACCESS_ICONS[rule.access_level]}
                        {ACCESS_LABELS[rule.access_level]}
                        {rule.requires_approval && ' (Approval)'}
                      </span>
                    ))}
                  </div>

                  {canGrant && (
                    <button
                      onClick={() => handleGrantFromPool(pool.pool_id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-all text-xs font-medium"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Grant Tokens
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Transaction History View */}
      {activeView === 'history' && (
        <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
          <div className="p-4 border-b border-gray-700">
            <h3 className="text-white font-semibold text-sm flex items-center gap-2">
              <Activity className="w-4 h-4 text-gray-400" />
              Pool Transaction Log ({events.length} events)
            </h3>
          </div>
          <div className="max-h-[500px] overflow-y-auto">
            {events.length === 0 ? (
              <div className="text-center py-12 text-gray-500">No pool events recorded</div>
            ) : (
              events.map(event => {
                const colors = POOL_COLORS[event.pool_id] || POOL_COLORS.BURNED;
                const isDebit = event.event_type === 'POOL_DEBIT';
                const isInit = event.event_type === 'POOL_INIT';

                return (
                  <div key={event.event_id} className="px-4 py-3 border-b border-gray-700/50 last:border-b-0 hover:bg-gray-700/20 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${colors.accent}`} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-white text-sm font-medium">{event.pool_name}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                              isDebit ? 'bg-red-500/20 text-red-400' :
                              isInit ? 'bg-blue-500/20 text-blue-400' :
                              'bg-emerald-500/20 text-emerald-400'
                            }`}>
                              {event.event_type.replace('POOL_', '')}
                            </span>
                          </div>
                          <div className="text-gray-500 text-xs mt-0.5 truncate">
                            {event.ref_type || 'system'} -- {new Date(event.ts).toLocaleString()}
                          </div>
                        </div>
                      </div>
                      <div className={`text-sm font-semibold ${isDebit ? 'text-red-400' : 'text-emerald-400'}`}>
                        {isDebit ? '-' : '+'}{fmt(event.amount_pip)} PIP
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Supply Integrity View */}
      {activeView === 'integrity' && (
        <div className="space-y-4">
          <div className={`rounded-xl p-5 border ${
            allChecksPassed
              ? 'bg-emerald-500/10 border-emerald-500/30'
              : 'bg-red-500/10 border-red-500/30'
          }`}>
            <div className="flex items-center gap-3 mb-3">
              <Shield className={`w-6 h-6 ${allChecksPassed ? 'text-emerald-400' : 'text-red-400'}`} />
              <div>
                <h3 className="text-white font-semibold">
                  {allChecksPassed ? 'All Integrity Checks Passing' : 'Integrity Issues Detected'}
                </h3>
                <p className="text-gray-400 text-xs mt-0.5">
                  {integrityChecks.length} checks -- Pools + Circulating + Burned = 100,000,000 PIP
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2.5">
            {integrityChecks.map((check, i) => (
              <div
                key={i}
                className={`flex items-center justify-between p-4 rounded-xl border ${
                  check.passed
                    ? 'bg-gray-800 border-gray-700'
                    : 'bg-red-500/10 border-red-500/30'
                }`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    {check.passed
                      ? <CheckCircle className="w-4 h-4 text-emerald-400" />
                      : <XCircle className="w-4 h-4 text-red-400" />}
                    <span className="text-white text-sm font-medium">{check.check_name}</span>
                  </div>
                  <p className="text-gray-400 text-xs mt-1 ml-6">{check.details}</p>
                </div>
                <div className="text-right ml-4">
                  <div className="text-gray-400 text-xs">
                    Expected: {fmtPrecise(Number(check.expected_value))}
                  </div>
                  <div className={`text-xs font-medium ${check.passed ? 'text-emerald-400' : 'text-red-400'}`}>
                    Actual: {fmtPrecise(Number(check.actual_value))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Manual Transfer Dialog */}
      {showTransferDialog && selectedPool && (
        <ManualTokenTransferDialog
          sourcePoolId={selectedPool}
          sourcePoolName={pools.find(p => p.pool_id === selectedPool)?.pool_name || selectedPool}
          poolBalance={pools.find(p => p.pool_id === selectedPool)?.current_balance || 0}
          maxSingleGrant={
            pools.find(p => p.pool_id === selectedPool)?.access_rules
              .find(r => r.access_level === 'manual_grant')?.max_single_grant || 0
          }
          onClose={() => { setShowTransferDialog(false); setSelectedPool(null); }}
          onComplete={handleTransferComplete}
        />
      )}
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
      <div className="text-gray-400 text-xs mb-1">{label}</div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
    </div>
  );
}

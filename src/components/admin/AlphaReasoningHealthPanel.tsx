import { useEffect, useState } from 'react';
import {
  Brain,
  Activity,
  AlertTriangle,
  CheckCircle,
  TrendingUp,
  TrendingDown,
  Clock,
  Scale,
  Flame,
  Shield,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface TelemetryRow {
  id: string;
  symbol: string;
  style: string;
  action: string;
  entry_mode: string | null;
  confidence_tier: string | null;
  q5_failure_probability: number | null;
  named_evidence_count: number | null;
  ccip_citations: unknown;
  answer_sheet_coherence_score: number | null;
  reasoning_length: number | null;
  created_at: string;
}

interface Observation {
  observation_type: string;
  ccip_tag: string | null;
  severity: string | null;
  summary: string;
  sample_size: number | null;
  created_at: string;
}

interface WatcherRun {
  id: string;
  run_at: string;
  observations_created: number | null;
  no_trade_rate_pct: number | null;
  no_trade_sample: number | null;
  vc_win_rate_pct: number | null;
  vc_sample: number | null;
  ec_win_rate_pct: number | null;
  ec_sample: number | null;
  counter_trend_violations: number | null;
  error_message: string | null;
}

interface TierCalibration {
  tier: string;
  claimed: number;
  executed: number;
  wins: number;
  losses: number;
  winRate: number | null;
}

interface ActionCount {
  action: string;
  entryMode: string;
  count: number;
}

interface CitationCount {
  tag: string;
  count: number;
}

const TIER_ORDER = ['extremely_confident', 'very_confident', 'confident', 'moderate', 'cautious'];

export function AlphaReasoningHealthPanel() {
  const [loading, setLoading] = useState(true);
  const [telemetry, setTelemetry] = useState<TelemetryRow[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [watcherRuns, setWatcherRuns] = useState<WatcherRun[]>([]);
  const [calibration, setCalibration] = useState<TierCalibration[]>([]);
  const [actionCounts, setActionCounts] = useState<ActionCount[]>([]);
  const [citationCounts, setCitationCounts] = useState<CitationCount[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);

    const [telemetryRes, obsRes, watcherRes] = await Promise.all([
      supabase
        .from('alpha_reasoning_telemetry')
        .select('id, symbol, style, action, entry_mode, confidence_tier, q5_failure_probability, named_evidence_count, ccip_citations, answer_sheet_coherence_score, reasoning_length, created_at')
        .gte('created_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(1000),
      supabase
        .from('ccip_post_deploy_observations')
        .select('observation_type, ccip_tag, severity, summary, sample_size, created_at')
        .is('resolved_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('alpha_reasoning_watcher_runs')
        .select('id, run_at, observations_created, no_trade_rate_pct, no_trade_sample, vc_win_rate_pct, vc_sample, ec_win_rate_pct, ec_sample, counter_trend_violations, error_message')
        .order('run_at', { ascending: false })
        .limit(24),
    ]);

    const tel = (telemetryRes.data ?? []) as TelemetryRow[];
    setTelemetry(tel);
    setObservations((obsRes.data ?? []) as Observation[]);
    setWatcherRuns((watcherRes.data ?? []) as WatcherRun[]);

    await loadCalibration();
    setActionCounts(buildActionCounts(tel));
    setCitationCounts(buildCitationCounts(tel));

    setLoading(false);
  }

  async function loadCalibration() {
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('alpha_decisions')
      .select('id, confidence_tier, alpha_decision_outcomes(executed, outcome)')
      .gte('created_at', cutoff)
      .not('confidence_tier', 'is', null)
      .limit(2000);

    const map = new Map<string, TierCalibration>();
    for (const tier of TIER_ORDER) {
      map.set(tier, { tier, claimed: 0, executed: 0, wins: 0, losses: 0, winRate: null });
    }

    type Row = { confidence_tier: string | null; alpha_decision_outcomes: { executed: boolean | null; outcome: string | null }[] | { executed: boolean | null; outcome: string | null } | null };
    for (const row of (data ?? []) as Row[]) {
      const tier = row.confidence_tier;
      if (!tier || !map.has(tier)) continue;
      const entry = map.get(tier)!;
      entry.claimed += 1;
      const outcomes = Array.isArray(row.alpha_decision_outcomes)
        ? row.alpha_decision_outcomes
        : row.alpha_decision_outcomes
        ? [row.alpha_decision_outcomes]
        : [];
      for (const o of outcomes) {
        if (o?.executed) {
          entry.executed += 1;
          if (o.outcome === 'WIN') entry.wins += 1;
          else if (o.outcome === 'LOSS') entry.losses += 1;
        }
      }
    }

    const out: TierCalibration[] = [];
    for (const tier of TIER_ORDER) {
      const e = map.get(tier)!;
      const decided = e.wins + e.losses;
      e.winRate = decided > 0 ? Math.round((100 * e.wins) / decided) : null;
      out.push(e);
    }
    setCalibration(out);
  }

  function buildActionCounts(rows: TelemetryRow[]): ActionCount[] {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const key = `${r.action}::${r.entry_mode ?? 'none'}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([k, count]) => {
        const [action, entryMode] = k.split('::');
        return { action, entryMode, count };
      })
      .sort((a, b) => b.count - a.count);
  }

  function buildCitationCounts(rows: TelemetryRow[]): CitationCount[] {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const cites = Array.isArray(r.ccip_citations) ? (r.ccip_citations as string[]) : [];
      for (const tag of cites) {
        if (typeof tag !== 'string') continue;
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }

  const totalDecisions = telemetry.length;
  const noTradeCount = telemetry.filter((r) => r.action === 'NO_TRADE').length;
  const noTradeRate = totalDecisions > 0 ? Math.round((100 * noTradeCount) / totalDecisions) : 0;
  const avgEvidence =
    totalDecisions > 0
      ? (
          telemetry.reduce((s, r) => s + (r.named_evidence_count ?? 0), 0) / totalDecisions
        ).toFixed(1)
      : '0.0';
  const avgCoherence =
    totalDecisions > 0
      ? Math.round(
          (100 *
            telemetry.reduce((s, r) => s + (r.answer_sheet_coherence_score ?? 0), 0)) /
            totalDecisions
        )
      : 0;

  const latestRun = watcherRuns[0];
  const maxCitation = citationCounts[0]?.count ?? 1;
  const maxAction = actionCounts[0]?.count ?? 1;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <Clock className="w-5 h-5 animate-spin mr-2" />
        Loading reasoning health...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-emerald-500/10 rounded-lg">
          <Brain className="w-6 h-6 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Alpha Reasoning Health</h2>
          <p className="text-sm text-gray-400">
            Stage 6 telemetry — 14-day rolling window. CCIP-2026-0430A.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Decisions (14d)"
          value={totalDecisions.toString()}
          icon={Activity}
          color="text-emerald-400"
        />
        <StatCard
          label="NO_TRADE rate"
          value={`${noTradeRate}%`}
          icon={noTradeRate > 10 ? TrendingDown : TrendingUp}
          color={noTradeRate > 10 ? 'text-red-400' : 'text-emerald-400'}
          subtitle={noTradeRate > 10 ? 'Above Wait-First target' : 'Solving, not refusing'}
        />
        <StatCard
          label="Avg named evidence"
          value={avgEvidence}
          icon={Flame}
          color="text-amber-400"
          subtitle="per reasoning"
        />
        <StatCard
          label="Answer-sheet coherence"
          value={`${avgCoherence}%`}
          icon={Shield}
          color={avgCoherence >= 80 ? 'text-emerald-400' : 'text-yellow-400'}
        />
      </div>

      <Section
        title="Active observations"
        icon={AlertTriangle}
        iconColor={observations.length > 0 ? 'text-red-400' : 'text-emerald-400'}
      >
        {observations.length === 0 ? (
          <div className="flex items-center gap-2 text-emerald-400 text-sm py-2">
            <CheckCircle className="w-4 h-4" />
            No watcher signals firing. Reasoning health is clean.
          </div>
        ) : (
          <div className="space-y-2">
            {observations.map((o, idx) => (
              <div
                key={`${o.observation_type}-${idx}`}
                className="p-3 bg-red-500/5 border border-red-500/20 rounded-lg"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-red-500/20 text-red-300">
                    {o.observation_type}
                  </span>
                  {o.ccip_tag && (
                    <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-gray-800 text-gray-300">
                      {o.ccip_tag}
                    </span>
                  )}
                  <span className="text-[10px] text-gray-500 ml-auto">
                    n={o.sample_size ?? '—'}
                  </span>
                </div>
                <p className="text-xs text-gray-300 leading-relaxed">{o.summary}</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Tier calibration (claimed vs realized)" icon={Scale} iconColor="text-blue-400">
        <div className="space-y-2">
          {calibration.map((c) => {
            const decided = c.wins + c.losses;
            const target = targetForTier(c.tier);
            const miss = c.winRate !== null && target !== null && c.winRate < target;
            return (
              <div key={c.tier} className="flex items-center gap-3 text-xs">
                <div className="w-40 text-gray-300 font-medium capitalize">
                  {c.tier.replace('_', ' ')}
                </div>
                <div className="flex-1 bg-gray-800 rounded h-6 relative overflow-hidden">
                  {c.winRate !== null && (
                    <div
                      className={`h-full ${miss ? 'bg-red-500/60' : 'bg-emerald-500/60'}`}
                      style={{ width: `${Math.min(100, c.winRate)}%` }}
                    />
                  )}
                  <div className="absolute inset-0 flex items-center px-2 text-white font-mono">
                    {c.winRate !== null ? `${c.winRate}% win` : 'insufficient data'}
                    {target !== null && (
                      <span className="ml-auto text-gray-400">target {target}%+</span>
                    )}
                  </div>
                </div>
                <div className="w-28 text-right text-gray-500 font-mono">
                  {c.claimed} claimed / {decided} decided
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Action distribution" icon={Activity} iconColor="text-emerald-400">
          <div className="space-y-1.5">
            {actionCounts.slice(0, 8).map((a) => (
              <div
                key={`${a.action}-${a.entryMode}`}
                className="flex items-center gap-2 text-xs"
              >
                <div className="w-40 text-gray-300">
                  <span className={actionColor(a.action)}>{a.action}</span>
                  {a.entryMode !== 'none' && (
                    <span className="text-gray-500 ml-1">· {a.entryMode}</span>
                  )}
                </div>
                <div className="flex-1 bg-gray-800 rounded h-4 relative">
                  <div
                    className="h-full bg-emerald-500/40 rounded"
                    style={{ width: `${(100 * a.count) / maxAction}%` }}
                  />
                  <div className="absolute inset-0 flex items-center px-2 text-white font-mono">
                    {a.count}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="CCIP citation heatmap" icon={Flame} iconColor="text-amber-400">
          {citationCounts.length === 0 ? (
            <p className="text-sm text-gray-500">No CCIP citations found in recent reasoning.</p>
          ) : (
            <div className="space-y-1.5">
              {citationCounts.map((c) => (
                <div key={c.tag} className="flex items-center gap-2 text-xs">
                  <div className="w-40 font-mono text-amber-300 truncate">{c.tag}</div>
                  <div className="flex-1 bg-gray-800 rounded h-4 relative">
                    <div
                      className="h-full bg-amber-500/40 rounded"
                      style={{ width: `${(100 * c.count) / maxCitation}%` }}
                    />
                    <div className="absolute inset-0 flex items-center px-2 text-white font-mono">
                      {c.count}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <Section title="Watcher run history" icon={Clock} iconColor="text-gray-400">
        {watcherRuns.length === 0 ? (
          <p className="text-sm text-gray-500">No watcher runs recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {latestRun && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                <MiniStat label="Last run" value={formatRelative(latestRun.run_at)} />
                <MiniStat
                  label="Observations created"
                  value={`${latestRun.observations_created ?? 0}`}
                />
                <MiniStat
                  label="very_confident"
                  value={
                    latestRun.vc_win_rate_pct !== null
                      ? `${latestRun.vc_win_rate_pct}% (n=${latestRun.vc_sample ?? 0})`
                      : '—'
                  }
                />
                <MiniStat
                  label="Counter-trend violations"
                  value={`${latestRun.counter_trend_violations ?? 0}`}
                />
              </div>
            )}
            <div className="flex gap-1 items-end h-10">
              {watcherRuns
                .slice()
                .reverse()
                .map((r) => {
                  const count = r.observations_created ?? 0;
                  const height = Math.min(100, 20 + count * 20);
                  const errored = !!r.error_message;
                  return (
                    <div
                      key={r.id}
                      title={`${formatRelative(r.run_at)} · ${count} observations${
                        errored ? ' · error' : ''
                      }`}
                      className={`flex-1 rounded-t ${
                        errored
                          ? 'bg-red-500/60'
                          : count > 0
                          ? 'bg-yellow-500/60'
                          : 'bg-emerald-500/30'
                      }`}
                      style={{ height: `${height}%` }}
                    />
                  );
                })}
            </div>
            <p className="text-[10px] text-gray-500">
              Each bar = one watcher run (15-min cadence). Green = clean. Yellow = observations
              fired. Red = error.
            </p>
          </div>
        )}
      </Section>
    </div>
  );
}

function targetForTier(tier: string): number | null {
  if (tier === 'extremely_confident') return 80;
  if (tier === 'very_confident') return 65;
  if (tier === 'confident') return 55;
  return null;
}

function actionColor(action: string): string {
  if (action === 'BUY') return 'text-emerald-400 font-semibold';
  if (action === 'SELL') return 'text-red-400 font-semibold';
  if (action === 'NO_TRADE') return 'text-gray-500';
  return 'text-gray-300';
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ElementType;
  color: string;
  subtitle?: string;
}

function StatCard({ label, value, icon: Icon, color, subtitle }: StatCardProps) {
  return (
    <div className="p-4 bg-gray-900/60 border border-gray-800 rounded-xl">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-400 uppercase tracking-wide">{label}</span>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
      {subtitle && <div className="text-[10px] text-gray-500 mt-1">{subtitle}</div>}
    </div>
  );
}

interface SectionProps {
  title: string;
  icon: React.ElementType;
  iconColor: string;
  children: React.ReactNode;
}

function Section({ title, icon: Icon, iconColor, children }: SectionProps) {
  return (
    <div className="p-4 bg-gray-900/60 border border-gray-800 rounded-xl">
      <div className="flex items-center gap-2 mb-3">
        <Icon className={`w-4 h-4 ${iconColor}`} />
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2 bg-gray-800/50 rounded">
      <div className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-sm font-mono text-white mt-0.5">{value}</div>
    </div>
  );
}

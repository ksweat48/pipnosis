import React, { useState, useEffect } from 'react';
import {
  TrendingUp, TrendingDown, Target, Award, AlertTriangle, CheckCircle,
  XCircle, ChevronDown, ChevronRight, Brain, Lightbulb, Activity
} from 'lucide-react';
import { sessionIntelligenceService, SessionSummary, TradeIntelligence } from '../services/session-intelligence-service';
import { TradeDecisionTimeline } from './TradeDecisionTimeline';

interface SessionDeepDivePanelProps {
  sessionId: string;
  userId: string;
}

export function SessionDeepDivePanel({ sessionId, userId }: SessionDeepDivePanelProps) {
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [trades, setTrades] = useState<TradeIntelligence[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTrade, setExpandedTrade] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'winners' | 'losers' | 'llm'>('overview');

  useEffect(() => {
    loadSessionData();
  }, [sessionId, userId]);

  const loadSessionData = async () => {
    setLoading(true);
    const sessionData = await sessionIntelligenceService.fetchSessionDetail(userId, sessionId);
    if (sessionData) {
      setSession(sessionData);
      const tradesData = await sessionIntelligenceService.fetchSessionTrades(userId, sessionData.sessionDate);
      setTrades(tradesData);
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg p-8">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span className="ml-3 text-gray-300">Loading session intelligence...</span>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="bg-gray-800 rounded-lg p-8 text-center">
        <p className="text-gray-400">Session not found</p>
      </div>
    );
  }

  const winners = sessionIntelligenceService.getWinningTrades(trades);
  const losers = sessionIntelligenceService.getLosingTrades(trades);
  const llmAnalysis = session.llmDeepAnalysis;

  return (
    <div className="space-y-6">
      {/* Session Overview Header */}
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-white">
              Day {session.dayNumber} Deep Dive
              {session.monthNumber > 1 && (
                <span className="text-gray-400 text-lg ml-2">Month {session.monthNumber}</span>
              )}
            </h2>
            <p className="text-gray-400 mt-1">
              {new Date(session.sessionDate).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </p>
          </div>
          <div className={`px-4 py-2 rounded-lg ${session.isProfitable ? 'bg-green-900/30 border border-green-500' : 'bg-red-900/30 border border-red-500'}`}>
            <div className="flex items-center gap-2">
              {session.isProfitable ? (
                <CheckCircle className="w-5 h-5 text-green-400" />
              ) : (
                <XCircle className="w-5 h-5 text-red-400" />
              )}
              <span className={`font-bold ${session.isProfitable ? 'text-green-400' : 'text-red-400'}`}>
                {session.isProfitable ? 'Profitable' : 'Loss'}
              </span>
            </div>
          </div>
        </div>

        {/* Key Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            label="Win Rate"
            value={`${session.winRate.toFixed(1)}%`}
            icon={Target}
            color={session.winRate >= 60 ? 'green' : session.winRate >= 50 ? 'yellow' : 'red'}
          />
          <MetricCard
            label="Profit Factor"
            value={session.profitFactor.toFixed(2)}
            icon={Award}
            color={session.profitFactor >= 2 ? 'green' : session.profitFactor >= 1.5 ? 'yellow' : 'red'}
          />
          <MetricCard
            label="Total P&L"
            value={`${session.pnl >= 0 ? '+' : ''}${session.pnl.toFixed(0)}`}
            icon={session.pnl >= 0 ? TrendingUp : TrendingDown}
            color={session.pnl >= 0 ? 'green' : 'red'}
          />
          <MetricCard
            label="Trades"
            value={`${session.totalTrades}`}
            subValue={`${session.winningTrades}W / ${session.losingTrades}L`}
            icon={Activity}
            color="blue"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <div className="flex border-b border-gray-700">
          <TabButton
            active={activeTab === 'overview'}
            onClick={() => setActiveTab('overview')}
            label="All Trades"
            count={trades.length}
          />
          <TabButton
            active={activeTab === 'winners'}
            onClick={() => setActiveTab('winners')}
            label="Winners"
            count={winners.length}
            color="green"
          />
          <TabButton
            active={activeTab === 'losers'}
            onClick={() => setActiveTab('losers')}
            label="Losers"
            count={losers.length}
            color="red"
          />
          {llmAnalysis && (
            <TabButton
              active={activeTab === 'llm'}
              onClick={() => setActiveTab('llm')}
              label="LLM Analysis"
              icon={Brain}
              color="purple"
            />
          )}
        </div>

        <div className="p-6">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <TradesList
              trades={trades}
              expandedTrade={expandedTrade}
              onToggleExpand={(id) => setExpandedTrade(expandedTrade === id ? null : id)}
            />
          )}

          {/* Winners Tab */}
          {activeTab === 'winners' && (
            <div>
              <div className="mb-4 p-4 bg-green-900/20 border border-green-500/30 rounded-lg">
                <h3 className="text-green-400 font-semibold mb-2 flex items-center gap-2">
                  <Lightbulb className="w-5 h-5" />
                  What Made These Trades Win
                </h3>
                <p className="text-gray-300 text-sm">
                  Analyze winning patterns to replicate success in future sessions
                </p>
              </div>
              <TradesList
                trades={winners}
                expandedTrade={expandedTrade}
                onToggleExpand={(id) => setExpandedTrade(expandedTrade === id ? null : id)}
                highlightWinPatterns
              />
            </div>
          )}

          {/* Losers Tab */}
          {activeTab === 'losers' && (
            <div>
              <div className="mb-4 p-4 bg-red-900/20 border border-red-500/30 rounded-lg">
                <h3 className="text-red-400 font-semibold mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" />
                  Loss Forensics
                </h3>
                <p className="text-gray-300 text-sm">
                  Deep analysis of why each trade lost and how to prevent similar losses
                </p>
              </div>
              <TradesList
                trades={losers}
                expandedTrade={expandedTrade}
                onToggleExpand={(id) => setExpandedTrade(expandedTrade === id ? null : id)}
                highlightForensics
              />
            </div>
          )}

          {/* LLM Analysis Tab */}
          {activeTab === 'llm' && llmAnalysis && (
            <LLMAnalysisView analysis={llmAnalysis} />
          )}
        </div>
      </div>
    </div>
  );
}

// Metric Card Component
function MetricCard({ label, value, subValue, icon: Icon, color }: any) {
  const colorClasses = {
    green: 'text-green-400',
    yellow: 'text-yellow-400',
    red: 'text-red-400',
    blue: 'text-blue-400',
    purple: 'text-purple-400',
  };

  return (
    <div className="bg-gray-750 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-400 text-sm">{label}</span>
        <Icon className={`w-5 h-5 ${colorClasses[color]}`} />
      </div>
      <div className={`text-2xl font-bold ${colorClasses[color]}`}>
        {value}
      </div>
      {subValue && (
        <div className="text-xs text-gray-500 mt-1">{subValue}</div>
      )}
    </div>
  );
}

// Tab Button Component
function TabButton({ active, onClick, label, count, icon: Icon, color = 'blue' }: any) {
  const colorClasses = {
    blue: 'border-blue-500 text-blue-400',
    green: 'border-green-500 text-green-400',
    red: 'border-red-500 text-red-400',
    purple: 'border-purple-500 text-purple-400',
  };

  return (
    <button
      onClick={onClick}
      className={`
        px-6 py-3 font-medium transition-colors flex items-center gap-2
        ${active
          ? `${colorClasses[color]} border-b-2 bg-gray-750`
          : 'text-gray-400 hover:text-gray-300 hover:bg-gray-750'
        }
      `}
    >
      {Icon && <Icon className="w-4 h-4" />}
      {label}
      {count !== undefined && (
        <span className={`ml-1 px-2 py-0.5 rounded-full text-xs ${active ? 'bg-gray-700' : 'bg-gray-800'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

// Trades List Component
function TradesList({ trades, expandedTrade, onToggleExpand, highlightWinPatterns, highlightForensics }: any) {
  if (trades.length === 0) {
    return (
      <div className="text-center text-gray-400 py-8">
        <p>No trades in this category</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {trades.map((trade: TradeIntelligence) => (
        <TradeCard
          key={trade.id}
          trade={trade}
          expanded={expandedTrade === trade.id}
          onToggle={() => onToggleExpand(trade.id)}
          highlightWinPatterns={highlightWinPatterns}
          highlightForensics={highlightForensics}
        />
      ))}
    </div>
  );
}

// Trade Card Component
function TradeCard({ trade, expanded, onToggle, highlightWinPatterns, highlightForensics }: any) {
  const isWin = trade.outcome === 'win';
  const outcomeColor = isWin ? 'text-green-400' : trade.outcome === 'loss' ? 'text-red-400' : 'text-yellow-400';
  const outcomeBg = isWin ? 'bg-green-900/20 border-green-500/30' : trade.outcome === 'loss' ? 'bg-red-900/20 border-red-500/30' : 'bg-yellow-900/20 border-yellow-500/30';

  return (
    <div className={`border rounded-lg ${outcomeBg}`}>
      {/* Trade Header */}
      <button
        onClick={onToggle}
        className="w-full p-4 flex items-center justify-between hover:bg-gray-800/30 transition-colors"
      >
        <div className="flex items-center gap-4 flex-1">
          {/* Outcome Icon */}
          {isWin ? (
            <CheckCircle className="w-6 h-6 text-green-400" />
          ) : (
            <XCircle className="w-6 h-6 text-red-400" />
          )}

          {/* Trade Info */}
          <div className="text-left">
            <div className="flex items-center gap-3">
              <span className="text-white font-medium">{trade.symbol}</span>
              <span className={`text-sm ${trade.direction === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                {trade.direction.toUpperCase()}
              </span>
              <span className="text-gray-400 text-sm">
                {new Date(trade.entryTime).toLocaleTimeString()}
              </span>
            </div>
            <div className="text-xs text-gray-400 mt-1">
              Confidence: {trade.confidence}%
              {trade.adjustedConfidence && trade.adjustedConfidence !== trade.confidence && (
                <span className="ml-2 text-blue-400">
                  → {trade.adjustedConfidence}% (adjusted)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* P&L */}
        <div className="flex items-center gap-4">
          <div className={`text-lg font-bold ${outcomeColor}`}>
            {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)}
          </div>
          {expanded ? (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronRight className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </button>

      {/* Expanded Trade Details */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-700">
          {/* Entry/Exit Details */}
          <div className="grid grid-cols-2 gap-4 pt-4">
            <div>
              <h4 className="text-sm text-gray-400 mb-2">Entry</h4>
              <div className="text-white">Price: {trade.entryPrice}</div>
              <div className="text-gray-400 text-sm">SL: {trade.stopLoss}</div>
              <div className="text-gray-400 text-sm">TP: {trade.takeProfit}</div>
            </div>
            <div>
              <h4 className="text-sm text-gray-400 mb-2">Exit</h4>
              <div className="text-white">Price: {trade.exitPrice || 'N/A'}</div>
              <div className="text-gray-400 text-sm">
                Duration: {Math.round((new Date(trade.exitTime).getTime() - new Date(trade.entryTime).getTime()) / 60000)}m
              </div>
            </div>
          </div>

          {/* Decision Reasoning */}
          <div>
            <h4 className="text-sm text-gray-400 mb-2">Why Trade Was Taken</h4>
            <p className="text-white text-sm bg-gray-800 p-3 rounded">
              {trade.decisionReasoning || 'No reasoning recorded'}
            </p>
          </div>

          {/* Layer Decision Timeline */}
          {(trade.layer1Decision || trade.layer2Decision || trade.layer3Decision || trade.layer4Decision || trade.layer5Decision) && (
            <div>
              <h4 className="text-sm text-gray-400 mb-2">Layer-by-Layer Decision Trail</h4>
              <TradeDecisionTimeline trade={trade} />
            </div>
          )}

          {/* Win Pattern (if available) */}
          {highlightWinPatterns && trade.winPattern && (
            <div className="bg-green-900/10 border border-green-500/30 rounded p-3">
              <h4 className="text-green-400 font-medium mb-2 flex items-center gap-2">
                <Lightbulb className="w-4 h-4" />
                Success Pattern
              </h4>
              <p className="text-gray-300 text-sm">
                {JSON.stringify(trade.winPattern)}
              </p>
            </div>
          )}

          {/* Loss Forensics (if available) */}
          {highlightForensics && trade.lossForensics && (
            <div className="bg-red-900/10 border border-red-500/30 rounded p-3">
              <h4 className="text-red-400 font-medium mb-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Loss Analysis
              </h4>
              <div className="text-gray-300 text-sm space-y-2">
                {trade.lossForensics.lossType && (
                  <div>
                    <span className="text-gray-400">Type:</span> {trade.lossForensics.lossType}
                  </div>
                )}
                {trade.lossForensics.primaryMistake && (
                  <div>
                    <span className="text-gray-400">Primary Mistake:</span> {trade.lossForensics.primaryMistake}
                  </div>
                )}
                {trade.lossForensics.preventionRule && (
                  <div className="mt-2 text-yellow-400">
                    <span className="text-gray-400">Prevention:</span> {trade.lossForensics.preventionRule}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Key Learnings */}
          {trade.keyLearnings && trade.keyLearnings.length > 0 && (
            <div>
              <h4 className="text-sm text-gray-400 mb-2">Key Learnings</h4>
              <ul className="space-y-1">
                {trade.keyLearnings.map((learning: string, idx: number) => (
                  <li key={idx} className="text-sm text-gray-300 flex items-start gap-2">
                    <span className="text-blue-400 mt-0.5">•</span>
                    {learning}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// LLM Analysis View Component
function LLMAnalysisView({ analysis }: any) {
  return (
    <div className="space-y-6">
      {/* Overall Assessment */}
      <div className="bg-purple-900/20 border border-purple-500/30 rounded-lg p-4">
        <h3 className="text-purple-400 font-semibold mb-2 flex items-center gap-2">
          <Brain className="w-5 h-5" />
          Overall Assessment
        </h3>
        <p className="text-white">{analysis.overallAssessment}</p>
      </div>

      {/* Strengths & Weaknesses */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-green-900/10 border border-green-500/30 rounded-lg p-4">
          <h4 className="text-green-400 font-medium mb-3 flex items-center gap-2">
            <CheckCircle className="w-4 h-4" />
            Strengths Identified
          </h4>
          <ul className="space-y-2">
            {analysis.strengthsIdentified?.map((strength: string, idx: number) => (
              <li key={idx} className="text-sm text-gray-300 flex items-start gap-2">
                <span className="text-green-400 mt-0.5">✓</span>
                {strength}
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-red-900/10 border border-red-500/30 rounded-lg p-4">
          <h4 className="text-red-400 font-medium mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Weaknesses Identified
          </h4>
          <ul className="space-y-2">
            {analysis.weaknessesIdentified?.map((weakness: string, idx: number) => (
              <li key={idx} className="text-sm text-gray-300 flex items-start gap-2">
                <span className="text-red-400 mt-0.5">!</span>
                {weakness}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Strategic Recommendations */}
      <div className="bg-blue-900/10 border border-blue-500/30 rounded-lg p-4">
        <h4 className="text-blue-400 font-medium mb-3 flex items-center gap-2">
          <Target className="w-4 h-4" />
          Strategic Recommendations
        </h4>
        <ul className="space-y-2">
          {analysis.strategicRecommendations?.map((rec: string, idx: number) => (
            <li key={idx} className="text-sm text-gray-300 flex items-start gap-2">
              <span className="text-blue-400 mt-0.5">→</span>
              {rec}
            </li>
          ))}
        </ul>
      </div>

      {/* Next Session Focus */}
      <div className="bg-yellow-900/10 border border-yellow-500/30 rounded-lg p-4">
        <h4 className="text-yellow-400 font-medium mb-3 flex items-center gap-2">
          <Lightbulb className="w-4 h-4" />
          Next Session Focus
        </h4>
        <ul className="space-y-2">
          {analysis.nextSessionFocus?.map((focus: string, idx: number) => (
            <li key={idx} className="text-sm text-gray-300 flex items-start gap-2">
              <span className="text-yellow-400 mt-0.5">•</span>
              {focus}
            </li>
          ))}
        </ul>
      </div>

      {/* Confidence Calibration */}
      {analysis.confidenceCalibrationAdvice && (
        <div className="bg-gray-750 rounded-lg p-4">
          <h4 className="text-gray-300 font-medium mb-2">Confidence Calibration Advice</h4>
          <p className="text-gray-400 text-sm">{analysis.confidenceCalibrationAdvice}</p>
        </div>
      )}

      {/* Improvement Potential */}
      {analysis.estimatedImprovementPotential && (
        <div className="bg-gray-750 rounded-lg p-4">
          <h4 className="text-gray-300 font-medium mb-2">Estimated Improvement Potential</h4>
          <p className="text-gray-400 text-sm">{analysis.estimatedImprovementPotential}</p>
        </div>
      )}
    </div>
  );
}

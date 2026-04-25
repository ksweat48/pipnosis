import { supabase } from '../lib/supabase';
import { forecastEngine, MarketConditions } from './forecast-engine';
import { goalSessionManager } from './goal-session-manager';
import { marketScheduleService } from './market-schedule-service';
import { alphaTradeExecutor } from './alpha-trade-executor';
import { normalizeTimeframeToDb } from '../utils/timeframe-utils';
import { getDefaultWatchlist } from '../config/watchlist';
import { scanningStateMachine } from './scanning-state-machine';
import { weekendProtectionService } from './weekend-protection-service';
import { multiSymbolRanker, type SymbolScore } from './multi-symbol-ranker';
import { alphaOmegaOrchestrator, type FullMarketState } from './alpha-omega-orchestrator';
import { sharedIntelligenceCoordinator } from './shared-intelligence-coordinator';
import { computeOmegaSensors, type OmegaSensors } from './omega-sensors';
import type { TraderScore } from './ai-identity';
import type { MarketSnapshotData } from './market-snapshot-cache';
import { alphaThoughtStream } from './alpha-thought-stream';
import { creditValidationService } from './credit-validation-service';
import { systemReadinessRegistry } from './system-readiness-registry';
import type { TradeSignal } from '../types/strategy';
import { createTradeContext } from '../utils/tradeMath';
import { resolveExecutionMode } from './execution-mode-resolver';

/**
 * Concurrent execution helper with concurrency limit
 * Prevents overwhelming resources while maximizing throughput
 */
async function executeWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number = 10
): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<void>[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const promise = Promise.resolve().then(() => task()).then(result => {
      results[i] = result;
    });

    executing.push(promise);

    if (executing.length >= limit) {
      await Promise.race(executing);
      executing.splice(executing.findIndex(p => p === promise), 1);
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * ✅ SSOT COMPLIANCE: Removed position sizing imports
 * Position sizing is now handled exclusively by ProfessionalRiskManager at execution layer
 * Removed: calculatePositionSize, getCurrencyPipInfo, calculatePipDistance, calculateDollarPerPip,
 *          getPositionSizeMultiplier, positionSafetyValidator, getRiskPercentage
 */

export interface SessionConfig {
  starting_balance: number;
  risk_mode: 'conservative' | 'moderate' | 'aggressive';
  goal_context?: {
    goal_type: string;
    target_amount: number;
    session_duration: number;
  };
  current_profit?: number;
}

export interface ScanResult {
  symbol: string;
  hasValidSetup: boolean;
  setupType?: string;
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
  confidence?: number;
  reasoning?: string;
  marketConditions: MarketConditions;
  alphaDecision?: any;
  // SSOT Snapshot metadata (Issue #2 fix)
  snapshotTimestamp?: number;
  snapshotPrice?: number;
  snapshotHash?: string;
}

// Trade execution delegated to alphaTradeExecutor (SSOT)

class GoalScanner {
  async scanMarket(sessionId: string, userId: string): Promise<ScanResult[]> {
    const scanStartTime = Date.now();

    try {
      // STEP 0: Clear old thoughts and prepare for new scan
      await alphaThoughtStream.clearScanThoughts(sessionId);

      // STEP 0.5: CCIP-BOOT-ORDER-2026-04-02 — Await SystemReadinessRegistry hard gate.
      // Replaces the former ad-hoc waitForInitialPriceData() polling loop.
      // The registry's 'price-poller' gate is resolved by PricePollingCoordinator on its
      // first successful fetch (self-registration).  If the gate does not resolve within
      // the registry's configured timeout (8 s) the scan proceeds with a logged warning —
      // the 4-tier freshness fallback in trade-execution-freshness-gate.ts remains as a
      // downstream safety net for any individual symbol that still lacks a price.
      await systemReadinessRegistry.awaitReady(['price-poller']);

      // STEP 1: Check scanning timing permissions
      const scanPermission = await scanningStateMachine.canScanNow(sessionId);

      if (!scanPermission.allowed) {
        console.log(`[Goal Scanner] ⏸️  Scanning blocked: ${scanPermission.message}`);

        // Add AI message explaining why scanning is blocked
        await goalSessionManager.addAIMessage(
          sessionId,
          userId,
          scanPermission.message,
          {
            scanningState: scanPermission.status,
            reason: scanPermission.reason,
            secondsRemaining: scanPermission.secondsRemaining
          },
          'warning'
        );

        return [];
      }

      console.log(`[Goal Scanner] ✅ Scanning allowed: ${scanPermission.message}`);

      // STEP 1.5: Check if session is credit blocked
      const isCreditBlocked = await creditValidationService.isSessionCreditBlocked(sessionId);
      if (isCreditBlocked) {
        console.log(`[Goal Scanner] 🔒 Session is credit blocked - cannot generate new signals`);

        await goalSessionManager.addAIMessage(
          sessionId,
          userId,
          'Session blocked: A previous credit deduction failed. Please resolve the credit issue to continue scanning.',
          { creditBlocked: true },
          'warning'
        );

        return [];
      }

      const session = await supabase
        .from('goal_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (session.error || !session.data) {
        console.error('Session not found:', session.error);
        return [];
      }

      // STEP 2: Filter watchlist by open markets
      const fullWatchlist = session.data.watchlist || getDefaultWatchlist();
      const marketCheck = weekendProtectionService.canScanAnySymbol(fullWatchlist);

      if (!marketCheck.allowed) {
        console.log(`[Goal Scanner] 🛡️ No markets open for scanning`);

        await goalSessionManager.addAIMessage(
          sessionId,
          userId,
          `🛡️ All markets closed. Trading resumes Sunday 5:00 PM EST.`,
          {
            allMarketsClosed: true,
            closedSymbols: marketCheck.closedSymbols
          },
          'warning'
        );

        return [];
      }

      // Filter watchlist to only open markets
      const watchlist = marketCheck.openSymbols;
      const closedSymbols = marketCheck.closedSymbols;

      // SSOT: Update active_pairs_count in database (real-time count of scannable pairs)
      await supabase
        .from('goal_sessions')
        .update({
          active_pairs_count: watchlist.length,
          last_pairs_update: new Date().toISOString()
        })
        .eq('id', sessionId);

      console.log(`[Goal Scanner] 📊 Active pairs count updated: ${watchlist.length} scannable pair(s)`);

      // Add market status message if some symbols are closed
      if (closedSymbols.length > 0) {
        const cryptoOnly = watchlist.every(s => ['BTCUSD', 'ETHUSD'].includes(s));

        console.log(`[Goal Scanner] 🕒 ${closedSymbols.length} symbols closed. Scanning ${watchlist.length} open markets (${cryptoOnly ? 'Crypto only' : 'Mixed'}).`);

        let marketMessage = '';
        if (cryptoOnly) {
          const dbMarketStatus = await marketScheduleService.getMarketStatus();
          const dbHoliday = await marketScheduleService.isHoliday();
          if (dbMarketStatus.status === 'holiday' && dbHoliday) {
            marketMessage = `📊 Forex markets closed for ${dbHoliday.name}. Scanning crypto markets only (${watchlist.join(', ')}). Note: Crypto has wider spreads and higher volatility.`;
          } else if (dbMarketStatus.status === 'early_close' && dbHoliday) {
            marketMessage = `📊 Forex markets closed early - ${dbHoliday.name}. Scanning crypto markets only (${watchlist.join(', ')}). Note: Crypto has wider spreads and higher volatility.`;
          } else {
            marketMessage = `📊 Forex markets closed for weekend. Scanning crypto markets only (${watchlist.join(', ')}). Note: Crypto has wider spreads and higher volatility during forex closed hours.`;
          }
        } else {
          marketMessage = `📊 Scanning ${watchlist.length} open markets. ${closedSymbols.length} symbols temporarily unavailable.`;
        }

        await goalSessionManager.addAIMessage(
          sessionId,
          userId,
          marketMessage,
          {
            openSymbols: watchlist,
            closedSymbols: closedSymbols,
            cryptoOnly
          },
          'info'
        );
      }

      console.log(`[Goal Scanner] 📊 Ranking ${watchlist.length} symbols by opportunity quality...`);

      const rankings: SymbolScore[] = await multiSymbolRanker.rankSymbols(watchlist);

      // Filter to only GOOD or better symbols (score ≥65)
      const qualitySymbols = rankings.filter(r => r.totalScore >= 65);

      console.log(`[Goal Scanner] Symbol Rankings (raw scores):`);
      rankings.forEach((rank, idx) => {
        console.log(`  ${idx + 1}. ${rank.symbol}: total=${rank.totalScore}/100 trend=${rank.trendStrength} vol=${rank.volatilityHealth} structure=${rank.structureClarity} manip=${rank.manipulationRisk} momentum=${rank.intradayMomentum}`);
      });

      console.log(`[Goal Scanner] ✅ Filtered to ${qualitySymbols.length} quality symbols (score ≥65)`);

      if (qualitySymbols.length === 0) {
        console.log('[Goal Scanner] ⚠️ No quality symbols meet criteria - scanning all symbols as fallback');
      }

      // Use quality-filtered symbols, or fall back to full watchlist if none pass
      const symbolsToScan = qualitySymbols.length > 0 ? qualitySymbols.map(r => r.symbol) : watchlist;
      const results: ScanResult[] = [];

      console.log(`[Goal Scanner] 🔍 Scanning ${symbolsToScan.length} symbols concurrently (10 parallel limit)...`);

      // Emit thought: Filtering results
      if (qualitySymbols.length > 0) {
        await alphaThoughtStream.emitFiltering(
          sessionId,
          userId,
          qualitySymbols.length,
          watchlist.length,
          symbolsToScan
        );
      }

      // Execute symbol analysis concurrently with 10-parallel limit
      const scanTasks = symbolsToScan.map(
        (symbol) => () => this.scanSymbol(symbol, session.data, userId)
      );

      const scanResults = await executeWithConcurrencyLimit(scanTasks, 10);

      for (let i = 0; i < scanResults.length; i++) {
        const scanResult = scanResults[i];
        const symbol = symbolsToScan[i];
        results.push(scanResult);

        // Emit Omega Council votes thought if Alpha analyzed this symbol
        if (scanResult.alphaDecision?.omega_votes && scanResult.hasValidSetup) {
          await alphaThoughtStream.emitOmegaVoting(
            sessionId,
            userId,
            symbol,
            scanResult.alphaDecision.omega_votes
          );
        }
      }

      console.log(`[Goal Scanner] ✅ Concurrent scan complete: ${scanResults.length} symbols analyzed (${Date.now() - scanStartTime}ms)`);

      const lastScanTime = new Date();
      const nextScanTime = new Date(lastScanTime.getTime() + (session.data.scan_interval_seconds || 300) * 1000);

      await goalSessionManager.updateScanTime(sessionId, lastScanTime, nextScanTime);

      const validSetups = results.filter(r => r.hasValidSetup);
      let tradeExecuted = false;

      // STEP 3: Execute valid setups — up to max_concurrent_trades simultaneously
      if (validSetups.length > 0) {
        // SSOT: max_concurrent_trades is authoritative — written at session creation
        const maxTrades: number = session.data.max_concurrent_trades ?? 1;

        // Sort by confidence descending and cap at the session's authorised limit
        const sortedSetups = [...validSetups].sort(
          (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)
        );
        const selectedSetups = sortedSetups.slice(0, maxTrades);

        console.log(
          `[Goal Scanner] Found ${validSetups.length} valid setup(s). ` +
          `Session allows max ${maxTrades} concurrent trade(s). ` +
          `Executing top ${selectedSetups.length}: ` +
          selectedSetups.map(s => `${s.symbol}(${s.confidence}%)`).join(', ')
        );

        // Emit comparison thought when multiple setups are available
        if (validSetups.length > 1) {
          const candidates = validSetups.map(s => ({
            symbol: s.symbol,
            confidence: s.confidence || 0,
            action: (s.alphaDecision?.action || 'NO_TRADE') as 'BUY' | 'SELL' | 'WAIT' | 'NO_TRADE',
            score: s.confidence || 0
          }));
          await alphaThoughtStream.emitComparing(sessionId, userId, candidates);
        }

        // Emit analyzing-entry thought for the top candidate
        const topSetup = selectedSetups[0];
        if (topSetup?.alphaDecision) {
          await alphaThoughtStream.emitAnalyzingEntry(
            sessionId, userId, topSetup.symbol, topSetup.confidence || 0
          );
        }

        // Evaluate all selected setups (sequential — each evaluateSignal is lightweight)
        const signalPairs: Array<{ signal: TradeSignal; alphaDecision: any; setup: ScanResult }> = [];
        for (const setup of selectedSetups) {
          const result = await this.evaluateSignal(sessionId, setup, session.data);
          if (result) signalPairs.push({ ...result, setup });
        }

        // Emit final-decision thought for each selected pair
        for (const { setup } of signalPairs) {
          await alphaThoughtStream.emitFinalDecision(sessionId, userId, {
            selected: true,
            symbol: setup.symbol,
            action: setup.alphaDecision?.action as 'BUY' | 'SELL' | 'WAIT' | 'NO_TRADE',
            confidence: setup.confidence,
            entry: setup.entry,
            reasoning: `Top-${maxTrades} selection by confidence — ${setup.entry?.toFixed(5)}`
          });
        }

        // SSOT: Resolve execution mode per signal (respects Alpha's entry_mode for WAIT/PULLBACK),
        // then execute each. Sequential to allow async mode resolution per pair.
        const executionResults: Array<{ success: boolean; error?: string; blockReason?: string; message?: string; isMonitoring?: boolean }> = [];
        for (const { alphaDecision, setup } of signalPairs) {
          const tradeContextResult = createTradeContext(setup.symbol);
          if (!tradeContextResult.success || !tradeContextResult.context) {
            console.error(`[Goal Scanner] Failed to create TradeContext for ${setup.symbol}: ${tradeContextResult.error}`);
            executionResults.push({
              success: false,
              error: `TradeContext creation failed: ${tradeContextResult.error}`,
              blockReason: 'HARD-BLOCK: TradeContext unavailable'
            });
            continue;
          }

          const { executionMode, monitorRequiredDetails } = await resolveExecutionMode(
            { ...alphaDecision, symbol: setup.symbol },
            userId,
            sessionId
          );

          // CCIP-2026-0429A: Alpha found a deferred setup but user's monitor is off.
          if (executionMode === 'MONITOR_REQUIRED' && monitorRequiredDetails) {
            console.log(`[Goal Scanner] CCIP-2026-0429A: MONITOR_REQUIRED for ${setup.symbol} — writing upgrade prompt record`);
            try {
              await supabase.from('alpha_decisions').insert({
                user_id: userId,
                session_id: sessionId,
                symbol: setup.symbol,
                action: 'MONITOR_REQUIRED',
                confidence: null,
                reasoning: `Alpha identified a ${monitorRequiredDetails.action} opportunity on ${setup.symbol} (${monitorRequiredDetails.confidenceTier}) requiring a deferred entry. ${monitorRequiredDetails.waitReasoning}`,
                decision_origin: 'ALPHA_WANTS_WAIT_MONITOR_REQUIRED',
                trade_executed: false,
                safety_blocked: false,
                answer_sheet: {
                  monitor_required_action: monitorRequiredDetails.action,
                  monitor_required_confidence: monitorRequiredDetails.confidenceTier,
                  monitor_required_zone_min: monitorRequiredDetails.zoneMin ?? null,
                  monitor_required_zone_max: monitorRequiredDetails.zoneMax ?? null,
                  monitor_required_reasoning: monitorRequiredDetails.waitReasoning,
                },
              });
            } catch (err) {
              console.warn('[CCIP-2026-0429A] Failed to write MONITOR_REQUIRED record (non-blocking)', err);
            }
            continue; // Skip execution
          }

          if (executionMode === 'MONITORED') {
            console.log(`[Goal Scanner] Alpha chose WAIT mode (${alphaDecision.entry_mode}) for ${setup.symbol} — creating monitored entry intent`);
          }

          const result = await alphaTradeExecutor.execute({
            decision: alphaDecision,
            tradeContext: tradeContextResult.context,
            userId,
            sessionId,
            session: session.data,
            mode: executionMode,
            snapshotTimestamp: new Date(setup.snapshotTimestamp ?? Date.now()),
          });
          executionResults.push(result);
        }

        // Process results and emit execution thoughts
        const executedTrades: Array<{ symbol: string; action: string; entry: number }> = [];
        for (let i = 0; i < executionResults.length; i++) {
          const execResult = executionResults[i];
          const { setup } = signalPairs[i];
          if (execResult.success) {
            if (execResult.isMonitoring) {
              // Alpha chose WAIT — entry intent created, autonomous monitor will execute at zone
              console.log(`[Goal Scanner] Entry intent created for ${setup.symbol} — monitoring for pullback zone`);
              tradeExecuted = true;
              await alphaThoughtStream.emitFinalDecision(sessionId, userId, {
                selected: true,
                symbol: setup.symbol,
                action: setup.alphaDecision?.action as 'BUY' | 'SELL' | 'WAIT' | 'NO_TRADE',
                confidence: setup.confidence,
                reasoning: `Waiting for pullback — will auto-execute when price reaches the zone`
              });
            } else {
              console.log(`[Goal Scanner] Trade executed: ${setup.symbol} — ${execResult.message}`);
              tradeExecuted = true;
              if (setup.alphaDecision?.action === 'BUY' || setup.alphaDecision?.action === 'SELL') {
                executedTrades.push({
                  symbol: setup.symbol,
                  action: setup.alphaDecision.action,
                  entry: setup.entry || 0
                });
                await alphaThoughtStream.emitExecution(
                  sessionId, userId, setup.symbol, setup.alphaDecision.action, setup.entry || 0
                );
              }
            }
          } else {
            console.warn(`[Goal Scanner] Signal execution failed for ${setup.symbol}: ${execResult.error}`);
            await alphaThoughtStream.emitFinalDecision(sessionId, userId, {
              selected: false,
              symbol: setup.symbol,
              action: setup.alphaDecision?.action as 'BUY' | 'SELL' | 'WAIT' | 'NO_TRADE',
              confidence: setup.confidence,
              reasoning: `Execution blocked: ${execResult.blockReason || execResult.error || 'Unknown error'}`
            });
          }
        }

        if (executedTrades.length > 0) {
          console.log(
            `[Goal Scanner] ${executedTrades.length} trade(s) opened simultaneously: ` +
            executedTrades.map(t => `${t.symbol} ${t.action}`).join(', ')
          );
        }
      } else {
        // No valid setups found - emit final decision
        await alphaThoughtStream.emitFinalDecision(sessionId, userId, {
          selected: false,
          symbol: null,
          reasoning: 'No quality setups met confidence and safety thresholds'
        });
      }

      // STEP 4: Record scan completion
      await scanningStateMachine.recordScanCompletion(sessionId, tradeExecuted);

      if (tradeExecuted) {
        console.log('[Goal Scanner] 🎉 Trade found - scanning cycle counters reset');
      } else {
        console.log('[Goal Scanner] ⏭️  Scan completed - no trades found');
      }

      // Emit thought: Scan complete
      const scanDurationMs = Date.now() - scanStartTime;

      await alphaThoughtStream.emitScanComplete(sessionId, userId, {
        tradeExecuted,
        tradesFound: validSetups.length,
        monitoringCount: 0, // WAIT removed - no monitoring mode
        scanDurationMs
      });

      // STEP 5: Add AI summary message
      await goalSessionManager.addAIMessage(
        sessionId,
        userId,
        this.generateScanSummary(results, scanPermission),
        {
          scanResults: results,
          tradeExecuted,
          sessionNumber: scanPermission.sessionNumber,
          scansRemaining: scanPermission.scansRemaining
        },
        tradeExecuted ? 'positive' : 'neutral'
      );

      return results;
    } catch (error) {
      console.error('Error scanning market:', error);
      return [];
    }
  }

  async scanSymbol(symbol: string, sessionConfig: SessionConfig, userId: string): Promise<ScanResult> {
    try {
      // ✅ SSOT FIX: Use snapshot cache instead of manual DB queries
      const timeframe = 'M15'; // Goal mode uses M15 by default
      const snapshot = await sharedIntelligenceCoordinator.getMarketSnapshot(
        symbol,
        timeframe,
        sessionConfig.risk_mode
      );

      if (!snapshot) {
        console.warn(`[Goal Scanner] ⚠️ No snapshot available for ${symbol}`);
        return {
          symbol,
          hasValidSetup: false,
          marketConditions: {
            symbol,
            volatility: 0,
            trend: 'sideways',
            volume: 0,
            momentum: 0,
            priceAction: 'insufficient_data',
          },
        };
      }

      const setup = await this.detectSetupFromSnapshot(symbol, snapshot, sessionConfig, userId);

      return setup;
    } catch (error) {
      console.error(`Error scanning ${symbol}:`, error);
      return {
        symbol,
        hasValidSetup: false,
        marketConditions: {
          symbol,
          volatility: 0,
          trend: 'sideways',
          volume: 0,
          momentum: 0,
          priceAction: 'error',
        },
      };
    }
  }

  /**
   * ✅ SSOT COMPLIANT: Uses snapshot from cache
   * Scanner and Omegas now see EXACT SAME DATA
   */
  async detectSetupFromSnapshot(
    symbol: string,
    snapshot: MarketSnapshotData,
    sessionConfig: SessionConfig,
    userId: string
  ): Promise<ScanResult> {
    // Build market conditions from snapshot
    const marketConditions: MarketConditions = {
      symbol,
      volatility: snapshot.volatility === 'high' ? 80 : snapshot.volatility === 'medium' ? 50 : 20,
      trend: snapshot.trend,
      volume: 50,
      momentum: snapshot.momentum,
      priceAction: this.analyzePriceActionFromSnapshot(snapshot),
    };

    // Basic filter using snapshot data
    const passesBasicFilter = this.passesBasicFilter(
      snapshot.price,
      snapshot.ema20,
      snapshot.ema50,
      snapshot.rsi,
      snapshot.atr.value, // Extract numeric value from ATRValue type
      marketConditions
    );

    if (!passesBasicFilter) {
      console.log(`[Goal Scanner] ❌ ${symbol}: Failed basic filter - skipping Alpha-Omega`);
      return {
        symbol,
        hasValidSetup: false,
        marketConditions,
      };
    }

    console.log(`[Goal Scanner] ✅ ${symbol}: Passed basic filter - calling Alpha-Omega...`);

    try {
      // CANDLE PRICE INTEGRITY CHECK (Fix 4 - XAUUSD $4603 vs $4758 bug)
      // The snapshot.price comes from the last stored candle close, which can be stale
      // if the candle pipeline has gaps. Compare snapshot price against realtime_prices.
      // If the gap exceeds the asset threshold, invalidate the snapshot before Alpha sees it.
      const CANDLE_INTEGRITY_THRESHOLDS: Record<string, number> = {
        XAUUSD: 20, XAGUSD: 20,
        US30: 50, NAS100: 50, SPX500: 30, UK100: 30, GER40: 30,
        BTCUSD: 300, ETHUSD: 100,
      };
      const integrityThresholdPips = CANDLE_INTEGRITY_THRESHOLDS[symbol] ?? 15;

      try {
        const { data: liveRow } = await supabase
          .from('realtime_prices')
          .select('bid, ask, broker_time')
          .eq('symbol', symbol)
          .order('broker_time', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (liveRow) {
          const livePrice = (liveRow.bid + liveRow.ask) / 2;
          const { calculatePipDistance } = await import('../utils/currencyHelpers');
          const gapPips = Math.abs(calculatePipDistance(symbol, snapshot.price, livePrice));

          if (gapPips > integrityThresholdPips) {
            console.error(
              `[Goal Scanner] 🚫 CANDLE_PRICE_INTEGRITY_FAIL: ${symbol} ` +
              `snapshot.price=${snapshot.price.toFixed(5)} vs live=${livePrice.toFixed(5)} ` +
              `(${gapPips.toFixed(1)} pips, threshold ${integrityThresholdPips} pips) — ` +
              `invalidating snapshot, skipping this scan cycle`
            );
            sharedIntelligenceCoordinator.invalidateSnapshot(symbol, 'M15');
            return {
              symbol,
              hasValidSetup: false,
              reasoning: `CANDLE_PRICE_INTEGRITY_FAIL: snapshot price ${snapshot.price.toFixed(5)} diverged ${gapPips.toFixed(1)} pips from live price ${livePrice.toFixed(5)} (threshold: ${integrityThresholdPips} pips). Snapshot invalidated — fresh data on next cycle.`,
              marketConditions,
            };
          }
        }
      } catch {
        // Non-blocking: if live price fetch fails, proceed with scan as normal
      }

      // ✅ Build FullMarketState from snapshot (NOT manual calculations)
      const marketState = this.snapshotToMarketState(snapshot);

      const mockTraderScore: TraderScore = {
        current_score: 75,
        lifetime_profit: sessionConfig.current_profit || 0,
        lifetime_loss: 0,
        streak_wins: 0,
        streak_losses: 0,
        confidence_level: 'medium',
        risk_appetite: sessionConfig.risk_mode === 'aggressive' ? 3 : sessionConfig.risk_mode === 'conservative' ? 1 : 2,
        trading_style: 'balanced',
        total_trades: 0,
        win_rate: 50
      };

      const proposedSL = snapshot.price - (snapshot.atr.value * 1.8);
      const proposedTP = snapshot.price + (snapshot.atr.value * 3.0);

      // ✅ Alpha-Omega will use SAME snapshot from cache
      // This guarantees scanner and Omegas see identical data
      const alphaDecision = await alphaOmegaOrchestrator.makeTradeDecision(
        marketState,
        mockTraderScore,
        proposedSL,
        proposedTP,
        sessionConfig.goal_context,
        userId
      );

      // ALPHA SOVEREIGNTY: Remove confidence threshold - Alpha decides
      const hasValidSetup = (alphaDecision.action === 'BUY' || alphaDecision.action === 'SELL');

      const setupType = hasValidSetup
        ? `Alpha ${alphaDecision.action} (${alphaDecision.confidence}%)`
        : 'NO_TRADE';

      return {
        symbol,
        hasValidSetup,
        setupType,
        entry: alphaDecision.entry,
        stopLoss: alphaDecision.stopLoss,
        takeProfit: alphaDecision.takeProfit,
        confidence: alphaDecision.confidence,
        reasoning: alphaDecision.reasoning,
        marketConditions,
        alphaDecision,
        // SSOT Snapshot metadata (Issue #2 fix)
        snapshotTimestamp: snapshot.createdAt,
        snapshotPrice: snapshot.price,
        snapshotHash: snapshot.snapshotHash,
      };
    } catch (error) {
      console.error(`[Goal Scanner] Alpha-Omega error for ${symbol}:`, error);
      return {
        symbol,
        hasValidSetup: false,
        reasoning: `Alpha-Omega error: ${error instanceof Error ? error.message : 'Unknown'}`,
        marketConditions,
      };
    }
  }

  /**
   * Convert MarketSnapshotData to FullMarketState
   * Adapter method to maintain compatibility with Alpha-Omega
   */
  private snapshotToMarketState(snapshot: MarketSnapshotData): FullMarketState {
    return {
      symbol: snapshot.symbol,
      price: snapshot.price,
      ema20: snapshot.ema20,
      ema50: snapshot.ema50,
      ema200: snapshot.ema200,
      rsi: snapshot.rsi,
      stochRsi: snapshot.stochRsi,
      atr: snapshot.atr.value, // Extract numeric value from ATRValue
      vwap: snapshot.vwap,
      trend: snapshot.trend,
      volatility: snapshot.volatility,
      momentum: snapshot.momentum,
      support: snapshot.support,
      resistance: snapshot.resistance,
      swingHigh: snapshot.swingHigh,
      swingLow: snapshot.swingLow,
      recentCandles: snapshot.candles, // FIX: snapshot has 'candles' not 'recentCandles'
      omegaSensors: snapshot.omegaSensors
    };
  }

  /**
   * Analyze price action from snapshot data
   */
  private analyzePriceActionFromSnapshot(snapshot: MarketSnapshotData): string {
    const candles = snapshot.recentCandles;
    if (!candles || candles.length < 3) return 'insufficient';

    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];

    const bodySize = Math.abs(lastCandle.close - lastCandle.open);
    const wickSize = lastCandle.high - lastCandle.low;
    const bodyRatio = wickSize > 0 ? bodySize / wickSize : 0;

    if (bodyRatio > 0.7) return 'strong_momentum';
    if (bodyRatio < 0.3) return 'indecision';

    const bullish = lastCandle.close > lastCandle.open;
    const prevBullish = prevCandle.close > prevCandle.open;

    if (bullish === prevBullish) return 'trending';
    return 'reversal';
  }

  private passesBasicFilter(
    price: number,
    ema20: number,
    ema50: number,
    rsi: number,
    atr: number,
    conditions: MarketConditions
  ): boolean {
    if (atr <= 0) return false;
    const atrPercent = (atr / price) * 100;
    if (atrPercent < 0.05) return false;
    if (rsi < 15 || rsi > 85) return false;
    if (conditions.priceAction === 'insufficient' || conditions.priceAction === 'error') return false;
    return true;
  }

  private buildMarketState(
    symbol: string,
    candles: any[],
    indicators: {
      ema20: number;
      ema50: number;
      ema200: number;
      vwap: number;
      atr: number;
      rsi: number;
      volatilityAnalysis: any;
      trendAnalysis: any;
    }
  ): FullMarketState {
    const currentCandle = candles[candles.length - 1];
    const price = currentCandle.close;

    const { support, resistance } = this.calculateSupportResistance(candles);
    const { swingHigh, swingLow } = this.calculateSwings(candles);

    const trend = indicators.ema20 > indicators.ema50 ? 'bull' : indicators.ema20 < indicators.ema50 ? 'bear' : 'sideways';
    const volatility = indicators.volatilityAnalysis.level;
    const momentum = indicators.trendAnalysis.confidence;

    const sensors: OmegaSensors = {
      sh: swingHigh,
      sl: swingLow,
      bos: 'none',
      cho: 'none',
      eqh: 0,
      eql: 0,
      vol_ratio: 1,
      vol_trend: 'stable',
      vol_spike: false,
      cvd: 0,
      rsi: indicators.rsi,
      macd: 0,
      macd_sig: 0,
      momentum,
      stoch: { k: 50, d: 50 },
      pat: { engulf: false, pin: false, doji: false, inside: false },
      mic: { wick_ratio: 0, body_size: 0, gap: false, trap: 'none' },
      ema20: indicators.ema20,
      ema50: indicators.ema50,
      ema200: indicators.ema200,
      atr: indicators.atr,
      vwap: indicators.vwap
    };

    return {
      symbol,
      price,
      ema20: indicators.ema20,
      ema50: indicators.ema50,
      ema200: indicators.ema200,
      rsi: indicators.rsi,
      stochRsi: 50,
      atr: indicators.atr,
      vwap: indicators.vwap,
      trend,
      volatility,
      momentum,
      support,
      resistance,
      swingHigh,
      swingLow,
      recentCandles: candles.slice(-30),
      omegaSensors: sensors
    };
  }

  private calculateSupportResistance(candles: any[]): { support: number[]; resistance: number[] } {
    const recentCandles = candles.slice(-20);
    const lows = recentCandles.map(c => c.low).sort((a: number, b: number) => a - b);
    const highs = recentCandles.map(c => c.high).sort((a: number, b: number) => b - a);

    return {
      support: lows.slice(0, 3),
      resistance: highs.slice(0, 3)
    };
  }

  private calculateSwings(candles: any[]): { swingHigh: number; swingLow: number } {
    const recentCandles = candles.slice(-10);
    let swingHigh = -Infinity;
    let swingLow = Infinity;

    for (const candle of recentCandles) {
      if (candle.high > swingHigh) swingHigh = candle.high;
      if (candle.low < swingLow) swingLow = candle.low;
    }

    return { swingHigh, swingLow };
  }

  private calculateRSI(prices: number[], period: number): number {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
      const change = (prices[i] || 0) - (prices[i - 1] || 0);
      if (change > 0) gains += change;
      else losses -= change;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  // REMOVED: getRiskThreshold - User exposure level no longer overrides LLM confidence
  // LLM autonomously determines minimum confidence based on:
  // - Current rank (Bronze, Silver, Gold, Alpha, Omega)
  // - Win/loss streak
  // - Pattern history
  // - Market conditions
  // - Reward engine state

  calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1] || 0;

    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;

    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  calculateVWAP(candles: any[], lookbackPeriod: number = 20): number {
    // Use only the most recent candles for VWAP to keep it responsive
    const relevantCandles = candles.slice(-lookbackPeriod);
    let totalVolume = 0;
    let totalPV = 0;

    for (const candle of relevantCandles) {
      const typical = (candle.high + candle.low + candle.close) / 3;
      const volume = candle.volume || 1;
      totalPV += typical * volume;
      totalVolume += volume;
    }

    return totalVolume > 0 ? totalPV / totalVolume : 0;
  }

  calculateATR(candles: any[], period: number = 14): number {
    if (candles.length < period) return 0.001;

    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trs.push(tr);
    }

    return trs.slice(-period).reduce((sum, tr) => sum + tr, 0) / period;
  }

  determineTrend(candles: any[]): 'bullish' | 'bearish' | 'sideways' {
    if (!candles || candles.length < 20) return 'sideways';

    const prices = candles.map(c => c.close);
    const firstPrice = prices[0];
    const lastPrice = prices[prices.length - 1];
    const change = ((lastPrice - firstPrice) / firstPrice) * 100;

    if (change > 0.5) return 'bullish';
    if (change < -0.5) return 'bearish';
    return 'sideways';
  }

  analyzePriceAction(candles: any[]): string {
    if (!candles || candles.length < 3) return 'insufficient';

    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];

    const bodySize = Math.abs(lastCandle.close - lastCandle.open);
    const wickSize = lastCandle.high - lastCandle.low;
    const bodyRatio = bodySize / wickSize;

    if (bodyRatio > 0.7) return 'strong_momentum';
    if (bodyRatio < 0.3) return 'indecision';

    const bullish = lastCandle.close > lastCandle.open;
    const prevBullish = prevCandle.close > prevCandle.open;

    if (bullish === prevBullish) return 'trending';
    return 'reversal';
  }

  generateScanSummary(results: ScanResult[], scanPermission?: any): string {
    const validSetups = results.filter(r => r.hasValidSetup);

    // Add scanning cycle context
    let cycleInfo = '';
    if (scanPermission?.sessionNumber && scanPermission?.scansRemaining !== undefined) {
      cycleInfo = ` [Session ${scanPermission.sessionNumber}/2, ${scanPermission.scansRemaining} scans remaining]`;
    }

    if (validSetups.length > 0) {
      const setupList = validSetups.map(s => `${s.symbol} (${s.setupType}, ${s.confidence}%)`).join(', ');
      return `Found ${validSetups.length} valid setup${validSetups.length > 1 ? 's' : ''}: ${setupList}. Preparing trade signals...${cycleInfo}`;
    }

    const highConfidenceForecasts = results.filter(r => r.marketConditions.momentum > 60);
    if (highConfidenceForecasts.length > 0) {
      return `No valid setups yet, but monitoring ${highConfidenceForecasts[0].symbol} — setup potentially forming soon. Will re-scan shortly.${cycleInfo}`;
    }

    return `Markets currently quiet across watchlist. No valid setups meeting risk criteria. Continuing scheduled scans...${cycleInfo}`;
  }

  async evaluateSignal(
    sessionId: string,
    scanResult: ScanResult,
    sessionConfig: SessionConfig
  ): Promise<{ signal: TradeSignal; alphaDecision?: any } | null> {
    if (!scanResult.hasValidSetup) return null;

    const direction: 'buy' | 'sell' = scanResult.setupType?.toUpperCase().includes('SELL') ? 'sell' : 'buy';

    /**
     * ✅ SSOT COMPLIANCE FIX: Position sizing REMOVED from scanner
     *
     * Position sizing deferred to execution layer where ProfessionalRiskManager
     * applies all 7 layers of risk protection:
     * - Kelly Criterion optimization
     * - EV Gating validation
     * - Volatility adjustments
     * - Correlation risk checks
     * - Market condition risk modifiers
     * - Progressive risk scaling
     * - PCVL validation
     *
     * Scanner's job: Identify trade opportunities
     * Execution layer's job: Size positions with full risk context
     */
    const stopDistance = Math.abs(scanResult.entry! - scanResult.stopLoss!);
    const riskReward = Math.abs(scanResult.takeProfit! - scanResult.entry!) / stopDistance;

    console.log('[Goal Scanner] ✅ Position sizing deferred to ProfessionalRiskManager');
    console.log(`  Symbol: ${scanResult.symbol}`);
    console.log(`  R:R Ratio: ${riskReward.toFixed(2)}:1`);
    console.log(`  Risk mode: ${sessionConfig.risk_mode}`);

    return {
      signal: {
        sessionId,
        symbol: scanResult.symbol,
        direction,
        entryPrice: scanResult.entry!,
        stopLoss: scanResult.stopLoss!,
        takeProfit: scanResult.takeProfit!,
        positionSize: 0, // ✅ PLACEHOLDER: Actual sizing at execution via ProfessionalRiskManager
        confidence: scanResult.confidence!,
        setupType: scanResult.setupType!,
        reasoning: scanResult.reasoning!,
        riskReward,
        expectedProfit: 0, // ✅ PLACEHOLDER: Calculated with actual position size at execution
        // SSOT Snapshot metadata (Issue #2 fix) - passed from scanResult
        snapshotTimestamp: scanResult.snapshotTimestamp || Date.now(),
        snapshotPrice: scanResult.snapshotPrice || scanResult.entry!,
        snapshotHash: scanResult.snapshotHash || '',
      },
      alphaDecision: scanResult.alphaDecision,
    };
  }

  /**
   * PHASE 2: Removed calculateRiskAmount() - unused dead code that bypassed ProfessionalRiskManager
   * Risk calculations should always go through ProfessionalRiskManager.evaluateTrade()
   */
}

export const goalScanner = new GoalScanner();

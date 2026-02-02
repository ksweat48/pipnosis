/**
 * Autonomous Entry Intent Monitor - Netlify Scheduled Function
 *
 * Runs every minute to monitor all active entry intents server-side
 * Eliminates browser tab throttling by executing in the cloud
 * Enables true "set and forget" entry monitoring
 *
 * Schedule: Every 1 minute (defined in netlify.toml)
 *
 * CCIP COMPLIANCE (2026-02-03): Uses AlphaTradeExecutor directly (SSOT)
 * Removed SSOTTradeExecutionAdapter phantom dependency
 * Integrated with NotificationCoordinator for modal popup triggers
 */

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { getCurrencyPipInfo, convertLotToPositionSize } from '../../src/utils/currencyHelpers';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface IntentForMonitoring {
  intent_id: string;
  user_id: string;
  session_id: string;
  symbol: string;
  intent_type: string;
  urgency: string;
  direction: string;
  entry_zone_min: number;
  entry_zone_max: number;
  timeout_at: string | null;
  max_wait_seconds: number;
  timeout_action: string;
  invalidation_price: number | null;
  alpha_confidence: number;
  alpha_reasoning: string | null;
  market_context: any;
  status: string;
  created_at: string;
  execution_mode: string;
  server_heartbeat: string | null;
  urgency_phase: number | null;
  zone_tolerance_pips: number | null;
  time_adjusted_threshold: number | null;
  zone_type: string | null;
  micro_regime_used: string | null;
  primary_zone_min: number | null;
  primary_zone_max: number | null;
  secondary_zone_min: number | null;
  secondary_zone_max: number | null;
  zone_reachability_distance_pips: number | null;
  position_size_multiplier: number | null;
  last_checked_at: string | null;
  current_price: number | null;
  price_updated_at: string | null;
  edge_loss_modal_triggered_at: string | null;
  edge_loss_modal_response: string | null;
  edge_loss_modal_response_at: string | null;
}

export const handler: Handler = async (event, context) => {
  const startTime = Date.now();
  console.log('[Entry Monitor] 🚀 Starting scheduled check...');

  // Health tracking metrics
  let totalIntents = 0;
  let successCount = 0;
  let errorCount = 0;
  let executedCount = 0;
  let abandonedCount = 0;
  let stalePriceCount = 0;
  const errors: any[] = [];

  try {
    // Get all active entry intents that need server monitoring
    const { data: activeIntents, error } = await supabase.rpc('get_intents_for_server_monitoring');

    if (error) {
      console.error('[Entry Monitor] ❌ Error fetching intents:', error);
      errors.push({ context: 'fetch_intents', error: error.message });

      // Log failed health check
      await logHealthMetrics(0, 0, 1, 0, 0, 0, Date.now() - startTime, errors);

      return {
        statusCode: 500,
        body: JSON.stringify({ error: error.message })
      };
    }

    totalIntents = activeIntents?.length || 0;

    if (!activeIntents || activeIntents.length === 0) {
      console.log('[Entry Monitor] ✓ No active intents to monitor');

      // Log successful health check (even with 0 intents)
      await logHealthMetrics(0, 0, 0, 0, 0, 0, Date.now() - startTime, []);

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No active intents',
          processed: 0,
          duration: Date.now() - startTime
        })
      };
    }

    console.log(`[Entry Monitor] 📊 Processing ${activeIntents.length} active intents`);

    const results = [];
    let waitingCount = 0;

    // Process each intent
    for (const intent of activeIntents as IntentForMonitoring[]) {
      try {
        console.log(`[Entry Monitor] Processing intent ${intent.intent_id.substring(0, 8)} for ${intent.symbol}`);

        // Update heartbeat at start
        await supabase.rpc('update_intent_server_heartbeat', {
          p_intent_id: intent.intent_id,
          p_instance_id: 'netlify-entry-monitor'
        });

        // Check if price data is stale
        if (!intent.current_price || !intent.price_updated_at) {
          console.log(`[Entry Monitor] ⚠️ No price data for ${intent.symbol}, skipping`);
          await updateServerState(intent.intent_id, intent.user_id, null, null, 'no_price_data', 'Price data unavailable');
          stalePriceCount++;
          waitingCount++;
          continue;
        }

        const priceAge = Date.now() - new Date(intent.price_updated_at).getTime();
        if (priceAge > 120000) {
          console.log(`[Entry Monitor] ⚠️ Stale price data for ${intent.symbol} (${Math.round(priceAge / 1000)}s old)`);
          await updateServerState(intent.intent_id, intent.user_id, intent.current_price, null, 'stale_price', 'Price data too old');
          stalePriceCount++;
          waitingCount++;
          continue;
        }

        // Check for timeout expiration
        if (intent.timeout_at && new Date(intent.timeout_at) < new Date()) {
          console.log(`[Entry Monitor] ⏰ Intent ${intent.intent_id.substring(0, 8)} expired`);
          await handleTimeout(intent);
          abandonedCount++;
          successCount++;
          results.push({
            intentId: intent.intent_id,
            symbol: intent.symbol,
            success: true,
            action: 'timeout'
          });
          continue;
        }

        // Check invalidation price (stop loss crossed)
        if (intent.invalidation_price) {
          const isInvalidated = intent.direction === 'long'
            ? intent.current_price <= intent.invalidation_price
            : intent.current_price >= intent.invalidation_price;

          if (isInvalidated) {
            console.log(`[Entry Monitor] 🚫 Intent ${intent.intent_id.substring(0, 8)} invalidated (price crossed stop loss)`);
            await abandonIntent(intent.intent_id, 'Price crossed invalidation level');
            abandonedCount++;
            successCount++;
            results.push({
              intentId: intent.intent_id,
              symbol: intent.symbol,
              success: true,
              action: 'invalidated'
            });
            continue;
          }
        }

        // Calculate time-based urgency and EQS threshold using SSOT database function
        const createdAt = new Date(intent.created_at);
        const minutesElapsed = (Date.now() - createdAt.getTime()) / 60000;

        // Determine style from intent or default to MICRO_INTRADAY
        const style = intent.market_context?.style || 'MICRO_INTRADAY';

        // SSOT: Get time thresholds from database function
        const { data: thresholdsData, error: thresholdsError } = await supabase.rpc('get_entry_time_thresholds', {
          p_trade_style: style
        });

        if (thresholdsError || !thresholdsData || thresholdsData.length === 0) {
          console.error(`[Entry Monitor] ❌ Failed to get thresholds for ${style}:`, thresholdsError);
          // Continue with fallback hardcoded thresholds
          waitingCount++;
          continue;
        }

        const thresholds = thresholdsData[0];

        // CRITICAL FIX: Calculate phase FIRST before any zone checks
        // This ensures edge loss check uses the correct tolerance for the current phase
        let urgencyPhase: 1 | 2 | 3 = 1;
        let zoneTolerancePips = thresholds.zone_tolerance_phase1;
        let timeAdjustedThreshold = thresholds.eqs_threshold_phase1;

        // Determine actual phase based on elapsed time FIRST
        if (minutesElapsed >= thresholds.eqs_phase3_min) {
          urgencyPhase = 3;
          zoneTolerancePips = thresholds.zone_tolerance_phase3;
          timeAdjustedThreshold = thresholds.eqs_threshold_phase3;
        } else if (minutesElapsed >= thresholds.eqs_phase2_min) {
          urgencyPhase = 2;
          zoneTolerancePips = thresholds.zone_tolerance_phase2;
          timeAdjustedThreshold = thresholds.eqs_threshold_phase2;
        }

        // NOW check if price is in zone using the CORRECT phase tolerance
        const isInZone = checkPriceInZone(intent, intent.current_price, zoneTolerancePips);

        console.log(`[Entry Monitor] ${intent.symbol} Phase ${urgencyPhase}: elapsed=${minutesElapsed.toFixed(1)}min, tolerance=${zoneTolerancePips}p, inZone=${isInZone}`);

        // PHASE 3 TIMEOUT ABANDONMENT: If max wait exceeded AND price is outside zone, abandon immediately
        // Per CCIP: Trades degrade intelligently - they do not silently hang forever
        // User requirement: Abandon when time expires, reset state, allow manual rescan
        if (minutesElapsed >= thresholds.max_wait_min && !isInZone) {
          console.log(`[Entry Monitor] ⏰ ABANDONING ${intent.symbol}: Max wait ${thresholds.max_wait_min}min exceeded and price never reached zone`);
          console.log(`[Entry Monitor] Time elapsed: ${minutesElapsed.toFixed(1)}min | Phase ${urgencyPhase} | Tolerance: ${zoneTolerancePips} pips`);
          console.log(`[Entry Monitor] Price: ${intent.current_price} | Zone: ${intent.entry_zone_min}-${intent.entry_zone_max}`);
          console.log(`[Entry Monitor] Reason: Entry opportunity expired - price movement did not favor entry`);

          try {
            // Step 1: Mark intent as expired
            await supabase
              .from('entry_intents')
              .update({
                status: 'expired_no_entry',
                canceled_at: new Date().toISOString(),
                canceled_reason: `Max wait time ${thresholds.max_wait_min} minutes exceeded - price never reached entry zone (Phase ${urgencyPhase})`
              })
              .eq('id', intent.intent_id);

            // Step 2: Reset monitor state to allow new scans
            // CRITICAL: This unblocks the scanner so user can manually rescan
            if (intent.session_id) {
              const { error: transitionError } = await supabase.rpc('transition_entry_monitor_state', {
                p_session_id: intent.session_id,
                p_new_state: 'DISCOVERY_SCANNING',
                p_locked_symbol: null,
                p_locked_direction: null
              });

              if (transitionError) {
                console.error(`[Entry Monitor] ⚠️ Failed to reset monitor state:`, transitionError);
              } else {
                console.log(`[Entry Monitor] ✅ Monitor state reset to DISCOVERY_SCANNING`);
              }
            }

            // Step 3: Create notification for user
            await supabase.from('goal_notifications').insert({
              user_id: intent.user_id,
              session_id: intent.session_id,
              type: 'entry_abandoned',
              title: `Entry Abandoned: ${intent.symbol}`,
              message: `${intent.symbol} entry abandoned after ${minutesElapsed.toFixed(0)} minutes - price never reached zone. You can rescan for new opportunities.`,
              priority: 'medium',
              metadata: {
                symbol: intent.symbol,
                direction: intent.direction,
                reason: 'timeout_no_entry',
                minutes_elapsed: Math.round(minutesElapsed),
                max_wait_minutes: thresholds.max_wait_min,
                phase: urgencyPhase,
                price: intent.current_price,
                zone_min: intent.entry_zone_min,
                zone_max: intent.entry_zone_max
              }
            });

            abandonedCount++;
            console.log(`[Entry Monitor] ✅ Abandoned ${intent.symbol} and reset state - ready for new scan`);

            results.push({
              intentId: intent.intent_id,
              symbol: intent.symbol,
              success: true,
              action: 'abandoned_timeout'
            });
          } catch (error) {
            console.error(`[Entry Monitor] ❌ Error during abandonment:`, error);
            errorCount++;
            errors.push({
              context: 'abandon_timeout',
              intent_id: intent.intent_id,
              symbol: intent.symbol,
              error: (error as Error).message
            });
          }

          continue;
        }

        const edgeDecayPercent = Math.min(100, (minutesElapsed / thresholds.max_wait_min) * 100);

        // Enhanced EQS logging - explain WHY score is what it is
        const pipInfo = getCurrencyPipInfo(intent.symbol);
        const zoneMid = (intent.entry_zone_min + intent.entry_zone_max) / 2;
        const distanceFromMid = Math.abs(intent.current_price - zoneMid);
        const distanceInPips = distanceFromMid / pipInfo.pipValue;

        console.log(`[Entry Monitor] ${intent.symbol} Phase ${urgencyPhase}: ${minutesElapsed.toFixed(1)}/${thresholds.max_wait_min}min | Edge: ${edgeDecayPercent.toFixed(0)}%`);
        console.log(`  📊 EQS Analysis: Threshold = ${timeAdjustedThreshold} | Tolerance = ${zoneTolerancePips} pips`);
        console.log(`  📍 Price Position: Current ${intent.current_price} | Zone mid ${zoneMid.toFixed(pipInfo.decimals)} | Distance ${distanceInPips.toFixed(1)} pips`);
        console.log(`  💡 EQS Impact: Distance affects proximity score (0-30 pts). Price must move closer to zone for EQS to improve.`);

        // CRITICAL FIX: Persist phase progression to database
        // This ensures UI and subsequent checks use current phase thresholds
        const updatePayload: any = {
          urgency_phase: urgencyPhase,
          zone_tolerance_pips: zoneTolerancePips,
          time_adjusted_threshold: timeAdjustedThreshold,
          last_checked_at: new Date().toISOString()
        };

        // Track phase transitions - update phase_entered_at only when phase changes
        if (intent.urgency_phase !== urgencyPhase) {
          updatePayload.phase_entered_at = new Date().toISOString();
          console.log(`[Entry Monitor] 🔄 Phase transition: ${intent.urgency_phase || 1} → ${urgencyPhase} for ${intent.symbol}`);
        }

        const { error: updateError } = await supabase
          .from('entry_intents')
          .update(updatePayload)
          .eq('id', intent.intent_id);

        if (updateError) {
          console.error(`[Entry Monitor] ⚠️ Failed to update phase for ${intent.symbol}:`, updateError);
        }

        // Calculate EQS score (simplified server-side version)
        const eqsScore = calculateSimplifiedEQS(intent, intent.current_price, urgencyPhase, zoneTolerancePips);

        // Re-check if price is in zone with updated tolerance from current phase
        const isInZoneWithPhase = checkPriceInZone(intent, intent.current_price, zoneTolerancePips);

        // Log monitoring check
        await logMonitoringCheck(
          intent.intent_id,
          intent.user_id,
          intent.symbol,
          intent.current_price,
          parseFloat(intent.entry_zone_min),
          parseFloat(intent.entry_zone_max),
          eqsScore,
          isInZoneWithPhase,
          urgencyPhase,
          timeAdjustedThreshold
        );

        // Execution decision: Price in zone AND EQS meets threshold
        console.log(`[Entry Monitor] 🎯 EXECUTION CHECK for ${intent.symbol}:`);
        console.log(`  - Price in zone: ${isInZoneWithPhase} (price: ${intent.current_price}, zone: ${intent.entry_zone_min}-${intent.entry_zone_max}, tolerance: ${zoneTolerancePips}p)`);
        console.log(`  - EQS check: ${eqsScore.toFixed(1)} >= ${timeAdjustedThreshold} = ${eqsScore >= timeAdjustedThreshold}`);
        console.log(`  - Phase: ${urgencyPhase}, Edge decay: ${edgeDecayPercent.toFixed(0)}%`);

        if (isInZoneWithPhase && eqsScore >= timeAdjustedThreshold) {
          console.log(`[Entry Monitor] ✅✅✅ EXECUTING TRADE NOW for ${intent.symbol} @ ${intent.current_price}`);
          console.log(`  EQS: ${eqsScore.toFixed(1)} >= ${timeAdjustedThreshold} | Phase ${urgencyPhase} | Edge decay: ${edgeDecayPercent.toFixed(0)}%`);

          const executed = await executeIntent(intent, intent.current_price, eqsScore);

          if (executed) {
            executedCount++;
            successCount++;
            console.log(`[Entry Monitor] ✅ Trade executed successfully for ${intent.symbol}`);
            results.push({
              intentId: intent.intent_id,
              symbol: intent.symbol,
              success: true,
              action: 'executed',
              price: intent.current_price,
              eqs: eqsScore,
              phase: urgencyPhase
            });
          } else {
            errorCount++;
            console.error(`[Entry Monitor] ❌ Trade execution FAILED for ${intent.symbol} - executeIntent returned false`);
            console.error(`[Entry Monitor] ❌ Check executeIntent logs above for specific error`);
            results.push({
              intentId: intent.intent_id,
              symbol: intent.symbol,
              success: false,
              action: 'execution_failed'
            });
          }
        } else {
          console.log(`[Entry Monitor] ⏳ NOT executing ${intent.symbol} - conditions not met`);

          // Still waiting - update server state
          const reason = !isInZoneWithPhase
            ? `Price ${intent.current_price} outside zone (${intent.entry_zone_min}-${intent.entry_zone_max}) +${zoneTolerancePips}p tolerance`
            : `EQS ${eqsScore.toFixed(1)} below threshold ${timeAdjustedThreshold}`;

          await updateServerState(intent.intent_id, intent.user_id, intent.current_price, eqsScore, 'monitoring', reason);
          waitingCount++;
          successCount++;
          results.push({
            intentId: intent.intent_id,
            symbol: intent.symbol,
            success: true,
            action: 'monitoring',
            reason,
            phase: urgencyPhase,
            edge_decay_percent: edgeDecayPercent
          });
        }
      } catch (intentError) {
        console.error(`[Entry Monitor] ❌ Error processing intent ${intent.intent_id}:`, intentError);
        errorCount++;
        errors.push({
          context: 'process_intent',
          intent_id: intent.intent_id,
          symbol: intent.symbol,
          error: (intentError as Error).message
        });

        await updateServerState(
          intent.intent_id,
          intent.user_id,
          null,
          null,
          'error',
          (intentError as Error).message,
          true
        );
      }
    }

    // Mark stale intents and create alerts (NO LONGER switches to browser mode)
    const { data: staleIntents } = await supabase.rpc('mark_stale_entry_intents');
    if (staleIntents && staleIntents.length > 0) {
      console.log(`[Entry Monitor] 🚨 ${staleIntents.length} stale intents detected - alerts created`);
    }

    const duration = Date.now() - startTime;

    // Log health metrics to database
    await logHealthMetrics(
      totalIntents,
      successCount,
      errorCount,
      executedCount,
      abandonedCount,
      stalePriceCount,
      duration,
      errors
    );

    const summary = {
      processed: activeIntents.length,
      successful: successCount,
      errors: errorCount,
      executed: executedCount,
      abandoned: abandonedCount,
      waiting: waitingCount,
      stalePriceCount,
      staleIntents: staleIntents?.length || 0,
      duration,
      results
    };

    console.log('[Entry Monitor] ✅ Completed:', summary);
    if (executedCount > 0) {
      console.log(`[Entry Monitor] 🎯 ${executedCount} trades executed`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify(summary)
    };
  } catch (error) {
    console.error('[Entry Monitor] 💥 Fatal error:', error);
    errors.push({ context: 'fatal', error: (error as Error).message });

    // Log failed health check
    await logHealthMetrics(totalIntents, successCount, errorCount, executedCount, abandonedCount, stalePriceCount, Date.now() - startTime, errors);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: (error as Error).message,
        duration: Date.now() - startTime
      })
    };
  }
};

// Helper: Calculate simplified EQS score server-side
// ENHANCED: More forgiving scoring in Phase 2/3 with tolerance-aware calculation
function calculateSimplifiedEQS(
  intent: IntentForMonitoring,
  currentPrice: number,
  phase: number,
  tolerancePips: number
): number {
  let score = 50;

  // Zone proximity with tolerance (0-30 points)
  // SSOT: Use getCurrencyPipInfo for correct pip values across all asset classes
  const pipInfo = getCurrencyPipInfo(intent.symbol);
  const tolerance = tolerancePips * pipInfo.pipValue;

  const zoneMid = (intent.entry_zone_min + intent.entry_zone_max) / 2;
  const zoneRange = intent.entry_zone_max - intent.entry_zone_min;
  const extendedRange = zoneRange + (2 * tolerance); // Account for both sides
  const distanceFromMid = Math.abs(currentPrice - zoneMid);

  // More forgiving proximity calculation with tolerance
  const proximityScore = Math.max(0, 30 * (1 - distanceFromMid / Math.max(extendedRange, zoneRange)));
  score += proximityScore;

  // Alpha confidence bonus (0-20 points)
  const confidenceBonus = Math.max(0, (intent.alpha_confidence - 50) / 50 * 20);
  score += confidenceBonus;

  // Phase urgency bonus (0-10 points)
  // Give bonus points in later phases to increase execution probability
  const phaseBonus = (phase - 1) * 5; // Phase 2: +5, Phase 3: +10
  score += phaseBonus;

  return Math.min(100, Math.max(0, score));
}

// Helper: Check if price is in zone with tolerance
// SSOT: Use getCurrencyPipInfo for correct pip values across all asset classes
function checkPriceInZone(intent: IntentForMonitoring, price: number, tolerancePips: number): boolean {
  const pipInfo = getCurrencyPipInfo(intent.symbol);
  const tolerance = tolerancePips * pipInfo.pipValue;

  const effectiveMin = intent.entry_zone_min - tolerance;
  const effectiveMax = intent.entry_zone_max + tolerance;

  console.log(`[Entry Monitor] Zone check ${intent.symbol}: price=${price}, zone=${intent.entry_zone_min}-${intent.entry_zone_max}, tolerance=${tolerancePips}p (${tolerance} price units), effective=${effectiveMin}-${effectiveMax}, pipValue=${pipInfo.pipValue}`);

  return price >= effectiveMin && price <= effectiveMax;
}

// Helper: Execute intent - FULLY SERVER-SIDE using SERVICE_ROLE client
// This bypasses browser code to avoid RLS issues with anon key
// CCIP-COMPLIANT: Comprehensive audit trail for diagnosing execution failures
async function executeIntent(intent: IntentForMonitoring, entryPrice: number, eqsScore: number): Promise<boolean> {
  console.log(`[Entry Monitor] 🎯 executeIntent (SSOT) called for ${intent.symbol} at price ${entryPrice}`);

  let auditId: string | null = null;

  try {
    // Step 1: Start execution audit tracking (CCIP requirement)
    const { data: auditIdData, error: auditStartError } = await supabase.rpc('start_execution_audit', {
      p_intent_id: intent.intent_id,
      p_user_id: intent.user_id,
      p_session_id: intent.session_id,
      p_entry_price: entryPrice,
      p_eqs_score: Math.round(eqsScore),
      p_urgency_phase: intent.urgency_phase || 1,
      p_zone_tolerance_pips: intent.zone_tolerance_pips || 0
    });

    if (auditStartError || !auditIdData) {
      console.error(`[Entry Monitor] ⚠️ Failed to start audit (non-blocking): ${auditStartError?.message}`);
    } else {
      auditId = auditIdData;
      console.log(`[Entry Monitor] 📋 Audit tracking started: ${auditId}`);
    }

    // Step 2: Fetch full intent data using SERVICE_ROLE client (bypasses RLS)
    if (auditId) {
      await supabase.rpc('log_execution_step', {
        p_audit_id: auditId,
        p_step: 'FETCH_INTENT',
        p_details: { intent_id: intent.intent_id }
      });
    }

    const { data: fullIntent, error: fetchError } = await supabase
      .from('entry_intents')
      .select('*, goal_sessions(*)')
      .eq('id', intent.intent_id)
      .maybeSingle();

    if (fetchError || !fullIntent) {
      console.error(`[Entry Monitor] ❌ Failed to fetch intent:`, fetchError?.message || 'Intent not found');

      if (auditId) {
        await supabase.rpc('fail_execution_audit', {
          p_audit_id: auditId,
          p_failure_step: 'FETCH_INTENT',
          p_failure_reason: fetchError?.message || 'Intent not found',
          p_error_details: { code: fetchError?.code, hint: fetchError?.hint }
        });
      }

      return false;
    }

    console.log(`[Entry Monitor] ✅ Intent fetched successfully`);

    // Step 3: Extract market context and session data
    const marketContext = (fullIntent.market_context as any) || {};
    const session = (fullIntent.goal_sessions as any);
    const pipInfo = getCurrencyPipInfo(intent.symbol);

    // Step 4: Build MarketSnapshot for SSOT adapter
    const snapshot: MarketSnapshot = {
      symbol: intent.symbol,
      currentPrice: entryPrice,
      bid: marketContext?.bid ?? entryPrice - (pipInfo.spread * pipInfo.pipValue / 2),
      ask: marketContext?.ask ?? entryPrice + (pipInfo.spread * pipInfo.pipValue / 2),
      spread: marketContext?.spread ?? pipInfo.spread,
      timestamp: new Date(),
      pipInfo,
      atr: marketContext?.atr,
      volatility: marketContext?.volatility
    };

    // Step 5: Prepare entry intent for adapter
    const intentForAdapter: EntryIntentForExecution = {
      id: fullIntent.id,
      user_id: fullIntent.user_id,
      session_id: fullIntent.session_id,
      symbol: fullIntent.symbol,
      direction: fullIntent.direction as 'long' | 'short',
      entry_zone_min: fullIntent.entry_zone_min,
      entry_zone_max: fullIntent.entry_zone_max,
      alpha_confidence: fullIntent.alpha_confidence ?? 75,
      alpha_reasoning: fullIntent.alpha_reasoning,
      market_context: marketContext,
      status: fullIntent.status,
      created_at: fullIntent.created_at,
      urgency: fullIntent.urgency ?? 'normal',
      intent_type: fullIntent.intent_type ?? 'market',
      time_adjusted_threshold: intent.time_adjusted_threshold,
      zone_tolerance_pips: intent.zone_tolerance_pips
    };

    // Step 6: Build enhanced market context with all required data
    const idealEntryPrice = (fullIntent.entry_zone_min + fullIntent.entry_zone_max) / 2;
    let adjustedStopLoss = marketContext?.stop_loss || fullIntent.invalidation_price;

    if (!adjustedStopLoss) {
      console.error(`[Entry Monitor] ❌ Missing stop loss - cannot execute`);
      if (auditId) {
        await supabase.rpc('fail_execution_audit', {
          p_audit_id: auditId,
          p_failure_step: 'VALIDATE_SL',
          p_failure_reason: 'Missing required stop loss price',
          p_error_details: { market_context: marketContext, invalidation_price: fullIntent.invalidation_price }
        });
      }
      return false;
    }

    // Calculate adjusted TP maintaining original R:R if entry price differs from ideal
    let adjustedTakeProfit = marketContext?.take_profit;
    if (adjustedStopLoss && adjustedTakeProfit && entryPrice !== idealEntryPrice) {
      const originalStopDistance = Math.abs(idealEntryPrice - adjustedStopLoss);
      const originalTPDistance = Math.abs(adjustedTakeProfit - idealEntryPrice);
      const originalRR = originalTPDistance / originalStopDistance;

      if (fullIntent.direction === 'long') {
        adjustedStopLoss = entryPrice - originalStopDistance;
        adjustedTakeProfit = entryPrice + (originalStopDistance * originalRR);
      } else {
        adjustedStopLoss = entryPrice + originalStopDistance;
        adjustedTakeProfit = entryPrice - (originalStopDistance * originalRR);
      }
      console.log(`[Entry Monitor] 📐 Adjusted SL/TP for entry slip: SL=${adjustedStopLoss.toFixed(5)}, TP=${adjustedTakeProfit.toFixed(5)}`);
    }

    const riskDollars = session?.dollar_risk ?? marketContext?.risk_dollars ?? 50;

    // Calculate expected profit using proper pip conversion
    const dollarPerPip = calculateDollarPerPip(intent.symbol, pipInfo);
    const slPips = Math.abs(entryPrice - adjustedStopLoss) / pipInfo.pipValue;
    const tpPips = adjustedTakeProfit ? Math.abs(adjustedTakeProfit - entryPrice) / pipInfo.pipValue : slPips * 2;
    const riskReward = tpPips / slPips;
    const expectedProfit = riskDollars * riskReward;

    const enhancedMarketContext = {
      ...marketContext,
      entry_quality_score: eqsScore,
      eqs_score: eqsScore,
      stop_loss: adjustedStopLoss,
      take_profit: adjustedTakeProfit,
      sl_pips: slPips,
      tp_pips: tpPips,
      risk_dollars: riskDollars,
      ideal_entry_price: idealEntryPrice,
      tp1_price: marketContext?.tp1_price,
      tp1_confidence: marketContext?.tp1_confidence,
      tp1_reasoning: marketContext?.tp1_reasoning,
      tp2_price: marketContext?.tp2_price ?? adjustedTakeProfit,
      tp2_reasoning: marketContext?.tp2_reasoning,
      take_profit_1: marketContext?.tp1_price,
      reasoning: fullIntent.alpha_reasoning || marketContext?.omega_summary || 'Server-side auto-execution',
      expected_profit: expectedProfit,
      expected_profit_at_tp_dollars: expectedProfit,
      regime_bucket: marketContext?.regime_bucket,
      regime_snapshot: marketContext?.regime_snapshot
    };

    console.log(`[Entry Monitor] 💰 Position sizing: Risk=$${riskDollars}, SL=${slPips.toFixed(1)} pips, Expected=$${expectedProfit.toFixed(2)}`);

    // Step 7: SSOT - Execute via AlphaTradeExecutor (direct call)
    // CCIP FIX (2026-02-03): Removed phantom SSOTTradeExecutionAdapter
    // Now using AlphaTradeExecutor.execute() directly as SSOT authority
    if (auditId) {
      await supabase.rpc('log_execution_step', {
        p_audit_id: auditId,
        p_step: 'EXECUTE_VIA_ALPHA_TRADE_EXECUTOR',
        p_details: {
          symbol: intent.symbol,
          entry_price: entryPrice,
          eqs_score: eqsScore,
          risk_dollars: riskDollars,
          expected_profit: expectedProfit
        }
      });
    }

    // Build AlphaDecision from entry intent data
    const alphaDecision = {
      action: fullIntent.direction === 'long' ? 'BUY' : 'SELL',
      symbol: fullIntent.symbol,
      entry: entryPrice,
      stopLoss: adjustedStopLoss,
      takeProfit: adjustedTakeProfit || (entryPrice + (fullIntent.direction === 'long' ? 1 : -1) * slPips * pipInfo.pipValue * 2),
      tp1Price: marketContext?.tp1_price,
      tp2Price: marketContext?.tp2_price || adjustedTakeProfit,
      tp1Confidence: marketContext?.tp1_confidence,
      reasoning: fullIntent.alpha_reasoning || marketContext?.omega_summary || 'Server-side auto-execution',
      confidence: fullIntent.alpha_confidence ?? 75,
      regime: marketContext?.regime_bucket || 'unknown',
      patterns: marketContext?.patterns || [],
      risks: marketContext?.risks || [],
      omegaConsensus: marketContext?.omega_consensus,
      timestamp: new Date()
    };

    // Build TradeContext
    const tradeContext = {
      symbol: fullIntent.symbol,
      currentPrice: entryPrice,
      snapshot: snapshot,
      marketContext: enhancedMarketContext,
      regime: marketContext?.regime_bucket || 'unknown',
      regimeSnapshot: marketContext?.regime_snapshot
    };

    // Execute trade via AlphaTradeExecutor (SSOT)
    const { AlphaTradeExecutor } = await import('../../src/services/alpha-trade-executor.js');
    const executor = new AlphaTradeExecutor();

    const executionResult = await executor.execute({
      decision: alphaDecision,
      tradeContext: tradeContext,
      userId: fullIntent.user_id,
      sessionId: fullIntent.session_id,
      session: session,
      mode: 'IMMEDIATE',
      snapshotTimestamp: new Date(),
      regimeSnapshot: marketContext?.regime_snapshot,
      adversarialState: marketContext?.adversarial_state
    });

    if (!executionResult.success) {
      console.error(`[Entry Monitor] ❌ AlphaTradeExecutor execution failed:`, executionResult.error);
      if (auditId) {
        await supabase.rpc('fail_execution_audit', {
          p_audit_id: auditId,
          p_failure_step: 'ALPHA_TRADE_EXECUTOR',
          p_failure_reason: executionResult.error || 'Unknown error',
          p_error_details: { execution_result: executionResult }
        });
      }
      return false;
    }

    console.log(`[Entry Monitor] ✅ Trade executed successfully via AlphaTradeExecutor: ${executionResult.tradeId}`);

    // Step 8: Update session status to in_trade (adapter may have already done this)
    const { error: sessionUpdateError } = await supabase
      .from('goal_sessions')
      .update({ status: 'in_trade' })
      .eq('id', intent.session_id)
      .eq('status', 'scanning'); // Only update if still scanning

    if (sessionUpdateError) {
      console.error(`[Entry Monitor] ⚠️ Failed to update session status: ${sessionUpdateError.message}`);
      // Continue - non-blocking
    }

    // Step 9: Transition entry monitor state to allow new monitoring
    try {
      const { error: transitionError } = await supabase.rpc('transition_entry_monitor_state', {
        p_session_id: intent.session_id,
        p_new_state: 'AWAITING_EXIT',
        p_locked_symbol: intent.symbol,
        p_locked_direction: intent.direction
      });

      if (transitionError) {
        console.error(`[Entry Monitor] ⚠️ Failed to transition monitor state: ${transitionError.message}`);
      } else {
        console.log(`[Entry Monitor] ✅ Monitor state transitioned to AWAITING_EXIT`);
      }
    } catch (err) {
      console.warn(`[Entry Monitor] ⚠️ Monitor state transition error:`, err);
    }

    // Step 10: Create success notification (using valid type 'trade_opened')
    const { error: notificationError } = await supabase.from('goal_notifications').insert({
      user_id: fullIntent.user_id,
      session_id: fullIntent.session_id,
      type: 'trade_opened',
      title: `Trade Executed: ${fullIntent.symbol}`,
      message: `${fullIntent.direction.toUpperCase()} ${fullIntent.symbol} @ ${entryPrice.toFixed(pipInfo.decimals)} | EQS: ${eqsScore.toFixed(1)} | Expected: $${expectedProfit.toFixed(2)}`,
      priority: 'high',
      metadata: {
        trade_id: executionResult.tradeId,
        symbol: fullIntent.symbol,
        direction: fullIntent.direction,
        entry_price: entryPrice,
        eqs_score: eqsScore,
        expected_profit: expectedProfit,
        execution_source: 'ssot_adapter',
        adapter_confidence: executionResult.eqsScore
      }
    });

    if (notificationError) {
      console.error('[Entry Monitor] ⚠️ Failed to create notification:', notificationError.message);
    }

    // Step 11: Mark execution audit as successful
    if (auditId) {
      await supabase.rpc('complete_execution_audit', {
        p_audit_id: auditId,
        p_trade_id: executionResult.tradeId
      });
    }

    console.log(`[Entry Monitor] 🎉 Execution complete via SSOT adapter for ${fullIntent.symbol}`);
    return true;

  } catch (error) {
    console.error('[Entry Monitor] ❌ Execution error:', error);
    console.error('[Entry Monitor] ❌ Error stack:', (error as Error).stack);

    // AUDIT: Log unexpected error (catch-all)
    if (auditId) {
      await supabase.rpc('fail_execution_audit', {
        p_audit_id: auditId,
        p_failure_step: 'UNEXPECTED_ERROR',
        p_failure_reason: `Unexpected error: ${(error as Error).message}`,
        p_error_details: {
          error_name: (error as Error).name,
          error_message: (error as Error).message,
          error_stack: (error as Error).stack
        }
      });
    }

    return false;
  }
}

// Helper: Handle timeout
async function handleTimeout(intent: IntentForMonitoring): Promise<void> {
  const action = intent.timeout_action || 'CANCEL';

  if (action === 'EXECUTE') {
    // Execute at current price
    await executeIntent(intent, intent.current_price!, 0);
  } else {
    // Cancel intent
    await abandonIntent(intent.intent_id, 'Timeout reached');
  }
}

// Helper: Abandon intent
async function abandonIntent(intentId: string, reason: string): Promise<void> {
  const { error } = await supabase
    .from('entry_intents')
    .update({
      status: 'timeout',
      canceled_at: new Date().toISOString(),
      canceled_reason: reason
    })
    .eq('id', intentId);

  if (error) {
    console.error('[Entry Monitor] ⚠️ Failed to abandon intent:', error.message);
  }
}

// Helper: Update server state
async function updateServerState(
  intentId: string,
  userId: string,
  lastPrice: number | null,
  lastEQS: number | null,
  decision: string,
  reason: string,
  isError: boolean = false
): Promise<void> {
  try {
    const { error } = await supabase
      .from('entry_intent_server_state')
      .upsert({
        intent_id: intentId,
        user_id: userId,
        last_processed_at: new Date().toISOString(),
        last_price_checked: lastPrice,
        last_eqs_score: lastEQS,
        last_decision: decision,
        consecutive_errors: isError ? 1 : 0,
        last_error: isError ? reason : null,
        last_error_at: isError ? new Date().toISOString() : null,
        total_checks: 1
      }, {
        onConflict: 'intent_id',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('[Entry Monitor] ⚠️ Failed to update server state:', error.message);
    }
  } catch (error) {
    console.error('[Entry Monitor] ⚠️ Exception in updateServerState:', (error as Error).message);
  }
}

// Helper: Log monitoring check
async function logMonitoringCheck(
  intentId: string,
  userId: string,
  symbol: string,
  price: number,
  entryZoneMin: number,
  entryZoneMax: number,
  eqs: number,
  inZone: boolean,
  phase: number,
  threshold: number
): Promise<void> {
  try {
    // Calculate distance to zone for analytics
    const distanceToZonePips = inZone ? 0 : Math.min(
      Math.abs(price - entryZoneMin),
      Math.abs(price - entryZoneMax)
    );

    const { error } = await supabase
      .from('entry_monitoring_logs')
      .insert({
        intent_id: intentId,
        user_id: userId,
        symbol: symbol,
        timestamp: new Date().toISOString(),
        current_price: price,
        distance_to_zone_pips: distanceToZonePips,
        eqs_score: Math.round(eqs),
        eqs_threshold: threshold,
        status: eqs >= threshold && inZone ? 'EXECUTE_READY' : inZone ? 'WAIT_IN_ZONE' : 'WAIT_OUTSIDE_ZONE',
        message: `Phase ${phase}: EQS ${eqs.toFixed(1)} vs threshold ${threshold} | ${inZone ? 'IN ZONE' : 'OUTSIDE ZONE'}`,
        conditions_met: {
          in_zone: inZone,
          eqs_meets_threshold: eqs >= threshold,
          phase: phase,
          zone_min: entryZoneMin,
          zone_max: entryZoneMax
        }
      });

    if (error) {
      console.error('[Entry Monitor] ⚠️ Failed to log monitoring check:', error.message);
    }
  } catch (error) {
    // Don't fail monitoring if logging fails - log and continue
    console.error('[Entry Monitor] ⚠️ Exception in logMonitoringCheck:', (error as Error).message);
  }
}

// Helper: Log server monitoring health metrics
async function logHealthMetrics(
  totalIntents: number,
  successful: number,
  failed: number,
  executed: number,
  abandoned: number,
  stalePrice: number,
  durationMs: number,
  errors: any[]
): Promise<void> {
  try {
    await supabase.rpc('log_server_monitoring_health', {
      p_total_intents: totalIntents,
      p_successful: successful,
      p_failed: failed,
      p_executed: executed,
      p_abandoned: abandoned,
      p_stale_price: stalePrice,
      p_duration_ms: durationMs,
      p_errors: errors
    });
  } catch (error) {
    // Don't fail function if health logging fails
    console.error('[Entry Monitor] Failed to log health metrics:', error);
  }
}

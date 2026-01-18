/**
 * Autonomous Entry Intent Monitor - Netlify Scheduled Function
 *
 * Runs every minute to monitor all active entry intents server-side
 * Eliminates browser tab throttling by executing in the cloud
 * Enables true "set and forget" entry monitoring
 *
 * Schedule: Every 1 minute (defined in netlify.toml)
 */

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { getCurrencyPipInfo } from '../../src/utils/currencyHelpers';

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

        // EDGE LOSS MODAL CHECK: Trigger if max wait exceeded AND price is outside extended zone
        // Only trigger once per intent to avoid duplicate modals
        if (minutesElapsed >= thresholds.max_wait_min && !isInZone && !intent.edge_loss_modal_triggered_at) {
          console.log(`[Entry Monitor] ⚠️ Max wait exceeded (${minutesElapsed.toFixed(1)}/${thresholds.max_wait_min}min) and price outside Phase ${urgencyPhase} zone`);
          console.log(`[Entry Monitor] 🔔 Triggering edge loss modal for ${intent.symbol}`);

          try {
            const { data: modalId, error: modalError } = await supabase.rpc('trigger_entry_edge_loss_modal', {
              p_intent_id: intent.intent_id,
              p_user_id: intent.user_id,
              p_session_id: intent.session_id
            });

            if (modalError) {
              console.error(`[Entry Monitor] ❌ Failed to trigger edge loss modal:`, modalError);
            } else {
              console.log(`[Entry Monitor] ✅ Edge loss modal triggered successfully:`, modalId);
            }
          } catch (error) {
            console.error(`[Entry Monitor] ❌ Exception triggering edge loss modal:`, error);
          }

          // Continue monitoring to give user chance to respond
          continue;
        }

        // GRACEFUL FALLBACK: If modal was triggered but no response after 2 minutes, force-abandon
        if (intent.edge_loss_modal_triggered_at && !intent.edge_loss_modal_response) {
          const modalAge = (Date.now() - new Date(intent.edge_loss_modal_triggered_at).getTime()) / (60 * 1000);

          if (modalAge > 2) {
            console.log(`[Entry Monitor] ⏰ Edge loss modal timeout (${modalAge.toFixed(1)} min) - force abandoning ${intent.symbol}`);

            try {
              await supabase
                .from('entry_intents')
                .update({
                  status: 'timeout',
                  canceled_at: new Date().toISOString()
                })
                .eq('id', intent.intent_id);

              await supabase
                .from('goal_sessions')
                .update({
                  status: 'completed',
                  completed_at: new Date().toISOString()
                })
                .eq('id', intent.session_id);

              abandonedCount++;
              console.log(`[Entry Monitor] ✅ Force-abandoned ${intent.symbol} after modal timeout`);
            } catch (error) {
              console.error(`[Entry Monitor] ❌ Error force-abandoning intent:`, error);
            }

            continue;
          }
        }

        const edgeDecayPercent = Math.min(100, (minutesElapsed / thresholds.max_wait_min) * 100);
        console.log(`[Entry Monitor] ${intent.symbol} Phase ${urgencyPhase}: ${minutesElapsed.toFixed(1)}/${thresholds.max_wait_min}min | Edge: ${edgeDecayPercent.toFixed(0)}% | Tolerance: ${zoneTolerancePips}p | EQS: ${timeAdjustedThreshold}`);

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
async function executeIntent(intent: IntentForMonitoring, entryPrice: number, eqsScore: number): Promise<boolean> {
  try {
    console.log(`[Entry Monitor] 🎯 Server-side execution starting for ${intent.symbol}`);
    console.log(`[Entry Monitor] Intent: ${intent.intent_id}, User: ${intent.user_id}, Session: ${intent.session_id}`);

    // Step 1: Fetch full intent data using SERVICE_ROLE client (bypasses RLS)
    const { data: fullIntent, error: fetchError } = await supabase
      .from('entry_intents')
      .select('*, goal_sessions(*)')
      .eq('id', intent.intent_id)
      .maybeSingle();

    if (fetchError) {
      console.error(`[Entry Monitor] ❌ Failed to fetch intent: ${fetchError.message}`);
      console.error(`[Entry Monitor] ❌ Fetch error details:`, JSON.stringify(fetchError));
      return false;
    }

    if (!fullIntent) {
      console.error(`[Entry Monitor] ❌ Intent not found in database: ${intent.intent_id}`);
      return false;
    }

    console.log(`[Entry Monitor] ✅ Intent fetched successfully`);

    const marketContext = fullIntent.market_context as any || {};
    const session = fullIntent.goal_sessions as any;

    // Step 2: Calculate adjusted SL/TP based on actual entry price
    const idealEntryPrice = (fullIntent.entry_zone_min + fullIntent.entry_zone_max) / 2;
    let adjustedStopLoss = marketContext?.stop_loss || fullIntent.invalidation_price;
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

    // Step 3: Get risk dollars from session
    const riskDollars = session?.dollar_risk || marketContext?.risk_dollars || 10;

    // Step 4: Calculate lot size using pip info
    const pipInfo = getCurrencyPipInfo(intent.symbol);
    const stopDistancePips = Math.abs(entryPrice - adjustedStopLoss) / pipInfo.pipValue;
    const pipValuePerLot = pipInfo.pipValuePerLot || 10;
    const lotSize = Math.max(0.01, Math.min(10, riskDollars / (stopDistancePips * pipValuePerLot)));
    const positionSize = Math.round(lotSize * 100000);

    console.log(`[Entry Monitor] 💰 Position sizing: Risk=$${riskDollars}, SL=${stopDistancePips.toFixed(1)} pips, Lot=${lotSize.toFixed(2)}`);

    // Step 5: Calculate time to entry
    const intentCreatedAt = new Date(fullIntent.created_at);
    const timeToEntrySeconds = Math.round((Date.now() - intentCreatedAt.getTime()) / 1000);

    // Step 6: Insert trade using SERVICE_ROLE client
    const tradeData = {
      goal_session_id: fullIntent.session_id,
      user_id: fullIntent.user_id,
      symbol: fullIntent.symbol,
      direction: fullIntent.direction === 'long' ? 'buy' : 'sell',
      position_type: fullIntent.direction,
      entry_price: entryPrice,
      stop_loss: adjustedStopLoss,
      take_profit: adjustedTakeProfit,
      tp1_price: marketContext?.tp1_price || null,
      tp1_confidence: marketContext?.tp1_confidence || null,
      tp1_reasoning: marketContext?.tp1_reasoning || null,
      tp2_price: marketContext?.tp2_price || adjustedTakeProfit,
      tp2_reasoning: marketContext?.tp2_reasoning || null,
      take_profit_1: marketContext?.tp1_price || null,
      take_profit_2: adjustedTakeProfit,
      lot_size: Number(lotSize.toFixed(2)),
      position_size: positionSize,
      risk_dollars: riskDollars,
      status: 'open',
      opened_at: new Date().toISOString(),
      current_price: entryPrice,
      current_pnl: 0,
      ai_confidence: Math.round(fullIntent.alpha_confidence || eqsScore),
      ai_reasoning: fullIntent.alpha_reasoning || marketContext?.omega_summary || 'Server-side auto-execution',
      confidence_score: Math.round(eqsScore),
      entry_intent_id: fullIntent.id,
      entry_intent_type: fullIntent.intent_type || 'limit',
      entry_urgency: fullIntent.urgency || 'normal',
      entry_quality_score: Math.round(eqsScore),
      time_to_entry_seconds: timeToEntrySeconds,
      ideal_entry_price: idealEntryPrice,
      entry_slippage_pips: Math.abs(entryPrice - idealEntryPrice) / pipInfo.pipValue,
      eqs_score: Math.round(eqsScore),
      entry_mode: 'monitored',
      trade_confidence: Math.round(eqsScore),
      order_type: 'market'
    };

    console.log(`[Entry Monitor] 📝 Creating trade:`, JSON.stringify({
      symbol: tradeData.symbol,
      direction: tradeData.direction,
      entry: tradeData.entry_price,
      sl: tradeData.stop_loss,
      tp: tradeData.take_profit,
      lot: tradeData.lot_size
    }));

    const { data: newTrade, error: insertError } = await supabase
      .from('goal_session_trades')
      .insert(tradeData)
      .select('id')
      .single();

    if (insertError) {
      console.error(`[Entry Monitor] ❌ Failed to create trade: ${insertError.message}`);
      console.error(`[Entry Monitor] ❌ Insert error details:`, JSON.stringify(insertError));
      return false;
    }

    console.log(`[Entry Monitor] ✅ Trade created: ${newTrade.id}`);

    // Step 7: Update intent status to executed
    const { error: updateError } = await supabase
      .from('entry_intents')
      .update({
        status: 'executed',
        executed_at: new Date().toISOString(),
        executed_price: entryPrice,
        execution_eqs_score: Math.round(eqsScore)
      })
      .eq('id', intent.intent_id);

    if (updateError) {
      console.error(`[Entry Monitor] ⚠️ Failed to update intent status: ${updateError.message}`);
    }

    // Step 8: Transition session back to discovery mode
    if (intent.session_id) {
      const { error: transitionError } = await supabase.rpc('transition_entry_monitor_state', {
        p_session_id: intent.session_id,
        p_new_state: 'DISCOVERY_SCANNING',
        p_locked_symbol: null,
        p_locked_direction: null
      });

      if (transitionError) {
        console.error(`[Entry Monitor] ⚠️ Failed to transition session state: ${transitionError.message}`);
      }
    }

    // Step 9: Create success notification (using valid type 'trade_opened')
    const { error: notificationError } = await supabase.from('goal_notifications').insert({
      user_id: fullIntent.user_id,
      session_id: fullIntent.session_id,
      type: 'trade_opened',
      title: `Trade Executed: ${fullIntent.symbol}`,
      message: `${fullIntent.direction.toUpperCase()} ${fullIntent.symbol} @ ${entryPrice.toFixed(pipInfo.decimals)} | EQS: ${eqsScore}`,
      priority: 'high',
      metadata: {
        trade_id: newTrade.id,
        symbol: fullIntent.symbol,
        direction: fullIntent.direction,
        entry_price: entryPrice,
        eqs_score: eqsScore,
        execution_source: 'server_entry_monitor'
      }
    });

    if (notificationError) {
      console.error('[Entry Monitor] ⚠️ Failed to create notification:', notificationError.message);
    }

    console.log(`[Entry Monitor] 🎉 Execution complete for ${fullIntent.symbol}`);
    return true;
  } catch (error) {
    console.error('[Entry Monitor] ❌ Execution error:', error);
    console.error('[Entry Monitor] ❌ Error stack:', (error as Error).stack);
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

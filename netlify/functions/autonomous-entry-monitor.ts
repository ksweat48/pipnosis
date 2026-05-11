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
import { getSupabaseAdmin } from './_shared/supabase-admin';
import { getCurrencyPipInfo, convertLotToPositionSize } from '../../src/utils/currencyHelpers';

const supabase = getSupabaseAdmin();

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
  intent_mode: 'pullback_to_zone' | 'push_confirmation_zone' | null;
  session_status: string | null;
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

        // TERMINAL SESSION GUARD: Log when a session is in a terminal state but DO NOT
        // automatically block execution. The intent's own timeout_at is the SSOT for
        // whether the intent is still alive. The session status is informational here.
        // executeIntent() validates session state before inserting a trade.
        const TERMINAL_SESSION_STATES = ['goal_achieved', 'stopped', 'timeout', 'weekend_shutdown', 'user_stopped'];
        if (intent.session_status && TERMINAL_SESSION_STATES.includes(intent.session_status)) {
          const timeoutAt = intent.timeout_at ? new Date(intent.timeout_at) : null;
          const intentExpired = timeoutAt && timeoutAt < new Date();
          if (intentExpired) {
            console.log(`[Entry Monitor] ⏭️ Skipping ${intent.symbol} — session is ${intent.session_status} AND intent has expired. Abandoning.`);
            await abandonIntent(intent.intent_id, `Session ${intent.session_status} and intent timeout expired`);
            abandonedCount++;
            successCount++;
            results.push({ intentId: intent.intent_id, symbol: intent.symbol, success: true, action: 'abandoned_terminal_session' });
            continue;
          }
          console.log(`[Entry Monitor] ⚠️ Session is ${intent.session_status} but intent timeout not expired — continuing to monitor. Session lifecycle and intent lifecycle are independent.`);
        }

        // GOVERNANCE (2026-02-18, revised 2026-04-11): Only block if the session has an
        // OPEN (status = 'open') trade right now. Closed or historical trades must not
        // prevent a deferred entry intent from executing — the user explicitly asked Alpha
        // to wait for a pullback and the system must honour that when the zone is hit.
        // Prior behaviour abandoned any intent if the session had ANY prior trade (too broad).
        if (intent.session_id) {
          const { count: openTrades } = await supabase
            .from('goal_session_trades')
            .select('id', { count: 'exact', head: true })
            .eq('goal_session_id', intent.session_id)
            .eq('status', 'open');

          if (openTrades && openTrades > 0) {
            console.log(`[Entry Monitor] GOVERNANCE: Session ${intent.session_id} has ${openTrades} OPEN trade(s) - abandoning intent ${intent.intent_id.substring(0, 8)} (closed/historical trades are not a block)`);
            await abandonIntent(intent.intent_id, 'Session already has open trade(s) - governance policy prevents concurrent auto-execution');
            abandonedCount++;
            successCount++;
            results.push({
              intentId: intent.intent_id,
              symbol: intent.symbol,
              success: true,
              action: 'governance_blocked'
            });
            continue;
          }
        }

        // Update heartbeat at start
        await supabase.rpc('update_intent_server_heartbeat', {
          p_intent_id: intent.intent_id,
          p_instance_id: 'netlify-entry-monitor'
        });

        // CCIP-2026-0426B: Manual trigger must execute before ANY price staleness gate.
        // The browser confirmed price was in the zone — the server honours that immediately.
        // Falls back to zone midpoint if current_price is unavailable.
        const isManualTriggerEarly = intent.market_context?.manual_trigger === true;
        if (isManualTriggerEarly) {
          const fallbackPrice = (Number(intent.entry_zone_min) + Number(intent.entry_zone_max)) / 2;
          const manualPrice = intent.current_price ?? fallbackPrice;
          console.log(`[Entry Monitor] ⚡ MANUAL TRIGGER for ${intent.symbol} — bypassing all gates. Price: ${manualPrice} (${intent.current_price ? 'live' : 'zone-midpoint fallback'})`);
          const executed = await executeIntent(intent, manualPrice, 100);
          if (executed) {
            executedCount++;
            successCount++;
            console.log(`[Entry Monitor] ✅ Manual trigger trade executed for ${intent.symbol}`);
            results.push({ intentId: intent.intent_id, symbol: intent.symbol, success: true, action: 'manual_trigger', price: manualPrice });
          } else {
            errorCount++;
            console.error(`[Entry Monitor] ❌ Manual trigger execution FAILED for ${intent.symbol}`);
            results.push({ intentId: intent.intent_id, symbol: intent.symbol, success: false, action: 'manual_trigger_failed' });
          }
          continue;
        }

        // CCIP-2026-0427H: Fallback live-price fetch.
        // The RPC filters realtime_prices to rows newer than 90s. If that filter
        // returned nothing, current_price will be NULL. Before abandoning the cycle,
        // try one direct lookup for the most recent row (regardless of age) and let
        // the 120s staleness check below decide whether it is usable. This prevents
        // a polling hiccup from silently expiring an intent that just hit its zone.
        if (!intent.current_price || !intent.price_updated_at) {
          const { data: fallbackPriceRow } = await supabase
            .from('realtime_prices')
            .select('bid, ask, mid, created_at')
            .eq('symbol', intent.symbol)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (fallbackPriceRow) {
            const fallbackPrice = intent.direction === 'long'
              ? Number(fallbackPriceRow.ask)
              : intent.direction === 'short'
                ? Number(fallbackPriceRow.bid)
                : Number(fallbackPriceRow.mid);
            if (Number.isFinite(fallbackPrice) && fallbackPrice > 0) {
              const fallbackAgeSec = Math.round((Date.now() - new Date(fallbackPriceRow.created_at).getTime()) / 1000);
              console.log(`[Entry Monitor] ↻ Fallback price for ${intent.symbol}: ${fallbackPrice} (age=${fallbackAgeSec}s)`);
              intent.current_price = fallbackPrice;
              intent.price_updated_at = fallbackPriceRow.created_at;
            }
          }
        }

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
          // CRITICAL FIX: If price is already in the zone when timeout fires, EXECUTE
          // the trade instead of abandoning. The user asked for a pullback entry and
          // the price has reached the target — honouring that takes priority over the
          // scheduling timeout. Use a zero-tolerance zone check here (Phase 1 tolerance)
          // so we only execute if price is genuinely inside the zone.
          const inZoneAtTimeout = intent.current_price
            ? checkPriceInZone(intent, intent.current_price, 0)
            : false;

          if (inZoneAtTimeout && intent.current_price) {
            console.log(`[Entry Monitor] ⏰⚡ Intent ${intent.intent_id.substring(0, 8)} expired BUT price is IN ZONE — executing trade instead of abandoning`);
            console.log(`  Price: ${intent.current_price} | Zone: ${intent.entry_zone_min}-${intent.entry_zone_max}`);
            const executed = await executeIntent(intent, intent.current_price, 75);
            if (executed) {
              executedCount++;
              successCount++;
              results.push({ intentId: intent.intent_id, symbol: intent.symbol, success: true, action: 'executed_at_timeout_in_zone' });
            } else {
              errorCount++;
              results.push({ intentId: intent.intent_id, symbol: intent.symbol, success: false, action: 'execution_failed_at_timeout' });
            }
          } else {
            console.log(`[Entry Monitor] ⏰ Intent ${intent.intent_id.substring(0, 8)} expired and price is outside zone — abandoning`);
            await handleTimeout(intent);
            abandonedCount++;
            successCount++;
            results.push({
              intentId: intent.intent_id,
              symbol: intent.symbol,
              success: true,
              action: 'timeout'
            });
          }
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

            const abandonMsg = intent.intent_mode === 'push_confirmation_zone'
              ? `${intent.symbol} push confirmation timed out after ${minutesElapsed.toFixed(0)}min — price never pushed into the confirmation zone. Rescanning automatically.`
              : `${intent.symbol} entry timed out after ${minutesElapsed.toFixed(0)}min — price never reached the entry zone. Rescanning automatically.`;

            // Step 3a: In-app notification
            await supabase.from('goal_notifications').insert({
              user_id: intent.user_id,
              goal_session_id: intent.session_id,
              type: 'entry_abandoned',
              title: `Entry Cancelled: ${intent.symbol}`,
              message: abandonMsg,
              priority: 'medium',
              metadata: {
                symbol: intent.symbol,
                direction: intent.direction,
                reason: 'timeout_no_entry',
                intent_mode: intent.intent_mode ?? 'pullback_to_zone',
                minutes_elapsed: Math.round(minutesElapsed),
                max_wait_minutes: thresholds.max_wait_min,
                phase: urgencyPhase,
                price: intent.current_price,
                zone_min: intent.entry_zone_min,
                zone_max: intent.entry_zone_max
              }
            });

            // Step 3b: Push notification to mobile
            await sendAbandonmentPushNotification(intent, abandonMsg);

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
        // Note: manual_trigger path was moved above the stale price gate (CCIP-2026-0426B)
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

// Helper: Send push notification on entry intent abandonment
async function sendAbandonmentPushNotification(intent: IntentForMonitoring, reason: string): Promise<void> {
  try {
    await supabase.from('push_notification_queue').insert({
      user_id: intent.user_id,
      title: `Entry Cancelled: ${intent.symbol}`,
      body: reason,
      data: {
        type: 'entry_abandoned',
        symbol: intent.symbol,
        direction: intent.direction,
        session_id: intent.session_id
      }
    });
  } catch (err) {
    console.warn(`[Entry Monitor] Failed to queue push notification for ${intent.intent_id}:`, err);
  }
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

    // Step 6: Resolve Alpha's SL/TP — SSOT enforcement (CCIP-2026-0319B)
    //
    // Alpha is the SOLE authority for stop loss and take profit.
    // Primary source: dedicated columns alpha_stop_loss / alpha_take_profit
    // (written by AlphaTradeExecutor.createMonitored at intent creation time).
    // Secondary source: market_context JSONB (defense-in-depth copy from same origin).
    //
    // THERE IS NO FABRICATED FALLBACK. If Alpha's values are absent, the system
    // fails loudly and blocks execution. No coordinator, monitor, or engine may
    // substitute or compute replacement values.

    const idealEntryPrice = (fullIntent.entry_zone_min + fullIntent.entry_zone_max) / 2;

    // Primary: dedicated columns. Secondary: market_context JSONB (same Alpha origin).
    const rawAlphaSL: number | null = fullIntent.alpha_stop_loss ?? marketContext?.stop_loss ?? null;
    const rawAlphaTP: number | null = fullIntent.alpha_take_profit ?? marketContext?.take_profit ?? null;

    // --- Hard failure: Alpha SL missing ---
    if (!rawAlphaSL || !Number.isFinite(Number(rawAlphaSL)) || Number(rawAlphaSL) <= 0) {
      const errorMsg =
        '[Entry Monitor] ALPHA_AUTHORITY_VIOLATION: Alpha stop loss is missing from entry_intents. ' +
        'alpha_stop_loss column is null/zero and market_context.stop_loss is also absent. ' +
        'Execution BLOCKED. No fallback is permitted. CCIP-2026-0319B.';
      console.error(errorMsg, {
        intentId: fullIntent.id,
        symbol: fullIntent.symbol,
        alpha_stop_loss: fullIntent.alpha_stop_loss,
        marketContext_stop_loss: marketContext?.stop_loss
      });
      if (auditId) {
        await supabase.rpc('fail_execution_audit', {
          p_audit_id: auditId,
          p_failure_step: 'ALPHA_SL_MISSING',
          p_failure_reason: 'Alpha stop loss was not persisted to entry_intents — execution blocked by SSOT enforcement (CCIP-2026-0319B)',
          p_error_details: {
            alpha_stop_loss: fullIntent.alpha_stop_loss,
            market_context_stop_loss: marketContext?.stop_loss,
            invalidation_price: fullIntent.invalidation_price
          }
        });
      }
      return false;
    }

    // --- Hard failure: Alpha TP missing ---
    if (!rawAlphaTP || !Number.isFinite(Number(rawAlphaTP)) || Number(rawAlphaTP) <= 0) {
      const errorMsg =
        '[Entry Monitor] ALPHA_AUTHORITY_VIOLATION: Alpha take profit is missing from entry_intents. ' +
        'alpha_take_profit column is null/zero and market_context.take_profit is also absent. ' +
        'Execution BLOCKED. No fallback is permitted. CCIP-2026-0319B.';
      console.error(errorMsg, {
        intentId: fullIntent.id,
        symbol: fullIntent.symbol,
        alpha_take_profit: fullIntent.alpha_take_profit,
        marketContext_take_profit: marketContext?.take_profit
      });
      if (auditId) {
        await supabase.rpc('fail_execution_audit', {
          p_audit_id: auditId,
          p_failure_step: 'ALPHA_TP_MISSING',
          p_failure_reason: 'Alpha take profit was not persisted to entry_intents — execution blocked by SSOT enforcement (CCIP-2026-0319B)',
          p_error_details: {
            alpha_take_profit: fullIntent.alpha_take_profit,
            market_context_take_profit: marketContext?.take_profit
          }
        });
      }
      return false;
    }

    let adjustedStopLoss = Number(rawAlphaSL);
    let adjustedTakeProfit = Number(rawAlphaTP);

    // Alpha's TP1/TP2 — from dedicated columns first, then market_context JSONB
    const rawAlphaTp1: number | null = fullIntent.alpha_tp1_price ?? marketContext?.tp1_price ?? null;
    const rawAlphaTp2: number | null = fullIntent.alpha_tp2_price ?? marketContext?.tp2_price ?? null;
    const adjustedTp1: number | null = rawAlphaTp1 ? Number(rawAlphaTp1) : null;
    const adjustedTp2: number | null = rawAlphaTp2 ? Number(rawAlphaTp2) : adjustedTakeProfit;

    console.log(
      `[Entry Monitor] Alpha SL/TP confirmed from SSOT columns (CCIP-2026-0319B): ` +
      `SL=${adjustedStopLoss.toFixed(5)}, TP=${adjustedTakeProfit.toFixed(5)}, ` +
      `TP1=${adjustedTp1?.toFixed(5) ?? 'none'}, TP2=${adjustedTp2?.toFixed(5) ?? 'none'}`
    );

    // R:R preservation when entry price differs from the ideal zone midpoint.
    // This adjustment is permissible because it preserves Alpha's intended R:R ratio —
    // it does not replace Alpha's decision, it scales it to the actual fill price.
    if (entryPrice !== idealEntryPrice) {
      const originalStopDistance = Math.abs(idealEntryPrice - adjustedStopLoss);
      const originalTPDistance = Math.abs(adjustedTakeProfit - idealEntryPrice);
      const originalRR = originalTPDistance / (originalStopDistance || 1);

      if (fullIntent.direction === 'long') {
        adjustedStopLoss = entryPrice - originalStopDistance;
        adjustedTakeProfit = entryPrice + (originalStopDistance * originalRR);
      } else {
        adjustedStopLoss = entryPrice + originalStopDistance;
        adjustedTakeProfit = entryPrice - (originalStopDistance * originalRR);
      }
      console.log(
        `[Entry Monitor] Alpha SL/TP scaled for entry slip (R:R preserved): ` +
        `SL=${adjustedStopLoss.toFixed(5)}, TP=${adjustedTakeProfit.toFixed(5)}`
      );
    }

    const riskDollars = session?.dollar_risk ?? marketContext?.risk_dollars ?? 50;

    // Calculate expected profit
    const slPips = Math.abs(entryPrice - adjustedStopLoss) / pipInfo.pipValue;
    const tpPips = Math.abs(adjustedTakeProfit - entryPrice) / pipInfo.pipValue;
    const riskReward = tpPips / (slPips || 1);
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
      tp1_price: adjustedTp1,
      tp1_confidence: marketContext?.tp1_confidence,
      tp1_reasoning: marketContext?.tp1_reasoning,
      tp2_price: adjustedTp2,
      tp2_reasoning: marketContext?.tp2_reasoning,
      take_profit_1: adjustedTp1,
      reasoning: fullIntent.alpha_reasoning || marketContext?.omega_summary || 'Server-side auto-execution',
      expected_profit: expectedProfit,
      expected_profit_at_tp_dollars: expectedProfit,
      regime_bucket: marketContext?.regime_bucket,
      regime_snapshot: marketContext?.regime_snapshot
    };

    console.log(`[Entry Monitor] Position sizing: Risk=$${riskDollars}, SL=${slPips.toFixed(1)} pips, Expected=$${expectedProfit.toFixed(2)}`);

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
          expected_profit: expectedProfit,
          sl_source: fullIntent.alpha_stop_loss ? 'alpha_stop_loss_column' : 'market_context_jsonb',
          tp_source: fullIntent.alpha_take_profit ? 'alpha_take_profit_column' : 'market_context_jsonb'
        }
      });
    }

    // Build AlphaDecision from entry intent — SL/TP come from Alpha's persisted values only
    const alphaDecision = {
      action: fullIntent.direction === 'long' ? 'BUY' : 'SELL',
      symbol: fullIntent.symbol,
      entry: entryPrice,
      stopLoss: adjustedStopLoss,
      takeProfit: adjustedTakeProfit,
      tp1Price: adjustedTp1,
      tp2Price: adjustedTp2,
      tp1Confidence: marketContext?.tp1_confidence,
      reasoning: fullIntent.alpha_reasoning || marketContext?.omega_summary || 'Server-side auto-execution',
      confidence: fullIntent.alpha_confidence ?? 75,
      regime: marketContext?.regime_bucket || 'unknown',
      patterns: marketContext?.patterns || [],
      risks: marketContext?.risks || [],
      omegaConsensus: marketContext?.omega_consensus,
      timestamp: new Date()
    };

    // Build SSOT TradeContext via the canonical factory.
    // CCIP-2026-0428D: prior code constructed a freeform object missing
    // `profileHash`, `createdTimestamp`, and the bound converters required by
    // `validateTradeContext`. UnifiedRiskAuthority.assessTrade -> validateContext
    // therefore raised HASH_MISMATCH on every server-side execution attempt
    // (49 consecutive failures observed on intent 4055540f). The SSOT factory
    // is the only legal way to obtain a valid TradeContext.
    const tradeMathModule = await import('../../src/utils/tradeMath.js');
    const tradeContextResult = tradeMathModule.createTradeContext(fullIntent.symbol);
    if (!tradeContextResult.success || !tradeContextResult.context) {
      const failureMsg = `createTradeContext failed for ${fullIntent.symbol}: ${tradeContextResult.error || 'unknown error'}`;
      console.error(`[Entry Monitor] ❌ ${failureMsg}`);
      if (auditId) {
        await supabase.rpc('fail_execution_audit', {
          p_audit_id: auditId,
          p_failure_step: 'TRADE_CONTEXT_CREATION',
          p_failure_reason: failureMsg,
          p_error_details: { errorCode: tradeContextResult.errorCode }
        });
      }
      return false;
    }
    const tradeContext = tradeContextResult.context;

    // Execute trade via AlphaTradeExecutor with service-role client (SSOT).
    // CCIP-2026-0511B: server-side callers must bind a service-role Supabase
    // client via createAlphaTradeExecutor() so inserts into RLS-protected
    // tables succeed without an auth.uid() context. The browser singleton
    // (alphaTradeExecutor) is anon-only and will fail RLS on server inserts.
    const executorModule = await import('../../src/services/alpha-trade-executor.js');
    const factory = executorModule.createAlphaTradeExecutor;
    const executor = typeof factory === 'function' ? factory(supabase) : executorModule.alphaTradeExecutor;
    if (!executor || typeof executor.execute !== 'function') {
      const importKeys = Object.keys(executorModule || {});
      const failureMsg = `AlphaTradeExecutor unavailable. Module keys: [${importKeys.join(', ')}]`;
      console.error(`[Entry Monitor] ❌ ${failureMsg}`);
      if (auditId) {
        await supabase.rpc('fail_execution_audit', {
          p_audit_id: auditId,
          p_failure_step: 'EXECUTOR_IMPORT',
          p_failure_reason: failureMsg,
          p_error_details: { module_keys: importKeys }
        });
      }
      return false;
    }

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
      goal_session_id: fullIntent.session_id,
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

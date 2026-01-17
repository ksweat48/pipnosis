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

        // Calculate urgency phase (1, 2, or 3) based on style-specific time thresholds
        let urgencyPhase: 1 | 2 | 3 = 1;
        let zoneTolerancePips = thresholds.zone_tolerance_phase1;
        let timeAdjustedThreshold = thresholds.eqs_threshold_phase1;

        // Check if price is in zone (need this for edge loss decision)
        const isInZone = checkPriceInZone(intent, intent.current_price, zoneTolerancePips);

        // EDGE LOSS MODAL CHECK: Check if max wait exceeded (but not if price is in zone)
        if (minutesElapsed >= thresholds.max_wait_min && !isInZone) {
          // Check if modal already triggered
          const hasModalTriggered = intent.market_context?.edge_loss_modal_triggered_at;

          if (!hasModalTriggered) {
            console.log(`[Entry Monitor] ⚠️ EDGE LOSS: ${style} ${intent.symbol} exceeded max wait (${minutesElapsed.toFixed(1)}/${thresholds.max_wait_min}min)`);
            console.log(`[Entry Monitor] 🔔 Triggering edge loss modal for user decision`);

            // Trigger edge loss modal
            const { data: modalData, error: modalError } = await supabase.rpc('trigger_entry_edge_loss_modal', {
              p_intent_id: intent.intent_id,
              p_user_id: intent.user_id,
              p_session_id: intent.session_id
            });

            if (modalError) {
              console.error(`[Entry Monitor] ❌ Failed to trigger edge loss modal:`, modalError);
            } else {
              console.log(`[Entry Monitor] ✅ Edge loss modal triggered, waiting for user response`);

              // Mark intent in database to track modal state
              await supabase
                .from('entry_intents')
                .update({
                  market_context: {
                    ...intent.market_context,
                    edge_loss_modal_triggered_at: new Date().toISOString()
                  }
                })
                .eq('id', intent.intent_id);
            }

            waitingCount++;
            successCount++;
            results.push({
              intentId: intent.intent_id,
              symbol: intent.symbol,
              success: true,
              action: 'edge_loss_modal_triggered'
            });
            continue;
          } else {
            // Modal already triggered - check if it timed out (1 minute)
            const modalTriggeredAt = new Date(hasModalTriggered);
            const modalElapsed = (Date.now() - modalTriggeredAt.getTime()) / 60000;

            if (modalElapsed >= 1) {
              console.log(`[Entry Monitor] ⏱️ Edge loss modal timed out after ${modalElapsed.toFixed(1)}min with no response`);
              console.log(`[Entry Monitor] 🔒 Auto-closing session due to timeout`);

              // Auto-close via database function
              const { error: autoCloseError } = await supabase.rpc('auto_close_timed_out_edge_loss_modals');

              if (autoCloseError) {
                console.error(`[Entry Monitor] ❌ Failed to auto-close:`, autoCloseError);
              }

              abandonedCount++;
              successCount++;
              results.push({
                intentId: intent.intent_id,
                symbol: intent.symbol,
                success: true,
                action: 'edge_loss_timeout_auto_closed'
              });
              continue;
            } else {
              // Modal active, waiting for response
              console.log(`[Entry Monitor] ⏳ Waiting for edge loss modal response (${(1 - modalElapsed).toFixed(1)}min remaining)`);
              waitingCount++;
              successCount++;
              results.push({
                intentId: intent.intent_id,
                symbol: intent.symbol,
                success: true,
                action: 'awaiting_edge_loss_response'
              });
              continue;
            }
          }
        }

        // Progressive phase transitions (only if not in edge loss state)
        if (minutesElapsed >= thresholds.eqs_phase3_min) {
          urgencyPhase = 3;
          zoneTolerancePips = thresholds.zone_tolerance_phase3;
          timeAdjustedThreshold = thresholds.eqs_threshold_phase3;
        } else if (minutesElapsed >= thresholds.eqs_phase2_min) {
          urgencyPhase = 2;
          zoneTolerancePips = thresholds.zone_tolerance_phase2;
          timeAdjustedThreshold = thresholds.eqs_threshold_phase2;
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
          intent.current_price,
          eqsScore,
          isInZoneWithPhase,
          urgencyPhase,
          timeAdjustedThreshold
        );

        // Execution decision: Price in zone AND EQS meets threshold
        if (isInZoneWithPhase && eqsScore >= timeAdjustedThreshold) {
          console.log(`[Entry Monitor] ✅ EXECUTING TRADE for ${intent.symbol} @ ${intent.current_price}`);
          console.log(`  EQS: ${eqsScore.toFixed(1)} >= ${timeAdjustedThreshold} | Phase ${urgencyPhase} | Edge decay: ${edgeDecayPercent.toFixed(0)}%`);

          const executed = await executeIntent(intent, intent.current_price, eqsScore);

          if (executed) {
            executedCount++;
            successCount++;
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
            results.push({
              intentId: intent.intent_id,
              symbol: intent.symbol,
              success: false,
              action: 'execution_failed'
            });
          }
        } else {
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
  const pipValue = intent.symbol.includes('JPY') ? 0.01 : 0.0001;
  const tolerance = tolerancePips * pipValue;

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
function checkPriceInZone(intent: IntentForMonitoring, price: number, tolerancePips: number): boolean {
  const pipValue = intent.symbol.includes('JPY') ? 0.01 : 0.0001;
  const tolerance = tolerancePips * pipValue;

  const effectiveMin = intent.entry_zone_min - tolerance;
  const effectiveMax = intent.entry_zone_max + tolerance;

  return price >= effectiveMin && price <= effectiveMax;
}

// Helper: Execute intent
async function executeIntent(intent: IntentForMonitoring, entryPrice: number, eqsScore: number): Promise<boolean> {
  try {
    // Import execution coordinator dynamically
    const { EntryExecutionCoordinator } = await import('../../src/services/entry-execution-coordinator');

    const result = await EntryExecutionCoordinator.executeFromIntent(intent.intent_id, entryPrice);

    if (result.success) {
      // Update intent status to executed
      await supabase
        .from('entry_intents')
        .update({
          status: 'executed',
          executed_at: new Date().toISOString(),
          executed_price: entryPrice,
          execution_eqs_score: eqsScore
        })
        .eq('id', intent.intent_id);

      // Transition session back to discovery mode
      if (intent.session_id) {
        await supabase.rpc('transition_entry_monitor_state', {
          p_session_id: intent.session_id,
          p_new_state: 'DISCOVERY_SCANNING',
          p_locked_symbol: null,
          p_locked_direction: null
        });
      }

      return true;
    }

    return false;
  } catch (error) {
    console.error('[Entry Monitor] Execution error:', error);
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
  await supabase
    .from('entry_intents')
    .update({
      status: 'timeout',
      canceled_at: new Date().toISOString(),
      canceled_reason: reason
    })
    .eq('id', intentId);
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
  await supabase
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
}

// Helper: Log monitoring check
async function logMonitoringCheck(
  intentId: string,
  price: number,
  eqs: number,
  inZone: boolean,
  phase: number,
  threshold: number
): Promise<void> {
  await supabase
    .from('entry_monitoring_logs')
    .insert({
      intent_id: intentId,
      checked_at: new Date().toISOString(),
      current_price: price,
      entry_quality_score: eqs,
      in_entry_zone: inZone,
      zone_status: inZone ? 'inside' : 'outside',
      decision: eqs >= threshold ? 'execute' : 'wait',
      reason: `Phase ${phase}: EQS ${eqs.toFixed(1)} vs threshold ${threshold}`
    });
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

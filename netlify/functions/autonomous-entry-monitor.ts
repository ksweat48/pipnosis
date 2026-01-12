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
  console.log('[Entry Monitor] Starting scheduled check...');

  try {
    // Get all active entry intents that need server monitoring
    const { data: activeIntents, error } = await supabase.rpc('get_intents_for_server_monitoring');

    if (error) {
      console.error('[Entry Monitor] Error fetching intents:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: error.message })
      };
    }

    if (!activeIntents || activeIntents.length === 0) {
      console.log('[Entry Monitor] No active intents to monitor');
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No active intents',
          processed: 0,
          duration: Date.now() - startTime
        })
      };
    }

    console.log(`[Entry Monitor] Processing ${activeIntents.length} active intents`);

    const results = [];
    let successCount = 0;
    let errorCount = 0;
    let executedCount = 0;
    let abandonedCount = 0;
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
          waitingCount++;
          continue;
        }

        const priceAge = Date.now() - new Date(intent.price_updated_at).getTime();
        if (priceAge > 120000) {
          console.log(`[Entry Monitor] ⚠️ Stale price data for ${intent.symbol} (${Math.round(priceAge / 1000)}s old)`);
          await updateServerState(intent.intent_id, intent.user_id, intent.current_price, null, 'stale_price', 'Price data too old');
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

        // Calculate time-based urgency and EQS threshold
        const createdAt = new Date(intent.created_at);
        const minutesElapsed = (Date.now() - createdAt.getTime()) / 60000;
        const maxWaitMinutes = intent.max_wait_seconds / 60;

        // Calculate urgency phase (1, 2, or 3)
        let urgencyPhase = 1;
        let zoneTolerancePips = 0;
        let timeAdjustedThreshold = 75;

        if (minutesElapsed > maxWaitMinutes * 0.66) {
          urgencyPhase = 3;
          zoneTolerancePips = 5;
          timeAdjustedThreshold = 40;
        } else if (minutesElapsed > maxWaitMinutes * 0.33) {
          urgencyPhase = 2;
          zoneTolerancePips = 2;
          timeAdjustedThreshold = 60;
        }

        // Calculate EQS score (simplified server-side version)
        const eqsScore = calculateSimplifiedEQS(intent, intent.current_price);

        // Check if price is in zone (with tolerance)
        const isInZone = checkPriceInZone(intent, intent.current_price, zoneTolerancePips);

        // Log monitoring check
        await logMonitoringCheck(
          intent.intent_id,
          intent.current_price,
          eqsScore,
          isInZone,
          urgencyPhase,
          timeAdjustedThreshold
        );

        // Execution decision: Price in zone AND EQS meets threshold
        if (isInZone && eqsScore >= timeAdjustedThreshold) {
          console.log(`[Entry Monitor] ✅ EXECUTING TRADE for ${intent.symbol} @ ${intent.current_price}`);
          console.log(`  EQS: ${eqsScore.toFixed(1)} >= ${timeAdjustedThreshold} | Phase ${urgencyPhase}`);

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
              eqs: eqsScore
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
          const reason = !isInZone
            ? `Price ${intent.current_price} outside zone (${intent.entry_zone_min}-${intent.entry_zone_max})`
            : `EQS ${eqsScore.toFixed(1)} below threshold ${timeAdjustedThreshold}`;

          await updateServerState(intent.intent_id, intent.user_id, intent.current_price, eqsScore, 'monitoring', reason);
          waitingCount++;
          successCount++;
          results.push({
            intentId: intent.intent_id,
            symbol: intent.symbol,
            success: true,
            action: 'monitoring',
            reason
          });
        }
      } catch (intentError) {
        console.error(`[Entry Monitor] Error processing intent ${intent.intent_id}:`, intentError);
        errorCount++;

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

    // Mark stale intents for browser fallback
    const { data: staleIntents } = await supabase.rpc('mark_stale_entry_intents');
    if (staleIntents && staleIntents.length > 0) {
      console.log(`[Entry Monitor] Marked ${staleIntents.length} stale intents for browser fallback`);
    }

    const duration = Date.now() - startTime;
    const summary = {
      processed: activeIntents.length,
      successful: successCount,
      errors: errorCount,
      executed: executedCount,
      abandoned: abandonedCount,
      waiting: waitingCount,
      staleIntents: staleIntents?.length || 0,
      duration,
      results
    };

    console.log('[Entry Monitor] Completed:', summary);
    if (executedCount > 0) {
      console.log(`[Entry Monitor] 🎯 ${executedCount} trades executed`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify(summary)
    };
  } catch (error) {
    console.error('[Entry Monitor] Fatal error:', error);
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
function calculateSimplifiedEQS(intent: IntentForMonitoring, currentPrice: number): number {
  let score = 50;

  // Zone proximity (0-30 points)
  const zoneMid = (intent.entry_zone_min + intent.entry_zone_max) / 2;
  const zoneRange = intent.entry_zone_max - intent.entry_zone_min;
  const distanceFromMid = Math.abs(currentPrice - zoneMid);
  const proximityScore = Math.max(0, 30 * (1 - distanceFromMid / zoneRange));
  score += proximityScore;

  // Alpha confidence bonus (0-20 points)
  const confidenceBonus = Math.max(0, (intent.alpha_confidence - 50) / 50 * 20);
  score += confidenceBonus;

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

/**
 * Backfill AI Learning Data
 *
 * Populates AI learning tables from existing goal_trades:
 * - ai_trade_analysis
 * - alpha_meta_insights
 * - alpha_confidence_calibration
 * - ai_platform_learning_stats
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function backfillAILearningData() {
  console.log('🚀 Starting AI Learning Data Backfill...\n');

  try {
    // Step 1: Fetch all closed trades
    console.log('📊 Fetching closed trades...');
    const { data: trades, error: tradesError } = await supabase
      .from('goal_trades')
      .select('*')
      .eq('status', 'closed')
      .not('realized_pnl', 'is', null)
      .order('created_at', { ascending: true });

    if (tradesError) {
      console.error('❌ Error fetching trades:', tradesError);
      return;
    }

    console.log(`✅ Found ${trades.length} closed trades\n`);

    // Step 2: Process each trade
    let analysesCreated = 0;
    let insightsUpdated = 0;
    let calibrationUpdated = 0;

    for (const trade of trades) {
      // Determine outcome
      const outcome = determineOutcome(trade);

      // Check if analysis already exists
      const { data: existing } = await supabase
        .from('ai_trade_analysis')
        .select('id')
        .eq('live_trade_id', trade.id)
        .maybeSingle();

      if (!existing) {
        // Create trade analysis
        const riskReward = calculateRiskReward(trade);
        const durationMinutes = calculateDuration(trade);

        await supabase.from('ai_trade_analysis').insert({
          user_id: trade.user_id,
          live_trade_id: trade.id,
          symbol: trade.symbol,
          direction: trade.direction,
          entry_time: trade.entry_time,
          exit_time: trade.close_time,
          entry_price: trade.entry_price,
          exit_price: trade.exit_price,
          stop_loss: trade.stop_loss,
          take_profit: trade.take_profit,
          entry_confidence: trade.ai_confidence || 75,
          outcome: outcome,
          pnl: trade.realized_pnl,
          risk_reward_at_entry: riskReward,
          duration_minutes: durationMinutes,
          close_reason: trade.close_reason || 'manual_close',
          ai_reasoning: trade.ai_reasoning || 'Historical backfill',
          entry_indicators_alignment: {
            setup: trade.setup_type || 'unknown'
          },
          contributed_to_global_learning: true
        });

        analysesCreated++;
      }

      // Update meta-insights
      if (trade.setup_type) {
        await updateMetaInsights(trade, outcome);
        insightsUpdated++;
      }

      // Update calibration
      if (trade.ai_confidence) {
        await updateCalibration(trade, outcome);
        calibrationUpdated++;
      }

      // Progress indicator
      if (analysesCreated % 10 === 0) {
        process.stdout.write(`\r📊 Progress: ${analysesCreated}/${trades.length} trades processed...`);
      }
    }

    console.log(`\n\n✅ Created ${analysesCreated} trade analyses`);
    console.log(`✅ Updated ${insightsUpdated} meta-insights`);
    console.log(`✅ Updated ${calibrationUpdated} calibration entries\n`);

    // Step 3: Update platform stats
    console.log('📊 Updating platform statistics...');
    await supabase.rpc('update_platform_stats');
    console.log('✅ Platform stats updated\n');

    // Step 4: Run platform intelligence aggregation
    console.log('📊 Running platform intelligence aggregation...');
    const { error: aggregateError } = await supabase.functions.invoke('aggregate-platform-intelligence');
    if (aggregateError) {
      console.error('⚠️  Could not invoke aggregation function:', aggregateError.message);
    } else {
      console.log('✅ Platform intelligence aggregated\n');
    }

    // Summary
    console.log('═══════════════════════════════════════');
    console.log('📊 BACKFILL COMPLETE!');
    console.log('═══════════════════════════════════════');
    console.log(`✅ Processed ${trades.length} total trades`);
    console.log(`✅ Created ${analysesCreated} new analyses`);
    console.log(`✅ Updated insights and calibration data`);
    console.log(`✅ Platform intelligence ready`);
    console.log('═══════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Backfill failed:', error);
    process.exit(1);
  }
}

/**
 * Determine trade outcome
 */
function determineOutcome(trade) {
  if (trade.close_reason === 'tp_hit') return 'win';
  if (trade.close_reason === 'sl_hit') return 'loss';
  if (trade.realized_pnl > 0.5) return 'win';
  if (trade.realized_pnl < -0.5) return 'loss';
  return 'breakeven';
}

/**
 * Calculate risk-reward ratio
 */
function calculateRiskReward(trade) {
  const risk = Math.abs(trade.entry_price - trade.stop_loss);
  const reward = Math.abs(trade.take_profit - trade.entry_price);
  return risk > 0 ? reward / risk : 0;
}

/**
 * Calculate trade duration
 */
function calculateDuration(trade) {
  const entryTime = new Date(trade.entry_time).getTime();
  const exitTime = new Date(trade.close_time).getTime();
  return Math.round((exitTime - entryTime) / 60000);
}

/**
 * Update meta-insights
 */
async function updateMetaInsights(trade, outcome) {
  const pattern = trade.setup_type;
  const winRate = outcome === 'win' ? 100 : 0;

  const { data: existing } = await supabase
    .from('alpha_meta_insights')
    .select('*')
    .eq('user_id', trade.user_id)
    .eq('symbol', trade.symbol)
    .eq('insight_description', `${pattern} on ${trade.symbol}`)
    .maybeSingle();

  if (existing) {
    const sampleSize = (existing.supporting_evidence?.sample_size || 0) + 1;
    const newWinRate = ((existing.improvement_seen || 0) * (sampleSize - 1) + winRate) / sampleSize;

    await supabase
      .from('alpha_meta_insights')
      .update({
        improvement_seen: newWinRate,
        confidence_in_insight: Math.min(95, 50 + (sampleSize * 2)),
        supporting_evidence: {
          sample_size: sampleSize,
          last_updated: new Date().toISOString()
        },
        validated: sampleSize >= 10,
        updated_at: new Date().toISOString()
      })
      .eq('id', existing.id);
  } else {
    const insightType = outcome === 'win' ? 'strength' : outcome === 'loss' ? 'weakness' : 'neutral';

    await supabase.from('alpha_meta_insights').insert({
      user_id: trade.user_id,
      symbol: trade.symbol,
      insight_type: insightType,
      insight_description: `${pattern} on ${trade.symbol}`,
      improvement_seen: winRate,
      confidence_in_insight: 50,
      supporting_evidence: {
        sample_size: 1,
        last_updated: new Date().toISOString()
      },
      validated: false
    });
  }
}

/**
 * Update calibration
 */
async function updateCalibration(trade, outcome) {
  const confidence = trade.ai_confidence || 75;
  const bucket = getConfidenceBucket(confidence);
  const actualWinRate = outcome === 'win' ? 100 : 0;

  const { data: existing } = await supabase
    .from('alpha_confidence_calibration')
    .select('*')
    .eq('user_id', trade.user_id)
    .eq('confidence_bucket', bucket)
    .maybeSingle();

  if (existing) {
    const newSampleSize = existing.sample_size + 1;
    const newActualWR = ((existing.actual_win_rate * existing.sample_size) + actualWinRate) / newSampleSize;
    const calibrationError = Math.abs(confidence - newActualWR);

    await supabase
      .from('alpha_confidence_calibration')
      .update({
        sample_size: newSampleSize,
        actual_win_rate: newActualWR,
        predicted_win_rate: confidence,
        calibration_error: calibrationError,
        updated_at: new Date().toISOString()
      })
      .eq('id', existing.id);
  } else {
    const calibrationError = Math.abs(confidence - actualWinRate);

    await supabase.from('alpha_confidence_calibration').insert({
      user_id: trade.user_id,
      confidence_bucket: bucket,
      sample_size: 1,
      actual_win_rate: actualWinRate,
      predicted_win_rate: confidence,
      calibration_error: calibrationError
    });
  }
}

/**
 * Get confidence bucket
 */
function getConfidenceBucket(confidence) {
  if (confidence >= 95) return 95;
  if (confidence >= 90) return 90;
  if (confidence >= 85) return 85;
  if (confidence >= 80) return 80;
  if (confidence >= 75) return 75;
  return 70;
}

// Run the backfill
backfillAILearningData()
  .then(() => {
    console.log('✅ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });

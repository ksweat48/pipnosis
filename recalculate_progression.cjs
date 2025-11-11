#!/usr/bin/env node

/**
 * Recalculate AI Skill Progression
 * This script recalculates progression percentages using the new formula
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

const SKILL_THRESHOLDS = [
  { level: 'Novice', minTrades: 0, minWinRate: 0, minProfitFactor: 0 },
  { level: 'Intermediate', minTrades: 100, minWinRate: 45, minProfitFactor: 1.0 },
  { level: 'Pro', minTrades: 500, minWinRate: 55, minProfitFactor: 1.2 },
  { level: 'Expert', minTrades: 1500, minWinRate: 65, minProfitFactor: 1.5 },
  { level: 'Master', minTrades: 5000, minWinRate: 70, minProfitFactor: 1.8 },
  { level: 'Exceptional', minTrades: 10000, minWinRate: 80, minProfitFactor: 2.0 }
];

function calculateSkillLevel(totalTrades, winRate, profitFactor) {
  for (let i = SKILL_THRESHOLDS.length - 1; i >= 0; i--) {
    const threshold = SKILL_THRESHOLDS[i];
    if (
      totalTrades >= threshold.minTrades &&
      winRate >= threshold.minWinRate &&
      profitFactor >= threshold.minProfitFactor
    ) {
      return threshold.level;
    }
  }
  return 'Novice';
}

function calculateProgressMetrics(totalTrades, winRate, profitFactor, currentLevel) {
  const currentLevelIndex = SKILL_THRESHOLDS.findIndex(t => t.level === currentLevel);
  if (currentLevelIndex === SKILL_THRESHOLDS.length - 1) {
    return { progressPercent: 100, tradesNeeded: 0 };
  }

  const currentThreshold = SKILL_THRESHOLDS[currentLevelIndex];
  const nextThreshold = SKILL_THRESHOLDS[currentLevelIndex + 1];

  // Calculate progress based on trades
  const tradesProgress = Math.min(100, Math.max(0,
    ((totalTrades - currentThreshold.minTrades) /
      (nextThreshold.minTrades - currentThreshold.minTrades)) * 100
  ));

  // Calculate progress based on win rate
  const winRateProgress = Math.min(100, Math.max(0,
    ((winRate - currentThreshold.minWinRate) /
      (nextThreshold.minWinRate - currentThreshold.minWinRate)) * 100
  ));

  // Calculate progress based on profit factor
  const profitFactorProgress = Math.min(100, Math.max(0,
    ((profitFactor - currentThreshold.minProfitFactor) /
      (nextThreshold.minProfitFactor - currentThreshold.minProfitFactor)) * 100
  ));

  // Calculate performance multiplier
  let performanceMultiplier = 1.0;

  const winRateGap = nextThreshold.minWinRate - winRate;
  if (winRateGap > 10) {
    performanceMultiplier *= Math.max(0.5, 1 - (winRateGap / 100));
  }

  const pfGap = nextThreshold.minProfitFactor - profitFactor;
  if (pfGap > 0.3) {
    performanceMultiplier *= Math.max(0.5, 1 - (pfGap / 2));
  }

  // Overall progress with performance multiplier
  let rawProgress = (tradesProgress * 0.5) + (winRateProgress * 0.3) + (profitFactorProgress * 0.2);
  rawProgress = rawProgress * performanceMultiplier;

  const progressPercent = Math.min(100, Math.max(0, rawProgress));
  const tradesNeeded = Math.max(0, nextThreshold.minTrades - totalTrades);

  return { progressPercent, tradesNeeded, performanceMultiplier };
}

async function recalculateProgression() {
  console.log('🔧 Recalculating AI Skill Progression...\n');

  // Fetch all progression records
  const { data: records, error: fetchError } = await supabase
    .from('ai_skill_progression')
    .select('*');

  if (fetchError) {
    console.error('❌ Error fetching records:', fetchError);
    return;
  }

  if (!records || records.length === 0) {
    console.log('ℹ️  No progression records found.');
    return;
  }

  console.log(`📊 Found ${records.length} progression record(s) to recalculate.\n`);

  for (const record of records) {
    const totalTrades = record.total_trades_analyzed;
    const winRate = parseFloat(record.current_win_rate);
    const profitFactor = parseFloat(record.current_profit_factor);

    console.log(`\n👤 User: ${record.user_id}`);
    console.log(`   Current Data:`);
    console.log(`   - Winning Trades: ${totalTrades}`);
    console.log(`   - Win Rate: ${winRate.toFixed(2)}%`);
    console.log(`   - Profit Factor: ${profitFactor.toFixed(2)}`);
    console.log(`   - Old Progress: ${parseFloat(record.progress_to_next_level_percent).toFixed(2)}%`);

    // Recalculate skill level
    const newLevel = calculateSkillLevel(totalTrades, winRate, profitFactor);

    // Recalculate progress
    const { progressPercent, tradesNeeded, performanceMultiplier } = calculateProgressMetrics(
      totalTrades,
      winRate,
      profitFactor,
      newLevel
    );

    // Apply performance gating if metrics are poor
    let gatedProgress = progressPercent;
    if (winRate < 35 || profitFactor < 0.5) {
      const performancePenalty = Math.max(0.1, Math.min(1.0, (winRate / 45) * (profitFactor / 1.0)));
      gatedProgress = progressPercent * performancePenalty;
      console.log(`   ⚠️  Performance gating applied: ${(performancePenalty * 100).toFixed(0)}% multiplier`);
    }

    console.log(`   New Calculation:`);
    console.log(`   - Skill Level: ${newLevel}`);
    console.log(`   - Performance Multiplier: ${performanceMultiplier.toFixed(2)}`);
    console.log(`   - New Progress: ${gatedProgress.toFixed(2)}%`);
    console.log(`   - Trades Needed: ${tradesNeeded}`);

    // Update database
    const { error: updateError } = await supabase
      .from('ai_skill_progression')
      .update({
        current_skill_level: newLevel,
        skill_level_numeric: SKILL_THRESHOLDS.findIndex(t => t.level === newLevel) + 1,
        progress_to_next_level_percent: gatedProgress,
        trades_needed_for_next_level: tradesNeeded,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', record.user_id);

    if (updateError) {
      console.error(`   ❌ Error updating record:`, updateError);
    } else {
      console.log(`   ✅ Updated successfully!`);
    }
  }

  console.log('\n🎉 Recalculation complete!');
}

recalculateProgression()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });

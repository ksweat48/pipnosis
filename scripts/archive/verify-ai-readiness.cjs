#!/usr/bin/env node

/**
 * AI Learning System Readiness Check
 *
 * Comprehensive pre-backtest validation to ensure all tables, connections,
 * and data flows are ready for the AI to learn successfully.
 *
 * Usage: node scripts/verify-ai-readiness.cjs
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials in .env file');
  console.error('   Required: VITE_SUPABASE_URL and VITE_SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Critical tables required for AI learning
const CRITICAL_TABLES = [
  'ai_learning_insights',
  'ai_skill_progression',
  'ai_session_learnings',
  'ai_pattern_ev_tracking',
  'synthetic_backtest_sessions',
  'synthetic_backtest_trades',
  'ai_trade_analysis',
  'ai_performance_evolution'
];

// Optional tables (nice-to-have for KPIs)
const OPTIONAL_TABLES = [
  'llm_layer_kpis',
  'continuous_learning_kpis',
  'ai_mastery_kpis',
  'daily_meta_analysis',
  'plateau_detection_log',
  'breakthrough_experiments'
];

// Results tracking
const results = {
  overall: 'unknown',
  canLearn: false,
  checks: {
    connection: false,
    criticalTables: false,
    optionalTables: false,
    dataAccess: false,
    migrations: false
  },
  issues: [],
  warnings: [],
  stats: {}
};

/**
 * Main validation flow
 */
async function runValidation() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║         AI LEARNING SYSTEM READINESS CHECK                     ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    // Step 1: Check database connection
    await checkConnection();

    // Step 2: Check critical tables exist
    await checkCriticalTables();

    // Step 3: Check optional tables
    await checkOptionalTables();

    // Step 4: Check user access (if user ID provided)
    const userId = process.env.TEST_USER_ID;
    if (userId) {
      await checkDataAccess(userId);
    } else {
      console.log('⚠️  Step 4: User Access Check - SKIPPED');
      console.log('   Set TEST_USER_ID in .env to check user-specific data access\n');
    }

    // Step 5: Summary
    printSummary();

    // Exit code
    process.exit(results.canLearn ? 0 : 1);

  } catch (error) {
    console.error('\n❌ CRITICAL ERROR during validation:', error.message);
    console.error(error);
    process.exit(1);
  }
}

/**
 * Step 1: Check database connection
 */
async function checkConnection() {
  console.log('📡 Step 1: Checking Database Connection...');

  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id')
      .limit(1);

    if (error) {
      throw error;
    }

    results.checks.connection = true;
    console.log('   ✅ Database connection successful\n');

  } catch (error) {
    results.checks.connection = false;
    results.issues.push({
      severity: 'critical',
      category: 'Connection',
      issue: 'Cannot connect to Supabase database',
      fix: 'Check VITE_SUPABASE_URL and VITE_SUPABASE_SERVICE_ROLE_KEY in .env'
    });
    console.log('   ❌ Database connection failed:', error.message, '\n');
  }
}

/**
 * Step 2: Check critical tables exist
 */
async function checkCriticalTables() {
  console.log('🗄️  Step 2: Checking Critical Tables...');

  const missingTables = [];
  const existingTables = [];

  for (const tableName of CRITICAL_TABLES) {
    try {
      const { error } = await supabase
        .from(tableName)
        .select('id', { count: 'exact', head: true })
        .limit(1);

      if (error) {
        missingTables.push(tableName);
        console.log(`   ❌ ${tableName} - NOT ACCESSIBLE`);
      } else {
        existingTables.push(tableName);
        console.log(`   ✅ ${tableName}`);
      }
    } catch (error) {
      missingTables.push(tableName);
      console.log(`   ❌ ${tableName} - ERROR: ${error.message}`);
    }
  }

  if (missingTables.length === 0) {
    results.checks.criticalTables = true;
    console.log(`\n   ✅ All ${CRITICAL_TABLES.length} critical tables are accessible\n`);
  } else {
    results.checks.criticalTables = false;
    results.issues.push({
      severity: 'critical',
      category: 'Schema',
      issue: `Missing critical tables: ${missingTables.join(', ')}`,
      fix: 'Run missing migrations or check RLS policies'
    });
    console.log(`\n   ❌ Missing ${missingTables.length} critical table(s)\n`);
  }

  results.stats.criticalTables = {
    total: CRITICAL_TABLES.length,
    existing: existingTables.length,
    missing: missingTables.length
  };
}

/**
 * Step 3: Check optional tables
 */
async function checkOptionalTables() {
  console.log('📊 Step 3: Checking Optional Tables (KPIs)...');

  const missingTables = [];
  const existingTables = [];

  for (const tableName of OPTIONAL_TABLES) {
    try {
      const { error } = await supabase
        .from(tableName)
        .select('id', { count: 'exact', head: true })
        .limit(1);

      if (error) {
        missingTables.push(tableName);
        console.log(`   ⚠️  ${tableName} - NOT ACCESSIBLE`);
      } else {
        existingTables.push(tableName);
        console.log(`   ✅ ${tableName}`);
      }
    } catch (error) {
      missingTables.push(tableName);
      console.log(`   ⚠️  ${tableName} - ERROR: ${error.message}`);
    }
  }

  results.checks.optionalTables = existingTables.length > 0;

  if (missingTables.length > 0) {
    results.warnings.push({
      severity: 'warning',
      category: 'KPIs',
      issue: `Optional tables missing: ${missingTables.join(', ')}`,
      fix: 'Some KPI metrics will not be available (non-critical)'
    });
  }

  console.log(`\n   ℹ️  ${existingTables.length}/${OPTIONAL_TABLES.length} optional tables available\n`);

  results.stats.optionalTables = {
    total: OPTIONAL_TABLES.length,
    existing: existingTables.length,
    missing: missingTables.length
  };
}

/**
 * Step 4: Check user data access
 */
async function checkDataAccess(userId) {
  console.log('👤 Step 4: Checking User Data Access...');
  console.log(`   User ID: ${userId}\n`);

  const checks = [];

  // Check ai_skill_progression
  try {
    const { data, error } = await supabase
      .from('ai_skill_progression')
      .select('current_skill_level, total_trades_analyzed, updated_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      console.log('   ✅ ai_skill_progression - ACCESS OK');
      console.log(`      Skill Level: ${data.current_skill_level}`);
      console.log(`      Total Trades: ${data.total_trades_analyzed}`);
      console.log(`      Last Update: ${data.updated_at}`);
      checks.push(true);
    } else {
      console.log('   ⚠️  ai_skill_progression - NO DATA (normal before first backtest)');
      checks.push(true);
    }
  } catch (error) {
    console.log('   ❌ ai_skill_progression - ACCESS DENIED:', error.message);
    results.issues.push({
      severity: 'critical',
      category: 'Access',
      issue: 'Cannot access ai_skill_progression',
      fix: 'Check RLS policies for this user'
    });
    checks.push(false);
  }

  // Check ai_learning_insights
  try {
    const { count, error } = await supabase
      .from('ai_learning_insights')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) throw error;

    console.log(`   ✅ ai_learning_insights - ${count || 0} insights found`);
    checks.push(true);
  } catch (error) {
    console.log('   ❌ ai_learning_insights - ACCESS DENIED:', error.message);
    results.issues.push({
      severity: 'critical',
      category: 'Access',
      issue: 'Cannot access ai_learning_insights',
      fix: 'Check RLS policies for this user'
    });
    checks.push(false);
  }

  // Check synthetic_backtest_sessions
  try {
    const { count, error } = await supabase
      .from('synthetic_backtest_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) throw error;

    console.log(`   ✅ synthetic_backtest_sessions - ${count || 0} sessions found`);

    if (count && count > 0) {
      results.warnings.push({
        severity: 'info',
        category: 'Data',
        issue: `User has ${count} existing backtest session(s)`,
        fix: 'AI can learn from existing data'
      });
    }

    checks.push(true);
  } catch (error) {
    console.log('   ❌ synthetic_backtest_sessions - ACCESS DENIED:', error.message);
    results.issues.push({
      severity: 'critical',
      category: 'Access',
      issue: 'Cannot access synthetic_backtest_sessions',
      fix: 'Check RLS policies for this user'
    });
    checks.push(false);
  }

  results.checks.dataAccess = checks.every(c => c === true);
  console.log();
}

/**
 * Print final summary
 */
function printSummary() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                      VALIDATION SUMMARY                        ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Determine overall status
  const criticalIssues = results.issues.filter(i => i.severity === 'critical').length;
  const allCriticalChecks = results.checks.connection && results.checks.criticalTables;

  results.canLearn = criticalIssues === 0 && allCriticalChecks;

  if (results.canLearn) {
    results.overall = 'healthy';
  } else if (criticalIssues > 0) {
    results.overall = 'error';
  } else {
    results.overall = 'warning';
  }

  // Print status
  if (results.overall === 'healthy') {
    console.log('🎉 OVERALL STATUS: ✅ HEALTHY - READY FOR BACKTEST!\n');
    console.log('   All critical systems are operational.');
    console.log('   The AI has full access to all data needed for learning.\n');
  } else if (results.overall === 'error') {
    console.log('🚨 OVERALL STATUS: ❌ CRITICAL ISSUES - DO NOT RUN BACKTEST!\n');
    console.log(`   ${criticalIssues} critical issue(s) must be fixed first.\n`);
  } else {
    console.log('⚠️  OVERALL STATUS: ⚠️  WARNINGS - PROCEED WITH CAUTION\n');
    console.log('   System is functional but not optimal.\n');
  }

  // Print check results
  console.log('Check Results:');
  console.log(`   Database Connection:   ${results.checks.connection ? '✅ OK' : '❌ FAILED'}`);
  console.log(`   Critical Tables:       ${results.checks.criticalTables ? '✅ OK' : '❌ FAILED'} (${results.stats.criticalTables?.existing || 0}/${results.stats.criticalTables?.total || 0})`);
  console.log(`   Optional Tables:       ${results.checks.optionalTables ? '✅ OK' : '⚠️  PARTIAL'} (${results.stats.optionalTables?.existing || 0}/${results.stats.optionalTables?.total || 0})`);
  if (results.checks.dataAccess !== undefined) {
    console.log(`   User Data Access:      ${results.checks.dataAccess ? '✅ OK' : '❌ FAILED'}`);
  }
  console.log();

  // Print critical issues
  if (results.issues.length > 0) {
    console.log('🚨 Critical Issues:');
    results.issues.forEach((issue, idx) => {
      console.log(`   ${idx + 1}. [${issue.category}] ${issue.issue}`);
      console.log(`      Fix: ${issue.fix}`);
    });
    console.log();
  }

  // Print warnings
  if (results.warnings.length > 0) {
    console.log('⚠️  Warnings:');
    results.warnings.forEach((warning, idx) => {
      console.log(`   ${idx + 1}. [${warning.category}] ${warning.issue}`);
      console.log(`      Note: ${warning.fix}`);
    });
    console.log();
  }

  // Print next steps
  if (results.canLearn) {
    console.log('✅ NEXT STEPS:');
    console.log('   1. Start the auto-backtest service');
    console.log('   2. Monitor the first backtest session');
    console.log('   3. Verify AI learning data flows after completion');
    console.log('   4. Check AI Learning Center for insights\n');
  } else {
    console.log('❌ REQUIRED ACTIONS:');
    console.log('   1. Fix all critical issues listed above');
    console.log('   2. Re-run this validation script');
    console.log('   3. Only proceed when all checks pass\n');
  }

  // Print footer
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Validation completed at: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════════════\n');
}

// Run the validation
runValidation().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});

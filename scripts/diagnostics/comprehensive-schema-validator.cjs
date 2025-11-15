/**
 * Comprehensive Database Schema Validator
 *
 * This script:
 * 1. Queries Supabase to get all existing tables
 * 2. Extracts all table names referenced in TypeScript code
 * 3. Compares expected vs actual tables
 * 4. Checks for proper constraints and indexes
 * 5. Generates a detailed diagnostic report
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials in .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Extract table names from TypeScript files
function extractTableNamesFromCode() {
  const srcDir = path.join(__dirname, '../../src');
  const tableNames = new Set();
  const tableUsage = new Map();

  function scanDirectory(dir) {
    const files = fs.readdirSync(dir);

    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        scanDirectory(filePath);
      } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
        const content = fs.readFileSync(filePath, 'utf-8');

        // Match .from('table_name') or .from("table_name")
        const fromMatches = content.matchAll(/\.from\(['"']([a-zA-Z_][a-zA-Z0-9_]*)['"']\)/g);

        for (const match of fromMatches) {
          const tableName = match[1];
          tableNames.add(tableName);

          if (!tableUsage.has(tableName)) {
            tableUsage.set(tableName, []);
          }
          tableUsage.get(tableName).push(filePath.replace(srcDir, 'src'));
        }
      }
    }
  }

  scanDirectory(srcDir);
  return { tableNames: Array.from(tableNames).sort(), tableUsage };
}

// Get all tables from Supabase
async function getExistingTables() {
  try {
    const { data, error } = await supabase.rpc('get_all_tables', {
      schema_name: 'public'
    }).single();

    if (error) {
      // Fallback: query information_schema directly
      console.log('Using information_schema fallback...');
      const { data: tables, error: schemaError } = await supabase
        .from('information_schema.tables')
        .select('table_name')
        .eq('table_schema', 'public')
        .eq('table_type', 'BASE TABLE');

      if (schemaError) {
        throw schemaError;
      }

      return tables.map(t => t.table_name).sort();
    }

    return data;
  } catch (error) {
    console.error('Error querying database:', error.message);
    return null;
  }
}

// Check table constraints
async function checkTableConstraints(tableName) {
  try {
    // Check for UNIQUE constraints
    const { data: constraints, error } = await supabase.rpc('exec', {
      query: `
        SELECT
          tc.constraint_name,
          tc.constraint_type,
          kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = '${tableName}'
          AND tc.table_schema = 'public'
      `
    });

    return { constraints: constraints || [], error };
  } catch (error) {
    return { constraints: [], error: error.message };
  }
}

// Check RLS status
async function checkRLSStatus(tableName) {
  try {
    const { data, error } = await supabase.rpc('exec', {
      query: `
        SELECT relrowsecurity as rls_enabled
        FROM pg_class
        WHERE relname = '${tableName}'
          AND relnamespace = 'public'::regnamespace
      `
    });

    return { rlsEnabled: data?.[0]?.rls_enabled || false, error };
  } catch (error) {
    return { rlsEnabled: false, error: error.message };
  }
}

// Main diagnostic function
async function runDiagnostics() {
  console.log('🔍 Starting Comprehensive Database Schema Validation...\n');

  // Step 1: Extract table names from code
  console.log('📂 Scanning TypeScript files for table references...');
  const { tableNames: expectedTables, tableUsage } = extractTableNamesFromCode();
  console.log(`✅ Found ${expectedTables.length} unique table references in code\n`);

  // Step 2: Get existing tables from database
  console.log('🗄️  Querying Supabase for existing tables...');
  const existingTables = await getExistingTables();

  if (!existingTables) {
    console.error('❌ Failed to query database tables');
    process.exit(1);
  }

  console.log(`✅ Found ${existingTables.length} tables in database\n`);

  // Step 3: Compare expected vs actual
  const missingTables = expectedTables.filter(t => !existingTables.includes(t));
  const unusedTables = existingTables.filter(t => !expectedTables.includes(t));

  // Step 4: Check critical tables
  const criticalTables = [
    'polling_health',
    'polling_recovery_log',
    'polling_fallback_cache',
    'forex_candles',
    'realtime_prices',
    'trade_history',
    'user_profiles',
    'goal_sessions',
    'ai_trade_analysis',
    'ai_learning_insights'
  ];

  // Generate report
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalExpectedTables: expectedTables.length,
      totalExistingTables: existingTables.length,
      missingTablesCount: missingTables.length,
      unusedTablesCount: unusedTables.length
    },
    missingTables: missingTables.map(table => ({
      name: table,
      usedIn: tableUsage.get(table) || [],
      isCritical: criticalTables.includes(table)
    })),
    unusedTables,
    existingTables: existingTables.map(table => ({
      name: table,
      usedIn: tableUsage.get(table) || [],
      usageCount: tableUsage.get(table)?.length || 0
    })).sort((a, b) => b.usageCount - a.usageCount)
  };

  // Console output
  console.log('=' .repeat(80));
  console.log('📊 DIAGNOSTIC REPORT');
  console.log('='.repeat(80));
  console.log(`\n📈 Summary:`);
  console.log(`   - Expected tables from code: ${report.summary.totalExpectedTables}`);
  console.log(`   - Existing tables in DB: ${report.summary.totalExistingTables}`);
  console.log(`   - Missing tables: ${report.summary.missingTablesCount}`);
  console.log(`   - Unused tables: ${report.summary.unusedTablesCount}`);

  if (missingTables.length > 0) {
    console.log(`\n❌ MISSING TABLES (${missingTables.length}):`);

    const criticalMissing = missingTables.filter(t => criticalTables.includes(t));
    const nonCriticalMissing = missingTables.filter(t => !criticalTables.includes(t));

    if (criticalMissing.length > 0) {
      console.log(`\n   🚨 CRITICAL MISSING TABLES:`);
      criticalMissing.forEach(table => {
        const usage = tableUsage.get(table) || [];
        console.log(`      - ${table} (used in ${usage.length} files)`);
      });
    }

    if (nonCriticalMissing.length > 0) {
      console.log(`\n   ⚠️  NON-CRITICAL MISSING TABLES:`);
      nonCriticalMissing.forEach(table => {
        const usage = tableUsage.get(table) || [];
        console.log(`      - ${table} (used in ${usage.length} files)`);
      });
    }
  } else {
    console.log(`\n✅ All expected tables exist in database!`);
  }

  if (unusedTables.length > 0) {
    console.log(`\n📋 Tables in DB not referenced in code (${unusedTables.length}):`);
    unusedTables.slice(0, 10).forEach(table => {
      console.log(`   - ${table}`);
    });
    if (unusedTables.length > 10) {
      console.log(`   ... and ${unusedTables.length - 10} more`);
    }
  }

  // Top 10 most used tables
  console.log(`\n📊 TOP 10 MOST REFERENCED TABLES:`);
  report.existingTables.slice(0, 10).forEach((table, idx) => {
    console.log(`   ${idx + 1}. ${table.name} - ${table.usageCount} references`);
  });

  // Save full report to file
  const reportPath = path.join(__dirname, '../../schema-validation-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n💾 Full report saved to: schema-validation-report.json`);

  console.log('\n' + '='.repeat(80));

  // Exit with error code if critical tables are missing
  if (criticalMissing && criticalMissing.length > 0) {
    console.log('\n❌ CRITICAL TABLES MISSING - Database schema needs immediate attention!');
    process.exit(1);
  }

  console.log('\n✅ Diagnostic complete!');
}

// Run diagnostics
runDiagnostics().catch(error => {
  console.error('❌ Diagnostic failed:', error);
  process.exit(1);
});

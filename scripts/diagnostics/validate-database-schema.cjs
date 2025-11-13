#!/usr/bin/env node

/**
 * Database Schema Validation Script
 * Checks which tables exist in the database vs migrations
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('ERROR: Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function getExistingTables() {
  const { data, error } = await supabase.rpc('exec_sql', {
    query: `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `
  });

  if (error) {
    console.error('Error fetching tables:', error);
    return [];
  }

  return data || [];
}

async function checkTableExists(tableName) {
  const { data, error } = await supabase
    .from(tableName)
    .select('*')
    .limit(0);

  return !error;
}

async function validateSchema() {
  console.log('=' .repeat(80));
  console.log('DATABASE SCHEMA VALIDATION');
  console.log('=' .repeat(80));
  console.log(`\nConnecting to: ${supabaseUrl}`);

  // Load migration audit report
  const reportPath = path.join(__dirname, 'migration-audit-report.json');
  if (!fs.existsSync(reportPath)) {
    console.error('\nERROR: Run audit-migrations.cjs first to generate the report');
    process.exit(1);
  }

  const auditReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const expectedTables = Object.keys(auditReport.tableMap).filter(t => t !== 'to').sort();

  console.log(`\nExpected tables from migrations: ${expectedTables.length}`);

  // Check each table
  console.log('\n' + '=' .repeat(80));
  console.log('TABLE EXISTENCE CHECK');
  console.log('=' .repeat(80));

  const results = {
    existing: [],
    missing: [],
    total: expectedTables.length
  };

  for (const tableName of expectedTables) {
    const exists = await checkTableExists(tableName);

    if (exists) {
      results.existing.push(tableName);
      console.log(`✓ ${tableName}`);
    } else {
      results.missing.push(tableName);
      console.log(`✗ ${tableName} [MISSING]`);
    }
  }

  // Summary
  console.log('\n' + '=' .repeat(80));
  console.log('VALIDATION SUMMARY');
  console.log('=' .repeat(80));
  console.log(`\nTotal Expected Tables: ${results.total}`);
  console.log(`Existing in Database: ${results.existing.length} (${((results.existing.length / results.total) * 100).toFixed(1)}%)`);
  console.log(`Missing from Database: ${results.missing.length}`);

  if (results.missing.length > 0) {
    console.log('\n' + '=' .repeat(80));
    console.log('MISSING TABLES DETAILS');
    console.log('=' .repeat(80));

    results.missing.forEach(tableName => {
      const migrations = auditReport.tableMap[tableName];
      console.log(`\n${tableName}:`);
      console.log(`  Created in ${migrations.length} migration(s):`);
      migrations.forEach((m, idx) => {
        console.log(`    ${idx + 1}. ${m.file}`);
      });
    });

    console.log('\n' + '=' .repeat(80));
    console.log('RECOMMENDED MIGRATIONS TO RUN');
    console.log('=' .repeat(80));

    // Find the earliest migration for each missing table
    const migrationsToRun = new Set();
    results.missing.forEach(tableName => {
      const migrations = auditReport.tableMap[tableName];
      // Pick the earliest migration (first one in the list)
      const earliestMigration = migrations.sort((a, b) => a.file.localeCompare(b.file))[0];
      migrationsToRun.add(earliestMigration.file);
    });

    console.log('\nRun these migrations in order:');
    Array.from(migrationsToRun).sort().forEach((migration, idx) => {
      console.log(`  ${idx + 1}. ${migration}`);
    });
  } else {
    console.log('\n✓ All expected tables exist in the database!');
  }

  console.log('\n' + '=' .repeat(80));

  // Save results
  const resultsPath = path.join(__dirname, 'schema-validation-results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`\nValidation results saved to: ${resultsPath}`);

  return results;
}

// Run validation
validateSchema()
  .then(() => {
    console.log('\nValidation complete!');
    process.exit(0);
  })
  .catch(err => {
    console.error('\nValidation failed:', err);
    process.exit(1);
  });

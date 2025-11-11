#!/usr/bin/env node

/**
 * Safe Migration Runner
 * Applies missing migrations in order with safety checks
 * Usage: node safe-migration-runner.cjs [--dry-run] [--migrations migration1.sql,migration2.sql]
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const MIGRATIONS_DIR = path.join(__dirname, 'supabase', 'migrations');

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const specificMigrations = args.find(arg => arg.startsWith('--migrations='))?.split('=')[1]?.split(',');

// Load validation results
const validationResultsPath = path.join(__dirname, 'schema-validation-results.json');
if (!fs.existsSync(validationResultsPath)) {
  console.error('ERROR: Run validate-database-schema.cjs first!');
  process.exit(1);
}

const validationResults = JSON.parse(fs.readFileSync(validationResultsPath, 'utf8'));

// Load audit report
const auditReportPath = path.join(__dirname, 'migration-audit-report.json');
if (!fs.existsSync(auditReportPath)) {
  console.error('ERROR: Run audit-migrations.cjs first!');
  process.exit(1);
}

const auditReport = JSON.parse(fs.readFileSync(auditReportPath, 'utf8'));

console.log('=' .repeat(80));
console.log('SAFE MIGRATION RUNNER');
console.log('=' .repeat(80));
console.log(`\nMode: ${isDryRun ? 'DRY RUN (no changes will be made)' : 'LIVE EXECUTION'}`);
console.log(`Missing Tables: ${validationResults.missing.length}`);

if (validationResults.missing.length === 0) {
  console.log('\n✓ No missing tables! Database is up to date.');
  process.exit(0);
}

// Determine which migrations to run
let migrationsToRun = new Set();

if (specificMigrations) {
  console.log(`\nRunning specific migrations: ${specificMigrations.join(', ')}`);
  migrationsToRun = new Set(specificMigrations);
} else {
  // Find the earliest migration for each missing table
  validationResults.missing.forEach(tableName => {
    const migrations = auditReport.tableMap[tableName];
    if (migrations && migrations.length > 0) {
      // Pick the earliest migration (first one alphabetically)
      const earliestMigration = migrations.sort((a, b) => a.file.localeCompare(b.file))[0];
      migrationsToRun.add(earliestMigration.file);
    }
  });
}

const sortedMigrations = Array.from(migrationsToRun).sort();

console.log('\n' + '=' .repeat(80));
console.log('MIGRATIONS TO APPLY');
console.log('=' .repeat(80));

sortedMigrations.forEach((migration, idx) => {
  console.log(`  ${idx + 1}. ${migration}`);
});

console.log('\n' + '=' .repeat(80));
console.log('MIGRATION CONTENTS PREVIEW');
console.log('=' .repeat(80));

sortedMigrations.forEach(migration => {
  const migrationPath = path.join(MIGRATIONS_DIR, migration);

  if (!fs.existsSync(migrationPath)) {
    console.log(`\n⚠ WARNING: ${migration} not found!`);
    return;
  }

  const content = fs.readFileSync(migrationPath, 'utf8');
  const lines = content.split('\n');

  console.log(`\n--- ${migration} ---`);
  console.log(`Size: ${content.length} bytes, ${lines.length} lines`);

  // Extract and show table creations
  const tableCreations = content.match(/CREATE TABLE\s+(IF NOT EXISTS\s+)?([a-z_]+)/gi) || [];
  if (tableCreations.length > 0) {
    console.log('Tables to create:');
    tableCreations.forEach(match => {
      const hasIfNotExists = /IF NOT EXISTS/i.test(match);
      const tableName = match.replace(/CREATE TABLE\s+(IF NOT EXISTS\s+)?/i, '');
      const safetyIndicator = hasIfNotExists ? '✓' : '⚠';
      console.log(`  ${safetyIndicator} ${tableName}`);
    });
  }

  // Check for unsafe operations
  const unsafeOperations = [];
  if (/DROP TABLE/i.test(content)) unsafeOperations.push('DROP TABLE');
  if (/DROP COLUMN/i.test(content)) unsafeOperations.push('DROP COLUMN');
  if (/TRUNCATE/i.test(content)) unsafeOperations.push('TRUNCATE');

  if (unsafeOperations.length > 0) {
    console.log('⚠ WARNING: Contains potentially destructive operations:');
    unsafeOperations.forEach(op => console.log(`  - ${op}`));
  }
});

if (isDryRun) {
  console.log('\n' + '=' .repeat(80));
  console.log('DRY RUN COMPLETE');
  console.log('=' .repeat(80));
  console.log('\nNo changes were made to the database.');
  console.log('To apply these migrations, run without --dry-run flag.');
  console.log('\nRecommended approach:');
  console.log('  1. Review the migration contents above');
  console.log('  2. Apply migrations one at a time using Supabase Dashboard SQL Editor');
  console.log('  3. Verify each migration succeeded before proceeding to the next');
  console.log('  4. Run validate-database-schema.cjs again to verify completion');
} else {
  console.log('\n' + '=' .repeat(80));
  console.log('APPLICATION INSTRUCTIONS');
  console.log('=' .repeat(80));
  console.log('\nThis script cannot directly apply migrations.');
  console.log('Please apply them manually using one of these methods:');
  console.log('\n1. Supabase Dashboard SQL Editor:');
  console.log('   - Go to your Supabase project dashboard');
  console.log('   - Navigate to SQL Editor');
  console.log('   - Copy and paste each migration file content');
  console.log('   - Execute in order');
  console.log('\n2. Using apply_missing_migrations.sql:');
  console.log('   - This consolidated file contains common missing tables');
  console.log('   - Run it in the SQL Editor first');
  console.log('   - Then run specific migrations for remaining tables');

  console.log('\n3. Using the MCP Supabase tool:');
  console.log('   - Use mcp__supabase__apply_migration for each file');

  console.log('\n' + '=' .repeat(80));
  console.log('NEXT STEPS');
  console.log('=' .repeat(80));
  console.log('\n1. Apply migrations in the order shown above');
  console.log('2. After each migration, verify it succeeded');
  console.log('3. Run: node validate-database-schema.cjs');
  console.log('4. Repeat until all tables exist');
}

console.log('\n' + '=' .repeat(80));
console.log('END OF SAFE MIGRATION RUNNER');
console.log('=' .repeat(80));

// Save migration plan
const planPath = path.join(__dirname, 'migration-execution-plan.json');
const plan = {
  timestamp: new Date().toISOString(),
  mode: isDryRun ? 'dry-run' : 'execution-plan',
  migrationsToRun: sortedMigrations,
  missingTables: validationResults.missing,
  summary: {
    totalMigrations: sortedMigrations.length,
    totalMissingTables: validationResults.missing.length
  }
};
fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
console.log(`\nExecution plan saved to: ${planPath}\n`);

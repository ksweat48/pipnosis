#!/usr/bin/env node

/**
 * Migration Audit Script
 * Analyzes all migration files to identify:
 * - Duplicate migrations
 * - Tables created by each migration
 * - Missing IF NOT EXISTS checks
 * - Potential conflicts
 */

const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, 'supabase', 'migrations');

function extractTableNames(sqlContent) {
  const tableRegex = /CREATE TABLE\s+(IF NOT EXISTS\s+)?([a-z_]+)/gi;
  const tables = [];
  let match;

  while ((match = tableRegex.exec(sqlContent)) !== null) {
    tables.push({
      name: match[2],
      hasIfNotExists: !!match[1]
    });
  }

  return tables;
}

function extractFunctions(sqlContent) {
  const functionRegex = /CREATE\s+(OR REPLACE\s+)?FUNCTION\s+([a-z_]+)/gi;
  const functions = [];
  let match;

  while ((match = functionRegex.exec(sqlContent)) !== null) {
    functions.push({
      name: match[2],
      hasOrReplace: !!match[1]
    });
  }

  return functions;
}

function extractIndexes(sqlContent) {
  const indexRegex = /CREATE\s+(UNIQUE\s+)?INDEX\s+(IF NOT EXISTS\s+)?([a-z_]+)/gi;
  const indexes = [];
  let match;

  while ((match = indexRegex.exec(sqlContent)) !== null) {
    indexes.push({
      name: match[3],
      hasIfNotExists: !!match[2],
      isUnique: !!match[1]
    });
  }

  return indexes;
}

function analyzeMigrations() {
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const analysis = {
    totalMigrations: files.length,
    migrations: [],
    tableMap: {},
    functionMap: {},
    indexMap: {},
    duplicates: [],
    unsafeCreations: []
  };

  files.forEach(file => {
    const filePath = path.join(migrationsDir, file);
    const content = fs.readFileSync(filePath, 'utf8');

    const tables = extractTableNames(content);
    const functions = extractFunctions(content);
    const indexes = extractIndexes(content);

    const migrationInfo = {
      file,
      tables,
      functions,
      indexes,
      size: content.length
    };

    analysis.migrations.push(migrationInfo);

    // Track tables
    tables.forEach(table => {
      if (!analysis.tableMap[table.name]) {
        analysis.tableMap[table.name] = [];
      }
      analysis.tableMap[table.name].push({ file, hasIfNotExists: table.hasIfNotExists });

      // Track unsafe creations
      if (!table.hasIfNotExists) {
        analysis.unsafeCreations.push({
          file,
          type: 'table',
          name: table.name
        });
      }
    });

    // Track functions
    functions.forEach(func => {
      if (!analysis.functionMap[func.name]) {
        analysis.functionMap[func.name] = [];
      }
      analysis.functionMap[func.name].push({ file, hasOrReplace: func.hasOrReplace });
    });

    // Track indexes
    indexes.forEach(idx => {
      if (!analysis.indexMap[idx.name]) {
        analysis.indexMap[idx.name] = [];
      }
      analysis.indexMap[idx.name].push({ file, hasIfNotExists: idx.hasIfNotExists });

      if (!idx.hasIfNotExists) {
        analysis.unsafeCreations.push({
          file,
          type: 'index',
          name: idx.name
        });
      }
    });
  });

  // Identify duplicates
  Object.entries(analysis.tableMap).forEach(([tableName, occurrences]) => {
    if (occurrences.length > 1) {
      analysis.duplicates.push({
        type: 'table',
        name: tableName,
        files: occurrences.map(o => o.file)
      });
    }
  });

  return analysis;
}

function generateReport(analysis) {
  console.log('=' .repeat(80));
  console.log('MIGRATION AUDIT REPORT');
  console.log('=' .repeat(80));
  console.log(`\nTotal Migrations: ${analysis.totalMigrations}`);
  console.log(`Total Tables Created: ${Object.keys(analysis.tableMap).length}`);
  console.log(`Total Functions Created: ${Object.keys(analysis.functionMap).length}`);
  console.log(`Total Indexes Created: ${Object.keys(analysis.indexMap).length}`);

  console.log('\n' + '=' .repeat(80));
  console.log('DUPLICATE TABLE DEFINITIONS');
  console.log('=' .repeat(80));

  if (analysis.duplicates.length === 0) {
    console.log('\nNo duplicate table definitions found.');
  } else {
    analysis.duplicates.forEach(dup => {
      console.log(`\n${dup.type.toUpperCase()}: ${dup.name}`);
      console.log(`Created in ${dup.files.length} migrations:`);
      dup.files.forEach((file, idx) => {
        console.log(`  ${idx + 1}. ${file}`);
      });
    });
  }

  console.log('\n' + '=' .repeat(80));
  console.log('UNSAFE CREATIONS (Missing IF NOT EXISTS)');
  console.log('=' .repeat(80));

  if (analysis.unsafeCreations.length === 0) {
    console.log('\nAll creations have safety checks.');
  } else {
    const unsafeByFile = {};
    analysis.unsafeCreations.forEach(item => {
      if (!unsafeByFile[item.file]) {
        unsafeByFile[item.file] = [];
      }
      unsafeByFile[item.file].push(`${item.type}: ${item.name}`);
    });

    Object.entries(unsafeByFile).forEach(([file, items]) => {
      console.log(`\n${file}:`);
      items.forEach(item => console.log(`  - ${item}`));
    });
  }

  console.log('\n' + '=' .repeat(80));
  console.log('ALL TABLES IN DATABASE SCHEMA');
  console.log('=' .repeat(80));

  const sortedTables = Object.entries(analysis.tableMap).sort(([a], [b]) => a.localeCompare(b));
  sortedTables.forEach(([tableName, occurrences]) => {
    const status = occurrences.length > 1 ? ' [DUPLICATE]' : '';
    const safe = occurrences.every(o => o.hasIfNotExists) ? ' ✓' : ' ⚠';
    console.log(`\n${tableName}${status}${safe}`);
    occurrences.forEach(occ => {
      console.log(`  - ${occ.file}`);
    });
  });

  console.log('\n' + '=' .repeat(80));
  console.log('RECOMMENDED ACTIONS');
  console.log('=' .repeat(80));

  console.log('\n1. Duplicate Migrations:');
  if (analysis.duplicates.length > 0) {
    console.log('   - Keep the earliest migration file for each table');
    console.log('   - Archive or delete duplicate migrations');
    console.log('   - Update application to reference the canonical migration');
  } else {
    console.log('   - No action needed');
  }

  console.log('\n2. Unsafe Creations:');
  if (analysis.unsafeCreations.length > 0) {
    console.log(`   - ${analysis.unsafeCreations.length} objects created without safety checks`);
    console.log('   - Add IF NOT EXISTS to CREATE TABLE statements');
    console.log('   - Add IF NOT EXISTS to CREATE INDEX statements');
    console.log('   - Add OR REPLACE to CREATE FUNCTION statements');
  } else {
    console.log('   - All creations are safe to re-run');
  }

  console.log('\n' + '=' .repeat(80));
  console.log('END OF REPORT');
  console.log('=' .repeat(80));

  // Save detailed JSON report
  const reportPath = path.join(__dirname, 'migration-audit-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(analysis, null, 2));
  console.log(`\nDetailed JSON report saved to: ${reportPath}`);
}

// Run the analysis
const analysis = analyzeMigrations();
generateReport(analysis);

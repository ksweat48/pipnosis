/**
 * Supabase Migration Runner for Pipnosis
 * 
 * This script helps you run the database migration for Pipnosis directly from your local machine.
 * It connects to your Supabase project using the service role key and executes the migration SQL.
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

// Get Supabase credentials from environment variables
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to migrations directory
const migrationsDir = path.join(__dirname, 'supabase', 'migrations');

async function main() {
  console.log('🚀 Supabase Migration Runner for Pipnosis');
  console.log('========================================');
  console.log('');

  // Check if environment variables are set
  if (!supabaseUrl || !supabaseServiceKey) {
    console.log('❌ Supabase credentials not found in .env file');
    console.log('Please make sure you have set the following variables in your .env file:');
    console.log('- SUPABASE_URL or VITE_SUPABASE_URL');
    console.log('- SUPABASE_SERVICE_ROLE_KEY');
    return;
  }

  console.log(`✅ Using Supabase URL: ${supabaseUrl}`);
  console.log(`✅ Service role key found (first 10 chars): ${supabaseServiceKey.substring(0, 10)}...`);

  // Create Supabase client with service role key
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Check if migrations directory exists
  if (!fs.existsSync(migrationsDir)) {
    console.log('❌ Migrations directory not found:', migrationsDir);
    return;
  }

  // Get all migration files
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();

  if (migrationFiles.length === 0) {
    console.log('❌ No migration files found in:', migrationsDir);
    return;
  }

  console.log(`\n📋 Found ${migrationFiles.length} migration files:`);
  migrationFiles.forEach((file, index) => {
    console.log(`   ${index + 1}. ${file}`);
  });

  // Get the latest migration file
  const latestMigration = migrationFiles[migrationFiles.length - 1];
  console.log(`\n🚀 Running latest migration: ${latestMigration}...`);

  const filePath = path.join(migrationsDir, latestMigration);
  const sql = fs.readFileSync(filePath, 'utf8');
  
  try {
    // Execute the SQL directly using the pg_query RPC function
    const { error } = await supabase.rpc('pg_query', { query: sql });
    
    if (error) {
      console.log(`❌ Migration failed: ${error.message}`);
      
      // Check for common errors
      if (error.message.includes('already exists')) {
        console.log('   This appears to be a duplicate table error. The table might already exist.');
        console.log('   This is usually not a problem if you\'re re-running migrations.');
      } else if (error.message.includes('does not exist')) {
        console.log('   This appears to be a missing table error.');
        console.log('   Make sure you run migrations in the correct order.');
      }
    } else {
      console.log(`✅ Migration successful: ${latestMigration}`);
      
      // Verify tables were created
      console.log('\n🔍 Verifying tables were created...');
      
      const tables = [
        'user_profiles',
        'trading_prompts',
        'trade_records',
        'journal_entries',
        'trading_sessions',
        'waitlist'
      ];
      
      for (const table of tables) {
        try {
          const { data, error, count } = await supabase
            .from(table)
            .select('*', { count: 'exact', head: true });
          
          if (error) {
            if (error.code === 'PGRST116') {
              console.log(`✅ Table ${table} exists but is empty`);
            } else {
              console.log(`❌ Error checking table ${table}: ${error.message}`);
            }
          } else {
            console.log(`✅ Table ${table} exists with ${count} records`);
          }
        } catch (error) {
          console.log(`❌ Error checking table ${table}: ${error.message}`);
        }
      }
    }
  } catch (error) {
    console.log(`❌ Error running migration: ${error.message}`);
  }

  console.log('\n🎯 Migration process completed!');
  console.log('\nNext steps:');
  console.log('1. Restart your development server');
  console.log('2. Check the database connection in the app');
  console.log('3. If issues persist, check the console for specific errors');
}

main().catch(console.error);
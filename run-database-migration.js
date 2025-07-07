/**
 * Pipnosis Database Migration Runner
 * 
 * This script helps you run the database migration for Pipnosis.
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import readline from 'readline';

// Load environment variables
dotenv.config();

// Get Supabase credentials from environment variables
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function main() {
  console.log('🔍 Pipnosis Database Migration Runner');
  console.log('====================================');
  console.log('');

  // Check if environment variables are set
  if (!supabaseUrl || !supabaseServiceKey) {
    console.log('❌ Supabase credentials not found in .env file');
    console.log('Please make sure you have set the following variables in your .env file:');
    console.log('- VITE_SUPABASE_URL');
    console.log('- SUPABASE_SERVICE_ROLE_KEY');
    rl.close();
    return;
  }

  console.log(`✅ Using Supabase URL: ${supabaseUrl}`);
  console.log(`✅ Service role key found (first 10 chars): ${supabaseServiceKey.substring(0, 10)}...`);

  // Create Supabase client with service role key
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Check if migrations directory exists
  const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.log('❌ Migrations directory not found:', migrationsDir);
    rl.close();
    return;
  }

  // Get all migration files
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();

  if (migrationFiles.length === 0) {
    console.log('❌ No migration files found in:', migrationsDir);
    rl.close();
    return;
  }

  console.log(`\n📋 Found ${migrationFiles.length} migration files:`);
  migrationFiles.forEach((file, index) => {
    console.log(`   ${index + 1}. ${file}`);
  });

  // Ask user which migration to run
  rl.question('\n🔍 Which migration would you like to run? (Enter number or "all" for all migrations): ', async (answer) => {
    let filesToRun = [];

    if (answer.toLowerCase() === 'all') {
      filesToRun = migrationFiles;
      console.log(`\n🚀 Running all ${migrationFiles.length} migrations...`);
    } else {
      const index = parseInt(answer) - 1;
      if (isNaN(index) || index < 0 || index >= migrationFiles.length) {
        console.log('❌ Invalid selection');
        rl.close();
        return;
      }
      filesToRun = [migrationFiles[index]];
      console.log(`\n🚀 Running migration: ${filesToRun[0]}...`);
    }

    // Run each selected migration
    for (const file of filesToRun) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      
      console.log(`\n📄 Running migration: ${file}`);
      try {
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
          console.log(`✅ Migration successful: ${file}`);
        }
      } catch (error) {
        console.log(`❌ Error running migration: ${error.message}`);
      }
    }

    console.log('\n🎯 Migration process completed!');
    console.log('\nNext steps:');
    console.log('1. Restart your development server');
    console.log('2. Check the database connection in the app');
    console.log('3. If issues persist, check the console for specific errors');
    
    rl.close();
  });
}

main();
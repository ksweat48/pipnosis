/**
 * Pipnosis Local Database Setup
 * 
 * This script helps you set up the local database for Pipnosis.
 * It will:
 * 1. Check your Supabase connection
 * 2. Run the database migration if needed
 * 3. Create a test user profile
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
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function main() {
  console.log('🚀 Pipnosis Local Database Setup');
  console.log('===============================');
  console.log('');

  // Check if environment variables are set
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    console.log('❌ Supabase credentials not found in .env file');
    console.log('Please make sure you have set the following variables in your .env file:');
    console.log('- VITE_SUPABASE_URL');
    console.log('- VITE_SUPABASE_ANON_KEY');
    console.log('- SUPABASE_SERVICE_ROLE_KEY');
    rl.close();
    return;
  }

  console.log(`✅ Using Supabase URL: ${supabaseUrl}`);
  console.log(`✅ Anon key found (first 10 chars): ${supabaseAnonKey.substring(0, 10)}...`);
  console.log(`✅ Service role key found (first 10 chars): ${supabaseServiceKey.substring(0, 10)}...`);

  // Create Supabase client with service role key
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Step 1: Check if tables exist
  console.log('\n🔍 Step 1: Checking if database tables exist...');
  try {
    const { data, error, count } = await supabase
      .from('user_profiles')
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      if (error.code === '42P01') {
        console.log('❌ Table "user_profiles" does not exist');
        console.log('   You need to run the database migration');
        
        // Ask if user wants to run the migration
        rl.question('\n🔍 Would you like to run the database migration now? (y/n): ', async (answer) => {
          if (answer.toLowerCase() === 'y') {
            await runMigration(supabase);
          } else {
            console.log('\n❌ Migration skipped. Your database is not set up.');
            console.log('   You can run the migration later using the Supabase SQL Editor.');
            rl.close();
          }
        });
      } else if (error.code === 'PGRST116') {
        console.log('✅ Table exists but is empty - this is normal for a new setup');
        await checkUserProfiles(supabase);
      } else {
        console.log(`❌ Query error: ${error.message}`);
        rl.close();
      }
    } else {
      console.log('✅ Database tables exist');
      console.log(`   Found ${count} records in user_profiles table`);
      await checkUserProfiles(supabase);
    }
  } catch (error) {
    console.log(`❌ Error checking tables: ${error.message}`);
    rl.close();
  }
}

async function runMigration(supabase) {
  console.log('\n🚀 Running database migration...');
  
  // Get the latest migration file
  const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.log('❌ Migrations directory not found:', migrationsDir);
    rl.close();
    return;
  }

  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();

  if (migrationFiles.length === 0) {
    console.log('❌ No migration files found in:', migrationsDir);
    rl.close();
    return;
  }

  const latestMigration = migrationFiles[migrationFiles.length - 1];
  const filePath = path.join(migrationsDir, latestMigration);
  const sql = fs.readFileSync(filePath, 'utf8');
  
  console.log(`📄 Running migration: ${latestMigration}`);
  try {
    const { error } = await supabase.rpc('pg_query', { query: sql });
    if (error) {
      console.log(`❌ Migration failed: ${error.message}`);
      rl.close();
    } else {
      console.log(`✅ Migration successful: ${latestMigration}`);
      await checkUserProfiles(supabase);
    }
  } catch (error) {
    console.log(`❌ Error running migration: ${error.message}`);
    rl.close();
  }
}

async function checkUserProfiles(supabase) {
  console.log('\n🔍 Step 2: Checking for user profiles...');
  
  // Check if any user profiles exist
  const { data, error, count } = await supabase
    .from('user_profiles')
    .select('*', { count: 'exact' });
  
  if (error) {
    console.log(`❌ Error checking user profiles: ${error.message}`);
    rl.close();
    return;
  }
  
  if (count === 0) {
    console.log('❌ No user profiles found');
    
    // Ask if user wants to create a test profile
    rl.question('\n🔍 Would you like to create a test user profile? (y/n): ', async (answer) => {
      if (answer.toLowerCase() === 'y') {
        await createTestUser(supabase);
      } else {
        console.log('\n✅ Setup complete. You can create users through the application.');
        rl.close();
      }
    });
  } else {
    console.log(`✅ Found ${count} user profiles`);
    console.log('\n✅ Database setup complete!');
    console.log('\nNext steps:');
    console.log('1. Restart your development server');
    console.log('2. Sign in with one of the existing users');
    console.log('3. If issues persist, check the console for specific errors');
    rl.close();
  }
}

async function createTestUser(supabase) {
  console.log('\n🚀 Creating test user...');
  
  // First create auth user
  const email = 'test@example.com';
  const password = 'password123';
  
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  
  if (authError) {
    console.log(`❌ Error creating auth user: ${authError.message}`);
    rl.close();
    return;
  }
  
  console.log('✅ Auth user created successfully');
  
  // Now create user profile
  const { data: profileData, error: profileError } = await supabase
    .from('user_profiles')
    .insert([
      {
        id: authData.user.id,
        email: email,
        full_name: 'Test User',
        plan_type: 'free',
        account_balance: 10000.00,
        risk_profile: 'auto',
        trading_preferences: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ])
    .select();
  
  if (profileError) {
    console.log(`❌ Error creating user profile: ${profileError.message}`);
    rl.close();
    return;
  }
  
  console.log('✅ User profile created successfully');
  console.log('\n✅ Test user created:');
  console.log(`   Email: ${email}`);
  console.log(`   Password: ${password}`);
  console.log('\n✅ Database setup complete!');
  console.log('\nNext steps:');
  console.log('1. Restart your development server');
  console.log('2. Sign in with the test user credentials');
  console.log('3. If issues persist, check the console for specific errors');
  rl.close();
}

main();
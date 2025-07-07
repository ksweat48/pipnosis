/**
 * Pipnosis Database Connection Checker
 * 
 * This script checks your Supabase database connection and helps troubleshoot issues.
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Get Supabase credentials from environment variables
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

console.log('🔍 Checking Supabase Database Connection');
console.log('========================================');
console.log('');

// Check if environment variables are set
console.log('1. Checking environment variables:');
if (!supabaseUrl) {
  console.log('❌ VITE_SUPABASE_URL is not set in .env file');
} else {
  console.log(`✅ VITE_SUPABASE_URL: ${supabaseUrl}`);
}

if (!supabaseAnonKey) {
  console.log('❌ VITE_SUPABASE_ANON_KEY is not set in .env file');
} else {
  console.log(`✅ VITE_SUPABASE_ANON_KEY: ${supabaseAnonKey.substring(0, 10)}...`);
}

// Check if .env file exists
console.log('\n2. Checking .env file:');
if (fs.existsSync('.env')) {
  console.log('✅ .env file exists');
  const envContent = fs.readFileSync('.env', 'utf8');
  console.log('📋 .env file content:');
  
  // Print each line, masking sensitive values
  envContent.split('\n').forEach(line => {
    if (line.trim() && !line.startsWith('#')) {
      const [key, value] = line.split('=');
      if (key && value) {
        if (key.includes('KEY') || key.includes('SECRET')) {
          console.log(`   ${key}=${value.substring(0, 10)}...`);
        } else {
          console.log(`   ${key}=${value}`);
        }
      }
    }
  });
} else {
  console.log('❌ .env file does not exist');
  console.log('   Create a .env file by copying .env.example');
}

// Check if Supabase client can be created
console.log('\n3. Testing Supabase connection:');
if (!supabaseUrl || !supabaseAnonKey) {
  console.log('❌ Cannot test connection - missing credentials');
} else {
  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    console.log('✅ Supabase client created successfully');
    
    // Test a simple query
    console.log('\n4. Testing database query:');
    try {
      const { data, error, count } = await supabase
        .from('user_profiles')
        .select('*', { count: 'exact', head: true });
      
      if (error) {
        if (error.code === '42P01') {
          console.log('❌ Table "user_profiles" does not exist');
          console.log('   You need to run the database migration');
          console.log('   Go to Supabase dashboard → SQL Editor and run the migration SQL');
        } else if (error.code === 'PGRST116') {
          console.log('✅ Table exists but is empty - this is normal for a new setup');
        } else {
          console.log(`❌ Query error: ${error.message}`);
        }
      } else {
        console.log('✅ Database query successful');
        console.log(`   Found ${count} records in user_profiles table`);
      }
    } catch (error) {
      console.log(`❌ Query failed: ${error.message}`);
    }
  } catch (error) {
    console.log(`❌ Failed to create Supabase client: ${error.message}`);
  }
}

console.log('\n5. Recommendations:');
if (!supabaseUrl || !supabaseAnonKey) {
  console.log('1. Create a .env file by copying .env.example');
  console.log('2. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env file');
  console.log('3. Get these values from your Supabase dashboard → Settings → API');
} else {
  console.log('1. Make sure your Supabase project is active');
  console.log('2. Run the database migration in Supabase SQL Editor');
  console.log('3. Restart the development server after making changes');
}

console.log('\nFor more information, see docs/SUPABASE_SETUP.md');
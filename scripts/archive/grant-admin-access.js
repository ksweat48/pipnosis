#!/usr/bin/env node

/**
 * Quick script to grant admin access to current user
 * Run with: node scripts/grant-admin-access.js
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials in .env file');
  console.error('Required: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function grantAdminAccess() {
  console.log('🚀 Granting admin access to all users...\n');

  try {
    // Read the migration file
    const migrationPath = join(__dirname, '..', 'supabase', 'migrations', '20251117000000_grant_admin_access_and_auto_profile.sql');

    if (!fs.existsSync(migrationPath)) {
      console.error('❌ Migration file not found:', migrationPath);
      process.exit(1);
    }

    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Applying migration...');

    // Execute the migration
    const { error } = await supabase.rpc('exec', { sql: migrationSQL });

    if (error) {
      console.error('❌ Error applying migration:', error);
      console.log('\n💡 Try applying the migration manually in Supabase SQL Editor:');
      console.log('   1. Go to your Supabase Dashboard');
      console.log('   2. Navigate to SQL Editor');
      console.log('   3. Copy and paste the migration file contents');
      console.log('   4. Run the query');
      process.exit(1);
    }

    console.log('✅ Migration applied successfully!\n');

    // Verify admin users
    const { data: adminUsers, error: queryError } = await supabase
      .from('user_profiles')
      .select('email, is_admin')
      .eq('is_admin', true);

    if (queryError) {
      console.error('⚠️  Could not verify admin users:', queryError.message);
    } else {
      console.log(`✅ ${adminUsers.length} admin user(s) configured:\n`);
      adminUsers.forEach(user => {
        console.log(`   - ${user.email}`);
      });
    }

    console.log('\n✨ All done! Refresh the AI Training Lab page to access it.');

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    console.log('\n📖 See GRANT_ADMIN_ACCESS.md for manual instructions');
    process.exit(1);
  }
}

grantAdminAccess();

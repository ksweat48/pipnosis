// Test script to verify Supabase migration
import { supabase } from '../server/lib/supabase.js';

async function testMigration() {
  console.log('🧪 Testing Supabase Migration...\n');

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
      const { data, error } = await supabase
        .from(table)
        .select('count')
        .limit(1);

      if (error) {
        console.log(`❌ ${table}: ${error.message}`);
      } else {
        console.log(`✅ ${table}: Table exists and accessible`);
      }
    } catch (err) {
      console.log(`❌ ${table}: ${err.message}`);
    }
  }

  // Test waitlist insertion (public table)
  try {
    const { data, error } = await supabase
      .from('waitlist')
      .insert({
        email: 'test@example.com',
        plan_type: 'beta'
      })
      .select()
      .single();

    if (error && error.code !== '23505') { // Ignore duplicate email
      console.log(`❌ Waitlist insert test: ${error.message}`);
    } else {
      console.log(`✅ Waitlist insert test: Success`);
    }
  } catch (err) {
    console.log(`❌ Waitlist insert test: ${err.message}`);
  }

  console.log('\n🎯 Migration test complete!');
}

// Run the test
testMigration().catch(console.error);
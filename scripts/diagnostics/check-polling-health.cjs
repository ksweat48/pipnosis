/**
 * Quick Polling Health Check Script
 *
 * Run this anytime to check the status of your polling system:
 * node scripts/diagnostics/check-polling-health.cjs
 */

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials in .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkPollingHealth() {
  console.log('🔍 Checking Polling System Health...\n');

  try {
    // Check if tables exist
    const { data: healthData, error: healthError } = await supabase
      .from('polling_health')
      .select('*')
      .order('symbol');

    if (healthError) {
      console.error('❌ Error accessing polling_health table:', healthError.message);
      console.log('\n💡 The polling_health table might not exist or have permission issues.');
      process.exit(1);
    }

    const { data: recoveryData, error: recoveryError } = await supabase
      .from('polling_recovery_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);

    if (recoveryError) {
      console.error('❌ Error accessing polling_recovery_log table:', recoveryError.message);
    }

    const { data: cacheData, error: cacheError } = await supabase
      .from('polling_fallback_cache')
      .select('*')
      .order('cached_at', { ascending: false });

    if (cacheError) {
      console.error('❌ Error accessing polling_fallback_cache table:', cacheError.message);
    }

    // Display Health Status
    console.log('=' .repeat(80));
    console.log('📊 POLLING HEALTH STATUS');
    console.log('='.repeat(80));

    if (healthData && healthData.length > 0) {
      console.log('\n');

      const statusIcons = {
        active: '✅',
        degraded: '⚠️',
        critical: '🔥',
        stopped: '❌'
      };

      const circuitIcons = {
        closed: '✅',
        half_open: '⚠️',
        open: '❌'
      };

      healthData.forEach(health => {
        const statusIcon = statusIcons[health.status] || '❓';
        const circuitIcon = circuitIcons[health.circuit_breaker_state] || '❓';

        console.log(`${statusIcon} ${health.symbol.padEnd(20)}`);
        console.log(`   Status: ${health.status.toUpperCase()}`);
        console.log(`   Data Quality: ${health.data_quality}`);
        console.log(`   Errors: ${health.consecutive_errors} consecutive, ${health.total_errors} total`);
        console.log(`   Success: ${health.success_count} polls`);
        console.log(`   Circuit Breaker: ${circuitIcon} ${health.circuit_breaker_state}`);

        if (health.last_success_at) {
          const lastSuccess = new Date(health.last_success_at);
          const timeSince = Math.round((Date.now() - lastSuccess.getTime()) / 1000);
          console.log(`   Last Success: ${timeSince}s ago (${lastSuccess.toLocaleTimeString()})`);
        } else {
          console.log(`   Last Success: Never`);
        }

        if (health.last_error_message) {
          console.log(`   Last Error: ${health.last_error_message.substring(0, 60)}...`);
        }

        if (health.recovery_attempts > 0) {
          console.log(`   Recovery Attempts: ${health.recovery_attempts}`);
        }

        console.log('');
      });

      // Summary
      const counts = {
        active: healthData.filter(h => h.status === 'active').length,
        degraded: healthData.filter(h => h.status === 'degraded').length,
        critical: healthData.filter(h => h.status === 'critical').length,
        stopped: healthData.filter(h => h.status === 'stopped').length
      };

      console.log('─'.repeat(80));
      console.log(`📈 Summary: ${healthData.length} symbols tracked`);
      console.log(`   ✅ Active: ${counts.active}`);
      console.log(`   ⚠️  Degraded: ${counts.degraded}`);
      console.log(`   🔥 Critical: ${counts.critical}`);
      console.log(`   ❌ Stopped: ${counts.stopped}`);
    } else {
      console.log('\n⚠️  No health data found. System may not have started yet.');
    }

    // Recent Recovery Attempts
    if (recoveryData && recoveryData.length > 0) {
      console.log('\n' + '='.repeat(80));
      console.log('🔄 RECENT RECOVERY ATTEMPTS (Last 5)');
      console.log('='.repeat(80));
      console.log('');

      recoveryData.forEach(recovery => {
        const icon = recovery.success ? '✅' : '❌';
        const timestamp = new Date(recovery.created_at).toLocaleString();

        console.log(`${icon} ${recovery.symbol.padEnd(20)} ${timestamp}`);
        console.log(`   Reason: ${recovery.trigger_reason}`);
        console.log(`   Action: ${recovery.recovery_action}`);

        if (!recovery.success && recovery.error_message) {
          console.log(`   Error: ${recovery.error_message.substring(0, 60)}...`);
        }

        if (recovery.metrics) {
          console.log(`   Metrics: ${JSON.stringify(recovery.metrics).substring(0, 60)}...`);
        }

        console.log('');
      });
    } else {
      console.log('\n✅ No recovery attempts logged yet (system is healthy!)');
    }

    // Fallback Cache
    if (cacheData && cacheData.length > 0) {
      console.log('\n' + '='.repeat(80));
      console.log('💾 FALLBACK PRICE CACHE');
      console.log('='.repeat(80));
      console.log('');

      cacheData.forEach(cache => {
        const cachedTime = new Date(cache.cached_at);
        const expiresTime = new Date(cache.expires_at);
        const isExpired = expiresTime < new Date();
        const icon = isExpired ? '⚠️' : '✅';

        console.log(`${icon} ${cache.symbol.padEnd(20)} Bid: ${cache.bid}, Ask: ${cache.ask}`);
        console.log(`   Source: ${cache.source}`);
        console.log(`   Quality: ${cache.quality_score}/100`);
        console.log(`   Cached: ${cachedTime.toLocaleString()}`);
        console.log(`   Expires: ${expiresTime.toLocaleString()} ${isExpired ? '(EXPIRED)' : ''}`);
        console.log('');
      });
    } else {
      console.log('\n💾 Fallback cache is empty');
    }

    // Overall Assessment
    console.log('\n' + '='.repeat(80));
    console.log('🎯 OVERALL ASSESSMENT');
    console.log('='.repeat(80));

    if (healthData) {
      const allActive = healthData.every(h => h.status === 'active');
      const hasProblems = healthData.some(h => h.status === 'critical' || h.status === 'stopped');
      const hasDegraded = healthData.some(h => h.status === 'degraded');

      if (allActive) {
        console.log('\n✅ All systems operational! Price feeds are healthy.');
      } else if (hasProblems) {
        console.log('\n🔥 CRITICAL: Some symbols have severe polling issues.');
        console.log('   Check the error messages above and consider restarting the affected pollers.');
      } else if (hasDegraded) {
        console.log('\n⚠️  Some symbols are degraded but still functioning.');
        console.log('   The system should auto-recover. Monitor for improvement.');
      }

      // Circuit breaker warnings
      const openCircuits = healthData.filter(h => h.circuit_breaker_state === 'open');
      if (openCircuits.length > 0) {
        console.log(`\n⚠️  ${openCircuits.length} circuit breaker(s) OPEN - requests temporarily blocked`);
        openCircuits.forEach(h => {
          console.log(`   - ${h.symbol}: Will retry after cooldown period`);
        });
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Health check complete!');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ Health check failed:', error.message);
    process.exit(1);
  }
}

// Run the check
checkPollingHealth().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

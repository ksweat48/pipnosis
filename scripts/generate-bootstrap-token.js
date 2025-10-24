#!/usr/bin/env node

/**
 * Bootstrap Token Generator
 *
 * This script generates a MetaAPI token and caches it directly in Supabase.
 * Use this to provide an initial cached token for immediate demo mode exit.
 *
 * Usage:
 *   node scripts/generate-bootstrap-token.js
 *
 * Environment Variables Required:
 *   - METAAPI_ADMIN_TOKEN: Your MetaAPI admin token
 *   - VITE_METAAPI_ACCOUNT_ID: Your MetaAPI account ID
 *   - VITE_METAAPI_REGION: MetaAPI region (default: new-york)
 *   - VITE_SUPABASE_URL: Supabase project URL
 *   - SUPABASE_SERVICE_ROLE_KEY: Supabase service role key
 */

require('dotenv').config();

const adminToken = process.env.METAAPI_ADMIN_TOKEN;
const accountId = process.env.VITE_METAAPI_ACCOUNT_ID;
const region = process.env.VITE_METAAPI_REGION || 'new-york';
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Validation
const errors = [];
if (!adminToken) errors.push('METAAPI_ADMIN_TOKEN is missing');
if (!accountId) errors.push('VITE_METAAPI_ACCOUNT_ID is missing');
if (!supabaseUrl) errors.push('VITE_SUPABASE_URL is missing');
if (!supabaseServiceKey) errors.push('SUPABASE_SERVICE_ROLE_KEY is missing');

if (errors.length > 0) {
  console.error('\n❌ Configuration Error:');
  errors.forEach(err => console.error(`   - ${err}`));
  console.error('\nPlease set all required environment variables in your .env file\n');
  process.exit(1);
}

console.log('\n🚀 Bootstrap Token Generator\n');
console.log('Configuration:');
console.log(`   Account ID: ${accountId}`);
console.log(`   Region: ${region}`);
console.log(`   Supabase URL: ${supabaseUrl}`);
console.log('');

async function generateAndCacheToken() {
  try {
    // Import MetaAPI SDK
    console.log('📦 Loading MetaAPI SDK...');
    let MetaApi;

    try {
      const nodeModule = require('metaapi.cloud-sdk/node');
      MetaApi = nodeModule.default || nodeModule.MetaApi || nodeModule;
    } catch (err) {
      try {
        const mainModule = require('metaapi.cloud-sdk');
        MetaApi = mainModule.default || mainModule.MetaApi || mainModule;
      } catch (err2) {
        throw new Error('Failed to load MetaAPI SDK. Ensure metaapi.cloud-sdk is installed.');
      }
    }

    console.log('✓ MetaAPI SDK loaded\n');

    // Try multiple regions
    const regions = [region, 'new-york', 'london', 'singapore'].filter((v, i, a) => a.indexOf(v) === i);
    let generatedToken = null;
    let successfulRegion = null;

    console.log(`🌍 Will try regions in order: ${regions.join(', ')}\n`);

    for (const attemptRegion of regions) {
      try {
        console.log(`🔄 Attempting to generate token from ${attemptRegion} region...`);

        const endpoint = `${attemptRegion}.agiliumtrade.ai`;
        const metaApi = new MetaApi(adminToken, {
          application: 'Pipnosis-Bootstrap',
          domain: endpoint,
          requestTimeout: 25000,
          connectTimeout: 8000
        });

        const startTime = Date.now();
        generatedToken = await metaApi.tokenManagementApi.narrowDownTokenResources({
          accountId: accountId
        });
        const duration = Date.now() - startTime;

        if (generatedToken && typeof generatedToken === 'string') {
          successfulRegion = attemptRegion;
          console.log(`✓ Token generated successfully from ${attemptRegion} in ${duration}ms`);
          console.log(`  Token length: ${generatedToken.length} characters\n`);
          break;
        }
      } catch (error) {
        console.log(`✗ Failed from ${attemptRegion}: ${error.message}`);
        if (attemptRegion !== regions[regions.length - 1]) {
          console.log('  Trying next region...\n');
        }
      }
    }

    if (!generatedToken) {
      throw new Error('Failed to generate token from all regions');
    }

    // Cache token in Supabase
    console.log('💾 Caching token in Supabase...');
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 1 * 60 * 60 * 1000); // 1 hour

    const { error } = await supabase
      .from('metaapi_token_cache')
      .upsert({
        account_id: accountId,
        region: successfulRegion,
        token: generatedToken,
        expires_at: expiresAt.toISOString(),
        is_valid: true,
        created_at: now.toISOString(),
        updated_at: now.toISOString()
      }, {
        onConflict: 'account_id,region'
      });

    if (error) {
      throw new Error(`Failed to cache token: ${error.message}`);
    }

    console.log('✓ Token cached successfully\n');
    console.log('✅ Bootstrap Complete!\n');
    console.log('Token Details:');
    console.log(`   Region: ${successfulRegion}`);
    console.log(`   Expires: ${expiresAt.toISOString()}`);
    console.log(`   Valid for: 1 hour`);
    console.log('\n🎉 Your application should now exit demo mode immediately!\n');

  } catch (error) {
    console.error('\n❌ Bootstrap Failed:', error.message);
    console.error('\nPlease check:');
    console.error('   1. Your METAAPI_ADMIN_TOKEN is valid');
    console.error('   2. Your VITE_METAAPI_ACCOUNT_ID is correct');
    console.error('   3. Your Supabase credentials are correct');
    console.error('   4. The metaapi_token_cache table exists in Supabase');
    console.error('   5. MetaAPI services are operational\n');
    process.exit(1);
  }
}

generateAndCacheToken();

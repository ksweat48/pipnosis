#!/usr/bin/env node
/**
 * MetaAPI Account Status Check
 */

require('dotenv').config();

const token = process.env.METAAPI_TOKEN;
const accountId = process.env.METAAPI_ACCOUNT_ID;
const region = process.env.METAAPI_REGION || 'london';

async function checkAccountStatus() {
  if (!token || !accountId) {
    console.error('❌ MetaAPI credentials not found');
    process.exit(1);
  }

  console.log('\n========== MetaAPI Account Status ==========');
  console.log('Account ID:', accountId);
  console.log('Region:', region);
  console.log('===========================================\n');

  // Check account details
  const accountUrl = `https://mt-provisioning-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}`;

  try {
    const response = await fetch(accountUrl, {
      headers: {
        'auth-token': token,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error('❌ Failed to fetch account details:', response.status);
      const errorText = await response.text();
      console.error('   Error:', errorText);
      return;
    }

    const account = await response.json();

    console.log('Account Name:', account.name);
    console.log('Account Type:', account.type);
    console.log('Account State:', account.state);
    console.log('Connection Status:', account.connectionStatus);
    console.log('Broker:', account.broker);
    console.log('Server:', account.server);
    console.log('Platform:', account.platform);
    console.log('Version:', account.version);
    console.log('Deploy Status:', account.deploymentState);

    if (account.state !== 'DEPLOYED') {
      console.log('\n⚠️  WARNING: Account is NOT deployed!');
      console.log('   Current state:', account.state);
      console.log('   Expected state: DEPLOYED');
    }

    if (account.connectionStatus !== 'CONNECTED') {
      console.log('\n⚠️  WARNING: Account is NOT connected!');
      console.log('   Current status:', account.connectionStatus);
      console.log('   Expected status: CONNECTED');
    }

    console.log('\n========== Full Account Object ==========');
    console.log(JSON.stringify(account, null, 2));

  } catch (error) {
    console.error('\n❌ Error checking account:', error.message);
  }
}

checkAccountStatus().catch(console.error);

/**
 * Generate VAPID keys for Web Push notifications
 *
 * This script generates a public/private VAPID key pair needed for push notifications.
 *
 * Run with: node scripts/generate-vapid-keys.js
 *
 * The public key should be added to VITE_VAPID_PUBLIC_KEY in .env
 * The private key should be added to VAPID_PRIVATE_KEY in Supabase Edge Function secrets
 */

const crypto = require('crypto');

function generateVAPIDKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' }
  });

  const publicKeyBase64 = publicKey.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  const privateKeyBase64 = privateKey.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return {
    publicKey: publicKeyBase64,
    privateKey: privateKeyBase64
  };
}

console.log('🔐 Generating VAPID Keys for Push Notifications...\n');

const keys = generateVAPIDKeys();

console.log('✅ VAPID Keys Generated Successfully!\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📋 Add these to your environment variables:\n');
console.log('Frontend (.env):');
console.log(`VITE_VAPID_PUBLIC_KEY=${keys.publicKey}\n`);
console.log('Backend (Supabase Edge Function secrets):');
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}\n`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('\n⚠️  IMPORTANT: Keep the private key secure and never commit it to version control!\n');

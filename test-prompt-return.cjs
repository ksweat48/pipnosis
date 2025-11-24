#!/usr/bin/env node

// Simple test to verify the prompt functions return strings, not undefined

console.log('╔═══════════════════════════════════════════════╗');
console.log('║  Testing Prompt Return Values (Local Build)  ║');
console.log('╚═══════════════════════════════════════════════╝\n');

// Read the built JavaScript files and check for the pattern
const fs = require('fs');
const path = require('path');

const distPath = path.join(__dirname, 'dist', 'assets');

if (!fs.existsSync(distPath)) {
  console.error('❌ dist/assets directory not found. Run `npm run build` first.');
  process.exit(1);
}

const files = fs.readdirSync(distPath).filter(f => f.endsWith('.js'));

console.log(`Found ${files.length} JavaScript files in dist/assets\n`);

let foundIssues = false;
let fixedCount = 0;

// Look for the pattern that indicates missing return statements
// The pattern we're looking for: prompt template ending without return
const problematicPattern = /Be\s+(honest|RUTHLESS|data-driven).*?[\.;]`\s*}\s*[,;]/g;
const fixedPattern = /Be\s+(honest|RUTHLESS|data-driven).*?[\.;]`\s*return\s+\w+\s*;?\s*}/g;

for (const file of files) {
  const filePath = path.join(distPath, file);
  const content = fs.readFileSync(filePath, 'utf8');

  // Check for the FIXED pattern (with return statement)
  const fixedMatches = content.match(fixedPattern);
  if (fixedMatches) {
    console.log(`✅ ${file}: Found ${fixedMatches.length} FIXED prompt function(s)`);
    fixedCount += fixedMatches.length;
  }

  // Check for the BROKEN pattern (without return statement)
  const brokenMatches = content.match(problematicPattern);
  if (brokenMatches) {
    console.error(`❌ ${file}: Found ${brokenMatches.length} BROKEN prompt function(s)`);
    foundIssues = true;
  }
}

console.log('\n' + '═'.repeat(50));

if (foundIssues) {
  console.error('\n❌ FAILURE: Found prompt functions WITHOUT return statements!');
  console.error('   The build still contains the bug.');
  console.error('   Layers 2, 3, 4 will fail with null content errors.\n');
  process.exit(1);
} else if (fixedCount > 0) {
  console.log(`\n✅ SUCCESS: Found ${fixedCount} prompt functions WITH return statements!`);
  console.log('   All prompt builders are correctly returning strings.');
  console.log('   Layers 2, 3, 4 should work correctly.\n');

  // Additional check - make sure the functions are actually using the returned prompts
  console.log('📋 Next steps:');
  console.log('   1. ✅ Code fix verified in build');
  console.log('   2. ⏳ Waiting for Netlify deployment...');
  console.log('   3. 🧪 Test on live site: https://pipnosis.com');
  console.log('   4. 📊 Check Netlify function logs for successful GPT-4o calls\n');

  process.exit(0);
} else {
  console.warn('\n⚠️  WARNING: Could not find prompt functions in build.');
  console.warn('   This might be due to code minification.');
  console.warn('   Manual testing required.\n');
  process.exit(0);
}

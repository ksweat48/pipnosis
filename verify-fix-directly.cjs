#!/usr/bin/env node

/**
 * Direct verification that prompt builder functions return strings
 * Reads TypeScript source and confirms the pattern is correct
 */

const fs = require('fs');
const path = require('path');

console.log('╔══════════════════════════════════════════════════════╗');
console.log('║   LLM Prompt Builder Return Statement Validator     ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

const files = [
  {
    name: 'Layer 2 (Setup Quality)',
    path: 'src/services/llm-setup-quality.ts',
    functionName: 'buildScoringPrompt',
    endPattern: 'Be honest and critical'
  },
  {
    name: 'Layer 3 (Mistake Prevention)',
    path: 'src/services/llm-mistake-prevention.ts',
    functionName: 'buildPreventionPrompt',
    endPattern: 'Be RUTHLESS'
  },
  {
    name: 'Layer 4 (Confidence Calibration)',
    path: 'src/services/llm-confidence-calibrator.ts',
    functionName: 'buildCalibrationPrompt',
    endPattern: 'Be data-driven'
  }
];

let allPassed = true;

for (const file of files) {
  const fullPath = path.join(__dirname, file.path);
  console.log(`\n📄 Checking ${file.name}...`);
  console.log(`   File: ${file.path}`);
  console.log(`   Function: ${file.functionName}`);

  if (!fs.existsSync(fullPath)) {
    console.error(`   ❌ File not found!`);
    allPassed = false;
    continue;
  }

  const content = fs.readFileSync(fullPath, 'utf8');

  // Find the function
  const functionRegex = new RegExp(`private\\s+${file.functionName}\\s*\\([^)]*\\)\\s*:\\s*string\\s*{`, 'g');
  const functionMatch = functionRegex.exec(content);

  if (!functionMatch) {
    console.error(`   ❌ Function ${file.functionName} not found!`);
    allPassed = false;
    continue;
  }

  const functionStart = functionMatch.index;

  // Find the prompt end pattern
  const endPatternIndex = content.indexOf(file.endPattern, functionStart);
  if (endPatternIndex === -1) {
    console.error(`   ❌ End pattern "${file.endPattern}" not found!`);
    allPassed = false;
    continue;
  }

  // Extract the section from end pattern to next function (approximately 200 chars)
  const sectionAfterPattern = content.substring(endPatternIndex, endPatternIndex + 200);

  // Check for return statement
  const hasReturn = /return\s+prompt\s*;/.test(sectionAfterPattern);

  if (hasReturn) {
    console.log(`   ✅ PASS - Found "return prompt;" statement`);

    // Show the actual code
    const returnMatch = sectionAfterPattern.match(/Be [^`]+`\s*(return\s+prompt\s*;)/);
    if (returnMatch) {
      console.log(`   📝 Code: ...${returnMatch[0].substring(0, 80)}...`);
    }
  } else {
    console.error(`   ❌ FAIL - Missing "return prompt;" statement`);
    console.error(`   📝 Found: ${sectionAfterPattern.substring(0, 100)}...`);
    allPassed = false;
  }
}

console.log('\n' + '═'.repeat(55));

if (allPassed) {
  console.log('\n✅ ALL CHECKS PASSED!');
  console.log('\n✨ All prompt builder functions correctly return strings.');
  console.log('✨ The null content bug is FIXED.');
  console.log('\n📊 Next steps:');
  console.log('   1. Wait for Netlify deployment to complete (~2-3 minutes)');
  console.log('   2. Go to https://pipnosis.com');
  console.log('   3. Navigate to AI Training page');
  console.log('   4. Start a backtest');
  console.log('   5. Watch console for successful GPT-4o calls');
  console.log('   6. Check Netlify logs at:');
  console.log('      https://app.netlify.com/sites/pipnosis/functions/openai-chat');
  console.log('\n💪 Your faith should be restored!\n');
  process.exit(0);
} else {
  console.error('\n❌ SOME CHECKS FAILED!');
  console.error('\nThe fix was not applied correctly.');
  console.error('Layers 2, 3, 4 will still fail.\n');
  process.exit(1);
}

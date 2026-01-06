/**
 * Build Guard: Validate Omega Layer is Deterministic
 *
 * This script checks that no LLM imports exist in the deterministic Omega layer.
 * Run this as part of the build process to prevent accidental LLM usage.
 *
 * Usage: node scripts/validate-omega-deterministic.cjs
 */

const fs = require('fs');
const path = require('path');

const OMEGA_DIR = path.join(__dirname, '..', 'src', 'brains', 'omega');

const FORBIDDEN_IMPORTS = [
  'openai-client',
  'openAIClient',
  'llm-token-tracker',
  'llmTokenTracker',
  'openai-proxy-client',
  'llm-execution-brain',
  'llm-strategy-brain',
  'gpt-4o',
  'gpt-4o-mini'
];

const ALLOWED_EXCEPTIONS = [
  'index.ts'
];

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const filename = path.basename(filePath);
  const violations = [];

  for (const forbidden of FORBIDDEN_IMPORTS) {
    if (content.includes(forbidden)) {
      if (!ALLOWED_EXCEPTIONS.includes(filename)) {
        violations.push({
          file: filePath,
          violation: forbidden
        });
      }
    }
  }

  if (content.includes('await') && content.includes('openAIClient')) {
    violations.push({
      file: filePath,
      violation: 'async LLM call detected'
    });
  }

  return violations;
}

function scanDirectory(dirPath) {
  const violations = [];

  if (!fs.existsSync(dirPath)) {
    console.log(`[Omega Guard] Directory not found: ${dirPath}`);
    return violations;
  }

  const files = fs.readdirSync(dirPath);

  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      violations.push(...scanDirectory(fullPath));
    } else if (file.endsWith('.ts') && !file.endsWith('.test.ts')) {
      violations.push(...scanFile(fullPath));
    }
  }

  return violations;
}

function main() {
  console.log('[Omega Guard] Scanning deterministic Omega layer for LLM imports...');
  console.log(`[Omega Guard] Directory: ${OMEGA_DIR}`);

  const violations = scanDirectory(OMEGA_DIR);

  if (violations.length === 0) {
    console.log('[Omega Guard] PASS - No LLM imports found in Omega layer');
    process.exit(0);
  } else {
    console.error('[Omega Guard] FAIL - LLM imports detected in deterministic Omega layer:');
    for (const v of violations) {
      console.error(`  - ${v.file}: ${v.violation}`);
    }
    console.error('[Omega Guard] Omega layer must be FULLY DETERMINISTIC');
    process.exit(1);
  }
}

main();

#!/usr/bin/env node
/* eslint-disable */
/*
 * CCIP-2026-0515B — SPX500 Retirement build-time guard.
 *
 * Scans all files under src/ (excluding migrations, node_modules, and .bolt)
 * for literal references to the retired symbol SPX500.
 * Comments and strings containing "CCIP-2026-0515B" or "retired" are exempt
 * (they document the retirement itself).
 *
 * Fails the build if any non-exempt reference is found.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const RETIRED_SYMBOLS = ['SPX500'];

const EXEMPT_PATTERNS = [
  /CCIP-2026-0515B/,
  /retired/i,
  /retirement/i,
];

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

const EXEMPT_FILES = [
  'ccip-confidence-gate-adjustment.ts',
];

let violations = 0;

function scanFile(filePath) {
  const basename = path.basename(filePath);
  if (EXEMPT_FILES.includes(basename)) return;

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    for (const symbol of RETIRED_SYMBOLS) {
      if (!line.includes(symbol)) continue;

      const isExempt = EXEMPT_PATTERNS.some(p => p.test(line));
      if (isExempt) continue;

      const isComment = line.trimStart().startsWith('//') || line.trimStart().startsWith('*');
      if (isComment) {
        const commentExempt = EXEMPT_PATTERNS.some(p => p.test(line));
        if (commentExempt) continue;
      }

      console.error(
        `  VIOLATION: ${path.relative(ROOT, filePath)}:${idx + 1} — retired symbol "${symbol}" referenced`
      );
      console.error(`    > ${line.trim()}`);
      violations++;
    }
  });
}

function walkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.bolt') continue;
      walkDir(fullPath);
    } else if (entry.isFile() && EXTENSIONS.includes(path.extname(entry.name))) {
      scanFile(fullPath);
    }
  }
}

console.log('[audit-symbols] Scanning for retired symbol references...');
walkDir(SRC);

if (violations > 0) {
  console.error(`\n[audit-symbols] FAILED: ${violations} retired symbol reference(s) found.`);
  console.error('Remove all references to retired symbols from active code.');
  process.exit(1);
} else {
  console.log('[audit-symbols] PASSED: No retired symbol references found.');
}

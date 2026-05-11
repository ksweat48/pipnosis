#!/usr/bin/env node
/* eslint-disable */
/*
 * CCIP-2026-0511ZZ — Alpha Autonomy Doctrine build-time guard.
 *
 * Scans alpha-identity.ts for forbidden patterns in the LIVE PROMPT BODY
 * only (comments are exempt — they carry CCIP history and may reference
 * retired patterns by name). Fails the build when violations are found.
 *
 * Ratified doctrine lives in Supabase table alpha_engineering_doctrine.
 * See CLAUDE.md "ALPHA AUTONOMY DOCTRINE" for the full policy.
 */

const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, '..', 'src', 'config', 'alpha-identity.ts');

// Patterns that, when appearing in the live prompt body, constitute
// procedural teaching or checklist reasoning. These are the constructs
// the doctrine forbids from being reintroduced.
const FORBIDDEN = [
  { pattern: /\bSTEP\s*\d+\s*:/i, label: 'Step-numbered procedural bracket (STEP N:)' },
  { pattern: /\bfollow\s+this\s+(?:checklist|procedure|sequence)\b/i, label: 'Explicit procedural instruction' },
  { pattern: /\bIF\s+pattern\s*=/i, label: 'Pattern-to-output translation rule' },
  { pattern: /\balways\s+set\s+\w+\s+to\b/i, label: 'Hardcoded output prescription' },
  { pattern: /\bpre-execution\s+checklist\b/i, label: 'Pre-execution checklist' },
  { pattern: /\bconfirmation\s+checklist\b/i, label: 'Confirmation checklist' },
  { pattern: /\byou\s+must\s+check\s+(?:each|every|all)\b/i, label: 'Mandatory checklist instruction' },
  { pattern: /\bif\s+.+\s+then\s+(?:buy|sell|output|return)\b/i, label: 'Hardcoded direction rule' },
];

function stripComments(src) {
  // Remove block comments
  let out = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  // Remove line comments
  out = out.split('\n').map((line) => {
    const idx = line.indexOf('//');
    if (idx === -1) return line;
    // Keep the column offset stable by blanking the rest
    return line.slice(0, idx) + ' '.repeat(line.length - idx);
  }).join('\n');
  return out;
}

function main() {
  if (!fs.existsSync(TARGET)) {
    console.warn(`[alpha-autonomy-audit] Target not found: ${TARGET} — skipping.`);
    process.exit(0);
  }

  const raw = fs.readFileSync(TARGET, 'utf8');
  const stripped = stripComments(raw);
  const lines = stripped.split('\n');
  const rawLines = raw.split('\n');
  const violations = [];

  for (const { pattern, label } of FORBIDDEN) {
    lines.forEach((line, idx) => {
      if (pattern.test(line)) {
        violations.push({ line: idx + 1, label, snippet: rawLines[idx].trim().slice(0, 140) });
      }
    });
  }

  if (violations.length === 0) {
    console.log('[alpha-autonomy-audit] PASS — alpha-identity.ts complies with CCIP-2026-0511ZZ.');
    process.exit(0);
  }

  console.error('');
  console.error('='.repeat(72));
  console.error('ALPHA AUTONOMY DOCTRINE VIOLATION (CCIP-2026-0511ZZ)');
  console.error('='.repeat(72));
  console.error('alpha-identity.ts prompt body contains patterns forbidden by');
  console.error('engineering law. See CLAUDE.md "ALPHA AUTONOMY DOCTRINE" and');
  console.error('Supabase table alpha_engineering_doctrine for the ratified policy.');
  console.error('');
  for (const v of violations) {
    console.error(`  Line ${v.line}: ${v.label}`);
    console.error(`    > ${v.snippet}`);
  }
  console.error('');
  console.error('Build blocked. Remove the forbidden constructs or file a CCIP');
  console.error('amendment superseding the current doctrine row before retrying.');
  console.error('='.repeat(72));
  process.exit(1);
}

main();

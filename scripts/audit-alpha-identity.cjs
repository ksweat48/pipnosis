#!/usr/bin/env node
/* eslint-disable */
/*
 * CCIP-2026-0512A — Raw-Data Doctrine build-time guard.
 * (Supersedes CCIP-2026-0511ZZ Alpha Autonomy Doctrine; 0511ZZ patterns
 * remain in force as inherited obligations.)
 *
 * Scans:
 *   1. alpha-identity.ts for procedural/checklist patterns (0511ZZ legacy)
 *   2. coordinator-alpha.ts + prompt formatter files for interpretation,
 *      verdicts, labels, historical performance injection (0512A)
 *
 * Comments are stripped before scanning so CCIP history that references
 * retired patterns by name does not trigger violations.
 *
 * Ratified doctrine lives in Supabase table alpha_engineering_doctrine
 * (row: ccip_reference='CCIP-2026-0512A', active=true).
 * See CLAUDE.md "RAW-DATA DOCTRINE" for the full policy.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ─── 0511ZZ: alpha-identity.ts procedural guard ──────────────────────────────
const IDENTITY_TARGET = path.join(ROOT, 'src', 'config', 'alpha-identity.ts');

const IDENTITY_FORBIDDEN = [
  { pattern: /\bSTEP\s*\d+\s*:/i, label: 'Step-numbered procedural bracket (STEP N:)' },
  { pattern: /\bfollow\s+this\s+(?:checklist|procedure|sequence)\b/i, label: 'Explicit procedural instruction' },
  { pattern: /\bIF\s+pattern\s*=/i, label: 'Pattern-to-output translation rule' },
  { pattern: /\balways\s+set\s+\w+\s+to\b/i, label: 'Hardcoded output prescription' },
  { pattern: /\bpre-execution\s+checklist\b/i, label: 'Pre-execution checklist' },
  { pattern: /\bconfirmation\s+checklist\b/i, label: 'Confirmation checklist' },
  { pattern: /\byou\s+must\s+check\s+(?:each|every|all)\b/i, label: 'Mandatory checklist instruction' },
  { pattern: /\bif\s+.+\s+then\s+(?:buy|sell|output|return)\b/i, label: 'Hardcoded direction rule' },
];

// ─── 0512A: Raw-Data Doctrine guard for prompt-producing files ───────────────
const RAW_DATA_TARGETS = [
  path.join(ROOT, 'src', 'brains', 'coordinator-alpha.ts'),
  path.join(ROOT, 'src', 'services', 'multi-timeframe-pattern-intelligence.ts'),
  path.join(ROOT, 'src', 'services', 'momentum-trajectory-analyzer.ts'),
];

// Tokens that inject interpretation, verdicts, labels, or historical data
// into Alpha's prompt. Scanned against source with comments stripped.
const RAW_DATA_FORBIDDEN = [
  { pattern: /getRecentPerformanceSummary\s*\(/, label: 'Historical performance injection (rrSuccessTracker)' },
  { pattern: /HISTORICAL\s+PERFORMANCE/i, label: 'Historical performance header in prompt' },
  { pattern: /R:R\s+RATIO\s+SUCCESS/i, label: 'R:R success-rate narrative in prompt' },
  { pattern: /\bBest\s+performing\b/i, label: 'Best-performing narrative in prompt' },
  { pattern: /\bWorst\s+performing\b/i, label: 'Worst-performing narrative in prompt' },
  { pattern: /\btrade\s+history\b/i, label: 'Trade-history narrative in prompt' },
  { pattern: /["'`]\s*Intent\s*:/i, label: 'Intent label injected into prompt' },
  { pattern: /Direction\s+Bias\s*:/i, label: 'Direction Bias verdict in prompt' },
  { pattern: /Direction\s+Aligned\s*:/i, label: 'Direction Aligned verdict in prompt' },
  { pattern: /Overall\s+Intent\s*:/i, label: 'Overall Intent verdict in prompt' },
  { pattern: /Overall\s+Reasoning\s*:/i, label: 'Overall Reasoning narrative in prompt' },
  { pattern: /["'`]\s*SUPPORTS\s*:/i, label: 'SUPPORTS: verdict bullet in prompt' },
  { pattern: /["'`]\s*CONFLICTS\s*:/i, label: 'CONFLICTS: verdict bullet in prompt' },
  { pattern: /PATTERN\s+WARNINGS/i, label: 'PATTERN WARNINGS narrative in prompt' },
  { pattern: /PATTERN\s+VERDICT/i, label: 'PATTERN VERDICT narrative in prompt' },
  { pattern: /\bstrong\s+wick\b/i, label: 'Wick-quality label in prompt' },
  { pattern: /\bmoderate\s+wick\b/i, label: 'Wick-quality label in prompt' },
  { pattern: /\bshallow\s+wick\b/i, label: 'Wick-quality label in prompt' },
  { pattern: /Structure\s*:\s*\$\{?structureQuality/i, label: 'Structure-quality label in prompt' },
  { pattern: /["'`]\s*Observation\s*:/i, label: 'Observation narrative in prompt' },
  { pattern: /HUNTER['’]S\s+TP/i, label: 'HUNTER\'S TP teaching block in prompt' },
  { pattern: /SL\/TP\s+AUTHORITY/i, label: 'SL/TP AUTHORITY teaching block in prompt' },
  { pattern: /REJECTION\s+WICK\s+detected/i, label: 'Rejection-wick interpretation in prompt' },
  { pattern: /bullish\s+absorption/i, label: 'Absorption interpretation in prompt' },
  { pattern: /bearish\s+absorption/i, label: 'Absorption interpretation in prompt' },
  { pattern: /Long\s+targets\b/i, label: 'Directional framing (Long targets) in prompt' },
  { pattern: /Short\s+targets\b/i, label: 'Directional framing (Short targets) in prompt' },
  { pattern: /\bRegime\s*:\s*[A-Z_]{3,}/, label: 'Regime label in prompt' },
  { pattern: /momentum\s+peaking/i, label: 'Momentum-peaking interpretation in prompt' },
  { pattern: /DIRECTION\s+RULE/i, label: 'DIRECTION RULE teaching block in prompt' },
  { pattern: /MANDATORY\s*:\s*Reference/i, label: 'Mandatory reference procedural instruction in prompt' },
  { pattern: /directional\s+tailwind/i, label: 'Directional tailwind framing in prompt' },
  { pattern: /counter-trend\s*—\s*require/i, label: 'Counter-trend requirement framing in prompt' },
  { pattern: /INSTITUTIONAL\s+LEVEL\s+RULES/i, label: 'INSTITUTIONAL LEVEL RULES teaching block in prompt' },
  { pattern: /magnetic\s+pull/i, label: 'Magnetic-pull interpretation in prompt' },
  { pattern: /structurally\s+weak/i, label: 'Structurally-weak verdict in prompt' },
  { pattern: /false\s+breakout\s+zone/i, label: 'False-breakout zone verdict in prompt' },
  { pattern: /Expect\s+(?:rejection|bounce|breakout|breakdown)/i, label: 'Expectation verdict in prompt' },
];

function stripComments(src) {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  out = out.split('\n').map((line) => {
    const idx = line.indexOf('//');
    if (idx === -1) return line;
    return line.slice(0, idx) + ' '.repeat(line.length - idx);
  }).join('\n');
  return out;
}

function scan(targetPath, forbidden, label) {
  if (!fs.existsSync(targetPath)) {
    console.warn(`[audit] ${label} target not found: ${targetPath} — skipping.`);
    return [];
  }
  const raw = fs.readFileSync(targetPath, 'utf8');
  const stripped = stripComments(raw);
  const lines = stripped.split('\n');
  const rawLines = raw.split('\n');
  const violations = [];
  for (const { pattern, label: vLabel } of forbidden) {
    lines.forEach((line, idx) => {
      if (pattern.test(line)) {
        violations.push({
          file: path.relative(ROOT, targetPath),
          line: idx + 1,
          label: vLabel,
          snippet: rawLines[idx].trim().slice(0, 160),
        });
      }
    });
  }
  return violations;
}

function main() {
  const allViolations = [];

  // 0511ZZ legacy: alpha-identity.ts
  allViolations.push(...scan(IDENTITY_TARGET, IDENTITY_FORBIDDEN, 'alpha-identity'));

  // 0512A: coordinator + formatter files
  for (const target of RAW_DATA_TARGETS) {
    allViolations.push(...scan(target, RAW_DATA_FORBIDDEN, 'raw-data-doctrine'));
  }

  if (allViolations.length === 0) {
    console.log('[audit] PASS — CCIP-2026-0512A Raw-Data Doctrine + CCIP-2026-0511ZZ Autonomy Doctrine both compliant.');
    process.exit(0);
  }

  console.error('');
  console.error('='.repeat(72));
  console.error('DOCTRINE VIOLATION (CCIP-2026-0512A Raw-Data / CCIP-2026-0511ZZ Autonomy)');
  console.error('='.repeat(72));
  console.error('One or more files inject interpretation, verdicts, labels, or');
  console.error('procedural teachings into Alpha\'s prompt. Alpha receives RAW DATA only.');
  console.error('See CLAUDE.md "RAW-DATA DOCTRINE" and Supabase row');
  console.error("alpha_engineering_doctrine.ccip_reference = 'CCIP-2026-0512A'.");
  console.error('');
  for (const v of allViolations) {
    console.error(`  ${v.file}:${v.line}  ${v.label}`);
    console.error(`    > ${v.snippet}`);
  }
  console.error('');
  console.error('Build blocked. Remove the forbidden constructs or file a CCIP');
  console.error('amendment superseding the active doctrine row before retrying.');
  console.error('='.repeat(72));
  process.exit(1);
}

main();

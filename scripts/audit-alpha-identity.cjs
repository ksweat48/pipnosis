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
  // CCIP-2026-0513A: Profitability & Invalidation Doctrine — SL/TP are two sides
  // of one thesis, not independent anchoring tasks. Prevent regression to
  // anchor-procedure language that decouples invalidation from reward.
  { pattern: /\banchor\s+SL\s+to\b/i, label: 'Anchor-SL-to procedural language (0513A)' },
  { pattern: /\bplace\s+SL\s+at\s+structure\b/i, label: 'Place-SL-at-structure procedural language (0513A)' },
  { pattern: /\bplace\s+the\s+stop\s+at\s+the\s+nearest\b/i, label: 'Nearest-structure stop placement procedure (0513A)' },
  // CCIP-2026-0513B: Trap-Aware Geometry Doctrine — anchor-to-structure SL
  // language masks trap-awareness. Symmetric buy/sell coverage.
  { pattern: /\babove\s+the\s+recent\s+swing\b/i, label: 'Anchor-to-structure SL language (0513B)' },
  { pattern: /\bbelow\s+the\s+recent\s+swing\b/i, label: 'Anchor-to-structure SL language (0513B)' },
  { pattern: /\bstructural\s+breathing\s+room\b/i, label: 'Structural-breathing-room anchor framing (0513B)' },
  { pattern: /\babove\s+the\s+swing\s+high\b/i, label: 'Anchor-to-swing-high SL language (0513B)' },
  { pattern: /\bbelow\s+the\s+swing\s+low\b/i, label: 'Anchor-to-swing-low SL language (0513B)' },
  // CCIP-2026-0513F: M5-Primary Hierarchy. H1 is background context only.
  // Block any phrasing that reintroduces H1 (or M15) as directional authority
  // over the active M5 leg. The retired "CONTROL TF" framing must not return.
  { pattern: /\bCONTROL\s+TF\b/i, label: 'CONTROL TF framing — H1 elevation (0513F)' },
  { pattern: /\bH1\s+control\b/i, label: 'H1 control framing (0513F)' },
  { pattern: /\bH1\s+authority\b/i, label: 'H1 authority framing (0513F)' },
  { pattern: /\bwait\s+for\s+H1\s+confirmation\b/i, label: 'Wait-for-H1-confirmation procedural (0513F)' },
  { pattern: /\bH1\s+(?:must|should)\s+(?:confirm|align|agree)\b/i, label: 'H1-must-confirm authority elevation (0513F)' },
  { pattern: /\bH1\s+is\s+the\s+(?:primary|control|authoritative)\b/i, label: 'H1-as-primary framing (0513F)' },
  { pattern: /\bM15\s+(?:overrides|trumps|beats)\s+M5\b/i, label: 'M15-overrides-M5 framing (0513F)' },
  // CCIP-2026-0513G: TP1 Partial-Value Doctrine — block procedural TP1
  // anchoring language that would short-circuit Alpha's reasoning about
  // partial-value sufficiency.
  { pattern: /\bplace\s+TP1\s+at\s+(?:the\s+)?(?:first|nearest)\b/i, label: 'Procedural TP1 placement language (0513G)' },
  { pattern: /\banchor\s+TP1\s+to\b/i, label: 'Anchor-TP1-to procedural language (0513G)' },
  // CCIP-2026-0513H: M5 Entry-Sharpness Doctrine — block procedural MAE
  // prescriptions. MAE is a reasoning obligation, not an if/then rule.
  { pattern: /\bif\s+MAE\s*[><=]/i, label: 'Procedural MAE rule (0513H)' },
  { pattern: /\bMAE\s+must\s+(?:be|stay)\b/i, label: 'Hardcoded MAE prescription (0513H)' },
];

// ─── 0512A: Raw-Data Doctrine guard for prompt-producing files ───────────────
const RAW_DATA_TARGETS = [
  path.join(ROOT, 'src', 'brains', 'coordinator-alpha.ts'),
  path.join(ROOT, 'src', 'services', 'multi-timeframe-pattern-intelligence.ts'),
  path.join(ROOT, 'src', 'services', 'momentum-trajectory-analyzer.ts'),
];

// CCIP-2026-0513J SEALED-PROMPT DOCTRINE: dedicated prompt-formatter files
// where every emitted line goes directly to Alpha's prompt. Strict 0513J
// rules apply (no verdict labels, no .toUpperCase() on directional fields,
// symmetric +1/0/-1 codes only). market-briefing-builder.ts was the primary
// 7-to-1 SELL-skew injection site and is now under permanent surveillance.
const SEALED_PROMPT_TARGETS = [
  path.join(ROOT, 'src', 'services', 'market-briefing-builder.ts'),
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

// CCIP-2026-0513J SEALED-PROMPT DOCTRINE strict rules — only applied to
// dedicated prompt-formatter files (SEALED_PROMPT_TARGETS) where every
// emitted line goes directly to Alpha's prompt. Verdict labels and
// uppercased directional words are structurally forbidden; symmetric
// ±1 / 0 / -1 codes replace all directional/regime English.
const SEALED_PROMPT_FORBIDDEN = [
  { pattern: /\.toUpperCase\s*\(\s*\)/, label: '.toUpperCase() in sealed-prompt file (0513J — emit ±1/0/-1 codes instead)' },
  { pattern: /\bSTRONG_BULL\b/, label: 'STRONG_BULL verdict label (0513J)' },
  { pattern: /\bSTRONG_BEAR\b/, label: 'STRONG_BEAR verdict label (0513J)' },
  { pattern: /["'`]\s*BULLISH\s*["'`]/, label: 'BULLISH string literal in prompt (0513J)' },
  { pattern: /["'`]\s*BEARISH\s*["'`]/, label: 'BEARISH string literal in prompt (0513J)' },
  { pattern: /["'`]\s*MIXED\s*["'`]/, label: 'MIXED verdict literal in prompt (0513J)' },
  { pattern: /Directional\s+Bias\s*:/i, label: 'Directional Bias: verdict sentence in prompt (0513J)' },
  { pattern: /\bAction\s*:\s*\$\{/i, label: 'Action: verdict template injection in prompt (0513J)' },
  { pattern: /\bBias\s*:\s*\$\{/i, label: 'Bias: verdict template injection in prompt (0513J)' },
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

  // 0512A: coordinator + formatter files (broad raw-data rules)
  for (const target of RAW_DATA_TARGETS) {
    allViolations.push(...scan(target, RAW_DATA_FORBIDDEN, 'raw-data-doctrine'));
  }

  // 0513J: dedicated sealed-prompt formatter files (strict verdict-label ban)
  for (const target of SEALED_PROMPT_TARGETS) {
    allViolations.push(...scan(target, RAW_DATA_FORBIDDEN, 'raw-data-doctrine'));
    allViolations.push(...scan(target, SEALED_PROMPT_FORBIDDEN, 'sealed-prompt-doctrine'));
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

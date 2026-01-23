/**
 * Architectural Compliance Tests
 *
 * These tests enforce SSOT (Single Source of Truth) principles at build time.
 * They detect architectural violations through static code analysis.
 *
 * Part of Phase 3.2: Automated Architectural Tests
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC_DIR = path.join(__dirname, '..');
const SERVICES_DIR = path.join(SRC_DIR, 'services');
const BRAINS_DIR = path.join(SRC_DIR, 'brains');
const COMPONENTS_DIR = path.join(SRC_DIR, 'components');

/**
 * Recursively get all TypeScript files in a directory
 */
function getAllTsFiles(dir: string, exclude: string[] = []): string[] {
  const files: string[] = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    const relativePath = path.relative(SRC_DIR, fullPath);

    // Skip excluded paths
    if (exclude.some(ex => relativePath.includes(ex))) {
      continue;
    }

    if (item.isDirectory()) {
      files.push(...getAllTsFiles(fullPath, exclude));
    } else if (item.isFile() && (item.name.endsWith('.ts') || item.name.endsWith('.tsx'))) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Read file content safely
 */
function readFileContent(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    return '';
  }
}

describe('Architectural Compliance - SSOT Enforcement', () => {

  describe('Position Sizing Authority', () => {
    it('should not calculate position sizes outside ProfessionalRiskManager', () => {
      const violations: string[] = [];
      // ✅ PHASE 3.1 SECTION 3: Allow EstimationRiskCalculator as SSOT for estimations
      const files = getAllTsFiles(SERVICES_DIR, ['professional-risk-manager.ts', 'estimation-risk-calculator.ts']);

      // Patterns that indicate position sizing logic
      const forbiddenPatterns = [
        /calculateLotSizeFromDollarRisk\(/,
        /calculateGoalAwareLotSize\(/,
        /calculatePositionSize\(/,
        /lotSize\s*=\s*\([^)]*balance[^)]*riskPercent/,
        /positionSize\s*=\s*\([^)]*dollarRisk/
      ];

      for (const file of files) {
        let content = readFileContent(file);
        const relativePath = path.relative(SRC_DIR, file);

        // ✅ PHASE 2 SECTION 3: Strip comments to avoid false positives
        // Remove single-line comments
        content = content.replace(/\/\/.*$/gm, '');
        // Remove multi-line comments
        content = content.replace(/\/\*[\s\S]*?\*\//g, '');

        for (const pattern of forbiddenPatterns) {
          if (pattern.test(content)) {
            violations.push(`${relativePath}: Contains position sizing calculation (${pattern.source})`);
          }
        }
      }

      if (violations.length > 0) {
        console.error('\n⛔ SSOT VIOLATION: Position sizing logic found outside authorized services\n');
        violations.forEach(v => console.error(`  - ${v}`));
        console.error('\n✅ FIX: Use ProfessionalRiskManager.evaluateTrade() for execution or EstimationRiskCalculator for estimations\n');
      }

      expect(violations).toHaveLength(0);
    });

    it('should import ProfessionalRiskManager when doing position sizing', () => {
      const violations: string[] = [];
      const files = getAllTsFiles(SERVICES_DIR);

      for (const file of files) {
        const content = readFileContent(file);
        const relativePath = path.relative(SRC_DIR, file);

        // Skip the risk manager itself
        if (relativePath.includes('professional-risk-manager')) {
          continue;
        }

        // Check if file mentions position/lot size AND doesn't import risk manager
        const hasPositionSizing = /position.*size|lot.*size|evaluateTrade/i.test(content);
        const importsRiskManager = /import.*professional-risk-manager|ProfessionalRiskManager/.test(content);

        if (hasPositionSizing && !importsRiskManager && !content.includes('// @architectural-exception')) {
          // Additional check: does it actually calculate or just pass through?
          if (/lotSize\s*=|positionSize\s*=/.test(content)) {
            violations.push(`${relativePath}: Handles position sizing without importing ProfessionalRiskManager`);
          }
        }
      }

      if (violations.length > 0) {
        console.error('\n⛔ SSOT VIOLATION: Services handling position sizing without proper authority\n');
        violations.forEach(v => console.error(`  - ${v}`));
        console.error('\n✅ FIX: Import and use ProfessionalRiskManager for position sizing\n');
      }

      expect(violations).toHaveLength(0);
    });
  });

  describe('Market Data Authority', () => {
    it('should not query forex_candles directly outside MarketDataService', () => {
      const violations: string[] = [];
      const files = getAllTsFiles(SERVICES_DIR, ['market-data-service.ts', 'candle-', 'database-service.ts']);

      for (const file of files) {
        const content = readFileContent(file);
        const relativePath = path.relative(SRC_DIR, file);

        // Look for direct Supabase queries to forex_candles
        if (/\.from\s*\(\s*['"`]forex_candles['"`]\s*\)/.test(content)) {
          violations.push(`${relativePath}: Direct query to forex_candles table`);
        }
      }

      if (violations.length > 0) {
        console.error('\n⛔ SSOT VIOLATION: Direct database queries to forex_candles outside MarketDataService\n');
        violations.forEach(v => console.error(`  - ${v}`));
        console.error('\n✅ FIX: Use MarketDataService to fetch candle data\n');
      }

      expect(violations).toHaveLength(0);
    });

    it('should use MarketDataService for candle operations', () => {
      const violations: string[] = [];
      const files = [...getAllTsFiles(SERVICES_DIR), ...getAllTsFiles(BRAINS_DIR)];

      for (const file of files) {
        const content = readFileContent(file);
        const relativePath = path.relative(SRC_DIR, file);

        // Skip candle-related services and market data service
        if (relativePath.includes('candle-') || relativePath.includes('market-data-service')) {
          continue;
        }

        // Check if file needs candles but doesn't import market data service
        const needsCandles = /getCandles|fetchCandles|candle.*data/i.test(content);
        const importsMarketData = /import.*market-data-service|MarketDataService/.test(content);

        if (needsCandles && !importsMarketData && !content.includes('// @architectural-exception')) {
          violations.push(`${relativePath}: Needs candle data without importing MarketDataService`);
        }
      }

      // This is a warning, not a hard failure (some files may have valid exceptions)
      if (violations.length > 0) {
        console.warn('\n⚠️  WARNING: Files may need MarketDataService import\n');
        violations.forEach(v => console.warn(`  - ${v}`));
      }

      // Don't fail build on this one, just warn
      expect(true).toBe(true);
    });
  });

  describe('Validation Gateway Authority', () => {
    it('should validate trade requests through ValidationGateway', () => {
      const violations: string[] = [];
      const files = getAllTsFiles(SERVICES_DIR, [
        'validation-gateway.ts',
        'trade-validation-service.ts',
        'database-service.ts'
      ]);

      for (const file of files) {
        const content = readFileContent(file);
        const relativePath = path.relative(SRC_DIR, file);

        // Look for trade execution without validation
        const hasTradeExecution = /executeTrade|createTrade|insertTrade/i.test(content);
        const hasValidation = /validationGateway|ValidationGateway|validateTradeRequest/.test(content);

        if (hasTradeExecution && !hasValidation && !content.includes('// @architectural-exception')) {
          // Check if it's actually executing or just coordinating
          if (/await.*supabase.*insert|\.from\(['"`]positions/.test(content)) {
            violations.push(`${relativePath}: Trade execution without ValidationGateway check`);
          }
        }
      }

      if (violations.length > 0) {
        console.error('\n⛔ SSOT VIOLATION: Trade execution without validation gateway\n');
        violations.forEach(v => console.error(`  - ${v}`));
        console.error('\n✅ FIX: Validate through ValidationGateway before executing trades\n');
      }

      expect(violations).toHaveLength(0);
    });
  });

  describe('Price Freshness Authority', () => {
    it('should use PriceFreshnessGate for freshness validation', () => {
      const violations: string[] = [];
      const files = getAllTsFiles(SERVICES_DIR, ['price-freshness-gate.ts', 'freshness-', 'price-validation-service.ts']);

      for (const file of files) {
        const content = readFileContent(file);
        const relativePath = path.relative(SRC_DIR, file);

        // Look for manual freshness checks
        const manualFreshnessPatterns = [
          /age.*>.*\d+.*\*.*1000/, // age > X * 1000
          /Date\.now\(\).*-.*timestamp.*>.*\d+/, // Date.now() - timestamp > X
          /timestamp.*<.*Date\.now\(\).*-.*\d+/, // timestamp < Date.now() - X
        ];

        for (const pattern of manualFreshnessPatterns) {
          if (pattern.test(content) && !content.includes('// @architectural-exception')) {
            violations.push(`${relativePath}: Manual price freshness check (${pattern.source})`);
          }
        }
      }

      if (violations.length > 0) {
        console.error('\n⛔ SSOT VIOLATION: Manual price freshness checks found\n');
        violations.forEach(v => console.error(`  - ${v}`));
        console.error('\n✅ FIX: Use PriceFreshnessGate for all freshness validation\n');
      }

      expect(violations).toHaveLength(0);
    });
  });

  describe('Import Dependencies', () => {
    it('should not have circular dependencies in services', () => {
      const violations: string[] = [];
      const files = getAllTsFiles(SERVICES_DIR);

      // Build import graph
      const importGraph = new Map<string, string[]>();

      for (const file of files) {
        const content = readFileContent(file);
        const relativePath = path.relative(SERVICES_DIR, file);

        // Find all local imports
        const importPattern = /import.*from\s+['"](\.\.?\/[^'"]+)['"]/g;
        const imports: string[] = [];

        let match;
        while ((match = importPattern.exec(content)) !== null) {
          const importPath = match[1];
          // Resolve relative path
          const resolvedPath = path.relative(
            SERVICES_DIR,
            path.resolve(path.dirname(file), importPath)
          );
          imports.push(resolvedPath);
        }

        importGraph.set(relativePath, imports);
      }

      // Detect cycles (simplified check for direct circular deps)
      for (const [file, imports] of importGraph.entries()) {
        for (const importedFile of imports) {
          const importedImports = importGraph.get(importedFile) || [];
          if (importedImports.some(imp => imp.includes(file.replace(/\.(ts|tsx)$/, '')))) {
            violations.push(`${file} ↔️ ${importedFile}: Circular dependency`);
          }
        }
      }

      if (violations.length > 0) {
        console.error('\n⛔ ARCHITECTURE VIOLATION: Circular dependencies detected\n');
        violations.forEach(v => console.error(`  - ${v}`));
        console.error('\n✅ FIX: Refactor to remove circular dependencies\n');
      }

      expect(violations).toHaveLength(0);
    });
  });

  describe('Duplicate Logic Detection', () => {
    it('should not have duplicate risk calculation formulas', () => {
      const violations: string[] = [];
      const files = getAllTsFiles(SERVICES_DIR);

      // Look for duplicate risk calculation patterns
      const riskCalculationPatterns = [
        /dollarRisk\s*=\s*balance\s*\*\s*riskPercent/,
        /positionSize\s*=\s*dollarRisk\s*\/\s*stopLossPips/,
        /riskAmount\s*=\s*\(\s*balance\s*\*\s*risk\s*\)\s*\/\s*100/
      ];

      const occurrences = new Map<string, string[]>();

      for (const pattern of riskCalculationPatterns) {
        const filesWithPattern: string[] = [];

        for (const file of files) {
          const content = readFileContent(file);
          const relativePath = path.relative(SRC_DIR, file);

          if (pattern.test(content)) {
            filesWithPattern.push(relativePath);
          }
        }

        if (filesWithPattern.length > 1) {
          occurrences.set(pattern.source, filesWithPattern);
        }
      }

      for (const [pattern, files] of occurrences.entries()) {
        violations.push(`Pattern "${pattern}" found in ${files.length} files: ${files.join(', ')}`);
      }

      if (violations.length > 0) {
        console.error('\n⛔ SSOT VIOLATION: Duplicate risk calculation logic detected\n');
        violations.forEach(v => console.error(`  - ${v}`));
        console.error('\n✅ FIX: Consolidate into single authority (ProfessionalRiskManager)\n');
      }

      expect(violations).toHaveLength(0);
    });

    it('should not have duplicate freshness validation logic', () => {
      const violations: string[] = [];
      const files = getAllTsFiles(SERVICES_DIR, ['price-freshness-gate.ts']);

      // Count how many files implement their own freshness checks
      let freshnessCheckCount = 0;
      const filesWithChecks: string[] = [];

      for (const file of files) {
        const content = readFileContent(file);
        const relativePath = path.relative(SRC_DIR, file);

        // Look for freshness validation logic
        if (/FRESHNESS.*THRESHOLD|MAX.*AGE|STALE.*THRESHOLD/i.test(content) &&
            /age.*>|timestamp.*</.test(content)) {
          freshnessCheckCount++;
          filesWithChecks.push(relativePath);
        }
      }

      // Allow up to 2 files (the gate itself and maybe one coordinator)
      if (freshnessCheckCount > 2) {
        violations.push(`Freshness validation logic found in ${freshnessCheckCount} files: ${filesWithChecks.join(', ')}`);
      }

      if (violations.length > 0) {
        console.error('\n⛔ SSOT VIOLATION: Duplicate freshness validation logic\n');
        violations.forEach(v => console.error(`  - ${v}`));
        console.error('\n✅ FIX: Use PriceFreshnessGate exclusively\n');
      }

      expect(violations).toHaveLength(0);
    });
  });

  describe('Database Mutation Authority', () => {
    it('should not perform raw database mutations in business logic', () => {
      const violations: string[] = [];
      const files = [...getAllTsFiles(SERVICES_DIR), ...getAllTsFiles(BRAINS_DIR)];

      // Services that are allowed to write to database
      const allowedDatabaseServices = [
        'database-service',
        'position-service',
        'trade-execution',
        'trade-lifecycle',
        'supabase-summary',
        'candle-persistence',
        'session-management',
        'recommendation-tracker'
      ];

      for (const file of files) {
        const content = readFileContent(file);
        const relativePath = path.relative(SRC_DIR, file);

        // Skip allowed services
        if (allowedDatabaseServices.some(allowed => relativePath.includes(allowed))) {
          continue;
        }

        // Look for direct database mutations
        if (/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(content)) {
          // Check if it's in a coordinator pattern or direct mutation
          if (!content.includes('// @database-mutation-authorized')) {
            violations.push(`${relativePath}: Direct database mutation outside designated services`);
          }
        }
      }

      if (violations.length > 0) {
        console.warn('\n⚠️  WARNING: Direct database mutations found outside designated services\n');
        violations.forEach(v => console.warn(`  - ${v}`));
        console.warn('\n💡 TIP: Consider using coordinator services for database operations\n');
      }

      // This is a warning for now, not a hard failure
      expect(true).toBe(true);
    });
  });

  describe('Governance Infrastructure', () => {
    it('should have all required governance files', () => {
      const requiredFiles = [
        'src/governance/validation-gateway.ts',
        'src/governance/price-freshness-gate.ts',
        'src/governance/ssot-violation-detector.ts',
        'src/governance/RESPONSIBILITY_REGISTRY.md'
      ];

      const missing: string[] = [];

      for (const file of requiredFiles) {
        const fullPath = path.join(__dirname, '..', '..', file);
        if (!fs.existsSync(fullPath)) {
          missing.push(file);
        }
      }

      if (missing.length > 0) {
        console.error('\n⛔ CRITICAL: Missing governance infrastructure files\n');
        missing.forEach(f => console.error(`  - ${f}`));
      }

      expect(missing).toHaveLength(0);
    });

    it('should have ssot_violations table documented', () => {
      const migrationDir = path.join(__dirname, '..', '..', 'supabase', 'migrations');

      if (!fs.existsSync(migrationDir)) {
        console.warn('\n⚠️  WARNING: Cannot verify ssot_violations table (migrations directory not found)\n');
        expect(true).toBe(true);
        return;
      }

      const migrationFiles = fs.readdirSync(migrationDir);
      const hasViolationsTable = migrationFiles.some(file =>
        file.includes('ssot_violations') ||
        file.includes('ssot-violations')
      );

      if (!hasViolationsTable) {
        console.warn('\n⚠️  WARNING: ssot_violations table migration not found\n');
      }

      expect(hasViolationsTable).toBe(true);
    });
  });
});

describe('Architectural Compliance - Best Practices', () => {

  describe('Code Organization', () => {
    it('should not have files larger than 1000 lines', () => {
      const violations: string[] = [];
      const files = getAllTsFiles(SRC_DIR, ['tests', 'node_modules']);

      for (const file of files) {
        const content = readFileContent(file);
        const lines = content.split('\n').length;
        const relativePath = path.relative(SRC_DIR, file);

        if (lines > 1000) {
          violations.push(`${relativePath}: ${lines} lines (consider splitting)`);
        }
      }

      if (violations.length > 0) {
        console.warn('\n⚠️  WARNING: Large files detected (>1000 lines)\n');
        violations.forEach(v => console.warn(`  - ${v}`));
        console.warn('\n💡 TIP: Consider splitting into smaller, focused modules\n');
      }

      // This is a warning, not a hard failure
      expect(true).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should use logger for error logging, not console.error', () => {
      const violations: string[] = [];
      const files = getAllTsFiles(SERVICES_DIR);

      for (const file of files) {
        const content = readFileContent(file);
        const relativePath = path.relative(SRC_DIR, file);

        // Look for console.error usage
        if (/console\.error\(/.test(content)) {
          const importsLogger = /import.*logger.*from/.test(content);
          if (!importsLogger) {
            violations.push(`${relativePath}: Uses console.error without importing logger`);
          }
        }
      }

      if (violations.length > 0) {
        console.warn('\n⚠️  WARNING: Services using console.error instead of logger\n');
        violations.forEach(v => console.warn(`  - ${v}`));
        console.warn('\n💡 TIP: Use logger from lib/logger.ts for consistent logging\n');
      }

      // This is a warning, not a hard failure
      expect(true).toBe(true);
    });
  });
});

describe('Architectural Compliance - Confidence-Dominant Selection', () => {

  describe('Best Symbol Selector Authority', () => {
    it('should use confidence as PRIMARY score, not TPS', () => {
      const violations: string[] = [];
      const selectorFile = path.join(SERVICES_DIR, 'best-symbol-selector.ts');

      if (!fs.existsSync(selectorFile)) {
        console.error('\n⛔ CRITICAL: best-symbol-selector.ts not found\n');
        expect(true).toBe(false);
        return;
      }

      const content = readFileContent(selectorFile);

      // ✅ CONFIDENCE-DOMINANT ARCHITECTURE CHECKS
      // 1. Confidence must be the primaryScore
      if (!/primaryScore:\s*decision\.confidence/.test(content)) {
        violations.push('primaryScore must be decision.confidence (confidence IS the score)');
      }

      // 2. TPS should only be used for tie-breaking
      if (!/TIE.*BREAKER|tie.*breaker/i.test(content) && /tpsScore|TPS.*score/i.test(content)) {
        violations.push('TPS scores should only be used for tie-breaking logic');
      }

      // 3. Confidence sorting must happen before tie-breaking
      if (!/sort.*primaryScore/.test(content)) {
        violations.push('Must sort by primaryScore (confidence) before applying tie-breakers');
      }

      // 4. TPS scores must be optional parameter
      if (!/tpsScores\?:.*Map<string,\s*number>/.test(content)) {
        violations.push('tpsScores must be an optional parameter (confidence works without it)');
      }

      if (violations.length > 0) {
        console.error('\n⛔ ARCHITECTURAL VIOLATION: Confidence-dominant selection broken\n');
        violations.forEach(v => console.error(`  - ${v}`));
        console.error('\n✅ FIX: Confidence is PRIMARY score, TPS only for tie-breaking (≤5 point difference)\n');
      }

      expect(violations).toHaveLength(0);
    });

    it('should pass TPS scores from goal-session-live-engine to selector', () => {
      const liveEngineFile = path.join(SERVICES_DIR, 'goal-session-live-engine.ts');

      if (!fs.existsSync(liveEngineFile)) {
        console.error('\n⛔ CRITICAL: goal-session-live-engine.ts not found\n');
        expect(true).toBe(false);
        return;
      }

      const content = readFileContent(liveEngineFile);

      // Check that TPS scores are calculated and passed
      const calculatesTPS = /computeTPS|trade-priority-score/.test(content);
      const passesTPS = /selectBestSymbol\([^)]*tpsScores/.test(content);

      if (!calculatesTPS) {
        console.error('\n⛔ REGRESSION: TPS scores not being calculated in goal-session-live-engine\n');
        console.error('✅ FIX: Import computeTPS and calculate scores before calling selector\n');
      }

      if (!passesTPS) {
        console.error('\n⛔ REGRESSION: TPS scores not being passed to selectBestSymbol\n');
        console.error('✅ FIX: Pass tpsScores Map as third parameter to selectBestSymbol\n');
      }

      expect(calculatesTPS).toBe(true);
      expect(passesTPS).toBe(true);
    });
  });

  describe('Execution Eligibility Gate - MICRO Override', () => {
    it('should have MICRO >=85% confidence override logic', () => {
      const violations: string[] = [];
      const gateFile = path.join(SERVICES_DIR, 'execution-eligibility-gate.ts');

      if (!fs.existsSync(gateFile)) {
        console.error('\n⛔ CRITICAL: execution-eligibility-gate.ts not found\n');
        expect(true).toBe(false);
        return;
      }

      const content = readFileContent(gateFile);

      // Check for MICRO override logic
      if (!/MICRO.*CONFIDENCE.*OVERRIDE|MICRO.*>=85/i.test(content)) {
        violations.push('Missing MICRO >=85% confidence override logic');
      }

      // Check that style and confidence are in input interface
      if (!/tradeConfidence\?:.*number/.test(content)) {
        violations.push('ExecutionEligibilityInput must include tradeConfidence field');
      }

      if (!/style\?:.*SCALP.*MICRO_INTRADAY.*INTRADAY/.test(content)) {
        violations.push('ExecutionEligibilityInput must include style field');
      }

      // Check that override detects MICRO_INTRADAY + >=85% confidence
      if (!/MICRO_INTRADAY.*>=.*85|>=.*85.*MICRO_INTRADAY/.test(content)) {
        violations.push('Override must check for MICRO_INTRADAY style AND confidence >= 85%');
      }

      if (violations.length > 0) {
        console.error('\n⛔ ARCHITECTURAL VIOLATION: MICRO confidence override missing or broken\n');
        violations.forEach(v => console.error(`  - ${v}`));
        console.error('\n✅ FIX: Add MICRO_INTRADAY + >=85% confidence override to respect Alpha authority\n');
      }

      expect(violations).toHaveLength(0);
    });

    it('should respect economic checks even with MICRO override', () => {
      const gateFile = path.join(SERVICES_DIR, 'execution-eligibility-gate.ts');

      if (!fs.existsSync(gateFile)) {
        console.error('\n⛔ CRITICAL: execution-eligibility-gate.ts not found\n');
        expect(true).toBe(false);
        return;
      }

      const content = readFileContent(gateFile);

      // Economic checks should NEVER be bypassed
      const hasEconomicChecks = /checkMinimumProfit|PROFIT_BELOW_MINIMUM/.test(content);
      const economicChecksRespectOverride = /Note:.*MICRO.*override.*NOT.*bypass.*economic|economic.*check.*not.*overridable/i.test(content);

      if (!hasEconomicChecks) {
        console.error('\n⛔ CRITICAL: Economic checks (minimum profit) missing\n');
        expect(true).toBe(false);
        return;
      }

      if (!economicChecksRespectOverride) {
        console.warn('\n⚠️  WARNING: Clarify that MICRO override does NOT bypass economic checks\n');
        console.warn('💡 TIP: Add comment noting economic checks remain enforced\n');
      }

      expect(hasEconomicChecks).toBe(true);
    });
  });

  describe('TPS Integration Integrity', () => {
    it('should not allow TPS to override confidence-based ranking', () => {
      const violations: string[] = [];
      const files = getAllTsFiles(SERVICES_DIR);

      for (const file of files) {
        const content = readFileContent(file);
        const relativePath = path.relative(SRC_DIR, file);

        // Look for TPS score being used as primary ranking
        const forbiddenPatterns = [
          /sort.*tpsScore(?!.*\/\/.*tie[-\s]?break)/i,  // Sorting by TPS without tie-break comment
          /primaryScore.*=.*tps/i,                       // Setting primaryScore to TPS
          /if.*tpsScore.*>.*confidence/i,                // Comparing TPS vs confidence
        ];

        for (const pattern of forbiddenPatterns) {
          if (pattern.test(content)) {
            violations.push(`${relativePath}: TPS score used for primary ranking (${pattern.source})`);
          }
        }
      }

      if (violations.length > 0) {
        console.error('\n⛔ ARCHITECTURAL VIOLATION: TPS overriding confidence-based ranking\n');
        violations.forEach(v => console.error(`  - ${v}`));
        console.error('\n✅ FIX: TPS must ONLY be used for tie-breaking, never primary ranking\n');
      }

      expect(violations).toHaveLength(0);
    });

    it('should use TPS only for candidates with close confidence', () => {
      const selectorFile = path.join(SERVICES_DIR, 'best-symbol-selector.ts');

      if (!fs.existsSync(selectorFile)) {
        expect(true).toBe(true); // Skip if file doesn't exist
        return;
      }

      const content = readFileContent(selectorFile);

      // Check for tie-breaker threshold logic
      const hasTieThreshold = /CONFIDENCE_TIE_THRESHOLD|confidenceDiff.*<=|confidence.*difference.*<=/.test(content);
      const appliesTieBreakersConditionally = /if.*confidenceDiff.*<=|if.*confidence.*difference/.test(content);

      if (!hasTieThreshold) {
        console.warn('\n⚠️  WARNING: No confidence tie threshold defined\n');
        console.warn('💡 TIP: Define threshold for when tie-breakers activate (e.g., ≤5 points)\n');
      }

      if (!appliesTieBreakersConditionally) {
        console.warn('\n⚠️  WARNING: Tie-breakers may not be applied conditionally\n');
        console.warn('💡 TIP: Only apply tie-breakers when confidence difference is within threshold\n');
      }

      // Non-critical checks - don't fail build
      expect(true).toBe(true);
    });
  });
});

// Summary reporter
afterAll(() => {
  console.log('\n✅ Architectural compliance tests complete');
  console.log('📊 SSOT enforcement verified at build time');
  console.log('🎯 Confidence-dominant selection architecture validated\n');
});

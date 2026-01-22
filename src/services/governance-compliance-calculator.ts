/**
 * Governance Compliance Calculator - Phase 3.2 Section 4
 *
 * Calculates SSOT compliance scores across all architectural domains
 * and records daily snapshots for trend analysis.
 *
 * Authority:
 * - SSOT for compliance scoring calculations
 * - Integrates with architectural tests
 * - Records snapshots to database
 *
 * Usage:
 * ```typescript
 * const calculator = new GovernanceComplianceCalculator();
 * const score = await calculator.calculateDailyScore();
 * await calculator.recordSnapshot(score);
 * ```
 */

import { supabase } from '../lib/supabase';
import { logger, LogCategory } from '../lib/logger';
import * as fs from 'fs';
import * as path from 'path';

export interface DomainScore {
  score: number; // 0-100
  violations: number;
  filesScanned: number;
  compliantFiles: number;
}

export interface ComplianceScore {
  overallScore: number;
  positionSizing: DomainScore;
  riskCalculation: DomainScore;
  marketData: DomainScore;
  validation: DomainScore;
  totalViolations: number;
  criticalViolations: number;
  warningViolations: number;
  totalFilesScanned: number;
  snapshotDate: string;
}

/**
 * GovernanceComplianceCalculator - SSOT for compliance scoring
 *
 * Calculates compliance scores by analyzing codebase for SSOT violations
 * across multiple architectural domains.
 */
export class GovernanceComplianceCalculator {
  private readonly SRC_DIR: string;
  private readonly SERVICES_DIR: string;

  constructor() {
    // In browser environment, we can't access filesystem directly
    // This service is meant to run in Node.js context (tests, scripts)
    if (typeof window === 'undefined') {
      this.SRC_DIR = path.join(process.cwd(), 'src');
      this.SERVICES_DIR = path.join(this.SRC_DIR, 'services');
    } else {
      this.SRC_DIR = '';
      this.SERVICES_DIR = '';
    }
  }

  /**
   * Calculate compliance score for Position Sizing domain
   */
  private async calculatePositionSizingScore(): Promise<DomainScore> {
    if (!this.SERVICES_DIR) {
      return { score: 100, violations: 0, filesScanned: 0, compliantFiles: 0 };
    }

    const violations: string[] = [];
    const files = this.getAllTsFiles(this.SERVICES_DIR, [
      'professional-risk-manager.ts',
      'estimation-risk-calculator.ts'
    ]);

    const forbiddenPatterns = [
      /calculateLotSizeFromDollarRisk\(/,
      /calculateGoalAwareLotSize\(/,
      /calculatePositionSize\(/,
      /lotSize\s*=\s*\([^)]*balance[^)]*riskPercent/,
      /positionSize\s*=\s*\([^)]*dollarRisk/
    ];

    for (const file of files) {
      let content = fs.readFileSync(file, 'utf-8');
      // Remove comments
      content = content.replace(/\/\/.*$/gm, '');
      content = content.replace(/\/\*[\s\S]*?\*\//g, '');

      for (const pattern of forbiddenPatterns) {
        if (pattern.test(content)) {
          violations.push(file);
          break;
        }
      }
    }

    const compliantFiles = files.length - violations.length;
    const score = files.length > 0 ? Math.round((compliantFiles / files.length) * 100) : 100;

    return {
      score,
      violations: violations.length,
      filesScanned: files.length,
      compliantFiles
    };
  }

  /**
   * Calculate compliance score for Risk Calculation domain
   */
  private async calculateRiskCalculationScore(): Promise<DomainScore> {
    if (!this.SERVICES_DIR) {
      return { score: 100, violations: 0, filesScanned: 0, compliantFiles: 0 };
    }

    const violations: string[] = [];
    const files = this.getAllTsFiles(this.SERVICES_DIR);

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const relativePath = path.relative(this.SRC_DIR, file);

      // Skip the risk managers themselves
      if (relativePath.includes('professional-risk-manager') ||
          relativePath.includes('estimation-risk-calculator')) {
        continue;
      }

      // Check if file mentions position/lot size AND doesn't import either risk manager
      const hasPositionSizing = /position.*size|lot.*size|evaluateTrade/i.test(content);
      const importsRiskManager = /import.*professional-risk-manager|ProfessionalRiskManager/.test(content);
      const importsEstimationCalculator = /import.*estimation-risk-calculator|EstimationRiskCalculator|estimationRiskCalculator/.test(content);

      if (hasPositionSizing && !importsRiskManager && !importsEstimationCalculator &&
          !content.includes('// @architectural-exception')) {
        if (/lotSize\s*=|positionSize\s*=/.test(content)) {
          violations.push(file);
        }
      }
    }

    const compliantFiles = files.length - violations.length;
    const score = files.length > 0 ? Math.round((compliantFiles / files.length) * 100) : 100;

    return {
      score,
      violations: violations.length,
      filesScanned: files.length,
      compliantFiles
    };
  }

  /**
   * Calculate compliance score for Market Data domain
   */
  private async calculateMarketDataScore(): Promise<DomainScore> {
    if (!this.SERVICES_DIR) {
      return { score: 100, violations: 0, filesScanned: 0, compliantFiles: 0 };
    }

    const violations: string[] = [];
    const files = this.getAllTsFiles(this.SERVICES_DIR, [
      'market-data-service.ts',
      'candle-',
      'database-service.ts'
    ]);

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');

      // Look for direct Supabase queries to forex_candles
      if (/\.from\s*\(\s*['"`]forex_candles['"`]\s*\)/.test(content)) {
        violations.push(file);
      }
    }

    const compliantFiles = files.length - violations.length;
    const score = files.length > 0 ? Math.round((compliantFiles / files.length) * 100) : 100;

    return {
      score,
      violations: violations.length,
      filesScanned: files.length,
      compliantFiles
    };
  }

  /**
   * Calculate compliance score for Validation domain
   */
  private async calculateValidationScore(): Promise<DomainScore> {
    // Placeholder for future validation domain checks
    return {
      score: 100,
      violations: 0,
      filesScanned: 0,
      compliantFiles: 0
    };
  }

  /**
   * Calculate overall compliance score
   */
  async calculateDailyScore(): Promise<ComplianceScore> {
    logger.info(LogCategory.GOVERNANCE, 'Calculating daily compliance score...');

    const positionSizing = await this.calculatePositionSizingScore();
    const riskCalculation = await this.calculateRiskCalculationScore();
    const marketData = await this.calculateMarketDataScore();
    const validation = await this.calculateValidationScore();

    const totalViolations =
      positionSizing.violations +
      riskCalculation.violations +
      marketData.violations +
      validation.violations;

    const totalFilesScanned =
      positionSizing.filesScanned +
      riskCalculation.filesScanned +
      marketData.filesScanned +
      validation.filesScanned;

    // Overall score is weighted average
    const overallScore = Math.round(
      (positionSizing.score * 0.3 +
       riskCalculation.score * 0.3 +
       marketData.score * 0.2 +
       validation.score * 0.2)
    );

    // Classify violations as critical/warning
    const criticalViolations = positionSizing.violations + riskCalculation.violations;
    const warningViolations = marketData.violations + validation.violations;

    return {
      overallScore,
      positionSizing,
      riskCalculation,
      marketData,
      validation,
      totalViolations,
      criticalViolations,
      warningViolations,
      totalFilesScanned,
      snapshotDate: new Date().toISOString().split('T')[0]
    };
  }

  /**
   * Record compliance snapshot to database
   */
  async recordSnapshot(score: ComplianceScore): Promise<void> {
    try {
      const { error } = await supabase
        .from('compliance_scores')
        .upsert({
          snapshot_date: score.snapshotDate,
          overall_score: score.overallScore,
          position_sizing_score: score.positionSizing.score,
          risk_calculation_score: score.riskCalculation.score,
          market_data_score: score.marketData.score,
          trade_validation_score: score.validation.score,
          total_files_scanned: score.totalFilesScanned,
          compliant_files: score.totalFilesScanned - score.totalViolations,
          position_sizing_violations: score.positionSizing.violations,
          risk_calculation_violations: score.riskCalculation.violations,
          market_data_violations: score.marketData.violations,
          captured_at: new Date().toISOString()
        }, {
          onConflict: 'snapshot_date'
        });

      if (error) {
        logger.error(LogCategory.GOVERNANCE, 'Failed to record compliance snapshot', error);
        throw error;
      }

      logger.info(LogCategory.GOVERNANCE, `Compliance snapshot recorded: ${score.overallScore}/100`);
    } catch (error) {
      logger.error(LogCategory.GOVERNANCE, 'Error recording compliance snapshot', error);
      throw error;
    }
  }

  /**
   * Get all TypeScript files in a directory
   */
  private getAllTsFiles(dir: string, exclude: string[] = []): string[] {
    const files: string[] = [];

    if (!fs.existsSync(dir)) {
      return files;
    }

    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      const relativePath = path.relative(this.SRC_DIR, fullPath);

      // Skip excluded paths
      if (exclude.some(ex => relativePath.includes(ex))) {
        continue;
      }

      if (item.isDirectory()) {
        files.push(...this.getAllTsFiles(fullPath, exclude));
      } else if (item.isFile() && (item.name.endsWith('.ts') || item.name.endsWith('.tsx'))) {
        files.push(fullPath);
      }
    }

    return files;
  }
}

// Export singleton instance
export const governanceComplianceCalculator = new GovernanceComplianceCalculator();

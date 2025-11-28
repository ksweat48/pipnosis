#!/usr/bin/env node

/**
 * Critical Systems Validator
 *
 * Validates that critical infrastructure configurations haven't been modified.
 * Runs during build process and generates warnings (non-blocking).
 *
 * This prevents accidental breakage of polling, charts, and real-time systems.
 */

const fs = require('fs');
const path = require('path');

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m'
};

class CriticalSystemValidator {
  constructor() {
    this.warnings = [];
    this.changes = [];
    this.errors = [];
    this.baselinePath = path.join(__dirname, '../config/critical-baseline.json');
    this.netlifyTomlPath = path.join(__dirname, '../netlify.toml');
    this.baseline = null;
  }

  log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
  }

  logHeader(message) {
    console.log('\n' + '='.repeat(80));
    this.log(message, 'bright');
    console.log('='.repeat(80) + '\n');
  }

  logWarning(message) {
    this.warnings.push(message);
    this.log(`⚠️  ${message}`, 'yellow');
  }

  logError(message) {
    this.errors.push(message);
    this.log(`❌ ${message}`, 'red');
  }

  logSuccess(message) {
    this.log(`✅ ${message}`, 'green');
  }

  logChange(component, field, oldValue, newValue) {
    this.changes.push({ component, field, oldValue, newValue });
    this.log(`\n🔄 CHANGE DETECTED in ${component}:`, 'yellow');
    this.log(`   Field: ${field}`, 'yellow');
    this.log(`   Old: ${JSON.stringify(oldValue)}`, 'red');
    this.log(`   New: ${JSON.stringify(newValue)}`, 'green');
  }

  loadBaseline() {
    try {
      const baselineContent = fs.readFileSync(this.baselinePath, 'utf8');
      this.baseline = JSON.parse(baselineContent);
      this.logSuccess(`Loaded baseline configuration v${this.baseline.version}`);
      return true;
    } catch (error) {
      this.logError(`Failed to load baseline: ${error.message}`);
      return false;
    }
  }

  validateNetlifyToml() {
    this.log('\n📋 Validating netlify.toml...', 'blue');

    try {
      const tomlContent = fs.readFileSync(this.netlifyTomlPath, 'utf8');

      // Validate each critical function
      const functionsToCheck = this.baseline.netlifyFunctions;

      for (const [funcName, expected] of Object.entries(functionsToCheck)) {
        const functionKey = funcName.replace(/([A-Z])/g, '-$1').toLowerCase();

        // Check timeout
        const timeoutRegex = new RegExp(`\\[functions\\."${functionKey}"\\][\\s\\S]*?timeout\\s*=\\s*(\\d+)`);
        const timeoutMatch = tomlContent.match(timeoutRegex);

        if (timeoutMatch) {
          const actualTimeout = parseInt(timeoutMatch[1]);
          if (actualTimeout !== expected.timeout) {
            this.logChange(
              `netlify.toml [functions."${functionKey}"]`,
              'timeout',
              expected.timeout,
              actualTimeout
            );
          }
        }

        // Check schedule (if exists)
        if (expected.schedule) {
          const scheduleRegex = new RegExp(`\\[functions\\."${functionKey}"\\][\\s\\S]*?schedule\\s*=\\s*"([^"]+)"`);
          const scheduleMatch = tomlContent.match(scheduleRegex);

          if (scheduleMatch) {
            const actualSchedule = scheduleMatch[1];
            if (actualSchedule !== expected.schedule) {
              this.logChange(
                `netlify.toml [functions."${functionKey}"]`,
                'schedule',
                expected.schedule,
                actualSchedule
              );
            }

            // Validate cron format (must be 5-field)
            const cronFields = actualSchedule.trim().split(/\s+/);
            if (cronFields.length !== 5) {
              this.logError(
                `CRITICAL: Invalid cron format for ${functionKey}: "${actualSchedule}"\n` +
                `   Netlify requires 5-field format (minute hour day month weekday)\n` +
                `   Found ${cronFields.length} fields. This will BREAK the scheduled function!`
              );
            }
          }
        }
      }

      if (this.changes.length === 0 && this.errors.length === 0) {
        this.logSuccess('netlify.toml configuration matches baseline');
      }

    } catch (error) {
      this.logError(`Failed to validate netlify.toml: ${error.message}`);
    }
  }

  validatePollingIntervals() {
    this.log('\n⏱️  Validating polling intervals...', 'blue');

    const filesToCheck = [
      {
        path: 'src/services/chart-direct-price-poller.ts',
        patterns: [
          { name: 'chartUpdateInterval', regex: /interval:\s*(\d+)/, expected: this.baseline.polling.chartUpdateInterval }
        ]
      },
      {
        path: 'src/services/global-polling-coordinator.ts',
        patterns: [
          { name: 'marketCheckInterval', regex: /MARKET_CHECK_INTERVAL\s*=\s*(\d+)/, expected: this.baseline.polling.marketCheckInterval },
          { name: 'heartbeatInterval', regex: /HEARTBEAT_INTERVAL_MS\s*=\s*(\d+)/, expected: this.baseline.polling.heartbeatInterval }
        ]
      }
    ];

    for (const file of filesToCheck) {
      const fullPath = path.join(__dirname, '..', file.path);

      try {
        const content = fs.readFileSync(fullPath, 'utf8');

        for (const pattern of file.patterns) {
          const match = content.match(pattern.regex);
          if (match) {
            const actualValue = parseInt(match[1]);
            if (actualValue !== pattern.expected) {
              this.logChange(
                file.path,
                pattern.name,
                pattern.expected,
                actualValue
              );
            }
          }
        }
      } catch (error) {
        this.logWarning(`Could not read ${file.path}: ${error.message}`);
      }
    }

    if (this.changes.length === 0) {
      this.logSuccess('All polling intervals match baseline');
    }
  }

  generateReport() {
    const reportPath = path.join(__dirname, '..', 'CRITICAL_CHANGES_REPORT.txt');

    if (this.changes.length === 0 && this.errors.length === 0 && this.warnings.length === 0) {
      // Clean report - remove old one if exists
      if (fs.existsSync(reportPath)) {
        fs.unlinkSync(reportPath);
      }
      return;
    }

    let report = '';
    report += '═'.repeat(80) + '\n';
    report += '🚨 CRITICAL INFRASTRUCTURE CHANGES DETECTED\n';
    report += '═'.repeat(80) + '\n\n';
    report += `Generated: ${new Date().toISOString()}\n`;
    report += `Baseline Version: ${this.baseline.version}\n\n`;

    if (this.errors.length > 0) {
      report += '❌ ERRORS (Will break functionality):\n';
      report += '-'.repeat(80) + '\n';
      this.errors.forEach((error, i) => {
        report += `${i + 1}. ${error}\n\n`;
      });
    }

    if (this.changes.length > 0) {
      report += '\n🔄 CONFIGURATION CHANGES:\n';
      report += '-'.repeat(80) + '\n';
      this.changes.forEach((change, i) => {
        report += `${i + 1}. ${change.component}\n`;
        report += `   Field: ${change.field}\n`;
        report += `   Old Value: ${JSON.stringify(change.oldValue)}\n`;
        report += `   New Value: ${JSON.stringify(change.newValue)}\n\n`;
      });
    }

    if (this.warnings.length > 0) {
      report += '\n⚠️  WARNINGS:\n';
      report += '-'.repeat(80) + '\n';
      this.warnings.forEach((warning, i) => {
        report += `${i + 1}. ${warning}\n\n`;
      });
    }

    report += '\n📋 RECOMMENDED ACTIONS:\n';
    report += '-'.repeat(80) + '\n';
    report += '1. Review each change to determine if it was intentional\n';
    report += '2. If unintentional, restore values from critical-baseline.json\n';
    report += '3. Test polling and chart functionality after deployment\n';
    report += '4. Update baseline if changes are approved and working\n';
    report += '5. Monitor production for 15 minutes after deployment\n\n';

    report += '📚 DOCUMENTATION:\n';
    report += '-'.repeat(80) + '\n';
    report += 'See docs/CRITICAL_SYSTEMS.md for detailed information\n';
    report += 'Baseline: config/critical-baseline.json\n\n';

    report += '🔄 ROLLBACK:\n';
    report += '-'.repeat(80) + '\n';
    report += 'If deployment breaks functionality:\n';
    report += '1. Revert to previous deployment in Netlify dashboard\n';
    report += '2. Or restore files from git history\n';
    report += '3. Or manually restore values from critical-baseline.json\n\n';

    fs.writeFileSync(reportPath, report);
    this.log(`\n📄 Full report written to: CRITICAL_CHANGES_REPORT.txt`, 'yellow');
  }

  run() {
    this.logHeader('🛡️  CRITICAL SYSTEMS VALIDATION');

    this.log('Checking critical infrastructure configurations...', 'blue');
    this.log('Mode: WARNING (non-blocking)\n', 'yellow');

    // Load baseline
    if (!this.loadBaseline()) {
      this.logError('Cannot proceed without baseline configuration');
      return 1;
    }

    // Run validations
    this.validateNetlifyToml();
    this.validatePollingIntervals();

    // Summary
    this.logHeader('📊 VALIDATION SUMMARY');

    if (this.errors.length === 0 && this.changes.length === 0 && this.warnings.length === 0) {
      this.logSuccess('✅ All critical systems match baseline configuration');
      this.logSuccess('✅ No changes detected');
      this.logSuccess('✅ Safe to deploy');
      return 0;
    }

    if (this.errors.length > 0) {
      this.log(`\n${colors.bgRed}${colors.bright} CRITICAL ERRORS: ${this.errors.length} ${colors.reset}`, 'red');
      this.log('These changes will likely BREAK functionality!', 'red');
    }

    if (this.changes.length > 0) {
      this.log(`\n${colors.bgYellow}${colors.bright} CONFIGURATION CHANGES: ${this.changes.length} ${colors.reset}`, 'yellow');
      this.log('Review these changes before deployment', 'yellow');
    }

    if (this.warnings.length > 0) {
      this.log(`\n⚠️  WARNINGS: ${this.warnings.length}`, 'yellow');
    }

    // Generate detailed report
    this.generateReport();

    this.log('\n⚠️  BUILD WILL CONTINUE (warning mode)', 'yellow');
    this.log('Review the report and monitor deployment closely\n', 'yellow');

    // Return 0 (success) since we're in warning mode
    return 0;
  }
}

// Run validator
const validator = new CriticalSystemValidator();
const exitCode = validator.run();
process.exit(exitCode);

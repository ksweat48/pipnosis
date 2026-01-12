/**
 * ESLint SSOT Module Boundary Rules
 *
 * ENFORCEMENT POLICY:
 * These rules prevent hardcoded pip/lot/dollar mathematics outside SSOT modules.
 * Violations are ERRORS (not warnings) to prevent merging non-compliant code.
 *
 * ALLOWED LOCATIONS (SSOT Modules):
 * - src/utils/tradeMath.ts
 * - src/utils/currencyHelpers.ts
 * - src/config/symbol-registry.ts
 * - src/types/trade-context.ts
 *
 * FORBIDDEN LOCATIONS (Business Logic):
 * - src/brains/**
 * - src/services/**
 * - src/components/**
 * - netlify/functions/**
 *
 * FORBIDDEN PATTERNS:
 * - Hardcoded constants: 0.0001, 0.01, 10, 10000, 100000
 * - Pip calculations: / 0.0001, * 10000
 * - Dollar per pip: lotSize * 10
 * - Decimal precision without context: .toFixed(5)
 * - Symbol conditionals: if (symbol.includes('JPY'))
 */

module.exports = {
  overrides: [
    {
      // Apply to business logic layers only
      files: [
        'src/brains/**/*.ts',
        'src/brains/**/*.tsx',
        'src/services/**/*.ts',
        'src/services/**/*.tsx',
        'src/components/**/*.ts',
        'src/components/**/*.tsx',
        'netlify/functions/**/*.ts',
        'netlify/functions/**/*.js',
      ],
      // Exclude SSOT modules
      excludedFiles: [
        'src/utils/tradeMath.ts',
        'src/utils/currencyHelpers.ts',
        'src/config/symbol-registry.ts',
        'src/types/trade-context.ts',
        'src/types/trading-units.ts',
        'src/services/ssot-*.ts',
      ],
      rules: {
        // Forbid hardcoded pip divisions
        'no-restricted-syntax': [
          'error',
          {
            selector: 'BinaryExpression[operator="/"][right.value=0.0001]',
            message: 'SSOT VIOLATION: Do not use hardcoded pip division (/ 0.0001). Use ctx.convertPriceToPips() or tradeMath.calculatePips()',
          },
          {
            selector: 'BinaryExpression[operator="/"][right.value=0.01]',
            message: 'SSOT VIOLATION: Do not use hardcoded pip division (/ 0.01). Use ctx.convertPriceToPips() or tradeMath.calculatePips()',
          },
          {
            selector: 'BinaryExpression[operator="*"][right.value=10000]',
            message: 'SSOT VIOLATION: Do not use hardcoded pip multiplication (* 10000). Use ctx.convertPriceToPips() or tradeMath.calculatePips()',
          },
          {
            selector: 'BinaryExpression[operator="*"][left.value=10000]',
            message: 'SSOT VIOLATION: Do not use hardcoded pip multiplication (10000 *). Use ctx.convertPriceToPips() or tradeMath.calculatePips()',
          },
          {
            selector: 'BinaryExpression[operator="*"][right.value=100000]',
            message: 'SSOT VIOLATION: Do not use hardcoded pip multiplication (* 100000). Use ctx.convertPriceToPips() or tradeMath.calculatePips()',
          },
          {
            selector: 'BinaryExpression[operator="*"][left.value=100000]',
            message: 'SSOT VIOLATION: Do not use hardcoded pip multiplication (100000 *). Use ctx.convertPriceToPips() or tradeMath.calculatePips()',
          },
          // Forbid hardcoded dollar per pip
          {
            selector: 'BinaryExpression[operator="*"][right.value=10][left.property.name="lotSize"]',
            message: 'SSOT VIOLATION: Do not use hardcoded dollar per pip (lotSize * 10). Use ctx.calculateDollarsPerPip() or tradeMath.calculateDollarsPerPip()',
          },
          {
            selector: 'BinaryExpression[operator="*"][left.value=10][right.property.name="lotSize"]',
            message: 'SSOT VIOLATION: Do not use hardcoded dollar per pip (10 * lotSize). Use ctx.calculateDollarsPerPip() or tradeMath.calculateDollarsPerPip()',
          },
          // Forbid symbol conditionals
          {
            selector: 'IfStatement[test.callee.property.name="includes"][test.arguments.0.value=/JPY|XAU|BTC|ETH/]',
            message: 'SSOT VIOLATION: Do not use symbol conditionals for pip values. Use TradeContext or tradeMath.getSymbolProfile()',
          },
        ],
      },
    },
  ],
};

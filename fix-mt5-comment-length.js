/**
 * Fix MT5 Comment Length Issue
 * 
 * This script checks and fixes the comment length issue in the MT5 connector
 * by ensuring all comments are limited to 31 characters (MT5 requirement).
 */

const fs = require('fs');
const path = require('path');

// Files to check and fix
const filesToFix = [
  'mt5_connector.py',
  'python/mt5_connector.py',
  'src/hooks/useTradeExecution.ts',
  'src/services/mt5WebSocketClient.ts'
];

// Function to fix a file
function fixFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${filePath}`);
    return false;
  }

  console.log(`Checking ${filePath}...`);
  let content = fs.readFileSync(filePath, 'utf8');
  let fixed = false;

  // Fix for Python files
  if (filePath.endsWith('.py')) {
    // Check if already fixed
    if (content.includes('comment[:31]')) {
      console.log(`✅ ${filePath} already fixed`);
      return false;
    }

    // Fix the comment parameter
    const newContent = content.replace(
      /"comment": comment,/g, 
      '"comment": comment[:31],  # Limit comment to 31 characters (MT5 requirement)'
    );

    if (newContent !== content) {
      fs.writeFileSync(filePath, newContent);
      console.log(`✅ Fixed ${filePath}`);
      fixed = true;
    }
  }

  // Fix for TypeScript files
  if (filePath.endsWith('.ts')) {
    // Check if already fixed
    if (content.includes('substring(0, 31)')) {
      console.log(`✅ ${filePath} already fixed`);
      return false;
    }

    // Fix for useTradeExecution.ts
    if (filePath.includes('useTradeExecution.ts')) {
      const newContent = content.replace(
        /const formattedSymbol = request\.symbol\.replace\('\/'\, ''\)\.toUpperCase\(\);/,
        `const formattedSymbol = request.symbol.replace('/', '').toUpperCase();\n\n      // Limit comment to 31 characters (MT5 requirement)\n      const limitedComment = request.comment ? request.comment.substring(0, 31) : 'Pipnosis AI Trade';`
      ).replace(
        /comment: request\.comment \|\| 'Pipnosis AI Trade'/,
        'comment: limitedComment'
      );

      if (newContent !== content) {
        fs.writeFileSync(filePath, newContent);
        console.log(`✅ Fixed ${filePath}`);
        fixed = true;
      }
    }

    // Fix for mt5WebSocketClient.ts
    if (filePath.includes('mt5WebSocketClient.ts')) {
      const newContent = content.replace(
        /const formattedSymbol = order\.symbol\.replace\('\/'\, ''\)\.toUpperCase\(\);/,
        `const formattedSymbol = order.symbol.replace('/', '').toUpperCase();\n      \n      // Limit comment to 31 characters (MT5 requirement)\n      const limitedComment = order.comment ? order.comment.substring(0, 31) : 'Pipnosis AI Trade';`
      ).replace(
        /comment: order\.comment \|\| 'Pipnosis AI Trade'/,
        'comment: limitedComment'
      );

      if (newContent !== content) {
        fs.writeFileSync(filePath, newContent);
        console.log(`✅ Fixed ${filePath}`);
        fixed = true;
      }
    }
  }

  return fixed;
}

// Main function
function main() {
  console.log('🔧 Fixing MT5 comment length issue...');
  let fixedCount = 0;

  for (const file of filesToFix) {
    if (fixFile(file)) {
      fixedCount++;
    }
  }

  if (fixedCount > 0) {
    console.log(`\n✅ Fixed ${fixedCount} files`);
    console.log('🔄 Please restart the MT5 bridge and development server to apply the changes');
  } else {
    console.log('\n✅ All files are already fixed or not found');
  }
}

main();
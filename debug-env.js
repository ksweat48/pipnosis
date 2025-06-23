// Debug script to check environment variable loading (no external dependencies)
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🔍 Environment Variable Debugging');
console.log('='.repeat(50));

// 1. Check current working directory
console.log('1. Current working directory:', process.cwd());

// 2. Check __dirname
console.log('2. Script directory (__dirname):', __dirname);

// 3. Check if .env file exists in various locations
const possibleEnvPaths = [
  '.env',
  '../.env',
  '../../.env',
  join(__dirname, '.env'),
  join(__dirname, '../.env'),
  join(__dirname, '../../.env'),
  join(process.cwd(), '.env'),
];

console.log('\n3. Checking .env file locations:');
let foundEnvFile = null;

possibleEnvPaths.forEach(path => {
  const exists = existsSync(path);
  console.log(`   ${exists ? '✅' : '❌'} ${path} ${exists ? '(EXISTS)' : '(NOT FOUND)'}`);
  
  if (exists && !foundEnvFile) {
    foundEnvFile = path;
    try {
      const content = readFileSync(path, 'utf8');
      const lines = content.split('\n').filter(line => line.trim() && !line.startsWith('#'));
      console.log(`      📄 Contains ${lines.length} environment variables`);
      
      // Show first few characters of each variable (for security)
      lines.forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) {
          const maskedValue = value.length > 10 ? `${value.substring(0, 10)}...` : value;
          console.log(`      🔑 ${key}=${maskedValue}`);
        }
      });
    } catch (error) {
      console.log(`      ❌ Error reading file: ${error.message}`);
    }
  }
});

// 4. Manual environment variable parsing (without dotenv)
console.log('\n4. Manual .env parsing test:');

if (foundEnvFile) {
  console.log(`   Using .env file: ${foundEnvFile}`);
  
  try {
    const content = readFileSync(foundEnvFile, 'utf8');
    const lines = content.split('\n');
    
    console.log('   Parsing variables:');
    lines.forEach((line, index) => {
      line = line.trim();
      if (line && !line.startsWith('#')) {
        const equalIndex = line.indexOf('=');
        if (equalIndex > 0) {
          const key = line.substring(0, equalIndex);
          const value = line.substring(equalIndex + 1);
          
          // Remove quotes if present
          const cleanValue = value.replace(/^["']|["']$/g, '');
          
          console.log(`   Line ${index + 1}: ${key}=${cleanValue.length > 10 ? cleanValue.substring(0, 10) + '...' : cleanValue}`);
          
          // Set in process.env for testing
          process.env[key] = cleanValue;
        }
      }
    });
    
    console.log('\n   After manual parsing:');
    console.log(`   OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'LOADED ✅' : 'NOT LOADED ❌'}`);
    console.log(`   SUPABASE_URL: ${process.env.SUPABASE_URL ? 'LOADED ✅' : 'NOT LOADED ❌'}`);
    console.log(`   SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'LOADED ✅' : 'NOT LOADED ❌'}`);
    console.log(`   PORT: ${process.env.PORT || 'NOT SET (will use default 3001)'}`);
    
  } catch (error) {
    console.log(`   ❌ Error parsing .env file: ${error.message}`);
  }
} else {
  console.log('   ❌ No .env file found to parse');
}

// 5. Check Node.js version and module type
console.log('\n5. System information:');
console.log(`   Node.js version: ${process.version}`);
console.log(`   Platform: ${process.platform}`);
console.log(`   Architecture: ${process.arch}`);

// 6. Check package.json type
try {
  const packageJsonPath = join(__dirname, 'package.json');
  if (existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    console.log(`   Package type: ${packageJson.type || 'commonjs'}`);
  }
  
  // Also check server package.json
  const serverPackageJsonPath = join(__dirname, 'server', 'package.json');
  if (existsSync(serverPackageJsonPath)) {
    const serverPackageJson = JSON.parse(readFileSync(serverPackageJsonPath, 'utf8'));
    console.log(`   Server package type: ${serverPackageJson.type || 'commonjs'}`);
  }
} catch (error) {
  console.log(`   Package.json check failed: ${error.message}`);
}

// 7. Directory structure check
console.log('\n6. Directory structure:');
try {
  const items = readFileSync('.', { withFileTypes: true });
  console.log('   Root directory contents:');
  items.forEach(item => {
    console.log(`   ${item.isDirectory() ? '📁' : '📄'} ${item.name}`);
  });
} catch (error) {
  console.log(`   ❌ Could not read directory: ${error.message}`);
}

console.log('\n' + '='.repeat(50));
console.log('🔍 Debug complete. Check the output above for issues.');

// 8. Recommendations
console.log('\n💡 Recommendations:');
if (!foundEnvFile) {
  console.log('   ❌ Create a .env file in the project root directory');
  console.log('   📝 Copy .env.example to .env and fill in your API keys');
} else {
  console.log('   ✅ .env file found');
  if (!process.env.OPENAI_API_KEY) {
    console.log('   ❌ Add OPENAI_API_KEY to your .env file');
  }
  if (!process.env.SUPABASE_URL) {
    console.log('   ❌ Add SUPABASE_URL to your .env file');
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('   ❌ Add SUPABASE_SERVICE_ROLE_KEY to your .env file');
  }
}
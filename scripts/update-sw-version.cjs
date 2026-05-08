const fs = require('fs');
const path = require('path');

const versionFile = path.join(__dirname, '..', 'public', 'version.json');
const swFile = path.join(__dirname, '..', 'public', 'sw.js');

const newVersion = Date.now().toString();
const version = { version: newVersion, buildTime: new Date().toISOString() };

fs.writeFileSync(versionFile, JSON.stringify(version, null, 2));
console.log('[update-sw-version] Updated version.json:', newVersion);

const swSource = fs.readFileSync(swFile, 'utf8');
const updatedSw = swSource.replace(
  /const\s+CACHE_VERSION\s*=\s*'[^']*';/,
  `const CACHE_VERSION = '${newVersion}';`
);

if (updatedSw === swSource) {
  throw new Error('[update-sw-version] Failed to update CACHE_VERSION in sw.js — pattern not found');
}

fs.writeFileSync(swFile, updatedSw);
console.log('[update-sw-version] Updated sw.js CACHE_VERSION:', newVersion);

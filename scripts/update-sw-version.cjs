const fs = require('fs');
const path = require('path');

const versionFile = path.join(__dirname, '..', 'public', 'version.json');
const version = { version: Date.now().toString(), buildTime: new Date().toISOString() };

fs.writeFileSync(versionFile, JSON.stringify(version, null, 2));
console.log('[update-sw-version] Updated version.json:', version.version);

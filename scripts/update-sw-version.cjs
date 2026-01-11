#!/usr/bin/env node

/**
 * Service Worker Version Updater
 *
 * SSOT for build-time version synchronization
 * Automatically updates the BUILD_VERSION in sw.js before each build
 * to ensure cache invalidation on every deployment.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SW_PATH = path.join(__dirname, '..', 'public', 'sw.js');
const PACKAGE_PATH = path.join(__dirname, '..', 'package.json');

function getVersionString() {
  try {
    // Try to get git commit hash (first 8 chars)
    const gitHash = execSync('git rev-parse --short=8 HEAD', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();

    // Get package version
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
    const pkgVersion = pkg.version || '1.0.0';

    // Combine for unique version: "1.0.0-a1b2c3d4"
    return `${pkgVersion}-${gitHash}`;
  } catch (error) {
    // Fallback to timestamp if git not available
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
    const pkgVersion = pkg.version || '1.0.0';
    const timestamp = Date.now().toString(36); // Base36 timestamp
    return `${pkgVersion}-${timestamp}`;
  }
}

function updateServiceWorkerVersion() {
  const version = getVersionString();

  console.log(`[SW Version] Updating service worker to version: ${version}`);

  try {
    let swContent = fs.readFileSync(SW_PATH, 'utf8');

    // Replace BUILD_VERSION line
    const updatedContent = swContent.replace(
      /const BUILD_VERSION = ['"`].*?['"`];/,
      `const BUILD_VERSION = '${version}';`
    );

    if (swContent === updatedContent) {
      console.warn('[SW Version] WARNING: BUILD_VERSION not found in sw.js!');
      return false;
    }

    fs.writeFileSync(SW_PATH, updatedContent, 'utf8');
    console.log('[SW Version] ✅ Service worker version updated successfully');

    // Also write version to a file for runtime access
    const versionFile = path.join(__dirname, '..', 'public', 'version.json');
    fs.writeFileSync(versionFile, JSON.stringify({
      version,
      buildTime: new Date().toISOString()
    }, null, 2));
    console.log('[SW Version] ✅ Version manifest created');

    return true;
  } catch (error) {
    console.error('[SW Version] ❌ Error updating service worker:', error.message);
    process.exit(1);
  }
}

// Run the update
updateServiceWorkerVersion();

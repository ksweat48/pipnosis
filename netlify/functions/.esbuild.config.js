// esbuild configuration for Netlify Functions
// This ensures MetaAPI SDK is bundled correctly for Node.js environment

module.exports = {
  // External packages that should not be bundled
  external: [],

  // Node.js platform for proper module resolution
  platform: 'node',

  // Target Node.js 18 (Netlify's current version)
  target: 'node18',

  // CommonJS format for compatibility
  format: 'cjs',

  // Main fields priority - prefer Node.js versions
  mainFields: ['main', 'module'],

  // Conditions for export resolution - prefer Node.js exports
  conditions: ['node', 'require', 'default'],

  // Bundle everything for predictable behavior
  bundle: true,

  // Minify for smaller function size
  minify: false, // Keep false for debugging

  // Source maps for debugging
  sourcemap: true,
};

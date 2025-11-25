/**
 * Environment Detection Utility
 * Detects whether the app is running in production, development, or WebContainer (Bolt)
 */

import { logger, LogCategory } from './logger';

export type Environment = 'production' | 'development' | 'webcontainer';

/**
 * Detect the current environment
 */
export function detectEnvironment(): Environment {
  if (typeof window === 'undefined') {
    return 'production';
  }

  const hostname = window.location.hostname;
  const userAgent = navigator.userAgent;

  if (hostname === 'pipnosis.com' || hostname.endsWith('.netlify.app')) {
    return 'production';
  }

  if (hostname.includes('webcontainer') || userAgent.includes('WebContainer')) {
    return 'webcontainer';
  }

  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.')) {
    return 'development';
  }

  return 'development';
}

/**
 * Check if running in production
 */
export function isProduction(): boolean {
  return detectEnvironment() === 'production';
}

/**
 * Check if running in development
 */
export function isDevelopment(): boolean {
  const env = detectEnvironment();
  return env === 'development' || env === 'webcontainer';
}

/**
 * Check if running in WebContainer (Bolt)
 */
export function isWebContainer(): boolean {
  return detectEnvironment() === 'webcontainer';
}

/**
 * Check if Netlify Functions are available
 */
export function areFunctionsAvailable(): boolean {
  return isProduction();
}

/**
 * Get the base URL for API calls
 */
export function getApiBaseUrl(): string {
  if (isProduction()) {
    return '';
  }
  return '';
}

/**
 * Log environment information
 */
export function logEnvironmentInfo(): void {
  const env = detectEnvironment();
  logger.debug(LogCategory.SYSTEM, '🌍 Environment Detection:');
  logger.debug(LogCategory.SYSTEM, `  - Environment: ${env}`);
  logger.debug(LogCategory.SYSTEM, `  - Hostname: ${window.location.hostname}`);
  logger.debug(LogCategory.SYSTEM, `  - Functions Available: ${areFunctionsAvailable()}`);
  logger.debug(LogCategory.SYSTEM, `  - User Agent: ${navigator.userAgent.substring(0, 100)}...`);
}

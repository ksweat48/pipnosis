/* eslint-disable */
/**
 * MetaAPI REST Client
 * Direct REST API implementation to replace the MetaAPI SDK
 * Uses working mt-client-api-v1 endpoints that don't have DNS issues
 */

const https = require('https');
const http = require('http');

const DEFAULT_TIMEOUT = 10000;
const MAX_RETRIES = 2;
const RETRY_DELAY = 1000;

class MetaApiRestClient {
  constructor(token, options = {}) {
    this.token = token;
    this.region = options.region || 'london';
    this.timeout = options.timeout || DEFAULT_TIMEOUT;
    this.baseUrl = `https://mt-client-api-v1.${this.region}.agiliumtrade.ai`;
  }

  async makeRequest(method, path, body = null, retryCount = 0) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);

      const options = {
        method: method,
        headers: {
          'auth-token': this.token,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: this.timeout
      };

      const protocol = url.protocol === 'https:' ? https : http;

      const req = protocol.request(url, options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const parsed = data ? JSON.parse(data) : {};
              resolve(parsed);
            } else if (res.statusCode >= 500 && retryCount < MAX_RETRIES) {
              setTimeout(() => {
                this.makeRequest(method, path, body, retryCount + 1)
                  .then(resolve)
                  .catch(reject);
              }, RETRY_DELAY * (retryCount + 1));
            } else {
              const error = new Error(`HTTP ${res.statusCode}: ${data}`);
              error.statusCode = res.statusCode;
              error.response = data;
              reject(error);
            }
          } catch (err) {
            reject(new Error(`Failed to parse response: ${err.message}`));
          }
        });
      });

      req.on('error', (err) => {
        if (retryCount < MAX_RETRIES && (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT')) {
          setTimeout(() => {
            this.makeRequest(method, path, body, retryCount + 1)
              .then(resolve)
              .catch(reject);
          }, RETRY_DELAY * (retryCount + 1));
        } else {
          reject(err);
        }
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (body) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }

  async getAccountInformation(accountId) {
    const path = `/users/current/accounts/${accountId}`;
    return await this.makeRequest('GET', path);
  }

  async getAccountState(accountId) {
    const path = `/users/current/accounts/${accountId}/state`;
    return await this.makeRequest('GET', path);
  }

  async getSymbolPrice(accountId, symbol) {
    const path = `/users/current/accounts/${accountId}/symbols/${symbol}/current-price`;
    return await this.makeRequest('GET', path);
  }

  async getSymbolPrices(accountId, symbols) {
    const path = `/users/current/accounts/${accountId}/symbols/prices`;
    const body = { symbols };
    return await this.makeRequest('POST', path, body);
  }

  async waitForConnection(accountId, maxWaitSeconds = 30) {
    const startTime = Date.now();
    const maxWaitMs = maxWaitSeconds * 1000;

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const state = await this.getAccountState(accountId);

        if (state.connected && state.synchronized) {
          return state;
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (err) {
        if (Date.now() - startTime >= maxWaitMs) {
          throw new Error(`Connection timeout after ${maxWaitSeconds}s: ${err.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    throw new Error(`Account did not connect within ${maxWaitSeconds}s`);
  }

  async healthCheck() {
    try {
      const response = await this.makeRequest('GET', '/health');
      return {
        healthy: true,
        region: this.region,
        baseUrl: this.baseUrl,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      return {
        healthy: false,
        region: this.region,
        baseUrl: this.baseUrl,
        error: err.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

function createRestClient(token, options = {}) {
  if (!token) {
    throw new Error('MetaAPI token is required');
  }
  return new MetaApiRestClient(token, options);
}

module.exports = {
  MetaApiRestClient,
  createRestClient
};

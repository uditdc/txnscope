/**
 * API Key Authentication Module
 *
 * Handles validation of API keys for WebSocket connections.
 * Keys can be provided via:
 * - Authorization header: "Bearer <key>"
 * - Query parameter: "?api_key=<key>"
 */

export interface AuthResult {
  authenticated: boolean;
  key?: string;
  error?: string;
}

export interface AuthConfig {
  /** Comma-separated list of valid API keys from environment */
  envKeys: string[];
  /** Optional Redis client for dynamic key lookup */
  redisClient?: unknown;
}

/**
 * Parse API keys from environment variable
 * @param envValue - Comma-separated API keys string
 * @returns Array of trimmed, non-empty API keys
 */
export function parseApiKeys(envValue: string | undefined): string[] {
  if (!envValue) {
    return [];
  }
  return envValue
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
}

/**
 * Extract API key from Authorization header
 * @param authHeader - The Authorization header value
 * @returns The API key if valid Bearer token, undefined otherwise
 */
export function extractFromHeader(authHeader: string | undefined): string | undefined {
  if (!authHeader) {
    return undefined;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return undefined;
  }

  const key = parts[1].trim();
  return key.length > 0 ? key : undefined;
}

/**
 * Extract API key from query string
 * @param queryParams - Object containing query parameters
 * @returns The API key if present, undefined otherwise
 */
export function extractFromQuery(queryParams: Record<string, string | undefined>): string | undefined {
  const key = queryParams.api_key;
  if (!key || typeof key !== 'string') {
    return undefined;
  }
  return key.trim().length > 0 ? key.trim() : undefined;
}

/**
 * Validate an API key against the allowed keys
 * @param key - The API key to validate
 * @param allowedKeys - Array of allowed API keys
 * @returns true if the key is valid
 */
export function validateKey(key: string | undefined, allowedKeys: string[]): boolean {
  if (!key || key.length === 0) {
    return false;
  }
  // Case-sensitive matching
  return allowedKeys.includes(key);
}

/**
 * Authenticate a request using API key
 * @param authHeader - Authorization header value
 * @param queryParams - Query parameters object
 * @param allowedKeys - Array of allowed API keys
 * @returns AuthResult with authentication status
 */
export function authenticate(
  authHeader: string | undefined,
  queryParams: Record<string, string | undefined>,
  allowedKeys: string[]
): AuthResult {
  // Try header first, then query param
  const key = extractFromHeader(authHeader) ?? extractFromQuery(queryParams);

  if (!key) {
    return {
      authenticated: false,
      error: 'Missing API key',
    };
  }

  if (key.length === 0) {
    return {
      authenticated: false,
      error: 'Empty API key',
    };
  }

  if (!validateKey(key, allowedKeys)) {
    return {
      authenticated: false,
      error: 'Invalid API key',
    };
  }

  return {
    authenticated: true,
    key,
  };
}

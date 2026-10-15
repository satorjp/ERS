const REQUIRED = ['DATABASE_URL', 'JWT_SECRET'] as const;

/** Fails fast at startup when required environment variables are missing. */
export function validateEnv(config: Record<string, unknown>) {
  const missing = REQUIRED.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
  return config;
}

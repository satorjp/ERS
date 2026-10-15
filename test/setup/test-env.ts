import { config } from 'dotenv';
import { resolve } from 'path';

/**
 * e2e tests run against a separate database so they never touch dev data.
 * Uses TEST_DATABASE_URL, or DATABASE_URL with the db name suffixed "_test".
 */
export function resolveTestDatabaseUrl(): string {
  config({ path: resolve(__dirname, '../../.env') });
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `${url.pathname}_test`;
  return url.toString();
}

process.env.DATABASE_URL = resolveTestDatabaseUrl();

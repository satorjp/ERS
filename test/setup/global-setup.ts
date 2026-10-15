import { execSync } from 'child_process';
import { resolve } from 'path';
import { resolveTestDatabaseUrl } from './test-env';

/** Migrates (creating the db if needed) and seeds the test database. */
export default function globalSetup() {
  const env = { ...process.env, DATABASE_URL: resolveTestDatabaseUrl() };
  const cwd = resolve(__dirname, '../..');
  execSync('npx prisma migrate deploy', { cwd, env, stdio: 'ignore' });
  execSync('npx ts-node prisma/seed.ts', { cwd, env, stdio: 'ignore' });
}

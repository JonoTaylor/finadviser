import { neon } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { env } from '@/lib/env';
import * as schema from './schema';

let _db: NeonHttpDatabase<typeof schema> | null = null;

export function getDb(): NeonHttpDatabase<typeof schema> {
  if (!_db) {
    const sql = neon(env().DATABASE_URL);
    _db = drizzle(sql, { schema });
  }
  return _db;
}

export { schema };

import { eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

const { appSettings } = schema;

/**
 * Generic key/value access for runtime-tunable app settings (AI model,
 * future preferences). For typed access prefer the specific helpers in
 * lib/ai/model.ts etc.; this repo is the raw layer.
 */
export const appSettingsRepo = {
  async get(key: string): Promise<string | null> {
    const db = getDb();
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, key))
      .limit(1);
    return row?.value ?? null;
  },

  async set(key: string, value: string): Promise<void> {
    const db = getDb();
    await db.execute(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${key}, ${value}, now())
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
    `);
  },

  async clear(key: string): Promise<void> {
    const db = getDb();
    await db.delete(appSettings).where(eq(appSettings.key, key));
  },
};

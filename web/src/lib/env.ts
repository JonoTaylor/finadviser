import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  CLAUDE_MODEL: z.string().default('claude-sonnet-4-20250514'),
  API_AUTH_TOKEN: z.string().min(16).optional(),
  ADMIN_TOKEN: z.string().min(16).optional(),
  ALLOW_SEED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Personal-app auth: bcrypt hash of the single user's password and the
  // secret used to sign the session JWT.
  APP_PASSWORD_HASH: z.string().min(1).optional(),
  AUTH_SECRET: z.string().min(32).optional(),
  // Session lifetime in seconds. Default: 30 days.
  SESSION_TTL_SECONDS: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => parseInt(v, 10))
    .optional(),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function env(): Env {
  if (_env) return _env;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  _env = parsed.data;
  return _env;
}

import { z } from 'zod';

/**
 * Environment configuration, validated once at startup.
 *
 * Every variable has a safe demo default so the stack boots with ZERO real
 * secrets (CLAUDE.md golden rule). Invalid config fails loudly with a clear
 * message instead of crashing silently later (anti-bug rule).
 *
 * Production-only secrets are declared but optional in demo. See ASSETS.md §3
 * for which key powers which feature.
 */
const EnvSchema = z.object({
  // --- app mode: the demo <-> production seam ---
  APP_MODE: z.enum(['demo', 'production']).default('demo'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // --- backend API ---
  BACKEND_HOST: z.string().min(1).default('0.0.0.0'),
  BACKEND_PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  // --- dependencies ---
  AI_SERVICE_URL: z.string().min(1).default('http://localhost:8000'),

  // --- admin API guard (I1 data layer) ---
  // Token required by every /admin/api request. Demo default lets the stack
  // boot with no secrets; the full permissioned Control Panel arrives in I8.
  ADMIN_API_TOKEN: z.string().min(1).default('demo-admin-token'),

  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://gameskeep:gameskeep_demo@localhost:5432/gameskeep'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  // --- production-only secrets (blank in demo) ---
  IGDB_CLIENT_ID: z.string().default(''),
  IGDB_CLIENT_SECRET: z.string().default(''),
  RAWG_API_KEY: z.string().default(''),
  STEAM_API_KEY: z.string().default(''),
  YOUTUBE_API_KEY: z.string().default(''),
  EMAIL_PROVIDER_API_KEY: z.string().default(''),
  OAUTH_GOOGLE_CLIENT_ID: z.string().default(''),
  OAUTH_GOOGLE_CLIENT_SECRET: z.string().default(''),
  OAUTH_DISCORD_CLIENT_ID: z.string().default(''),
  OAUTH_DISCORD_CLIENT_SECRET: z.string().default(''),
  OAUTH_STEAM_API_KEY: z.string().default(''),
  SESSION_SECRET: z.string().default('demo-insecure-session-secret-change-me'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/** Parse and validate process.env. Throws a readable error if invalid. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const env = loadEnv();

export const isDemo = (): boolean => env.APP_MODE === 'demo';
export const isProduction = (): boolean => env.APP_MODE === 'production';

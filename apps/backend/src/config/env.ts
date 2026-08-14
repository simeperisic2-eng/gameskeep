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

  // --- public site URL (I6 Slice 2 — email link bases) ---
  // The origin the browser reaches (the frontend / BFF). Verification and
  // password-reset emails build their links from this. Demo default is the
  // local frontend; production sets the real https origin.
  PUBLIC_SITE_URL: z.string().min(1).default('http://localhost:3000'),

  // --- dependencies ---
  AI_SERVICE_URL: z.string().min(1).default('http://localhost:8000'),

  // --- admin API guard (I1 data layer) ---
  // Token required by every /admin/api request. Demo default lets the stack
  // boot with no secrets; the full permissioned Control Panel arrives in I8.
  ADMIN_API_TOKEN: z.string().min(1).default('demo-admin-token'),

  // --- reverse-proxy trust (I6 hardening — the spoofable-IP HIGH) ---
  // Controls Fastify's trustProxy. Default 'false' = req.ip is the UNSPOOFABLE
  // socket peer (X-Forwarded-For ignored), so per-IP throttles can't be defeated
  // by a forged header. Production behind Cloudflare/Nginx sets a hop count
  // ('1') or CIDR list — never blanket 'true' unless every hop is trusted.
  TRUST_PROXY: z.string().default('false'),

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

/** Demo-default secrets that MUST be replaced before production (fail closed). */
const DEMO_SECRET_DEFAULTS: Record<string, string> = {
  SESSION_SECRET: 'demo-insecure-session-secret-change-me',
  ADMIN_API_TOKEN: 'demo-admin-token',
};

/**
 * I6 hardening (LOW — fail closed): a production boot with demo-default
 * secrets is a misconfiguration, not a working deployment. Refuse to start
 * rather than run with guessable credentials. Exported for hermetic tests.
 */
export function assertProductionSecrets(parsed: Env): void {
  if (parsed.APP_MODE !== 'production') return;
  const stale = Object.entries(DEMO_SECRET_DEFAULTS)
    .filter(([key, demoValue]) => (parsed as unknown as Record<string, string>)[key] === demoValue)
    .map(([key]) => key);
  if (stale.length > 0) {
    throw new Error(
      `Refusing to start in production with demo-default secrets: ${stale.join(', ')}. ` +
        'Set real values (see ASSETS.md §3) — failing closed.',
    );
  }
}

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
  assertProductionSecrets(parsed.data);
  cached = parsed.data;
  return cached;
}

export const env = loadEnv();

export const isDemo = (): boolean => env.APP_MODE === 'demo';
export const isProduction = (): boolean => env.APP_MODE === 'production';

/**
 * Fastify `trustProxy` value from TRUST_PROXY: 'false'→false (unspoofable
 * socket peer, the default), 'true'→true, an integer→hop count, anything
 * else→address/CIDR list string.
 */
export function trustProxyValue(raw: string = env.TRUST_PROXY): boolean | number | string {
  const v = raw.trim();
  if (v === '' || v.toLowerCase() === 'false') return false;
  if (v.toLowerCase() === 'true') return true;
  const n = Number(v);
  if (Number.isInteger(n) && n > 0) return n;
  return v;
}

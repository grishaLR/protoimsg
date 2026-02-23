import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('localhost'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url(),
  JETSTREAM_URL: z
    .string()
    .default(
      [
        'wss://jetstream1.us-east.bsky.network/subscribe',
        'wss://jetstream2.us-east.bsky.network/subscribe',
        'wss://jetstream1.us-west.bsky.network/subscribe',
        'wss://jetstream2.us-west.bsky.network/subscribe',
      ].join(','),
    )
    .transform((v) =>
      v
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean),
    ),
  PUBLIC_API_URL: z.string().url().default('https://public.api.bsky.app'),
  OAUTH_CLIENT_ID: z.string().optional(),
  OAUTH_REDIRECT_URI: z.string().url().optional(),
  SENTRY_DSN: z.string().url().optional(),
  REDIS_URL: z.string().startsWith('redis://').optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional(),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  DB_POOL_MAX: z.coerce.number().int().min(1).default(20),
  DB_IDLE_TIMEOUT: z.coerce.number().int().min(0).default(20),
  DB_CONNECT_TIMEOUT: z.coerce.number().int().min(1).default(10),
  SESSION_TTL_MS: z.coerce
    .number()
    .default(8 * 60 * 60 * 1000)
    .refine((v) => v > 0, 'SESSION_TTL_MS must be greater than 0'), // 8 hours
  LIBRETRANSLATE_URL: z.string().url().optional(),
  NLLB_URL: z.string().url().optional(),
  NLLB_API_KEY: z.string().optional(),
  TRANSLATE_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  TRANSLATE_RATE_LIMIT: z.coerce.number().int().min(1).default(100),
  GIPHY_API_KEY: z.string().optional(),
  KLIPY_API_KEY: z.string().optional(),
  REQUIRE_ALLOWLIST: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  COTURN_SHARED_SECRET: z.string().optional(),
  STUN_URL: z.string().optional(),
  TURN_URL: z.string().optional(),
  ICE_CREDENTIAL_TTL_SECS: z.coerce.number().int().min(60).default(14400),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().default('proto instant messenger <noreply@protoimsg.app>'),
  ADMIN_API_KEY: z.string().optional(),
  /** Minutes of commit silence before Sentry warning. 0 disables the check. */
  COMMIT_SILENCE_MINUTES: z.coerce.number().min(0).default(30),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(): Config {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment configuration:');
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

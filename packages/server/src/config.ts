import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('localhost'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url(),
  JETSTREAM_URL: z.string().url().default('wss://jetstream2.us-east.bsky.network/subscribe'),
  PUBLIC_API_URL: z.string().url().default('https://public.api.bsky.app'),
  OAUTH_CLIENT_ID: z.string().optional(),
  OAUTH_REDIRECT_URI: z.string().url().optional(),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
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

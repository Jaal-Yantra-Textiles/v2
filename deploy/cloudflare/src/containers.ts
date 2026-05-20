import { Container } from "@cloudflare/containers";
import { env } from "cloudflare:workers";

import type { Env } from "./worker";

/**
 * MedusaServer — the Express API container.
 *
 *   - Runs the same image as the Railway deployment.
 *   - MEDUSA_WORKER_MODE=server selects the API role in the Dockerfile CMD,
 *     which also runs `predeploy:force` (migrations) on boot. MikroORM uses
 *     PG advisory locks, so it's race-safe when both HA instances boot.
 *   - Listens on :9000 (Medusa default).
 *   - Long `sleepAfter` keeps the container warm to avoid cold-starts.
 */
export class MedusaServer extends Container<Env> {
  defaultPort = 9000;
  sleepAfter = "30m";

  envVars = {
    NODE_ENV: "production",
    MEDUSA_WORKER_MODE: "server",
    // Connection strings + secrets — forwarded from Worker secrets.
    // `env.X` here resolves at container-start time, not module-load time.
    DATABASE_URL: env.DATABASE_URL,
    REDIS_URL: env.REDIS_URL,
    // Auth / session secrets
    JWT_SECRET: env.JWT_SECRET,
    COOKIE_SECRET: env.COOKIE_SECRET,
    // R2 (S3-compatible) for file uploads
    S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY,
    S3_BUCKET: env.S3_BUCKET,
    S3_ENDPOINT: env.S3_ENDPOINT,
    S3_FILE_URL: env.S3_FILE_URL,
    S3_REGION: "auto",
    // Public URLs (admin bundle is built with these at image-build time,
    // but several runtime code paths also read MEDUSA_BACKEND_URL)
    MEDUSA_BACKEND_URL: env.MEDUSA_BACKEND_URL,
    STORE_CORS: env.STORE_CORS,
    ADMIN_CORS: env.ADMIN_CORS,
    AUTH_CORS: env.AUTH_CORS,
    // Observability
    SENTRY_DSN: env.SENTRY_DSN,
    // Anything else from .env.railway.server lands here — see
    // deploy/cloudflare/secrets.example.sh for the canonical list.
  };

  override onError(error: unknown): void {
    console.error("[MedusaServer] container error", error);
  }
}

/**
 * MedusaWorker — the background process container.
 *
 *   - Same image as MedusaServer, MEDUSA_WORKER_MODE=worker.
 *   - No `defaultPort` — does not serve HTTP. Receives no inbound traffic.
 *   - Kept alive by the cron in worker.ts (`* * * * *`) which calls
 *     getContainer(env.MEDUSA_WORKER, "singleton").start(). sleepAfter is
 *     1h as a safety net if the cron ever misses.
 *   - Singleton (max_instances=1 in wrangler.toml) — running 2 would
 *     double-execute scheduled jobs and subscribers.
 */
export class MedusaWorker extends Container<Env> {
  // No defaultPort — background process.
  sleepAfter = "1h";

  envVars = {
    NODE_ENV: "production",
    MEDUSA_WORKER_MODE: "worker",
    DATABASE_URL: env.DATABASE_URL,
    REDIS_URL: env.REDIS_URL,
    // The worker process also writes to R2 (e.g. report generation, exports)
    S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY,
    S3_BUCKET: env.S3_BUCKET,
    S3_ENDPOINT: env.S3_ENDPOINT,
    S3_FILE_URL: env.S3_FILE_URL,
    S3_REGION: "auto",
    SENTRY_DSN: env.SENTRY_DSN,
  };

  override onError(error: unknown): void {
    console.error("[MedusaWorker] container error", error);
  }
}

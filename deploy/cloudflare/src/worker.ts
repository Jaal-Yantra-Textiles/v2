import { getContainer, getRandom } from "@cloudflare/containers";

import { MedusaServer, MedusaWorker } from "./containers";

export { MedusaServer, MedusaWorker };

export interface Env {
  // Container bindings (Durable Object namespaces)
  MEDUSA_SERVER: DurableObjectNamespace<MedusaServer>;
  MEDUSA_WORKER: DurableObjectNamespace<MedusaWorker>;

  // Worker secrets — typed here so `env.X` is checked.
  // Set via `wrangler secret put X`. See secrets.example.sh.
  DATABASE_URL: string;
  REDIS_URL: string;
  JWT_SECRET: string;
  COOKIE_SECRET: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  S3_BUCKET: string;
  S3_ENDPOINT: string;
  S3_FILE_URL: string;
  MEDUSA_BACKEND_URL: string;
  STORE_CORS: string;
  ADMIN_CORS: string;
  AUTH_CORS: string;
  SENTRY_DSN: string;
}

const SERVER_INSTANCES = 2;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const server = await getRandom(env.MEDUSA_SERVER, SERVER_INSTANCES);
    return server.fetch(request);
  },

  /**
   * Runs every minute (see [triggers] in wrangler.toml). The only job here
   * is to ensure the singleton worker container is running. The cron is the
   * lifeline that keeps a no-HTTP container alive across CF's lifecycle.
   */
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const worker = getContainer(env.MEDUSA_WORKER, "singleton");
    try {
      await worker.start();
    } catch (err) {
      // Already-running is the happy path on most ticks; log anything else.
      const msg = err instanceof Error ? err.message : String(err);
      if (!/already/i.test(msg)) {
        console.error("[scheduled] worker start failed", err);
      }
    }
  },
};

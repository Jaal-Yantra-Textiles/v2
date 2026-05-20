# JYT backend on Cloudflare Containers — runbook

Operational guide for deploying the Medusa backend (`apps/backend`) to
Cloudflare Containers. Architecture and decisions live in [PLAN.md](./PLAN.md);
this file is the "do the thing" reference.

> ⚠️  **DEFERRED as of 2026-05-17.** Active deploy is on AWS Lightsail — see
> `deploy/aws/README.md`. This config is preserved as a future option.
> The runbook below is accurate if/when we revive the CF path.

---

## Layout

```
/                                  ← repo root
├── wrangler.toml                  ← Worker + Containers config (root for build context)
├── apps/backend/Dockerfile        ← reused as-is from Railway
├── pnpm-workspace.yaml            ← deploy/cloudflare added as a workspace
└── deploy/cloudflare/
    ├── PLAN.md                    ← architecture & decisions
    ├── README.md                  ← this file
    ├── package.json               ← wrangler + types
    ├── tsconfig.json
    ├── secrets.example.sh         ← `wrangler secret put` for every secret
    └── src/
        ├── worker.ts              ← routing Worker + cron-driven keep-alive
        └── containers.ts          ← MedusaServer + MedusaWorker classes
```

---

## Prerequisites — provision external services first

These are user-owned steps. Do them before any `wrangler deploy`.

### 1. Install wrangler

```bash
npm i -g wrangler        # OR use pnpm workspace's local binary via:
pnpm --filter @jyt/cloudflare-deploy exec wrangler --version
wrangler login
```

### 2. Provision Cloudflare R2 (file storage)

1. CF Dashboard → R2 → **Create bucket**
   - Name: `jyt-uploads-staging` (and later `jyt-uploads-prod`)
   - Location hint: pick the region closest to your users (e.g. `eeur` for EU, `wnam` for US-West)
2. R2 → **Manage R2 API tokens** → **Create API token**
   - Permission: `Object Read & Write`
   - Scope: just the bucket(s) you created
   - Copy the **Access Key ID** + **Secret Access Key** (shown once)
3. Capture the **endpoint URL** from the bucket settings panel:
   `https://<account_id>.r2.cloudflarestorage.com`
4. Decide the public file URL:
   - For staging: use the R2 dev URL (`https://pub-<hash>.r2.dev`)
   - For prod: bind a custom domain (e.g. `files.jaalyantra.in`)

### 3. Provision Upstash Redis

1. https://console.upstash.com → **Create Database**
   - Type: Regional (cheaper) for staging; Global for prod
   - Region: nearest to your Railway PG region (latency between worker and Redis matters)
   - TLS: **on**
2. Copy the **`UPSTASH_REDIS_REST_URL`** style TCP URL — the one starting
   with `rediss://default:...@...upstash.io:6379`. **Not** the REST URL.

### 4. Confirm Railway PG accepts external TCP

Railway's PG is publicly reachable by default. The `DATABASE_URL` in
`apps/backend/.env.railway.server` is exactly what we want. No change needed.

---

## First deploy (staging)

Run from the **repo root**.

```bash
# 1. Install wrangler into the workspace
pnpm install

# 2. Forward all secrets — interactive prompts (see secrets.example.sh)
bash deploy/cloudflare/secrets.example.sh

# 3. Sanity check the config
wrangler deploy --dry-run

# 4. Deploy for real
wrangler deploy
```

On first deploy, wrangler will:

1. Detect Docker is running locally.
2. Build the image from `./apps/backend/Dockerfile` with the **repo root** as
   build context (because wrangler.toml lives at root).
3. Push the image to Cloudflare's container registry.
4. Roll out the new image to both `MedusaServer` and `MedusaWorker` classes.
5. Deploy the routing Worker.

Expected output ends with something like:

```
Published medusa-router
  https://medusa-router.<your-subdomain>.workers.dev
Containers:
  MedusaServer  (standard-2, max 2)  → ready
  MedusaWorker  (standard-1, max 1)  → ready
```

### Apple Silicon (M-series) — `linux/amd64` build

If `wrangler deploy` produces an image that fails to start on CF with an
exec-format error, force amd64:

```bash
DOCKER_DEFAULT_PLATFORM=linux/amd64 wrangler deploy
```

If this works, bake it into a deploy script (or `.envrc`) so it's not
forgotten.

---

## Verify the deploy

```bash
# Live logs (Worker + container stdout)
wrangler tail

# Curl the routing Worker (will warm a server container)
curl -i https://medusa-router.<subdomain>.workers.dev/health

# Hit a real Medusa endpoint
curl -i https://medusa-router.<subdomain>.workers.dev/store/regions
```

### Verifying the worker container is actually doing work

The worker has no inbound URL — the only signal it's running is that
scheduled jobs fire and subscribers process events. Quick checks:

1. **Place a test order** (via the storefront integration test suite or the
   admin UI). A subscriber should record an entry — confirm via the admin
   workflow runs page.
2. **Tail logs while a cron job is scheduled**: `wrangler tail --format pretty`
   and watch for `[MedusaWorker]` messages.
3. **Inspect Redis** (Upstash dashboard → CLI tab) — Medusa's workflow engine
   tracks active runs there.

---

## DNS cutover (when ready)

Phase 2 step. Uncomment the `[[routes]]` block in `wrangler.toml`, set the
hostname + zone, then `wrangler deploy`. Verify CF has issued a cert for the
hostname (usually instant). Swap your DNS record from Railway → CF. Keep
Railway warm for 7 days.

---

## Rollback

Phase 1 rollback is git-based:

```bash
git checkout <last_known_good_sha>
wrangler deploy
```

Rebuilds the prior image and redeploys. ~8–10 minutes total.

For instant rollbacks (Phase 3), we'll move to pre-built images tagged by SHA
in the CF registry, then `wrangler deploy --image medusa-api:<sha>`.

---

## Debugging

| Symptom | Where to look |
|---|---|
| Worker route returns 5xx immediately | `wrangler tail` — the Worker likely couldn't reach the container. Check that `MEDUSA_SERVER` binding exists. |
| Container starts but Medusa errors on boot | `wrangler tail` shows container stdout — usually a missing secret. `wrangler secret list` to verify. |
| Migrations failing | The first server instance owns `predeploy:force`. Tail logs and look for MikroORM output. Worst case: run `pnpm --filter @jyt/backend predeploy:force` from a dev machine against the same DATABASE_URL. |
| Worker container not running jobs | Confirm the cron fires: `wrangler tail` will show `[scheduled]` invocations every minute. If cron fires but jobs don't run, the worker likely failed to start — check container error logs. |
| Image build fails locally | `DOCKER_DEFAULT_PLATFORM=linux/amd64 wrangler deploy --log-level debug` for verbose Docker output. |
| `x-amz-checksum-crc32 NotImplemented` from R2 | AWS SDK v3 checksum incompatibility. Patch in `apps/backend/medusa-config.prod.ts` under the file-s3 provider: add `additional_client_config: { requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" }`. CF claims this is fixed at the R2 layer now; this is the escape hatch if not. |

---

## Open verification items (Phase 1)

Track these here until they're confirmed working. Each can flip into a real
TODO if the trial deploy uncovers a gap.

- [ ] `wrangler.toml` `image = "./apps/backend/Dockerfile"` with root build
      context actually works. (If wrangler treats Dockerfile dir as context,
      we'll need to move wrangler.toml or use a different syntax — fallback
      noted in PLAN §5.1.)
- [ ] `linux/amd64` build from Apple Silicon produces a runnable image.
- [ ] `MedusaWorker.envVars` referencing `env.X` resolves correctly at start
      (vs. needing `startAndWaitForPorts({ startOptions: { envVars } })`).
- [ ] Cron-driven keep-alive actually prevents the worker container from
      being reaped during long quiet periods.
- [ ] R2 + `@medusajs/file-s3` happy path (upload a product image, verify
      it served back via `S3_FILE_URL`).
- [ ] No SDK v3 checksum issue on R2 with current `aws-sdk-js-v3`.

Once all six are ticked, Phase 1 is complete and we can plan Phase 2 (DNS
cutover + decommission Railway compute).

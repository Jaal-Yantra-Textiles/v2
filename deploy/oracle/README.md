# Medusa on OCI Ampere A1

Moves the two ECS services (deploy/aws/copilot) to the Always Free A1 box:
`jyt-backend-mirror`, 2 OCPU / 12 GB / 48 GB disk, Frankfurt, `130.61.141.163`.

| AWS today | Here |
|---|---|
| ECS `medusa-server` (0.5 vCPU / 4 GB, 1-2 tasks) | `server` container, `mem_limit: 4g` |
| ECS `medusa-worker` (0.5 vCPU / 2 GB) | `worker` container, `mem_limit: 2g` (profile `worker`) |
| ElastiCache Valkey `cache.t4g.micro` | `valkey` container (AOF on) |
| ALB + ACM | `cloudflared` tunnel (profile `tunnel`), no inbound ports |
| ECR image (amd64) | GHCR `latest-arm64`, built by `.github/workflows/build-arm64.yml` |
| SSM / Secrets Manager at task start | `secrets.env`, rendered from SSM by `render-env.sh` |
| RDS `db.t4g.micro`, us-east-1, private | `postgres` container (pgvector image), on the box |

## Files
- `compose.yml`: the stack. The worker and tunnel are opt-in profiles, so a plain
  `up` can never start a second worker or take traffic by accident.
- `render-env.sh`: on a laptop with AWS credentials, reads every `/jyt/prod/*`
  parameter the ECS server manifest lists and copies them to `/opt/jyt/secrets.env`
  (mode 600) on the box. The box never holds AWS keys.
- `deploy.sh`: copies `compose.yml`, pulls the image, recreates, and waits for `/health`.
  On first run it also creates `/opt/jyt/.env` with a random Postgres password.
- `copy-prod-db.sh`: copies the prod RDS database into the box's Postgres (see below).
- `setup-backup-bucket.sh`, `install-backup.sh`, `verify-backup.sh`, `backup/`: nightly backups.
- `ops/`, `deploy-ops.sh`, `logs.sh`: logs, uptime checks and metrics.

## One-time box setup
```bash
ssh ubuntu@130.61.141.163 'sudo apt-get update && sudo apt-get install -y docker-compose-v2 && docker compose version'
```
Compose must be at least 2.30 (for `env_file: format: raw`).

## Database: Postgres on the box (decided 2026-11-23)
Prod RDS is in **us-east-1** and private. From Frankfurt every query would cross the
Atlantic (~90 ms), and Medusa makes dozens per request. A Frankfurt RDS would cost money.
So the database moves onto the box:
- **Image:** `pgvector/pgvector`, because Mastra keeps its memory and RAG vectors in
  the same database. `pg_trgm` and `unaccent` (used by Medusa) ship with it.
- **Size:** 561 MB restored. RDS reports more because it counts its own WAL and
  system files.

**Copying the data:** `copy-prod-db.sh`
1. A one-off Fargate task inside the VPC runs `pg_dump`. It is read-only and does
   not block prod writes.
2. The dump goes to the private, encrypted `task-jyt-dbsnap-…` bucket via
   pre-signed URLs, so neither the task nor the box holds AWS keys.
3. It is restored with `--clean`, and the dump is deleted from the bucket and the box.

The first run (2026-11-23) produced a 103 MB dump with 618 tables. It restored with no
errors, and its 154 non-draft orders and newest order (#158) matched the prod API.

## Backups (nightly, to S3)
RDS took snapshots for us; on the box that is our job.
- **Where:** `s3://jyt-oracle-pg-backups/pg/` in eu-central-1 (same region as the box),
  private, encrypted, versioned. Kept 35 days.
- **How:** `jyt-pg-backup.timer` runs `/opt/jyt/pg-backup.sh` daily at 21:00 UTC
  (02:30 IST). It streams `pg_dump -Fc` straight to S3; nothing is written to disk.
- **Box key:** the IAM user `jyt-oracle-backup` may only **PutObject** into that bucket.
  It cannot list, read or delete, and versioning keeps anything overwritten, so a
  compromised box cannot wipe the backups.
- **Alarm:** every run pushes its result to Gatus (`a1_pg-backup`). A failed run, or
  no run for 26 h, shows as a failure.

Setup, once, from a laptop with admin AWS credentials:
```bash
deploy/oracle/setup-backup-bucket.sh   # bucket + put-only user; key goes straight to /opt/jyt/backup.env
deploy/oracle/install-backup.sh        # timer + one backup now
deploy/oracle/verify-backup.sh         # restores the newest backup into a scratch DB, compares counts
```
Run `verify-backup.sh` monthly. A backup nobody has restored is not a backup.

Restore for real: download the dump (presigned URL from a laptop), then
`docker compose cp` it into the postgres container and `pg_restore --clean --if-exists`,
as `copy-prod-db.sh` does.

## Logs, uptime and metrics (`ops/`)
A separate compose project (`jyt-ops`, in `/opt/jyt-ops`), so redeploying Medusa never
restarts monitoring. Everything binds to 127.0.0.1. About 110 MB RAM in use.

| Tool | Replaces | What |
|---|---|---|
| Loki 3.6 + Alloy | CloudWatch Logs | every container + the systemd journal, kept 14 days |
| `logs.sh` (logcli) | `aws logs tail` | query from a laptop through an SSH tunnel |
| Gatus | ALB health checks + alarms | server, admin, postgres, valkey, public `/health` + TLS expiry, backup heartbeat |
| Beszel (profile `metrics`) | Container Insights | CPU / memory / disk history per container |

```bash
deploy/oracle/deploy-ops.sh                       # (re)deploy
brew install logcli                               # once
deploy/oracle/logs.sh server                      # last hour of the Medusa server
deploy/oracle/logs.sh server -f                   # follow
deploy/oracle/logs.sh worker --since 6h --grep 'payu|error'
deploy/oracle/logs.sh unit jyt-pg-backup.service --since 48h
deploy/oracle/logs.sh query '{project="jyt"} |= "order_"' --since 24h
ssh -L 8080:127.0.0.1:8080 ubuntu@130.61.141.163  # Gatus dashboard on localhost:8080
```
**Alerts → phone (ntfy):** Gatus posts to an unguessable topic on ntfy.sh after 3 failed
checks in a row (the backup heartbeat alerts on the first failure) and again when it recovers.
Get the topic with `ssh ubuntu@130.61.141.163 'grep NTFY_TOPIC /opt/jyt-ops/.env'`, then
subscribe in the ntfy app (iOS/Android, server `ntfy.sh`). Anyone with the topic name can
read the alerts, so share it only with people on call.

Beszel one-time setup: `deploy-ops.sh ubuntu@… metrics` starts the hub with an agent
that has no key yet. Open it via `ssh -L 8090:127.0.0.1:8090 …`, create the admin user,
"Add system" (host `127.0.0.1`, port `45876`), copy the key and token into
`/opt/jyt-ops/.env` as `BESZEL_KEY=` / `BESZEL_TOKEN=`, then run `deploy-ops.sh … metrics` again.
Later these UIs can go on the Cloudflare tunnel behind Cloudflare Access.

## Cutover runbook
Rehearsal (safe while AWS serves prod):
1. Run `render-env.sh`, then `deploy.sh`. This starts Postgres, Valkey and the server
   only, with nothing exposed publicly.
2. Run `copy-prod-db.sh` for a fresh copy. Then smoke-test through an SSH port-forward
   (`ssh -L 9000:127.0.0.1:9000 ubuntu@…`): `/health`, admin login, `GET /store/products`.

Cutover (a maintenance window: writes must stop while the data moves):
1. Create the Cloudflare tunnel, route the public hostname to `http://server:9000`,
   and save the token to `/opt/jyt/tunnel.token` (mode 600).
2. Scale **both** ECS services to 0. From here prod is down.
3. Run `copy-prod-db.sh` for the final copy. Prod has nothing writing to it now.
4. Run `deploy.sh ubuntu@… worker tunnel`, then point `v3.jaalyantra.com` at the tunnel.
   Never run this stack's worker while an AWS worker is alive: two workers on separate
   Redis instances run every scheduled job twice.
5. Rollback, before the box takes real writes: point DNS back at the ALB and scale ECS up.
   **After the box takes writes, rollback needs a reverse copy (box → RDS), or those
   orders are lost.**

## Not covered yet
- Automatic deploy on image push (needs a pull trigger, or a webhook that
  doesn't reintroduce a runner on the box).
- An outside check. Gatus runs on the box, so if the box dies nobody is told.
  Add an external monitor (healthchecks.io / UptimeRobot) that also posts to the ntfy topic.
- Database migrations: `RUN_MIGRATIONS_ON_BOOT` stays off. After cutover they have to
  run on the box (`docker compose run --rm server pnpm predeploy:force`), since the
  Fargate migration task can no longer reach the database.

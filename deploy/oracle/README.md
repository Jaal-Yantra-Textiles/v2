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
| RDS `db.t4g.micro`, us-east-1, private | **open decision**, see below |

## Files
- `compose.yml`: the stack. The worker and tunnel are opt-in profiles, so a plain
  `up` can never start a second worker or take traffic by accident.
- `render-env.sh`: on a laptop with AWS credentials, reads every `/jyt/prod/*`
  parameter the ECS server manifest lists and copies them to `/opt/jyt/secrets.env`
  (mode 600) on the box. The box never holds AWS keys.
- `deploy.sh`: copies `compose.yml`, pulls the image, recreates, and waits for `/health`.

## One-time box setup
```bash
ssh ubuntu@130.61.141.163 'sudo apt-get update && sudo apt-get install -y docker-compose-v2 && docker compose version'
```
Compose must be at least 2.30 (for `env_file: format: raw`).

## The database decision
The prod database is RDS in **us-east-1** and is not publicly reachable.
It holds about 2.4 GB of data (17.6 of 20 GB free on 2026-11-23).

1. **Keep RDS in us-east-1.** Make it reachable from the box: public with a security
   group pinned to the box's IP plus TLS, or a WireGuard tunnel. Every query then
   crosses the Atlantic (~90 ms). Medusa makes dozens of queries per request, so pages
   would slow by seconds. Not recommended.
2. **Postgres on the A1 box.** No query latency and no RDS bill. We take on backups
   (nightly `pg_dump` to R2) and upgrades. 2.4 GB fits easily.
3. **RDS in eu-central-1 (Frankfurt).** Low latency and still managed, but costs money.
   It needs the same reachability work as option 1.

## Cutover runbook (after the database decision)
1. `render-env.sh` (with `DATABASE_URL` pointing at the chosen database), then `deploy.sh`.
   This starts the server and Valkey only. While the AWS worker is alive, never start
   this stack's worker: two workers with separate Redis run every scheduled job twice.
2. Smoke-test on the box: `curl 127.0.0.1:9000/health`, an admin login through an SSH
   port-forward, and `GET /store/products`.
3. In Cloudflare, create the tunnel (route the public hostname to `http://server:9000`)
   and save the token to `/opt/jyt/tunnel.token` (mode 600).
4. Cutover window:
   - scale ECS `medusa-worker` to 0, then `deploy.sh ubuntu@… worker tunnel`;
   - point `v3.jaalyantra.com` at the tunnel;
   - watch for 30 minutes, then scale ECS `medusa-server` to 0.
5. Rollback: point the DNS back at the ALB, stop this stack's worker, and scale ECS back up.

## Not covered yet
- Automatic deploy on image push (needs a pull trigger, or a webhook that
  doesn't reintroduce a runner on the box).
- Log shipping and alerting (ECS had CloudWatch and deploy alerts).
- Database migrations: `RUN_MIGRATIONS_ON_BOOT` stays off; run them as today.

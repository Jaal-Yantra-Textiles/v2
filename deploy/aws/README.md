# JYT backend on AWS ECS Fargate — runbook

Operational guide for the active Fargate deploy. Architecture + decisions live
in [PLAN.md](./PLAN.md); this file is the "do the thing" reference.

> **Status: Phase 0c done.** Configs written; first deploy not yet run.
> Phase 0b (user-side AWS provisioning) is the next gate.

---

## Layout

```
deploy/aws/
├── PLAN.md                          ← architecture + decisions
├── PLAN-lightsail-instance.md       ← prior plan, mothballed
├── README.md                        ← this file
├── secrets.example.env              ← every var, no values
├── .gitignore                       ← keeps secrets.local.env safe
├── copilot/
│   ├── medusa-server/manifest.yml   ← Load Balanced Web Service, 0.5/1, auto-scale 1→5
│   ├── medusa-worker/manifest.yml   ← Backend Service, 0.5/1, Spot, singleton
│   └── environments/prod/manifest.yml
└── scripts/
    ├── ghcr-to-ecr.sh               ← Mirror GHCR → ECR
    └── seed-secrets.sh              ← Push secrets to AWS Secrets Manager + SSM

.github/workflows/ecs-deploy.yml     ← CI deploy (workflow_dispatch)
```

---

## Phase 0b — user-owned AWS provisioning

Do these once, in this order, before the first deploy.

### 1. Install tooling

```bash
brew install awscli aws/tap/copilot-cli
aws configure                    # or `aws sso login`
copilot --version
```

### 2. Keep the existing ElastiCache Serverless cluster

The `jyt-spaces-1ufoes` cluster you provisioned stays. Pricing check on
2026-05-18 confirmed Valkey Serverless has a **100 MB minimum** data charge
(not 1 GB as I originally said), so at your current 151 MB the real cost is
**~$9.30/mo**, not $70. Provisioned would be marginally more expensive AND
require manual resize when Phase 1+ tenants land.

**Capture**: the cluster's endpoint
(`jyt-spaces-1ufoes.serverless.use1.cache.amazonaws.com:6379`) for `REDIS_URL`.
Note: Valkey Serverless requires TLS — your `REDIS_URL` must use the
`rediss://` (not `redis://`) scheme:

```
rediss://jyt-spaces-1ufoes.serverless.use1.cache.amazonaws.com:6379
```

The cluster is currently inside the default VPC. After `copilot env deploy`
creates a new VPC, we have two options (decision point at Phase 0d step 6):
- **Add VPC peering** between the Copilot VPC and the default VPC (cleaner).
- **Move/recreate the cluster** inside the Copilot VPC (simpler, ~5 min downtime).

Recommend option 2 since there's no data worth preserving yet.

### 3. CloudWatch alarms (cost guardrail)

Before going live, set two alarms on the ElastiCache cluster:

- `BytesUsedForCache` > **1 GB** (5-min average) → SNS → email
- `ElastiCacheProcessingUnits` > **50 M / day** (sum) → SNS → email

These guard against a runaway tenant or cache bug blowing up the Serverless
bill. Cheap insurance.

### 4. Create the ECR repository + lifecycle policy

```bash
aws ecr create-repository \
  --repository-name jyt-medusa \
  --region us-east-1 \
  --image-scanning-configuration scanOnPush=true \
  --image-tag-mutability MUTABLE

# Keep last 5 images; delete older.
cat > /tmp/lifecycle.json <<'EOF'
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Keep last 5 tagged images",
      "selection": {
        "tagStatus": "tagged",
        "tagPatternList": ["*"],
        "countType": "imageCountMoreThan",
        "countNumber": 5
      },
      "action": { "type": "expire" }
    },
    {
      "rulePriority": 2,
      "description": "Expire untagged after 1 day",
      "selection": {
        "tagStatus": "untagged",
        "countType": "sinceImagePushed",
        "countUnit": "days",
        "countNumber": 1
      },
      "action": { "type": "expire" }
    }
  ]
}
EOF
aws ecr put-lifecycle-policy \
  --repository-name jyt-medusa \
  --region us-east-1 \
  --lifecycle-policy-text file:///tmp/lifecycle.json
```

### 5. GitHub OIDC for CI

Set up an IAM role `jyt-github-actions` that GitHub Actions can assume via OIDC.

- Identity Provider: `token.actions.githubusercontent.com`
- Trust policy: scope to the JYT repo + the `ecs-deploy.yml` workflow.
- Permissions: ECR push/pull + ECS update-service + CloudFormation (Copilot uses it).
  Easiest: attach `AmazonEC2ContainerRegistryPowerUser`, `AmazonECS_FullAccess`,
  and an inline policy for `cloudformation:*` on stacks named `jyt-*`.

Then in the JYT GitHub repo → Settings → Secrets → Actions:
- `AWS_ACCOUNT_ID` = your 12-digit account ID

The role ARN in the workflow file is built from that secret.

### 6. Provision R2 + Sentry

- **R2** (Cloudflare dashboard): create bucket `jyt-uploads-prod`, generate API token, capture: access key ID, secret access key, endpoint URL.
- **Sentry**: create org (if not already) + project type "Node.js" / "Express", capture the DSN.

### 7. Pull real env values from Railway

```bash
cd apps/backend
railway link                                # link to the patient-spirit project
railway variables --service medusa-server > /tmp/railway-server.env
railway variables --service medusa-worker > /tmp/railway-worker.env
```

The output contains every secret you currently use on Railway. Merge into
`deploy/aws/secrets.local.env` (template at `secrets.example.env`).

---

## Phase 0d — first deploy

From repo root, in this order:

### 1. Initialize Copilot app + env

```bash
cd deploy/aws
copilot app init jyt
copilot env init --name prod --profile default --default-config
copilot env deploy --name prod
```

`env deploy` creates: VPC, 2 public subnets, IGW, ECS cluster, ALB.
Takes ~5–10 minutes.

### 2. Initialize services

```bash
copilot svc init --name medusa-server --svc-type "Load Balanced Web Service"
copilot svc init --name medusa-worker --svc-type "Backend Service"
```

Each `svc init` reads the existing `manifest.yml` we wrote; nothing new is
generated.

### 3. Seed secrets

```bash
cp secrets.example.env secrets.local.env
nano secrets.local.env                  # fill in real values
bash scripts/seed-secrets.sh prod
```

### 4. Mirror image GHCR → ECR

```bash
# If GHCR image is private:
export GHCR_USER="your-github-username"
export GHCR_PAT="ghp_..."               # PAT with read:packages

bash scripts/ghcr-to-ecr.sh latest
```

### 5. Deploy both services

```bash
copilot svc deploy --name medusa-server --env prod
copilot svc deploy --name medusa-worker --env prod
```

First deploy of `medusa-server` takes ~7–10 minutes (CloudFormation + ECS task + ALB warmup + Medusa boot + migrations).

### 6. Add ElastiCache SG inbound rule

In the AWS console:
- Note the Fargate task security group (Copilot named it `jyt-prod-medusa-server-*`)
- Edit the ElastiCache cluster's SG → add inbound rule: TCP :6379 from the Fargate task SG

### 7. Smoke test

```bash
# Get the ALB DNS
copilot svc show --name medusa-server

# Should print something like:
#   prod-xxx-1234567890.us-east-1.elb.amazonaws.com
ALB="prod-...elb.amazonaws.com"

# Hit /health
curl -i "https://${ALB}/health"

# Test with the production Host header (validates routing)
curl -i -H "Host: v3.jaalyantra.com" "https://${ALB}/health"
```

### 8. Verify worker is alive

```bash
# Tail worker logs
copilot svc logs --name medusa-worker --follow

# Or exec into a task
copilot svc exec --name medusa-worker
```

You should see subscriber registrations + the workflow engine ticking.

---

## Phase 0d — cutover

1. **CF DNS**: change `v3.jaalyantra.com` from Railway → the Copilot-generated ALB DNS. Start with grey-cloud (DNS-only) for the first few minutes.
2. Verify with `curl https://v3.jaalyantra.com/health` (skip CF proxy at first via `--resolve` if needed).
3. Flip CF to orange-cloud, SSL mode **Full (Strict)**. ACM cert on ALB handles end-to-end TLS.
4. Watch 24h. Both Sentry + CloudWatch logs.
5. Decommission Railway compute services (keep Railway PG). In Railway dashboard: pause or delete `medusa-server` and `medusa-worker` services. Don't touch `Postgres`.

---

## Subsequent deploys

### Manual (laptop)

```bash
bash deploy/aws/scripts/ghcr-to-ecr.sh latest
cd deploy/aws
copilot svc deploy --name medusa-server --env prod
copilot svc deploy --name medusa-worker --env prod
```

### CI (GitHub Actions)

1. Push a new image to `ghcr.io/jaal-yantra-textiles/v2:<tag>` from the GHCR build workflow.
2. In the JYT repo → Actions → "Deploy to ECS Fargate" → Run workflow → enter tag + which services.

---

## Rollback

```bash
# List task definition revisions
aws ecs describe-services \
  --cluster jyt-prod-Cluster \
  --services medusa-server \
  --query 'services[0].taskDefinition'

# Quick rollback to previous Copilot deploy
copilot svc rollback --name medusa-server --env prod
copilot svc rollback --name medusa-worker --env prod
```

If a destructive DB migration shipped, also restore Railway PG from its snapshot.

---

## Debugging

| Symptom | Where to look |
|---|---|
| ALB returns 502/503 | Tasks unhealthy. `copilot svc logs --name medusa-server --follow`. Usually a missing secret or DB unreachable. |
| Healthcheck failing | `/health` endpoint must return 200 within 5s. If migrations are slow, bump `grace_period` in the server manifest. |
| Worker not running jobs | `copilot svc logs --name medusa-worker --follow`. Confirm Spot task didn't get reaped — look for "STOPPED" reason. |
| Image pull failing | ECR auth issue or image not pushed. `aws ecr describe-images --repository-name jyt-medusa`. |
| Can't reach Valkey | SG rule missing. Add inbound :6379 from Fargate task SG to ElastiCache SG. |
| Secret not loading | Wrong path. `aws ssm get-parameter --name /jyt/prod/X` or `aws secretsmanager get-secret-value --secret-id /jyt/prod/X`. |
| OOM kills | Task RAM (1 GB) too tight. Edit manifest `memory: 2048`, redeploy. |

`copilot svc exec` opens a shell inside a running task — for one-off poking around or running `medusa db:migrate` manually.

---

## Open verification items (Phase 0)

Track here until confirmed working in real prod.

- [ ] `copilot env deploy` actually creates the VPC + ALB without errors
- [ ] `copilot svc deploy` mounts secrets correctly (env vars present in container)
- [ ] ECS task can reach Railway PG over public TCP
- [ ] ECS task can reach ElastiCache (after SG rule added)
- [ ] Auto-scaling triggers when CPU >60% sustained (load test)
- [ ] Spot interruption on worker recovers gracefully (don't lose in-flight jobs)
- [ ] Sentry receives errors from a deliberate crash test
- [ ] R2 uploads work end-to-end (admin → S3 SDK → R2 → public URL)
- [ ] CF DNS cutover with grey→orange transition works as documented
- [ ] Rollback (`copilot svc rollback`) actually rolls back

Once all 10 are ticked, Phase 0 is done.

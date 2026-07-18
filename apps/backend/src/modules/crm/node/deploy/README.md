# CRM Autobase node — deploy (Topology-A anchor)

The always-on Autobase writer/indexer behind the CRM module's proxy mode
(`../server.ts`). Runs as a standalone Node process on a durable, always-on host
(the OCI free-tier **handloom-mirror** VM in prod) and is reached by Medusa over
a Cloudflare Tunnel — Medusa itself stays stateless (no native hypercore stack in
the API tasks).

No secrets live in this directory. The bearer token and the cloudflared connector
token are generated at deploy time and kept only in SSM / on the box.

## 1. Build the bundle (from repo root)

A single self-contained CJS file — `server.ts` + `../dal/crm-contracts.ts` +
`@jytextiles/mikrohyperbee` bundled; the native P2P deps stay external and are
`npm install`ed on the box (they ship prebuilds for linux-x64).

```bash
pnpm --filter @jytextiles/mikrohyperbee build   # refresh dist (incl. view.sub isolation)
node_modules/.bin/esbuild apps/backend/src/modules/crm/node/server.ts \
  --bundle --platform=node --format=cjs --target=node20 \
  --external:corestore --external:hyperbee --external:autobase \
  --outfile=/tmp/crm-node/crm-node.cjs
cp apps/backend/src/modules/crm/node/deploy/package.json /tmp/crm-node/
```

## 2. Ship to the host

```bash
HOST=ubuntu@<vm-ip>
ssh $HOST 'sudo mkdir -p /opt/crm /etc/crm && sudo chown ubuntu:ubuntu /opt/crm'
scp /tmp/crm-node/{crm-node.cjs,package.json} $HOST:/opt/crm/
ssh $HOST 'cd /opt/crm && npm install --omit=dev'
```

## 3. Env + service

```bash
# /etc/crm/node.env  (root:600) — generate a strong CRM_NODE_TOKEN
#   CRM_STORE=/opt/crm/store
#   CRM_NODE_PORT=8790
#   CRM_NODE_TOKEN=<openssl rand -hex 32>
scp crm-node.service $HOST:/tmp/ && ssh $HOST '
  sudo mv /tmp/crm-node.service /etc/systemd/system/crm-node.service
  sudo systemctl daemon-reload && sudo systemctl enable --now crm-node.service'
curl -s http://127.0.0.1:8790/health   # {"ok":true,"writable":true}
```

## 4. Cloudflare Tunnel (ingress — no inbound VM ports)

Remotely-managed tunnel → public hostname → `http://localhost:8790`. Create the
tunnel + ingress config + a **proxied** `CNAME <host> → <tunnel-id>.cfargotunnel.com`
via the CF API (needs a token with account `Cloudflare Tunnel:Edit` + zone
`DNS:Edit`), then on the box:

```bash
sudo cloudflared service install <connector-token>
```

## 5. Wire Medusa (prod)

- SSM SecureString `/jyt/prod/CRM_NODE_TOKEN` = the bearer (write BEFORE deploy).
- `CRM_NODE_URL` (variables) + `CRM_NODE_TOKEN` (secrets) are in
  `deploy/aws/copilot/medusa-server/manifest.yml`.
- Deploy the server → loader logs `[crm] proxy mode → https://…` → `/admin/crm/*`
  is live end-to-end.

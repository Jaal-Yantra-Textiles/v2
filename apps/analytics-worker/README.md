# @jyt/analytics-worker — #344 edge analytics collector

Cloudflare Worker that terminates storefront `track` calls at the edge, buffers
events in **KV**, and every minute drains them as an **HMAC-signed batch** to the
Medusa ingest endpoint (`POST /web/analytics/ingest-batch`, shipped in #547/#548).
Downstream (daily rollup → `analytics_daily_stats` → stats panels) is unchanged.

See the design: `apps/docs/notes/525_MODULE_AUDIT_AND_CF_VISITOR_OFFLOAD.md`.

## What it does
- `POST /track` — same request/response contract as the legacy direct Medusa
  route (`200 {success:true}`, always). Adds an edge `event_id` (dedupe),
  `country` (free `request.cf` GeoIP), and receive `timestamp`; buffers to KV.
- cron (`* * * * *`) — drains the buffer, signs the exact body bytes, POSTs the
  batch, and deletes keys **only on a 2xx** (failed flush retries next tick;
  server dedupes on `event_id`, so retries can't double-count).

## Deploy

Prereq: a Cloudflare **API Token** (My Profile → API Tokens → Create Token — *not*
the Global API Key) with **Account** permissions:
- **Workers Scripts: Edit**
- **Workers KV Storage: Edit**
- **Account Settings: Read** (optional; lets wrangler resolve the account)
- (only for a custom `collect.<domain>` host: **Zone → Workers Routes: Edit** + **DNS: Edit**)

```bash
cd apps/analytics-worker
npm install

export CLOUDFLARE_API_TOKEN=...        # the scoped token above
export CLOUDFLARE_ACCOUNT_ID=...        # your account id

# 1. create the buffer namespace, paste the printed id into wrangler.jsonc kv_namespaces[0].id
npx wrangler kv namespace create ANALYTICS_BUFFER

# 2. set the shared secret — MUST equal Medusa's ANALYTICS_INGEST_SECRET (prod SSM)
npx wrangler secret put ANALYTICS_INGEST_SECRET

# 3. (optional) point MEDUSA_INGEST_URL at a preview before prod, in wrangler.jsonc vars
# 4. ship
npx wrangler deploy
```

## Enabling ingestion (rollout)
1. Set `ANALYTICS_INGEST_SECRET` in **Medusa prod** (SSM) to the **same** value as
   the worker secret — until then the endpoint fail-closes (401) and ingestion is inert.
2. Point the storefront `analytics.js` `track` URL at the worker **behind the
   `ANALYTICS_EDGE_INGEST` flag with a fallback to the direct Medusa route** (#344
   slice 4 — reversible; worker downtime degrades to direct ingest).

## Test
```bash
npm test        # pure-logic unit tests (normalize / chunk / HMAC parity with Node)
```
The HMAC test asserts the worker's signature equals Node's `createHmac` over the
exact body — i.e. exactly what the Medusa endpoint verifies against its raw bytes.

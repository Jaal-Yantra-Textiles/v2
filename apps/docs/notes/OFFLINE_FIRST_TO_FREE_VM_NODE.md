# Offline-first → always-on node on a free VM — a deployment pattern

> **Status (2026-07-18):** proven end-to-end by the CRM module (#1082). The CRM
> Autobase node runs on an OCI free-tier VM behind a Cloudflare Tunnel; Medusa
> proxies to it. This doc is the reusable **operational** guide. For the *design*
> of the underlying DAL/seams, see
> [`MIKROHYPERBEE_FRAMEWORK.md`](./MIKROHYPERBEE_FRAMEWORK.md). Related:
> `#938 product-as-spine`, `#940 free-hosting migration`, and the tracking issue
> for porting this to a full Medusa-free API on a free VM.

## 1. What this is (and when to reach for it)

A recipe for taking a module off Postgres and onto an **append-log + P2P**
foundation, then running the durable writer on **free, always-on infrastructure**
without opening the box to the internet — while Medusa stays a **stateless
proxy**.

Use it when a domain is:

- **offline-first / edge-friendly** — writers may be disconnected and reconcile
  later (contacts, notes, pipeline, field data, provenance);
- **soft-integrity-tolerant** — eventual consistency + last-writer-wins is
  acceptable (uniqueness resolved at *merge*, not at *append*);
- **cost-sensitive** — you'd rather run it on a $0 always-free VM than pay for
  managed Postgres + compute.

Do **not** use it for money, inventory, or anything needing hard
single-writer/ACID guarantees. Those stay on Postgres (**polyglot by design**).

## 2. The layered pattern

Six layers, each swappable, each already validated in the CRM build:

```
  ┌─ L6  Medusa (stateless) ──────────────────────────────────────────┐
  │      MedusaService → ${model}Service → baseRepository (Seam A)     │
  │      loader picks a repo impl by env; no native stack in the API   │
  └───────────────────────────┬───────────────────────────────────────┘
                              │  HTTP + bearer  (proxy repo)
  ┌───────────────────────────▼─────── Cloudflare Tunnel (TLS@edge) ───┐
  │  no inbound VM ports — cloudflared dials OUT to the CF edge        │
  └───────────────────────────┬───────────────────────────────────────┘
  ┌───────────────────────────▼──────── always-on node (free VM) ─────┐
  │  L5  tiny HTTP surface  (/crm/:seg[/:id], /health, /admin/writers) │
  │  L4  Autobase multi-writer  → deterministic apply() → ONE view     │
  │  L3  repository contract  (shape · uniqueness · referential integ) │
  │  L2  Hyperbee  (append-log KV, per-model sub-db isolation)         │
  │  L1  Corestore on a PERSISTENT DISK  (the durability anchor)       │
  └───────────────────────────────────────────────────────────────────┘
```

- **L1 Corestore / persistent disk** — the whole point of the VM. On an ephemeral
  host (Fargate, CF Containers) the store is lost on restart; on a free VM the
  `CRM_STORE` dir is a real disk. This is *the* reason the node lives on a VM.
- **L2 Hyperbee** — append-only KV; reads are just Hyperbee reads. Per-entity
  `view.sub(model)` isolation (a shared index once cross-linked two models — the
  isolation fix is load-bearing).
- **L3 repository contract** — Medusa-free (`dal/crm-contracts.ts`): shape,
  uniqueness, referential integrity. The same contracts drive embedded *and* node
  modes.
- **L4 Autobase (multi-writer)** — each writer appends ops to its **own** input
  core; a deterministic, **never-throwing LWW** `apply()` folds them into one
  Hyperbee view. Ops carry fully-materialized rows (writer mints id + stamps
  timestamps *before* append, so `apply()` is pure). Uniqueness clashes / stale
  updates are *dropped* at merge; the loser learns by reading its id back.
- **L5 tiny HTTP node** (`node/server.ts`) — host-agnostic. Opens the Autobase
  over `CRM_STORE`, serves REST, gates on a bearer token, and can authorize new
  writers (`POST /admin/writers`, owner-adds-writer).
- **L6 Medusa proxy** — the DAL loader is **flag-gated + non-fatal**: `CRM_NODE_URL`
  → proxy mode; `CRM_HYPERBEE=true` → embedded (dev); neither → no-op. A backend
  hiccup degrades that module alone, never boot.

## 3. Topologies

| | Store lives | Medusa holds | Durability | Use |
|---|---|---|---|---|
| **Embedded** | in the API process | a local Hyperbee | ephemeral on Fargate | local dev / experiments (`CRM_HYPERBEE=true`) |
| **Proxy (A)** ✅ | on the free VM | nothing (stateless) | persistent disk | **prod today** (`CRM_NODE_URL=…`) |
| **Full API on VM** | on the free VM | — (Medusa-free API runs *on* the VM) | persistent disk | endgame — see §7 |

Topology A is the current prod shape: durability + native P2P stack live on the
VM; the API tasks stay light and stateless. Multi-writer-ready — offline/edge
writers join the node's Autobase later with **zero Medusa changes**.

## 4. Deploy recipe (the worked example: the CRM node)

Reproducible steps live next to the code:
[`apps/backend/src/modules/crm/node/deploy/`](../../backend/src/modules/crm/node/deploy/)
(README + systemd unit + standalone `package.json`). In short:

1. **Bundle** — one self-contained CJS file via esbuild; native P2P deps
   (`corestore`/`hyperbee`/`autobase`) stay **external** and are `npm install`ed on
   the box (they ship linux-x64 prebuilds). No `tsx` on the box.
2. **Ship** — `scp` to `/opt/<svc>`, `npm install --omit=dev`.
3. **Run** — systemd unit as an unprivileged user, `EnvironmentFile` (root:600),
   persistent `*_STORE` dir, and a **`MemoryMax`** cap to stay inside the 1 GB box.
4. **Ingress** — a Cloudflare **remotely-managed** tunnel: create tunnel + ingress
   config + a **proxied** `CNAME <host> → <tunnel-id>.cfargotunnel.com`, then
   `cloudflared service install <connector-token>` on the box. No inbound ports.
5. **Wire the app** — `<SVC>_NODE_URL` (non-secret, in the copilot manifest
   `variables:`) + `<SVC>_NODE_TOKEN` (SSM SecureString, in `secrets:`). Deploy →
   loader logs proxy mode → the module is live.

## 5. Footprint & host selection (why a *free* VM works)

The node is tiny: Node baseline + Hyperbee/Autobase over a small dataset ≈ **35 MB
RSS**. That comfortably co-locates on an **Oracle Always-Free `VM.Standard.E2.1.Micro`**
(1 GB / 2 vCPU) alongside an existing idle service.

Selection rule when co-locating: pick the box by **`available` RAM + 5-min load**,
not by role. For CRM we chose the **P2P mirror** box (idle durability replica,
~360 MB free) over the **crawler** box (saturated, ~195 MB free, load 3.5). Cap
the service with systemd `MemoryMax` so it can never starve the host.

> **Whole-Medusa-on-a-VM does _not_ fit these micros.** The prod build alone OOMs
> at 2 GB (needs a 6 GB heap); runtime needs server + worker + Redis + Postgres.
> That is the **Ampere A1** free allocation (up to 4 OCPU / 24 GB) — see #940 — a
> different, deliberate move. This pattern is for a *single durable node*, not the
> whole app.

## 6. Security model

- **No inbound ports.** The VM firewall opens only `:22`; the node binds locally
  and is reachable **only** through the tunnel. `cloudflared` dials *out*.
- **TLS at the CF edge**, so no cert management on the box.
- **Bearer token** on every route (`/health` excepted); unauthenticated → 401. The
  token is an SSM SecureString on the Medusa side and a root:600 env file on the
  box. Rotate by regenerating both.
- Defense-in-depth to add later: Cloudflare Access (service token / mTLS) in front
  of the hostname; a `conflicts` sub-db so LWW losers are surfaced, not silently
  dropped.

## 7. The path forward — port to a full Medusa-free API on a free VM

Topology A keeps Medusa in front. The endgame (strangler-fig, per the framework
doc) is to let the **node itself grow into the API** — the same repository code +
a `query.graph`-style joiner + a thin HTTP layer — so a whole domain runs
Medusa-free **on the free VM**, and Medusa either proxies to it or is removed from
that path entirely. That is what makes "moving off Medusa" a matter of *deleting an
import*, not un-forking a fork.

**Tracked as [#1084](https://github.com/Jaal-Yantra-Textiles/v2/issues/1084)** — the concrete port:
generalize `node/server.ts` into a reusable service host (module registry, the
joiner, auth, writer membership, snapshot/restore), so any offline-first module
gets this deployment for free and the free-VM API becomes first-class rather than
CRM-specific.

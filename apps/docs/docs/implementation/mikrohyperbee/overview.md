---
title: "What it is & what it means"
sidebar_label: "Overview"
sidebar_position: 1
---

# MikroHyperbee — overview

> The practical *how* lives in **[Usage](./usage.md)**. The full *why* (north star,
> strangler plan, keep/shed decisions) is the design-of-record note
> `apps/docs/notes/MIKROHYPERBEE_FRAMEWORK.md`. This page is the short version.
>
> Landed on `main` 2026‑07‑15 (PRs #1046, #1050).

## What it is (one paragraph)

`@jytextiles/mikrohyperbee` (`packages/mikrohyperbee/`) is a **storage backend for
a Medusa module** that keeps records in a local, append‑friendly
[Hyperbee](https://docs.pears.com/building-blocks/hyperbee) KV store instead of
Postgres — **without changing the module's public API**.

Medusa plugs storage in at exactly one seam: the internal per‑model service that
the generated `create` / `list` / `retrieve` / `update` / `delete` methods delegate
to. MikroHyperbee provides a drop‑in for that seam — a contract‑driven
`HyperbeeBaseRepository`. Swap it in through a loader and the *same* route, service,
`query.graph`, links, and workflows keep working. The records just live in Hyperbee.

```
 route ─▶ generated PersonPropertyService ─▶ [ internal service ]  ─▶  storage
                                                     ▲
                       Postgres/MikroORM  ◀──────────┴──────────▶  Hyperbee (MikroHyperbee)
                              (default)                             (flag: *_HYPERBEE=true)
```

## What it means (why we'd want this)

- **Own the data layer** — a concrete step toward running modules off
  Medusa/Postgres entirely (the #938 "product‑as‑spine" / strangler‑fig plan):
  moving away becomes *deleting an import*, not un‑forking a fork.
- **Append‑log by construction** — ideal for **provenance / audit / append‑mostly**
  domains (weaver census, certification #935, audit trails) where immutability and
  crash‑safety are a feature, not overhead.
- **Local‑first / P2P‑ready** — Hypercore replicates peer‑to‑peer, so the same store
  can be mirrored (e.g. a public core + an encrypted core) with no central DB.
- **Polyglot & opt‑in** — it's per‑module and flag‑gated. Churny/transactional
  modules (orders, carts) stay on Postgres; you only move a module when the
  append‑log is a strict upgrade.

## What it is **not**

- Not a general Postgres replacement.
- Not for high‑write transactional data (orders, inventory, payments).
- Not automatic — each module opts in explicitly, behind a flag that defaults to
  Postgres.

Reach for it on **append‑mostly, provenance, or decentralized** modules. The
`person_property` module is the reference implementation; see **[Usage](./usage.md)**.

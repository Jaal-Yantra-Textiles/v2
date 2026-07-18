/**
 * Standalone CRM node — the always-on Autobase writer/indexer behind the Medusa
 * CRM module's proxy mode. Holds the CRM Autobase over a local Corestore and
 * serves a tiny REST surface that the proxy repository (dal/crm-proxy.ts) calls.
 *
 * Host-agnostic: the SAME process runs on an always-on VM (OCI free-tier — the
 * durable anchor) or a Cloudflare Container / Fargate task. Only durability
 * differs by host: on a VM the CRM_STORE dir is a real persistent disk; on an
 * ephemeral host you must either replicate to a durable peer (the multi-writer
 * story — other writers hold the data) or snapshot CRM_STORE to R2 and restore
 * on boot. This process itself just opens the store at CRM_STORE.
 *
 * Multi-writer ready: it's an Autobase indexer (bootstrap = null → its key IS the
 * base id). Additional writers join with bootstrap=<this base key> and are
 * authorized via the /admin/writers endpoint (owner-adds-writer).
 *
 *   Env: CRM_STORE (store dir, default ./.crm-node-store), CRM_NODE_PORT (8790),
 *        CRM_NODE_TOKEN (optional bearer required on all routes).
 *   Run: tsx apps/backend/src/modules/crm/node/server.ts
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

// @ts-ignore — native deps resolved at runtime (not part of the Medusa build)
import Corestore from "corestore";
// @ts-ignore
import Hyperbee from "hyperbee";
// @ts-ignore
import Autobase from "autobase";

import {
  autobeeRepositoryFor,
  makeApply,
  authorizeWriter,
  type ModelRepository,
} from "@jytextiles/mikrohyperbee";

import { crmContracts, CRM_MODEL_BY_SEGMENT } from "../dal/crm-contracts";

export type CrmNode = {
  base: any;
  repos: Record<string, ModelRepository>;
  close: () => Promise<void>;
};

/** Open the Autobase + per-model repositories over a store directory. */
export async function openCrmNode(storeDir: string): Promise<CrmNode> {
  const store = new Corestore(storeDir);
  const base = new Autobase(store, null, {
    valueEncoding: "json",
    open(viewStore: any) {
      return new Hyperbee(viewStore.get("view"), {
        keyEncoding: "utf-8",
        valueEncoding: "binary",
      });
    },
    apply: makeApply(crmContracts),
  });
  await base.ready();

  const repos: Record<string, ModelRepository> = {};
  for (const [model, contract] of Object.entries(crmContracts)) {
    repos[model] = autobeeRepositoryFor(contract, base);
  }
  return {
    base,
    repos,
    close: async () => {
      await base.close?.();
      await store.close?.();
    },
  };
}

// ── HTTP surface ───────────────────────────────────────────────────────────────
const send = (res: ServerResponse, code: number, body: unknown) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(s) });
  res.end(s);
};

const readJson = (req: IncomingMessage): Promise<any> =>
  new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });

/** Map a ContractError-shaped message to an HTTP status. */
const statusForError = (e: any): number => {
  const t = e?.type;
  if (t === "not_found") return 404;
  if (t === "invalid_data" || t === "not_unique") return 422;
  if (t === "not_allowed") return 403;
  return 500;
};

export function createCrmNodeServer(node: CrmNode, opts: { token?: string } = {}) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean); // ["crm","people",":id"]

      if (parts[0] === "health") return send(res, 200, { ok: true, writable: node.base.writable });

      if (opts.token) {
        const auth = req.headers["authorization"];
        if (auth !== `Bearer ${opts.token}`) return send(res, 401, { message: "unauthorized" });
      }

      // Membership: authorize another writer (owner-adds-writer). Body: { key: hex }.
      if (parts[0] === "admin" && parts[1] === "writers" && req.method === "POST") {
        const { key } = await readJson(req);
        if (!key) return send(res, 422, { message: "key (hex) required" });
        await authorizeWriter(node.base, Buffer.from(String(key), "hex"));
        return send(res, 200, { authorized: key });
      }

      if (parts[0] !== "crm") return send(res, 404, { message: "not found" });
      const model = CRM_MODEL_BY_SEGMENT[parts[1]];
      const repo = model && node.repos[model];
      if (!repo) return send(res, 404, { message: `unknown crm collection '${parts[1]}'` });

      const id = parts[2];

      if (!id && req.method === "GET") {
        const filters: Record<string, string> = {};
        for (const [k, v] of url.searchParams) if (k !== "limit" && k !== "offset") filters[k] = v;
        const take = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined;
        const skip = url.searchParams.has("offset") ? Number(url.searchParams.get("offset")) : 0;
        const [rows, count] = await repo.listAndCount(filters, { take, skip });
        return send(res, 200, { rows, count });
      }
      if (!id && req.method === "POST") {
        const created = await repo.create(await readJson(req));
        return send(res, 201, { record: created });
      }
      if (id && req.method === "GET") {
        return send(res, 200, { record: await repo.retrieve(id) });
      }
      if (id && req.method === "POST") {
        const updated = await repo.update({ id, ...(await readJson(req)) });
        return send(res, 200, { record: updated });
      }
      if (id && req.method === "DELETE") {
        await repo.delete(id);
        return send(res, 200, { id, deleted: true });
      }
      return send(res, 405, { message: "method not allowed" });
    } catch (e: any) {
      send(res, statusForError(e), { type: e?.type, message: e?.message || "error" });
    }
  });
}

// ── entrypoint (only when run directly) ─────────────────────────────────────────
const isMain = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require.main === module;
  } catch {
    return false;
  }
})();

if (isMain) {
  const storeDir = process.env.CRM_STORE || "./.crm-node-store";
  const port = Number(process.env.CRM_NODE_PORT || 8790);
  openCrmNode(storeDir).then((node) => {
    const server = createCrmNodeServer(node, { token: process.env.CRM_NODE_TOKEN });
    server.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(
        `[crm-node] listening on :${port} store=${storeDir} base=${Buffer.from(node.base.key)
          .toString("hex")
          .slice(0, 12)}… (writable=${node.base.writable})`
      );
    });
  });
}

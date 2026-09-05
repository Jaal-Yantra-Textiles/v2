// Unmask CLI — resolve one weaver's FULL PII from the encrypted sensitive core,
// locally, wherever the seeder's store lives (the OCI node). This is the
// "query it" path for an operator with the encryption key — no HTTP, no Medusa.
//
//   HANDLOOM_ENCRYPTION_KEY=<64-hex> [P2P_STORE=./p2p-store] \
//     node unmask_cli.mjs 2904500
//
// The key is the SAME 64-hex value the seeder (seed_p2p.mjs) uses; it never
// leaves this host. The sensitive core is opened by NAME (what the seeder
// created) so the operator doesn't need the core's hex key.

import Corestore from "corestore";
import Hyperbee from "hyperbee";
import b4a from "b4a";
import { brotliDecompressSync } from "node:zlib";

const id = process.argv[2];
if (!id) {
  console.error("usage: node unmask_cli.mjs <census_id>");
  process.exit(2);
}

const encHex = (process.env.HANDLOOM_ENCRYPTION_KEY || "").trim();
if (!encHex || encHex.length !== 64) {
  console.error("set HANDLOOM_ENCRYPTION_KEY (64-hex)");
  process.exit(2);
}
const STORE_DIR = process.env.P2P_STORE || "./p2p-store";

const store = new Corestore(STORE_DIR);
await store.ready();
const core = store.get({ name: "handloom-sensitive-v1", encryptionKey: b4a.from(encHex, "hex") });
await core.ready();
const bee = new Hyperbee(core, { keyEncoding: "utf-8", valueEncoding: "binary" });
await bee.ready();

const node = await bee.sub("rec", { valueEncoding: "binary" }).get(String(id));
if (!node) {
  console.error(`no census weaver with id ${id}`);
  process.exit(1);
}
console.log(JSON.stringify(JSON.parse(brotliDecompressSync(node.value).toString()), null, 2));
await store.close();
// Blind P2P mirror peer — durability replica for the handloom cores.
//
// Joins the same Hyperswarm as the seeder and replicates BOTH cores by key at the
// Corestore level, persisting every block to disk. It is "blind": it holds the
// sensitive core as ciphertext (no encryptionKey is ever given here), so it is a
// safe off-site backup that CANNOT read PII — it only guarantees the data survives
// if the seeder VM dies.
//
// Because replication is at the Corestore level, this same peer will also mirror a
// future encrypted Hyperdrive photo-blob core with no changes (just add its key).
//
// Modeled on the eyePhotos PhotoSync harness (Corestore + Hyperswarm + replicate +
// findingPeers/flush), generalized from one Hyperdrive to N cores by key.
//
//   PUBLIC_CORE_KEY=<hex> SENSITIVE_CORE_KEY=<hex> [P2P_STORE=./replica-store] \
//     node replicate_peer.mjs
//
// Keys are the shareable core keys (NOT the encryption key). Extra cores to mirror
// can be passed as EXTRA_CORE_KEYS=<hex>,<hex>,...  (e.g. the photo Hyperdrive).

import Corestore from "corestore";
import Hyperswarm from "hyperswarm";
import b4a from "b4a";

const STORE_DIR = process.env.P2P_STORE || "./replica-store";
const keys = [process.env.PUBLIC_CORE_KEY, process.env.SENSITIVE_CORE_KEY,
  ...(process.env.EXTRA_CORE_KEYS ? process.env.EXTRA_CORE_KEYS.split(",") : [])]
  .map((k) => (k || "").trim()).filter(Boolean);

if (keys.length < 2) {
  console.error("set PUBLIC_CORE_KEY and SENSITIVE_CORE_KEY (64-hex each)");
  process.exit(2);
}

const store = new Corestore(STORE_DIR);
await store.ready();

// read-only replicas of each core (no encryptionKey → sensitive stays opaque)
const cores = keys.map((hex) => store.get({ key: b4a.from(hex, "hex") }));
await Promise.all(cores.map((c) => c.ready()));

const swarm = new Hyperswarm();
swarm.on("connection", (conn, info) => {
  store.replicate(conn);                                    // Corestore-level: mirrors every core
  console.log(`[${new Date().toISOString()}] peer connected — ${swarm.connections.size} active`);
  conn.on("close", () => console.log(`[${new Date().toISOString()}] peer disconnected — ${swarm.connections.size} active`));
});

for (const core of cores) {
  const done = core.findingPeers();
  swarm.join(core.discoveryKey, { server: false, client: true });
  swarm.flush().then(done, done);
  // pull everything now, and keep pulling as the seeder appends
  core.download({ start: 0, end: -1 });
  core.on("append", () => {
    core.download({ start: 0, end: core.length });
    console.log(`[${new Date().toISOString()}] mirror: ${core.key.toString("hex").slice(0, 12)}… grew → ${core.length} blocks`);
  });
}

// Direct-socket path for same-VCN peers (deterministic; avoids NAT hole-punch).
// Opt-in via SEED_HOST (the seeder's private IP). Auto-reconnects.
if (process.env.SEED_HOST) {
  const net = await import("node:net");
  const port = Number(process.env.SEED_PORT || 49737);
  const dial = () => {
    const socket = net.connect(port, process.env.SEED_HOST);
    socket.on("connect", () => {
      console.log(`[${new Date().toISOString()}] direct connect → ${process.env.SEED_HOST}:${port}`);
      const s = store.replicate(true);           // raw socket → replicate(bool) + pipe
      s.pipe(socket).pipe(s);
    });
    socket.on("error", (e) => console.log(`[${new Date().toISOString()}] direct dial error: ${e.message}`));
    socket.on("close", () => setTimeout(dial, 5000));   // reconnect
  };
  dial();
}

const report = () => {
  const parts = cores.map((c, i) =>
    `${["public", "sensitive", "extra"][i] || "core" + i}=${c.contiguousLength}/${c.length}`);
  console.log(`[${new Date().toISOString()}] peers=${swarm.connections.size}  mirror blocks (have/known): ${parts.join("  ")}`);
};
setInterval(report, 5 * 60 * 1000);
await new Promise((r) => setTimeout(r, 3000));
report();
console.log("blind mirror joined swarm — downloading + persisting all cores (sensitive stays opaque; no encryptionKey here)");

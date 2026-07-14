import type { LoaderOptions } from "@medusajs/framework/types"

import { censusReader } from "../reader"

// The live handloom census PUBLIC core key ("share freely" — masked records +
// aggregates only, never PII). Overridable via env for other deployments.
const DEFAULT_PUBLIC_CORE_KEY =
  "5709e2edba5a83ca3711d84c049217f202c6101f2554b2c54f41498ba5ff35da"

/**
 * Boot the embedded P2P reader: join Hyperswarm, replicate the census PUBLIC core
 * by key (read-only, no encryption key → no PII), open a Hyperbee over it, and
 * hand it to the module-singleton CensusReader.
 *
 * Flag-gated + fully non-fatal: the native hypercore stack (hyperswarm pulls
 * sodium-native/udx-native) is loaded ONLY when CENSUS_P2P_ENABLED=true, via
 * dynamic import inside a try/catch — so a build without those optional deps, or
 * prod with the flag off, boots normally and the module simply stays "not ready".
 */
export default async function p2pReaderLoader({ container }: LoaderOptions) {
  const logger = container.resolve("logger")

  if (process.env.CENSUS_P2P_ENABLED !== "true") {
    logger.info("[census] P2P reader disabled (set CENSUS_P2P_ENABLED=true to connect)")
    return
  }

  const publicKeyHex = (process.env.CENSUS_PUBLIC_CORE_KEY || DEFAULT_PUBLIC_CORE_KEY).trim()
  const storeDir = process.env.CENSUS_P2P_STORE || "./.census-p2p-store"

  try {
    const [{ default: Corestore }, { default: Hyperbee }, { default: Hyperswarm }, { default: b4a }] =
      await Promise.all([
        import("corestore"),
        import("hyperbee"),
        import("hyperswarm"),
        import("b4a"),
      ])

    const store = new Corestore(storeDir)
    await store.ready()

    // read-only replica of the public core (by key, no encryptionKey)
    const core = store.get({ key: b4a.from(publicKeyHex, "hex") })
    await core.ready()

    const swarm = new Hyperswarm()
    swarm.on("connection", (conn: any) => store.replicate(conn))

    const done = core.findingPeers()
    swarm.join(core.discoveryKey, { server: false, client: true })
    swarm.flush().then(done, done)

    // pull everything now, and keep pulling as the seeder appends
    core.download({ start: 0, end: -1 })
    core.on("append", () => core.download({ start: 0, end: core.length }))

    const bee = new Hyperbee(core, { keyEncoding: "utf-8", valueEncoding: "binary" })
    await bee.ready()
    censusReader.setBee(bee)

    logger.info(
      `[census] P2P reader connected — replicating public core ${publicKeyHex.slice(0, 12)}… (read-only, PII-free)`
    )
  } catch (e: any) {
    // never break boot: log and leave the reader "not ready" (routes will 503).
    logger.error(`[census] P2P reader failed to start (module stays offline): ${e?.message || e}`)
  }
}

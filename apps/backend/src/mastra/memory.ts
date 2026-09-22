// @ts-nocheck
import { Memory } from "@mastra/memory";
import { PostgresStore, PgVector } from "@mastra/pg";
import { google } from "@ai-sdk/google";

// Centralized Mastra Memory configuration using Postgres + pgvector
// Uses DATABASE_URL or MEDUSA_DB_URL for connection

let memory: any | undefined
let sharedStorage: any | undefined

try {
  if (process.env.MASTRA_DISABLED === "true") {
    // Skip Mastra initialization entirely (e.g. in integration tests)
    throw new Error("Mastra disabled via MASTRA_DISABLED env var")
  }

  const connectionString =
    process.env.DATABASE_URL ||
    process.env.MEDUSA_DB_URL ||
    undefined

  /**
   * 🔴 Mastra opens its OWN pg pools, separately from Medusa's — one here for
   * storage, one for the vector index, one more in `mastra/index.ts`. Each
   * defaults to node-postgres' max of 10, so on a small Postgres the three of
   * them alone can exhaust the server: a managed instance capped at 20
   * connections answered a plain `medusa exec seed.ts` with "sorry, too many
   * clients already" and then "remaining connection slots are reserved for
   * roles with the SUPERUSER attribute".
   *
   * Unset means the library default, so nothing changes where connections are
   * plentiful; set it where they are not.
   */
  const poolMax = Number(process.env.MASTRA_PG_POOL_MAX) || undefined
  const poolOpts = poolMax ? { max: poolMax } : {}

  const embeddingsEnabled =
    process.env.MASTRA_ENABLE_EMBEDDINGS === "true" &&
    !!process.env.GOOGLE_GENERATIVE_AI_API_KEY

  const embeddingsDisabled =
    process.env.MASTRA_DISABLE_EMBEDDINGS === "true" ||
    !embeddingsEnabled

  if (connectionString) {
    sharedStorage = new PostgresStore({ id: "mastra-memory-storage", connectionString, ...poolOpts })
    if (embeddingsDisabled) {
      memory = new Memory({
        storage: sharedStorage,
        options: {
          workingMemory: { enabled: true },
          lastMessages: 10,
        },
      })
      // eslint-disable-next-line no-console
      console.log("[mastra:memory] Initialized Postgres-backed memory (embeddings disabled)")
    } else {
      memory = new Memory({
        storage: sharedStorage,
        vector: new PgVector({ id: "mastra-memory-vector", connectionString, ...poolOpts }),
        embedder: google.textEmbeddingModel("gemini-embedding-001", { outputDimensionality: 768 }),
        options: {
          workingMemory: { enabled: true },
          lastMessages: 10,
          // Enable semantic recall with v2-compatible embeddings
          semanticRecall: {
            topK: 3,
            messageRange: { before: 2, after: 1 },
          },
        },
      })
      // eslint-disable-next-line no-console
      console.log("[mastra:memory] Initialized Postgres-backed memory with PgVector + Gemini embeddings (AI SDK v5)")
    }
  } else {
    // eslint-disable-next-line no-console
    console.log("[mastra:memory] No DATABASE_URL/MEDUSA_DB_URL found; memory disabled")
  }
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn("[mastra:memory] Failed to initialize memory:", (e as any)?.message)
  memory = undefined
  sharedStorage = undefined
}

export { memory, sharedStorage }

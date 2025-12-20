// @ts-nocheck
import { Memory } from "@mastra/memory";
import { PostgresStore, PgVector } from "@mastra/pg";
import { google } from "@ai-sdk/google-v5";

// Centralized Mastra Memory configuration using Postgres + pgvector
// Uses DATABASE_URL or MEDUSA_DB_URL for connection

let memory: any | undefined
let sharedStorage: any | undefined

try {
  const connectionString =
    process.env.DATABASE_URL ||
    process.env.MEDUSA_DB_URL ||
    undefined

  const embeddingsEnabled =
    process.env.MASTRA_ENABLE_EMBEDDINGS === "true" &&
    !!process.env.GOOGLE_GENERATIVE_AI_API_KEY

  const embeddingsDisabled =
    process.env.MASTRA_DISABLE_EMBEDDINGS === "true" ||
    !embeddingsEnabled

  if (connectionString) {
    sharedStorage = new PostgresStore({ connectionString })
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
        vector: new PgVector({ connectionString }),
        embedder: google.textEmbeddingModel("text-embedding-004", { outputDimensionality: 768 }),
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

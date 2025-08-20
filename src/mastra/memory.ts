// @ts-nocheck
import { Memory } from "@mastra/memory";
import { PostgresStore, PgVector } from "@mastra/pg";
import { openai } from "@ai-sdk/openai";

// Centralized Mastra Memory configuration using Postgres + pgvector
// Uses DATABASE_URL or MEDUSA_DB_URL for connection

let memory: any | undefined

try {
  const connectionString =
    process.env.DATABASE_URL ||
    process.env.MEDUSA_DB_URL ||
    undefined

  if (connectionString) {
    memory = new Memory({
      storage: new PostgresStore({ connectionString }),
      vector: new PgVector({ connectionString }),
      embedder: openai.textEmbeddingModel("text-embedding-3-small"),
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
    console.log("[mastra:memory] Initialized Postgres-backed memory with PgVector + OpenAI embeddings (AI SDK v5)")
  } else {
    // eslint-disable-next-line no-console
    console.log("[mastra:memory] No DATABASE_URL/MEDUSA_DB_URL found; memory disabled")
  }
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn("[mastra:memory] Failed to initialize memory:", (e as any)?.message)
  memory = undefined
}

export { memory }

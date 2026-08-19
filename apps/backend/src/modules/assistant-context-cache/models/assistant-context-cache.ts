import { model } from "@medusajs/framework/utils"

/**
 * Cross-conversation context cache for the AI assistants.
 *
 * Each assistant (admin, partner) is stateless — the client sends the full
 * message array per turn — and conversations are isolated from one another.
 * When an operator repeats a task in a new conversation ("show me my orders"),
 * the assistant has no memory of what it fetched last time and re-calls the
 * same tools from scratch, paying for the same data twice.
 *
 * This table stores a compact, domain-keyed snapshot of what each assistant
 * turn actually found: which entity ids were touched and a one-line summary.
 * Before the next `streamText` call, the chat route reads the recent entries
 * for the active domains and injects them as a `## Prior context` block in the
 * system prompt, so the model can decide "I already have this — I don't need
 * to re-fetch" instead of blindly re-tool-calling.
 *
 * One row per (principal_id, surface, domain) — upserted on each turn that
 * touches that domain. The most recent context wins; older context is
 * overwritten, which keeps the table thin and the injection predictable.
 */
const AssistantContextCache = model
  .define("assistant_context_cache", {
    id: model.id().primaryKey(),

    // The admin user_id or partner_id this context belongs to.
    principal_id: model.text().searchable(),

    // Which assistant surface: "admin" | "partner".
    surface: model.text(),

    // The tool domain this context covers: "orders", "catalog", "production",
    // etc. Matches the domain vocabulary from the tool-slice modules.
    domain: model.text(),

    // Entity ids touched in this domain (order_..., prod_..., design_...).
    // Stored as a JSON array — thin by design, never the full tool results.
    entity_ids: model.json(),

    // A compact (1-3 line) summary of what was found, e.g.
    // "5 orders found. Most recent: order_abc (₹2,500). Statuses: 2 pending, 3 completed."
    summary: model.text(),

    // The conversation that last updated this entry, for traceability and
    // cleanup. Nullable because the first turn of a new conversation has no id.
    conversation_id: model.text().nullable(),
  })
  .indexes([
    {
      on: ["principal_id", "surface", "domain"],
      unique: true,
    },
    {
      on: ["principal_id", "surface"],
    },
  ])

export default AssistantContextCache

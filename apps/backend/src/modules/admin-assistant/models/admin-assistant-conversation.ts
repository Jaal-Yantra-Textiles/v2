import { model } from "@medusajs/framework/utils"

/**
 * A saved admin-assistant conversation (#1092 — chat history).
 *
 * The `/admin/assistant/chat` endpoint is stateless (the client sends the full
 * message array each turn), so history lives here: one row per saved
 * conversation, the whole AI-SDK UIMessage array persisted as `messages`. The
 * admin user IS the auth actor (auth_context.actor_id = user_id), so scoping is
 * per-user — every route filters by the authenticated user's id.
 *
 * `messages` mirrors the shape the chat transport sends/receives:
 *   [{ id, role: 'user'|'assistant'|'system', parts: [{ type, text, ... }] }]
 * Persisted verbatim (client-driven) after each completed stream, so reopening a
 * conversation replays it exactly and continues the thread.
 *
 * Mirrors the partner-assistant conversation model so both assistants share one
 * persistence shape.
 */
const AdminAssistantConversation = model
  .define("admin_assistant_conversation", {
    id: model.id().primaryKey(),

    // The admin user this conversation belongs to (auth actor id).
    user_id: model.text().searchable(),

    // Human-readable label shown in the history sidebar. Seeded from the first
    // user message client-side; editable.
    title: model.text().default("New chat"),

    // The AI-SDK UIMessage array (see doc-comment). Empty for a fresh chat.
    // `model.json()` types as an object; the array is stored/read at runtime and
    // the service always writes a value (defaulting to []), with the DB-level
    // default '[]' from the migration as the backstop.
    messages: model.json(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["user_id"],
    },
  ])

export default AdminAssistantConversation

import { model } from "@medusajs/framework/utils"

/**
 * A saved partner-portal assistant conversation (#338 item 2 — chat history).
 *
 * The `/partners/assistant/chat` endpoint is stateless (the client sends the
 * full message array each turn), so history lives here: one row per saved
 * conversation, the whole AI-SDK UIMessage array persisted as `messages`. The
 * partner IS the auth actor (auth_context.actor_id = partner_id), so scoping is
 * per-partner — every route filters by the authenticated partner's id.
 *
 * `messages` mirrors the shape the chat transport sends/receives:
 *   [{ id, role: 'user'|'assistant'|'system', parts: [{ type, text, ... }] }]
 * Persisted verbatim (client-driven) after each completed stream, so reopening a
 * conversation replays it exactly and continues the thread.
 */
const PartnerAssistantConversation = model
  .define("partner_assistant_conversation", {
    id: model.id().primaryKey(),

    // The partner this conversation belongs to (auth actor id).
    partner_id: model.text().searchable(),

    // Human-readable label shown in the history sidebar. Seeded from the first
    // user message client-side; editable.
    title: model.text().default("New chat"),

    // The AI-SDK UIMessage array (see doc-comment). Empty for a fresh chat.
    messages: model.json().default([]),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["partner_id"],
    },
  ])

export default PartnerAssistantConversation

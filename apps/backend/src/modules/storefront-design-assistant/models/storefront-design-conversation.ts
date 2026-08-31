import { model } from "@medusajs/framework/utils"

/**
 * A saved storefront design-assistant conversation.
 *
 * Mirror of `admin_assistant_conversation` (#1092) for the shop's chat-based
 * design editor: the `/store/ai/chat` endpoint is stateless (the client sends
 * the full message array each turn), so thread history lives here — one row
 * per saved conversation, the whole AI-SDK UIMessage array persisted verbatim
 * in `messages`. Reopening a thread replays it exactly and continues it.
 *
 * Scoping differs from the admin mirror: the design chat is public and gated
 * on the maker's EMAIL (no login — designs create guest customers by email on
 * first generation). So threads scope by normalised `customer_email`, NOT an
 * auth actor id. Rows additionally carry a typed `design_id` (nullable — the
 * design row is created at first generation, so pre-generation threads have
 * none) and a `thread_key` (the base-product scope the storefront threads on:
 * `product:{id}` or `custom`) so resume matches the client's thread keys.
 */
const StorefrontDesignConversation = model
  .define("storefront_design_conversation", {
    id: model.id().primaryKey(),

    // Normalised maker email (the flow's gate). Scopes every read/write.
    customer_email: model.text().searchable(),

    // Design the thread produced/edits. Nullable: threads start before the
    // design row exists (design is created upon first image generation).
    design_id: model.text().nullable(),

    // Base-product scope key matching the storefront thread keys
    // (`product:{id}` or `custom`) so a reopen matches the client's thread.
    thread_key: model.text().searchable(),

    // Human-readable label shown in the thread list. Seeded from the first
    // user message client-side.
    title: model.text().default("New chat"),

    // The AI-SDK UIMessage array, persisted verbatim (client-driven) after
    // each completed stream. json column types as an object; the array is
    // stored/read at runtime (DB default '[]' is the backstop).
    messages: model.json(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["customer_email", "thread_key"],
    },
    {
      on: ["design_id"],
    },
  ])

export default StorefrontDesignConversation

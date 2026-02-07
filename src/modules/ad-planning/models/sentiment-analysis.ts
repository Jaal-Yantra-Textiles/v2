import { model } from "@medusajs/framework/utils"

/**
 * SentimentAnalysis
 *
 * Caches AI-analyzed sentiment for feedback, comments, form responses, and social mentions.
 * Stores sentiment score, label, and extracted entities.
 */
const SentimentAnalysis = model.define("SentimentAnalysis", {
  id: model.id().primaryKey(),

  // Source reference
  source_type: model.enum([
    "feedback",        // From feedback module
    "form_response",   // From forms module
    "social_mention",  // From socials module
    "social_comment",  // Comments on social posts
    "review"           // Product reviews
  ]),
  source_id: model.text(), // ID of the source record

  // Original text (for reference)
  original_text: model.text().nullable(),
  text_hash: model.text().nullable(), // For deduplication

  // Sentiment scores
  sentiment_score: model.float(), // -1 (negative) to 1 (positive)
  sentiment_label: model.enum([
    "very_negative",
    "negative",
    "neutral",
    "positive",
    "very_positive",
    "mixed"
  ]).default("neutral"),

  // Confidence
  confidence: model.float().default(1.0), // 0 to 1

  // Extracted data (JSON)
  keywords: model.json().nullable(), // Array of key phrases
  entities: model.json().nullable(), // Named entities (people, products, etc.)
  topics: model.json().nullable(), // Topic classifications
  emotions: model.json().nullable(), // Detected emotions { "joy": 0.8, "anger": 0.1 }

  // AI model info
  model_provider: model.text().default("openai"), // openai, anthropic, etc.
  model_version: model.text().nullable(),

  // Processing info
  analyzed_at: model.dateTime(),
  processing_time_ms: model.number().nullable(),

  // Person link (if known)
  person_id: model.text().nullable(),

  // Metadata
  metadata: model.json().nullable(),
})
.indexes([
  {
    on: ["source_type", "source_id"],
    unique: true,
    name: "idx_sentiment_source_unique",
  },
  {
    on: ["sentiment_label"],
    name: "idx_sentiment_label",
  },
  {
    on: ["analyzed_at"],
    name: "idx_sentiment_time",
  },
  {
    on: ["person_id"],
    name: "idx_sentiment_person",
  },
])

export default SentimentAnalysis

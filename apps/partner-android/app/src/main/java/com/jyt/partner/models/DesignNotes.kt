package com.jyt.partner.models

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull

/**
 * `designer_notes` is either plain text or a TipTap document saved as JSON by
 * the web editor. partner-ui renders the TipTap blocks (design-detail.tsx
 * getTipTapBlocks); here we flatten them to readable text so a partner never
 * sees the raw JSON.
 */
object DesignNotes {
    private val json = Json { ignoreUnknownKeys = true }

    fun toText(raw: String?): String? {
        val trimmed = raw?.trim().orEmpty()
        if (trimmed.isEmpty()) return null
        val doc = if (trimmed.startsWith("{")) {
            runCatching { json.parseToJsonElement(trimmed) as? JsonObject }.getOrNull()
        } else null
        if (doc == null || doc.str("type") != "doc") return trimmed
        val text = blocks(doc.arr("content"), indent = "")
            .joinToString("\n")
            .replace(Regex("\n{3,}"), "\n\n")
            .trim()
        return text.ifEmpty { null }
    }

    private fun blocks(nodes: JsonArray?, indent: String): List<String> =
        nodes.orEmpty().mapNotNull { (it as? JsonObject)?.let { n -> block(n, indent) } }

    private fun block(node: JsonObject, indent: String): String? = when (node.str("type")) {
        "paragraph", "heading" -> indent + inline(node.arr("content"))
        "bulletList" -> listItems(node, indent) { "• " }
        "orderedList" -> {
            val start = (node.obj("attrs")?.get("start") as? JsonPrimitive)?.intOrNull ?: 1
            listItems(node, indent) { i -> "${start + i}. " }
        }
        "taskList" -> listItems(node, indent) { "☐ " }
        "blockquote" -> blocks(node.arr("content"), "$indent> ").joinToString("\n")
        "codeBlock" -> inline(node.arr("content"))
        "horizontalRule" -> "$indent———"
        else -> node.arr("content")?.let { blocks(it, indent).joinToString("\n") }
    }

    private fun listItems(list: JsonObject, indent: String, marker: (Int) -> String): String =
        list.arr("content").orEmpty().mapIndexedNotNull { i, item ->
            val lines = blocks((item as? JsonObject)?.arr("content"), "$indent   ")
                .flatMap { it.split("\n") }
                .filter { it.isNotBlank() }
            if (lines.isEmpty()) null
            else (indent + marker(i) + lines.first().trimStart() + lines.drop(1).joinToString("") { "\n$it" })
        }.joinToString("\n")

    private fun inline(nodes: JsonArray?): String = nodes.orEmpty().joinToString("") { el ->
        val n = el as? JsonObject ?: return@joinToString ""
        when (n.str("type")) {
            "text" -> n.str("text").orEmpty()
            "hardBreak" -> "\n"
            "mention" -> n.obj("attrs")?.str("label") ?: n.obj("attrs")?.str("id").orEmpty()
            else -> inline(n.arr("content"))
        }
    }

    private fun JsonObject.str(key: String): String? =
        (this[key] as? JsonPrimitive)?.contentOrNull
    private fun JsonObject.arr(key: String): JsonArray? = this[key] as? JsonArray
    private fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject
}

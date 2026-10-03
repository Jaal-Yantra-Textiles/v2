package com.jyt.partner.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * #2271 — which sizes/colours a completed run made. The Android twin of
 * partner-ui's `lib/completion-split.ts`.
 *
 * The run's snapshot states the sizes and colours it was commissioned for. When
 * it states several, the backend refuses Complete unless the partner says how
 * many of each were made (or the run's plan already adds up to the good units),
 * so the goods reach stock as the right variant. The backend re-checks all of
 * this (`workflows/production-runs/lib/run-output.ts`); this only decides what
 * the sheet shows and sends.
 */

@Serializable
data class OutputLine(
    @SerialName("size_label") val sizeLabel: String? = null,
    val color: String? = null,
    val quantity: Double = 0.0,
)

data class SplitAxes(val sizes: List<String>, val colors: List<String>)

data class SplitCombo(val sizeLabel: String?, val color: String?) {
    val key: String get() = "${sizeLabel ?: ""}\u0000${color ?: ""}"
    val label: String get() = listOfNotNull(sizeLabel, color).joinToString(" · ")
}

sealed interface SplitPlan {
    data object NotNeeded : SplitPlan
    data class Needed(val lines: List<OutputLine>, val total: Double, val target: Double) : SplitPlan {
        val ok: Boolean get() = total == target
    }
}

object CompletionSplit {
    private fun clean(v: String?): String = v?.trim().orEmpty()

    private fun JsonElement?.field(name: String): JsonElement? = (this as? JsonObject)?.get(name)
    private fun JsonElement?.text(): String? = (this as? JsonPrimitive)?.contentOrNull
    private fun JsonElement?.list(): List<JsonElement> = (this as? JsonArray)?.toList().orEmpty()

    private fun names(snapshot: JsonElement?, list: String, key: String): List<String> =
        snapshot.field(list).list().map { clean(it.field(key).text()) }.filter { it.isNotEmpty() }.distinct()

    /** The sizes and colour names the run's snapshot states, in stated order. */
    fun axes(run: ProductionRun?): SplitAxes = SplitAxes(
        sizes = names(run?.snapshot, "size_sets", "size_label"),
        colors = names(run?.snapshot, "colors", "name"),
    )

    /** The run's planned_output lines, skipping anything malformed. */
    fun planned(run: ProductionRun?): List<OutputLine> = run?.plannedOutput.list().mapNotNull { line ->
        val q = (line.field("quantity") as? JsonPrimitive)?.let { it.doubleOrNull ?: it.contentOrNull?.toDoubleOrNull() }
            ?: return@mapNotNull null
        OutputLine(line.field("size_label").text(), line.field("color").text(), q)
    }

    /** Does this run need the partner to say which combinations were made? */
    fun needed(axes: SplitAxes): Boolean = axes.sizes.size > 1 || axes.colors.size > 1

    /** Every size × colour combination the run is for, one row each. */
    fun combos(axes: SplitAxes): List<SplitCombo> {
        val sizes: List<String?> = axes.sizes.ifEmpty { listOf(null) }
        val colors: List<String?> = axes.colors.ifEmpty { listOf(null) }
        return sizes.flatMap { s -> colors.map { c -> SplitCombo(s, c) } }
    }

    /**
     * Starting quantities: the run's plan when it adds up to [target] (the good
     * units). Otherwise blank — a plan for 3 on a run that made 2 says nothing
     * about which 2.
     */
    fun initial(run: ProductionRun?, axes: SplitAxes, target: Double): Map<String, String> {
        val planned = planned(run)
        val values = mutableMapOf<String, String>()
        if (planned.isNotEmpty() && planned.sumOf { it.quantity } == target) {
            planned.forEach { line ->
                val combo = SplitCombo(clean(line.sizeLabel).ifEmpty { null }, clean(line.color).ifEmpty { null })
                values[combo.key] = formatQty(line.quantity)
            }
        }
        combos(axes).forEach { values.putIfAbsent(it.key, "") }
        return values
    }

    /** What to send as `produced_output`, and whether it adds up to [target]. */
    fun plan(axes: SplitAxes, values: Map<String, String>, target: Double): SplitPlan {
        if (!needed(axes)) return SplitPlan.NotNeeded
        val lines = combos(axes).mapNotNull { c ->
            val q = values[c.key]?.trim()?.toDoubleOrNull() ?: 0.0
            if (q > 0) OutputLine(c.sizeLabel, c.color, q) else null
        }
        return SplitPlan.Needed(lines, lines.sumOf { it.quantity }, target)
    }

    fun formatQty(q: Double): String = if (q % 1.0 == 0.0) q.toLong().toString() else q.toString()
}

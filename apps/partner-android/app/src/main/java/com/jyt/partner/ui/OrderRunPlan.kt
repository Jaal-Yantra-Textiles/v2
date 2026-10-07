package com.jyt.partner.ui

import com.jyt.partner.models.ProductionRun
import kotlinx.coroutines.CancellationException

// An order can carry several designs, each with its own run. The order
// screen used to act on runs.firstOrNull { open } — one run, unnamed — so a
// partner who slid "Accept" accepted ONE design and thought it was the
// order. These rules drive the per-design cards and the "all designs" sheet.

/** Plural label for the "all designs" sheet. */
val RunAction.bulkLabel: String
    get() = when (this) {
        RunAction.ACCEPT -> "Accept all"
        RunAction.START -> "Start all"
        RunAction.FINISH -> "Finish all"
        RunAction.COMPLETE -> "Complete all"
    }

/** Short label for the button on one design's card. */
val RunAction.shortLabel: String
    get() = when (this) {
        RunAction.ACCEPT -> "Accept"
        RunAction.START -> "Start"
        RunAction.FINISH -> "Finish"
        RunAction.COMPLETE -> "Complete"
    }

fun ProductionRun.isOpen(): Boolean = status != "completed" && status != "cancelled"

/** More than one run → one card per run, each with its own action. */
fun isMultiRun(runs: List<ProductionRun>): Boolean = runs.size > 1

/** Each action some run owes, with the runs that owe it, in lifecycle order. */
fun bulkActions(runs: List<ProductionRun>): List<Pair<RunAction, List<ProductionRun>>> =
    RunAction.entries.mapNotNull { action ->
        runs.filter { nextRunAction(it) == action }
            .takeIf { it.isNotEmpty() }
            ?.let { action to it }
    }

data class BulkResult(
    val done: List<ProductionRun>,
    val failed: List<Pair<ProductionRun, String>>,
)

/** Runs [op] on each run in turn. One failure doesn't stop the rest; the
 *  partner is told exactly which designs went through and which didn't. */
suspend fun runEach(runs: List<ProductionRun>, op: suspend (ProductionRun) -> Unit): BulkResult {
    val done = mutableListOf<ProductionRun>()
    val failed = mutableListOf<Pair<ProductionRun, String>>()
    for (run in runs) {
        try {
            op(run)
            done += run
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failed += run to (e.message ?: "Something went wrong.")
        }
    }
    return BulkResult(done, failed)
}

/** The partner-facing summary of a bulk action, or null when all went through. */
fun BulkResult.failureMessage(nameOf: (ProductionRun) -> String): String? {
    if (failed.isEmpty()) return null
    val head = if (done.isEmpty()) "None went through." else "${done.size} of ${done.size + failed.size} went through."
    return head + "\n\n" + failed.joinToString("\n") { (run, msg) -> "• ${nameOf(run)}: $msg" }
}

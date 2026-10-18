package com.jyt.partner.models

/**
 * The status chips over the design orders list. GET /partners/orders cannot
 * filter on `unified_order_status.partner_status` (a link sidecar, only read),
 * so the screen loads every page and narrows in memory.
 */
enum class OrderFilter(val label: String) {
    ALL("All"),
    ONGOING("Ongoing"),
    NEW("New"),
    DONE("Done"),
    CLOSED("Closed");

    fun matches(status: WorkStatus?): Boolean = when (this) {
        // Cancelled work is hidden unless asked for (2026-10-18): only the
        // Closed chip shows it. The screen fetches it (include_cancelled) so
        // that chip has something to show.
        ALL -> status != WorkStatus.CANCELLED
        ONGOING -> status == WorkStatus.ACCEPTED || status == WorkStatus.IN_PROGRESS || status == WorkStatus.PARTIAL
        // No status yet = just handed over, same as assigned.
        NEW -> status == null || status == WorkStatus.ASSIGNED
        DONE -> status == WorkStatus.FINISHED || status == WorkStatus.COMPLETED
        CLOSED -> status == WorkStatus.DECLINED || status == WorkStatus.CANCELLED
    }

    companion object {
        fun counts(orders: List<PartnerOrder>): Map<OrderFilter, Int> =
            entries.associateWith { f -> orders.count { f.matches(it.workStatus) } }
    }
}

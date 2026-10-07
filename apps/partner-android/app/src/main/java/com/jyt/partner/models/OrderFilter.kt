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
        ALL -> true
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

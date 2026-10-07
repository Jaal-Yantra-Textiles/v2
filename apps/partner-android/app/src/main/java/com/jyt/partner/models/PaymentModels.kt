package com.jyt.partner.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlin.math.round

// Partner payments: what they've asked to be paid for (payment submissions),
// what has been paid out (internal payments), and the completed runs they can
// still claim. Contract: apps/backend/src/api/partners/payment-submissions/**
// and api/partners/[id]/payments.

@Serializable
data class PaymentSubmissionItem(
    val id: String? = null,
    @SerialName("source_type") val sourceType: String? = null,
    @SerialName("design_id") val designId: String? = null,
    @SerialName("design_name") val designName: String? = null,
    @SerialName("task_name") val taskName: String? = null,
    @SerialName("inventory_order_id") val inventoryOrderId: String? = null,
    @SerialName("inventory_order_name") val inventoryOrderName: String? = null,
    val amount: Double = 0.0,
    val quantity: Double? = null,
    @SerialName("unit_amount") val unitAmount: Double? = null,
    @SerialName("production_run_ids") val productionRunIds: List<String>? = null,
) {
    val label: String
        get() = designName ?: taskName ?: inventoryOrderName ?: inventoryOrderId ?: "Item"
}

@Serializable
data class PaymentSubmission(
    val id: String,
    /** Draft | Pending | Under_Review | Approved | Rejected | Paid */
    val status: String = "",
    @SerialName("total_amount") val totalAmount: Double = 0.0,
    val currency: String? = null,
    @SerialName("submitted_at") val submittedAt: String? = null,
    @SerialName("reviewed_at") val reviewedAt: String? = null,
    @SerialName("paid_at") val paidAt: String? = null,
    @SerialName("rejection_reason") val rejectionReason: String? = null,
    val notes: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    val items: List<PaymentSubmissionItem>? = null,
) {
    val isDraft: Boolean get() = status == "Draft"
    val isPaid: Boolean get() = status == "Paid"
    val statusLabel: String get() = status.replace('_', ' ')

    fun claimsRun(runId: String): Boolean =
        items.orEmpty().any { it.productionRunIds.orEmpty().contains(runId) }
}

@Serializable
data class PaymentSubmissionListResponse(
    @SerialName("payment_submissions") val paymentSubmissions: List<PaymentSubmission>,
    val count: Int = 0,
)

@Serializable
data class PaymentSubmissionResponse(
    @SerialName("payment_submission") val paymentSubmission: PaymentSubmission,
)

@Serializable
data class PayableRun(
    @SerialName("run_id") val runId: String,
    @SerialName("design_id") val designId: String,
    @SerialName("design_name") val designName: String? = null,
    @SerialName("completed_at") val completedAt: String? = null,
    @SerialName("payable_quantity") val payableQuantity: Double = 0.0,
    @SerialName("unit_amount") val unitAmount: Double = 0.0,
    @SerialName("unit_is_derived") val unitIsDerived: Boolean = false,
    val amount: Double = 0.0,
    /** clear | partly_billed | unknown | billed */
    @SerialName("billing_status") val billingStatus: String? = null,
    @SerialName("design_has_open_submission") val designHasOpenSubmission: Boolean = false,
)

@Serializable
data class PayableRunsResponse(
    @SerialName("payable_runs") val payableRuns: List<PayableRun> = emptyList(),
)

/** A payout made to the partner (internal_payments). */
@Serializable
data class PartnerPayment(
    val id: String,
    val amount: Double = 0.0,
    /** Pending | Processing | Completed | Failed | Cancelled */
    val status: String? = null,
    @SerialName("payment_type") val paymentType: String? = null,
    @SerialName("payment_date") val paymentDate: String? = null,
    @SerialName("currency_code") val currencyCode: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
)

@Serializable
data class PartnerPaymentsResponse(
    val payments: List<PartnerPayment> = emptyList(),
    val count: Int = 0,
)

@Serializable
data class RateBand(val quantity: Double, @SerialName("unit_amount") val unitAmount: Double)

/** POST /partners/payment-submissions — runs only from the app; nulls are omitted. */
@Serializable
data class CreatePaymentSubmissionBody(
    @SerialName("design_ids") val designIds: List<String>,
    val notes: String? = null,
    @SerialName("production_run_ids") val productionRunIds: Map<String, List<String>>? = null,
    val quantities: Map<String, Double>? = null,
    @SerialName("unit_amounts") val unitAmounts: Map<String, Double>? = null,
    @SerialName("cost_overrides") val costOverrides: Map<String, Double>? = null,
    @SerialName("rate_breakdown") val rateBreakdown: Map<String, List<RateBand>>? = null,
)

@Serializable
data class SubmitPaymentBody(val notes: String? = null)

/**
 * The web create screen's money rules (partner-ui payment-submission-create.tsx
 * + lib/payment-submission-money.ts), ported for runs. The app never lets a
 * partner type a rate or quantity, so every "hasTypedRate" there is false here.
 */
object PaymentClaim {
    private fun cents(v: Double) = round(v * 100) / 100

    /** Why a run can't be picked, or null. `partly_billed` is NOT a block (#1596). */
    fun blockedReason(run: PayableRun): String? = when {
        run.billingStatus == "billed" -> "Already paid"
        run.designHasOpenSubmission -> "This design is already in an open request"
        else -> null
    }

    /** An agreed TOTAL already billed against: only a typed price can bill the rest. */
    fun needsTypedPrice(run: PayableRun): Boolean =
        run.unitIsDerived && run.billingStatus == "partly_billed"

    private fun billsVerbatimTotal(run: PayableRun): Boolean =
        run.unitIsDerived && run.billingStatus != "partly_billed"

    /** What this run bills (runLineAmount with no typed rate). */
    fun lineAmount(run: PayableRun): Double = when {
        needsTypedPrice(run) -> 0.0
        billsVerbatimTotal(run) -> run.amount
        else -> cents(run.payableQuantity * run.unitAmount)
    }

    /** Selectable in the app: not blocked, and bills something without a typed price. */
    fun canClaim(run: PayableRun): Boolean =
        blockedReason(run) == null && lineAmount(run) > 0 && run.payableQuantity > 0

    /** Merges equal rates, sorted by rate; null under two distinct rates. */
    fun rateBands(entries: List<RateBand>): List<RateBand>? {
        val byRate = linkedMapOf<Double, Double>()
        for (e in entries) {
            if (e.quantity <= 0 || e.unitAmount <= 0) continue
            byRate[e.unitAmount] = (byRate[e.unitAmount] ?: 0.0) + e.quantity
        }
        if (byRate.size < 2) return null
        return byRate.entries.sortedBy { it.key }.map { RateBand(cents(it.value), it.key) }
    }

    /**
     * One line per DESIGN: runs of a design collapse, quantities SUMMED. A
     * total-priced design goes on `cost_overrides` (never `unit_amounts`, which
     * the server would multiply); one rate on `unit_amounts`; mixed rates as
     * `rate_breakdown` bands instead of the total, never both.
     */
    fun build(selected: List<PayableRun>, notes: String?): CreatePaymentSubmissionBody {
        val runIds = linkedMapOf<String, MutableList<String>>()
        val quantities = linkedMapOf<String, Double>()
        val totals = linkedMapOf<String, Double>()
        val rates = linkedMapOf<String, MutableSet<Double>>()
        val priced = linkedMapOf<String, MutableList<RateBand>>()
        val verbatim = mutableSetOf<String>()

        for (run in selected) {
            val d = run.designId
            runIds.getOrPut(d) { mutableListOf() } += run.runId
            quantities[d] = (quantities[d] ?: 0.0) + run.payableQuantity
            totals[d] = (totals[d] ?: 0.0) + lineAmount(run)
            rates.getOrPut(d) { mutableSetOf() } += run.unitAmount
            priced.getOrPut(d) { mutableListOf() } += RateBand(run.payableQuantity, run.unitAmount)
            if (billsVerbatimTotal(run)) verbatim += d
        }

        val unitAmounts = linkedMapOf<String, Double>()
        val costOverrides = linkedMapOf<String, Double>()
        val breakdown = linkedMapOf<String, List<RateBand>>()
        for ((d, rs) in rates) {
            when {
                d in verbatim -> costOverrides[d] = cents(totals.getValue(d))
                rs.size == 1 -> unitAmounts[d] = rs.first()
                else -> rateBands(priced.getValue(d))?.let { breakdown[d] = it }
                    ?: run { costOverrides[d] = cents(totals.getValue(d)) }
            }
        }

        return CreatePaymentSubmissionBody(
            designIds = runIds.keys.toList(),
            notes = notes?.takeIf { it.isNotBlank() },
            productionRunIds = runIds.takeIf { it.isNotEmpty() },
            quantities = quantities.takeIf { it.isNotEmpty() },
            unitAmounts = unitAmounts.takeIf { it.isNotEmpty() },
            costOverrides = costOverrides.takeIf { it.isNotEmpty() },
            rateBreakdown = breakdown.takeIf { it.isNotEmpty() },
        )
    }
}

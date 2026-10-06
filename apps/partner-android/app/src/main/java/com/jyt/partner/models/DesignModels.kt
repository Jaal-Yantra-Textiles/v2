package com.jyt.partner.models

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive

// Design + production-run models — the Kotlin mirror of the iOS app's
// DesignModels.swift and the backend /partners/designs + /partners/production-runs
// surfaces.

@Serializable
data class PartnerDesignRow(
    val id: String,
    val name: String? = null,
    val status: String? = null,
    @SerialName("thumbnail_url") val thumbnailUrl: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
    @SerialName("partner_info") val partnerInfo: PartnerInfo? = null,
    /** owned | assigned | shared — derived server-side, never re-derived here. */
    @SerialName("partner_engagement") val partnerEngagement: String? = null,
    @SerialName("has_partner_run") val hasPartnerRun: Boolean? = null,
    @SerialName("partner_run_count") val partnerRunCount: Int? = null,
)

@Serializable
data class PartnerDesignListResponse(
    val designs: List<PartnerDesignRow>,
    val count: Int,
    val limit: Int,
    val offset: Int,
)

/// The partner_status block both design routes emit — derived entirely from
/// the partner's production runs on the design.
@Serializable
data class PartnerInfo(
    @SerialName("partner_status") val partnerStatus: String? = null,
    @SerialName("partner_phase") val partnerPhase: String? = null,
    @SerialName("partner_started_at") val partnerStartedAt: String? = null,
    @SerialName("partner_finished_at") val partnerFinishedAt: String? = null,
    @SerialName("partner_completed_at") val partnerCompletedAt: String? = null,
    @SerialName("workflow_tasks_count") val workflowTasksCount: Int? = null,
)

/** media_files json on the design: `[{id?, url, isThumbnail?}]`. */
@Serializable
data class MediaFile(
    val id: String? = null,
    val url: String,
    @SerialName("isThumbnail") val isThumbnail: Boolean? = null,
)

/** An Excalidraw moodboard scene, kept loose — only the embedded images. */
@Serializable
data class MoodboardScene(
    val elements: List<Element>? = null,
    val files: Map<String, File>? = null,
) {
    @Serializable
    data class Element(val type: String? = null, @SerialName("fileId") val fileId: String? = null)

    @Serializable
    data class File(@SerialName("dataURL") val dataUrl: String? = null)

    /** (key, dataURL) pairs for every image element on the board. */
    val imageDataUrls: List<Pair<String, String>>
        get() = elements.orEmpty().mapNotNull { element ->
            val key = element.fileId ?: return@mapNotNull null
            val data = files?.get(key)?.dataUrl ?: return@mapNotNull null
            if (element.type == "image") key to data else null
        }
}

/**
 * One board from `GET /partners/designs/:id/moodboards` (#2017). Boards are rows
 * now; the old single `design.moodboard` blob is only a fallback the server
 * folds in (`is_legacy`).
 */
@Serializable
data class MoodboardBoard(
    val id: String,
    @SerialName("owner_type") val ownerType: String? = null,
    val title: String? = null,
    val scene: MoodboardScene? = null,
    @SerialName("is_own") val isOwn: Boolean = false,
    @SerialName("is_legacy") val isLegacy: Boolean = false,
)

/** `own` is this partner's board; `others` are everyone else's (the admin's core board among them), read-only. */
@Serializable
data class MoodboardBoardsResponse(
    val own: MoodboardBoard? = null,
    val others: List<MoodboardBoard> = emptyList(),
) {
    companion object {
        /**
         * Every image across the boards, own first, each picture once. Falls back
         * to the design's legacy blob when the boards call failed or holds no
         * images, so a design that was never migrated still shows its board.
         */
        fun images(boards: MoodboardBoardsResponse?, legacy: MoodboardScene?): List<String> {
            val fromBoards = boards?.let { listOfNotNull(it.own) + it.others }
                .orEmpty()
                .flatMap { board -> board.scene?.imageDataUrls.orEmpty().map { it.second } }
                .distinct()
            if (fromBoards.isNotEmpty()) return fromBoards
            return legacy?.imageDataUrls.orEmpty().map { it.second }.distinct()
        }
    }
}

@Serializable
data class DesignColorRow(
    val id: String,
    val name: String,
    @SerialName("hex_code") val hexCode: String,
    @SerialName("usage_notes") val usageNotes: String? = null,
    val order: Int? = null,
)

@Serializable
data class DesignSizeSetRow(
    val id: String,
    @SerialName("size_label") val sizeLabel: String,
    /// measurement point -> value; values may be numbers or strings.
    val measurements: Map<String, FlexibleDouble>? = null,
)

/** An inventory item linked to the design (its bill of materials). */
@Serializable
data class DesignInventoryItem(
    val id: String,
    val title: String? = null,
    val sku: String? = null,
    @SerialName("unit_of_measure") val unitOfMeasure: String? = null,
) {
    val displayName: String get() = title ?: sku ?: "Material"
}

@Serializable
data class DesignDetail(
    val id: String,
    val name: String? = null,
    val description: String? = null,
    val status: String? = null,
    @SerialName("design_type") val designType: String? = null,
    @SerialName("product_type") val productType: String? = null,
    @SerialName("concept_theme") val conceptTheme: String? = null,
    @SerialName("aesthetic_keywords") val aestheticKeywords: List<String>? = null,
    @SerialName("designer_notes") val designerNotes: String? = null,
    @SerialName("thumbnail_url") val thumbnailUrl: String? = null,
    @SerialName("media_files") val mediaFiles: List<MediaFile>? = null,
    val moodboard: MoodboardScene? = null,
    val colors: List<DesignColorRow>? = null,
    @SerialName("size_sets") val sizeSets: List<DesignSizeSetRow>? = null,
    @SerialName("inventory_items") val inventoryItems: List<DesignInventoryItem>? = null,
    @SerialName("estimated_cost") val estimatedCost: FlexibleDouble? = null,
    @SerialName("cost_currency") val costCurrency: String? = null,
    @SerialName("partner_info") val partnerInfo: PartnerInfo? = null,
    @SerialName("is_owner") val isOwner: Boolean? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
)

@Serializable
data class DesignDetailResponse(val design: DesignDetail)

@Serializable
data class UploadFile(
    val id: String? = null,
    val url: String,
)

@Serializable
data class UploadFilesResponse(val files: List<UploadFile>)

@Serializable
data class AttachMediaFile(
    val id: String? = null,
    val url: String,
    @SerialName("isThumbnail") val isThumbnail: Boolean? = null,
)

@Serializable
data class AttachMediaBody(
    @SerialName("media_files") val mediaFiles: List<AttachMediaFile>,
)

// MARK: Production runs

@Serializable
data class ProductionRun(
    val id: String,
    val status: String? = null,
    @SerialName("run_type") val runType: String? = null,
    val role: String? = null,
    /** The ORDERED quantity — a float column on the backend, and the payout
     *  multiplier for a per-piece cost. Display with formatQuantity. */
    val quantity: Double? = null,
    @SerialName("produced_quantity") val producedQuantity: Double? = null,
    /** The partner's cost, per piece or for the whole run per [costType]. */
    @SerialName("partner_cost_estimate") val partnerCostEstimate: Double? = null,
    /** "per_unit" | "total". */
    @SerialName("cost_type") val costType: String? = null,
    /** What the cost is denominated in (#1979); null → INR in the UI. */
    @SerialName("cost_currency") val costCurrency: String? = null,
    @SerialName("design_id") val designId: String? = null,
    @SerialName("accepted_at") val acceptedAt: String? = null,
    @SerialName("started_at") val startedAt: String? = null,
    @SerialName("finished_at") val finishedAt: String? = null,
    @SerialName("completed_at") val completedAt: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
    /** The sizes/colours the run was commissioned for (#2271). Kept raw and
     *  read leniently by CompletionSplit — an odd snapshot must not stop the
     *  whole run from decoding. */
    val snapshot: JsonElement? = null,
    @SerialName("planned_output") val plannedOutput: JsonElement? = null,
)

@Serializable
data class ProductionRunListResponse(
    @SerialName("production_runs") val productionRuns: List<ProductionRun>,
    val count: Int,
    val limit: Int,
    val offset: Int,
)

@Serializable
data class RunTask(
    val id: String? = null,
    val title: String? = null,
    val status: String? = null,
    val priority: String? = null,
    @SerialName("start_date") val startDate: String? = null,
    @SerialName("end_date") val endDate: String? = null,
)

@Serializable
data class ProductionRunDetail(
    @SerialName("production_run") val productionRun: ProductionRun,
    val tasks: List<RunTask>? = null,
)

/** GET /partners/production-runs/:id/cost-summary — the run's cost rollup. */
@Serializable
data class RunCostSummaryResponse(
    @SerialName("cost_summary") val costSummary: RunCostSummary,
)

@Serializable
data class RunCostSummary(
    /** Lower-cased by the backend, or null when the run never stated one. */
    val currency: String? = null,
    val quantity: Double? = null,
    @SerialName("produced_quantity") val producedQuantity: Double? = null,
    val partner: Partner? = null,
    val material: Material? = null,
    @SerialName("grand_total") val grandTotal: Double? = null,
    @SerialName("cost_per_unit") val costPerUnit: Double? = null,
) {
    @Serializable
    data class Partner(
        val estimate: Double? = null,
        @SerialName("cost_type") val costType: String? = null,
        val total: Double? = null,
    )

    @Serializable
    data class Material(val total: Double? = null)
}

// MARK: Lenient JSON scalars

/**
 * bigNumber columns and other numbers that may arrive as Double, Int, or
 * numeric String — Medusa's query.graph is inconsistent here.
 */
@Serializable(with = FlexibleDoubleSerializer::class)
class FlexibleDouble(val value: Double?)

object FlexibleDoubleSerializer : KSerializer<FlexibleDouble> {
    private val surrogate = JsonElement.serializer()
    override val descriptor: SerialDescriptor = surrogate.descriptor

    override fun serialize(encoder: Encoder, value: FlexibleDouble) {
        val v = value.value
        if (v == null) encoder.encodeNull()
        else encoder.encodeSerializableValue(surrogate, JsonPrimitive(v))
    }

    override fun deserialize(decoder: Decoder): FlexibleDouble {
        val element = decoder.decodeSerializableValue(surrogate)
        return FlexibleDouble(
            runCatching { element.jsonPrimitive.doubleOrNull }.getOrNull()
        )
    }
}

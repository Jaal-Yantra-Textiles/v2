package com.jyt.partner.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/** The tasks assigned to this partner — the /partners/assigned-tasks
 *  surface the partner-ui's Tasks pages ride on. Subtasks are the same
 *  shape (a task row with a parent id). */
@Serializable
data class PartnerTask(
    val id: String,
    val title: String? = null,
    val description: String? = null,
    val priority: String? = null,
    val status: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
    @SerialName("completed_at") val completedAt: String? = null,
    @SerialName("parent_task_id") val parentTaskId: String? = null,
    val metadata: JsonObject? = null,
    val subtasks: List<PartnerTask> = emptyList(),
    /** The run this task is done for, when it is one (#run-partner-tasks).
     *  The partner view drops the maker — a photographer sees which piece
     *  the shoot is for, not which other partner makes it. */
    @SerialName("production_run") val productionRun: TaskProductionRun? = null,
) {
    /** Metadata-driven comment thread (the comments route reads/writes the
     *  same array through metadata.comments). */
    val metadataComments: List<TaskComment>
        get() = metadata?.get("comments")?.let { element ->
            runCatching {
                kotlinx.serialization.json.Json.decodeFromJsonElement(
                    kotlinx.serialization.builtins.ListSerializer(TaskComment.serializer()),
                    element,
                )
            }.getOrNull()
        } ?: emptyList()
}

/** The trimmed run summary tasks carry. */
@Serializable
data class TaskProductionRun(
    val id: String,
    val status: String? = null,
    @SerialName("run_type") val runType: String? = null,
    val quantity: Int? = null,
    @SerialName("design_id") val designId: String? = null,
    @SerialName("design_name") val designName: String? = null,
)

@Serializable
data class PartnerTaskListResponse(
    val tasks: List<PartnerTask> = emptyList(),
    val count: Int = 0,
)

@Serializable
data class PartnerTaskDetailResponse(val task: PartnerTask)

/** accept / finish share this shape: the task as it stands + a message. */
@Serializable
data class PartnerTaskActionResponse(
    val task: PartnerTask? = null,
    val message: String? = null,
)

@Serializable
data class TaskComment(
    val id: String,
    val comment: String? = null,
    @SerialName("author_type") val authorType: String? = null,
    @SerialName("author_name") val authorName: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
)

@Serializable
data class TaskCommentsResponse(
    val comments: List<TaskComment> = emptyList(),
    val count: Int = 0,
)

@Serializable
data class AddTaskCommentBody(val comment: String)

/** The finish route's optional cost — same fields the partner-ui's finish
 *  drawer sends (actual_cost + inr currency; cost_type stays null = total). */
@Serializable
data class FinishTaskBody(
    @SerialName("actual_cost") val actualCost: Double? = null,
    @SerialName("cost_type") val costType: String? = null,
    @SerialName("cost_currency") val costCurrency: String? = null,
)

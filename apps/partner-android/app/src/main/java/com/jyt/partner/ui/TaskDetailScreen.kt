package com.jyt.partner.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jyt.partner.api.PartnerApi
import com.jyt.partner.models.ApiDate
import com.jyt.partner.models.PartnerTask
import com.jyt.partner.models.TaskComment
import com.jyt.partner.models.formatDate
import kotlinx.coroutines.launch

/** One assigned task: the same detail the partner-ui shows — status and
 *  priority, the run it is for, its subtasks (each completable), a comment
 *  thread with us, and the accept/finish moves in the slide bar. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TaskDetailScreen(taskId: String, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var task by remember { mutableStateOf<PartnerTask?>(null) }
    var comments by remember { mutableStateOf<List<TaskComment>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var refreshing by remember { mutableStateOf(false) }
    var errorText by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var acting by remember { mutableStateOf(false) }
    var showFinish by remember { mutableStateOf(false) }
    var newComment by remember { mutableStateOf("") }

    suspend fun load() {
        loading = task == null
        try {
            val api = PartnerApi.get(context)
            task = api.assignedTask(taskId)
            // The thread lives in metadata; the comments route is the
            // read-model the web reads too. Fall back to the embedded copy.
            comments = runCatching { api.taskComments(taskId).comments }.getOrNull()
                ?: task?.metadataComments.orEmpty()
            errorText = null
        } catch (e: Exception) {
            if (task == null) errorText = e.message ?: "Something went wrong."
        }
        loading = false
    }

    LaunchedEffect(taskId) { load() }

    fun act(block: suspend () -> Unit) {
        if (acting) return
        scope.launch {
            acting = true
            try {
                block()
                load()
            } catch (e: Exception) {
                actionError = e.message
            } finally {
                acting = false
            }
        }
    }

    val current = task
    val status = current?.status.orEmpty()

    androidx.compose.material3.Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Task") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
        bottomBar = {
            if (current != null && (canAcceptTask(status) || canFinishTask(status))) {
                SlideToConfirmBar(
                    text = when {
                        canAcceptTask(status) -> "Slide to accept"
                        else -> "Slide to finish"
                    },
                    enabled = !acting,
                    onSlideComplete = {
                        when {
                            canAcceptTask(status) -> act { PartnerApi.get(context).acceptTask(taskId) }
                            else -> showFinish = true
                        }
                    },
                )
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                loading -> DetailSkeleton(sections = 4)
                current == null -> Box(Modifier.fillMaxSize().padding(24.dp)) {
                    ErrorState("Couldn't load this task", errorText ?: "") {
                        scope.launch { load() }
                    }
                }
                else -> Refreshable(
                    refreshing = refreshing,
                    onRefresh = {
                        scope.launch {
                            refreshing = true
                            load()
                            refreshing = false
                        }
                    },
                ) {
                    Column(
                        Modifier
                            .fillMaxSize()
                            .verticalScroll(rememberScrollState())
                            .padding(bottom = 16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        // Header card
                        Card(
                            shape = RoundedCornerShape(16.dp),
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                        ) {
                            Column(
                                Modifier.padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        text = current.title ?: "Task",
                                        fontSize = 19.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        modifier = Modifier.weight(1f, fill = false),
                                    )
                                    Spacer(Modifier.weight(1f))
                                    StatusBadge(taskStatusLabel(status), taskStatusTone(status))
                                }
                                current.priority?.let {
                                    Text(
                                        "Priority: ${it.replaceFirstChar { c -> c.uppercase() }}",
                                        fontSize = 13.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                current.productionRun?.let { run ->
                                    Text(
                                        text = listOfNotNull(
                                            "For: ${run.designName ?: run.id}",
                                            run.quantity?.let { "$it pieces" },
                                            run.runType?.let { it.replace('_', ' ') },
                                        ).joinToString(" · "),
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.Medium,
                                    )
                                }
                            }
                        }

                        // Description
                        current.description?.takeIf { it.isNotBlank() }?.let { description ->
                            Card(
                                shape = RoundedCornerShape(16.dp),
                                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                            ) {
                                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Text("Description", fontWeight = FontWeight.SemiBold)
                                    Text(
                                        description,
                                        fontSize = 13.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }

                        // Subtasks
                        if (current.subtasks.isNotEmpty()) {
                            Card(
                                shape = RoundedCornerShape(16.dp),
                                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                            ) {
                                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                    Text("Subtasks", fontWeight = FontWeight.SemiBold)
                                    current.subtasks.sortedBy { (it.metadata?.get("order")?.toString()?.toIntOrNull()) ?: 0 }
                                        .forEach { subtask ->
                                            SubtaskRow(
                                                subtask = subtask,
                                                enabled = !acting,
                                                onComplete = {
                                                    act {
                                                        PartnerApi.get(context)
                                                            .completeTaskSubtask(taskId, subtask.id)
                                                    }
                                                },
                                            )
                                        }
                                }
                            }
                        }

                        // Comments
                        Card(
                            shape = RoundedCornerShape(16.dp),
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                        ) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                Text("Comments", fontWeight = FontWeight.SemiBold)
                                if (comments.isEmpty()) {
                                    Text(
                                        "No comments yet. Write to the JYT team here.",
                                        fontSize = 13.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                } else {
                                    comments.forEach { comment ->
                                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                            Row {
                                                Text(
                                                    text = when (comment.authorType) {
                                                        "admin" -> "JYT"
                                                        "partner" -> "You"
                                                        else -> comment.authorName ?: "Someone"
                                                    },
                                                    fontSize = 12.sp,
                                                    fontWeight = FontWeight.SemiBold,
                                                )
                                                Spacer(Modifier.weight(1f))
                                                comment.createdAt?.let {
                                                    Text(
                                                        formatDate(ApiDate.parse(it)),
                                                        fontSize = 12.sp,
                                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                    )
                                                }
                                            }
                                            Text(comment.comment ?: "", fontSize = 13.sp)
                                        }
                                    }
                                }
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    OutlinedTextField(
                                        value = newComment,
                                        onValueChange = { newComment = it },
                                        placeholder = { Text("Add a comment") },
                                        modifier = Modifier.weight(1f),
                                        maxLines = 3,
                                    )
                                    IconButton(
                                        onClick = {
                                            val text = newComment.trim()
                                            if (text.isEmpty()) return@IconButton
                                            newComment = ""
                                            act {
                                                PartnerApi.get(context).addTaskComment(taskId, text)
                                            }
                                        },
                                        enabled = newComment.isNotBlank() && !acting,
                                    ) {
                                        if (acting) {
                                            CircularProgressIndicator(Modifier.width(20.dp).height(20.dp))
                                        } else {
                                            Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send")
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Finish drawer: optional actual cost, same as the partner-ui's finish
    // form (INR, used when the task is submitted for payment).
    if (showFinish) {
        FinishTaskDialog(
            enabled = !acting,
            onDismiss = { showFinish = false },
            onConfirm = { cost ->
                showFinish = false
                act { PartnerApi.get(context).finishTask(taskId, cost) }
            },
        )
    }

    if (actionError != null) {
        AlertDialog(
            onDismissRequest = { actionError = null },
            title = { Text("Couldn't do that") },
            text = { Text(actionError ?: "") },
            confirmButton = { TextButton(onClick = { actionError = null }) { Text("OK") } },
        )
    }
}

/** pending/assigned/incoming → the partner's move is Accept (TaskActionsSection). */
internal fun canAcceptTask(status: String): Boolean =
    status == "pending" || status == "assigned" || status == "incoming"

/** accepted/in_progress (or finished again) → the move is Finish. */
internal fun canFinishTask(status: String): Boolean =
    status == "accepted" || status == "in_progress" || status == "finished"

@Composable
private fun SubtaskRow(subtask: PartnerTask, enabled: Boolean, onComplete: () -> Unit) {
    val st = subtask.status.orEmpty()
    val done = st == "completed" || st == "finished"
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    subtask.title ?: "Subtask",
                    fontSize = 14.sp,
                    fontWeight = if (done) FontWeight.Normal else FontWeight.Medium,
                    color = if (done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                )
                subtask.description?.takeIf { it.isNotBlank() }?.let {
                    Text(
                        it,
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Spacer(Modifier.width(8.dp))
            StatusBadge(taskStatusLabel(st), taskStatusTone(st))
        }
        if (!done && enabled && st in ACTIONABLE_SUBTASK_STATUSES) {
            TextButton(onClick = onComplete, enabled = enabled) {
                Icon(Icons.Filled.CheckCircle, contentDescription = null, modifier = Modifier.height(16.dp))
                Spacer(Modifier.width(4.dp))
                Text("Mark done")
            }
        }
    }
}

/** Which subtask statuses the complete route accepts. */
private val ACTIONABLE_SUBTASK_STATUSES = setOf("pending", "assigned", "in_progress", "accepted")

/** The finish confirmation with the optional INR actual cost. */
@Composable
private fun FinishTaskDialog(
    enabled: Boolean,
    onDismiss: () -> Unit,
    onConfirm: (Double?) -> Unit,
) {
    var cost by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Finish task") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("This will mark the task as finished.")
                OutlinedTextField(
                    value = cost,
                    onValueChange = { cost = it.filter { c -> c.isDigit() || c == '.' } },
                    label = { Text("Actual cost (optional)") },
                    supportingText = { Text("INR — recorded and used when you submit it for payment.") },
                    singleLine = true,
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val value = cost.toDoubleOrNull()
                    onConfirm(value?.takeIf { it > 0 })
                },
                enabled = enabled,
            ) { Text("Finish") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}

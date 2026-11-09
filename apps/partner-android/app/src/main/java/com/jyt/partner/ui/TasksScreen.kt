package com.jyt.partner.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Timeline
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jyt.partner.api.PartnerApi
import com.jyt.partner.models.ApiDate
import com.jyt.partner.models.PartnerTask
import com.jyt.partner.models.formatDate
import kotlinx.coroutines.launch

/** The tasks assigned to this partner — the individual persona's home.
 *  The same /partners/assigned-tasks list the partner-ui shows: parent
 *  tasks plus still-actionable subtasks, each with the run it is for. */
@Composable
fun TasksScreen(onOpenTask: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var tasks by remember { mutableStateOf<List<PartnerTask>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var refreshing by remember { mutableStateOf(false) }
    var errorText by remember { mutableStateOf<String?>(null) }
    var showDone by remember { mutableStateOf(false) }

    suspend fun load() {
        loading = tasks.isEmpty()
        try {
            tasks = PartnerApi.get(context).assignedTasks().tasks
            errorText = null
        } catch (e: Exception) {
            if (tasks.isEmpty()) errorText = e.message ?: "Something went wrong."
        }
        loading = false
    }

    LaunchedEffect(Unit) { load() }

    Column(modifier = Modifier.fillMaxSize()) {
        // The tab's own header — this screen sits inside MainScaffold.
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 4.dp),
        ) {
            Text("Tasks", fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.weight(1f))
            FilterChip(
                selected = showDone,
                onClick = { showDone = !showDone },
                label = { Text(if (showDone) "All" else "Active") },
            )
        }

        val visible = tasks.filter { showDone || it.status !in DONE_STATUSES }

        if (errorText != null) {
            Box(Modifier.fillMaxSize()) {
                ErrorState("Couldn't load tasks", errorText ?: "") { scope.launch { load() } }
            }
        } else if (loading) {
            ListSkeleton(rows = 5, thumb = false)
        } else if (visible.isEmpty()) {
            Box(Modifier.fillMaxSize()) {
                EmptyState(
                    icon = Icons.Filled.Timeline,
                    title = if (showDone) "No tasks" else "Nothing to do",
                    subtitle = "Work the JYT team assigns to you shows up here.",
                )
            }
        } else {
            Refreshable(
                refreshing = refreshing,
                onRefresh = {
                    scope.launch {
                        refreshing = true
                        load()
                        refreshing = false
                    }
                },
            ) {
                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    items(visible, key = { it.id }) { task ->
                        TaskRow(task) { onOpenTask(task.id) }
                    }
                }
            }
        }
    }
}

/** completed/cancelled are hidden by default, like the partner-ui's
 *  EXCLUDED_TASK_STATUSES. */
private val DONE_STATUSES = setOf("completed", "cancelled")

/** A task row's tone: waiting on you, under way, done, stopped. */
internal fun taskStatusTone(status: String): BadgeTone = when (status) {
    "pending", "assigned", "incoming" -> BadgeTone.ACTION
    "accepted", "in_progress", "finished" -> BadgeTone.ACTIVE
    "completed" -> BadgeTone.DONE
    else -> BadgeTone.MUTED
}

/** "in_progress" → "In progress" — the same label shape the other badges use. */
internal fun taskStatusLabel(status: String): String =
    status.replace('_', ' ').replaceFirstChar { it.uppercase() }

@Composable
private fun TaskRow(task: PartnerTask, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 5.dp),
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = task.title ?: "Task",
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Spacer(Modifier.weight(1f))
                task.status?.let { status ->
                    StatusBadge(taskStatusLabel(status), taskStatusTone(status))
                }
            }
            task.description?.takeIf { it.isNotBlank() }?.let {
                Text(
                    text = it,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                task.priority?.let { StatPair("Priority", it) }
                task.productionRun?.designName?.let { StatPair("For", it) }
                task.updatedAt?.let {
                    StatPair(
                        "Updated",
                        formatDate(ApiDate.parse(it)),
                        alignEnd = task.productionRun?.designName == null,
                    )
                }
            }
        }
    }
}

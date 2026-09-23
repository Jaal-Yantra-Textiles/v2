package com.jyt.partner.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jyt.partner.api.PartnerApi
import com.jyt.partner.models.ApiDate
import com.jyt.partner.models.formatDate
import com.jyt.partner.models.DesignDetail
import com.jyt.partner.models.ProductionRunDetail
import com.jyt.partner.models.RunTask
import kotlinx.coroutines.launch
import java.util.Date

/** A production run — the RunDetailView counterpart: status, lifecycle
 *  timeline, tasks, the next-step banner and the same action sheets. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RunDetailScreen(
    runId: String,
    onOpenDesign: (String) -> Unit,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var detail by remember { mutableStateOf<ProductionRunDetail?>(null) }
    var design by remember { mutableStateOf<DesignDetail?>(null) }
    var loading by remember { mutableStateOf(true) }
    var errorText by remember { mutableStateOf<String?>(null) }

    var acting by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var pendingConfirm by remember { mutableStateOf<RunAction?>(null) }
    var showFinish by remember { mutableStateOf(false) }
    var showComplete by remember { mutableStateOf(false) }

    suspend fun load() {
        loading = detail == null
        try {
            val fetched = PartnerApi.get(context).productionRun(runId)
            detail = fetched
            errorText = null
            // The linked design carries the complete form's material options.
            if (design == null) {
                design = fetched.productionRun.designId
                    ?.let { runCatching { PartnerApi.get(context).design(it) }.getOrNull() }
            }
        } catch (e: Exception) {
            errorText = e.message
        }
        loading = false
    }

    LaunchedEffect(Unit) { load() }

    suspend fun run(action: RunAction, notes: String? = null, completeBody: PartnerApi.CompleteRunBody? = null) {
        if (acting) return
        acting = true
        try {
            val api = PartnerApi.get(context)
            when (action) {
                RunAction.ACCEPT -> api.acceptRun(runId)
                RunAction.START -> api.startRun(runId)
                RunAction.FINISH -> api.finishRun(runId, notes)
                RunAction.COMPLETE -> api.completeRun(runId, completeBody ?: return)
            }
            detail = null
            design = null
            load()
        } catch (e: Exception) {
            actionError = e.message
        }
        acting = false
    }

    val current = detail
    Column(modifier = Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text("Run") },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                }
            },
        )

        when {
            loading -> Box(Modifier.fillMaxSize()) {
                CircularProgressIndicator(Modifier.align(Alignment.Center))
            }
            current == null -> Box(Modifier.fillMaxSize().padding(24.dp)) {
                ErrorState("Couldn't load this run", errorText ?: "") { scope.launch { load() } }
            }
            else -> {
                val run = current.productionRun
                val nextAction = nextRunAction(run)
                val isSample = run.runType == "sample"

                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (nextAction != null) {
                        item {
                            SectionCard("Your next step") {
                                Text(nextAction.hint(isSample), fontSize = 13.sp)
                                Button(
                                    onClick = {
                                        when (nextAction) {
                                            RunAction.ACCEPT, RunAction.START -> pendingConfirm = nextAction
                                            RunAction.FINISH -> showFinish = true
                                            RunAction.COMPLETE -> showComplete = true
                                        }
                                    },
                                    enabled = !acting,
                                    modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                                ) {
                                    if (acting) {
                                        CircularProgressIndicator(Modifier.size(20.dp))
                                        Spacer(Modifier.size(8.dp))
                                    }
                                    Text(nextAction.label, fontWeight = FontWeight.SemiBold)
                                }
                            }
                        }
                    } else if (run.status == "completed") {
                        item {
                            SectionCard("") {
                                Text(
                                    "This run is complete. Nothing further is needed from you.",
                                    fontSize = 13.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    } else if (run.status == "cancelled") {
                        item {
                            SectionCard("") {
                                Text(
                                    "This run was cancelled. No action is needed.",
                                    fontSize = 13.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }

                    item {
                        SectionCard("Run") {
                            run.status?.let {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text("Status")
                                    RunStatusBadge(it)
                                }
                            }
                            run.runType?.let {
                                StatRow("Type", if (it == "sample") "Sample" else "Production")
                            }
                            run.role?.takeIf { it.isNotBlank() }?.let { StatRow("Role", it) }
                            run.quantity?.let { StatRow("Quantity", it.toString()) }
                        }
                    }

                    run.designId?.let { designId ->
                        item {
                            SectionCard("Design") {
                                ClickableRow(onClick = { onOpenDesign(designId) }) {
                                    Text("Open design")
                                    Spacer(Modifier.weight(1f))
                                    Icon(
                                        Icons.AutoMirrored.Filled.ArrowForward,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                    }

                    item {
                        SectionCard("Lifecycle") {
                            LifecycleRow("Accepted", ApiDate.parse(run.acceptedAt))
                            LifecycleRow("Started", ApiDate.parse(run.startedAt))
                            LifecycleRow("Finished", ApiDate.parse(run.finishedAt))
                            LifecycleRow("Completed", ApiDate.parse(run.completedAt))
                            LifecycleRow("Created", ApiDate.parse(run.createdAt))
                        }
                    }

                    item {
                        SectionCard("Tasks") {
                            val tasks: List<RunTask> = current.tasks.orEmpty()
                            if (tasks.isEmpty()) {
                                Text(
                                    "No tasks dispatched.",
                                    fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            } else {
                                tasks.forEach { task ->
                                    Column(Modifier.padding(vertical = 4.dp)) {
                                        Text(task.title ?: "Task", fontWeight = FontWeight.Medium)
                                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                            task.status?.let {
                                                Text(
                                                    it,
                                                    fontSize = 12.sp,
                                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                )
                                            }
                                            task.priority?.let {
                                                Text(
                                                    "· $it",
                                                    fontSize = 12.sp,
                                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                )
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
    }

    RunActionConfirmDialog(
        action = pendingConfirm,
        onConfirm = {
            val action = pendingConfirm
            pendingConfirm = null
            if (action != null) scope.launch { run(action) }
        },
        onDismiss = { pendingConfirm = null },
    )

    if (showFinish) {
        FinishRunSheet(
            pendingTasks = current?.tasks.orEmpty().filter { it.status == "pending" },
            isSample = current?.productionRun?.runType == "sample",
            onConfirm = { notes -> scope.launch { run(RunAction.FINISH, notes = notes) } },
            onDismiss = { showFinish = false },
        )
    }

    if (showComplete) {
        CompleteRunSheet(
            orderedQuantity = current?.productionRun?.quantity ?: 0,
            materials = design?.inventoryItems.orEmpty(),
            onConfirm = { body -> scope.launch { run(RunAction.COMPLETE, completeBody = body) } },
            onDismiss = { showComplete = false },
        )
    }

    if (actionError != null) {
        AlertDialog(
            onDismissRequest = { actionError = null },
            title = { Text("Action failed") },
            text = { Text(actionError ?: "") },
            confirmButton = { TextButton(onClick = { actionError = null }) { Text("OK") } },
        )
    }
}

@Composable
fun LifecycleRow(label: String, date: Date?) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(
                imageVector = if (date == null) Icons.Filled.RadioButtonUnchecked else Icons.Filled.CheckCircle,
                contentDescription = null,
                tint = if (date == null) Color.Gray else MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(18.dp),
            )
            Text(
                label,
                fontWeight = if (date == null) FontWeight.Normal else FontWeight.Medium,
            )
        }
        Text(
            text = formatDate(date).takeUnless { date == null } ?: "Not yet",
            fontSize = 12.sp,
            color = if (date == null) Color.Gray else MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

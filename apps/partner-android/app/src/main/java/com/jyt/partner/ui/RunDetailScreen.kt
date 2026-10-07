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
import androidx.compose.runtime.saveable.rememberSaveable
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
import com.jyt.partner.models.RunCostSummary
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
    onRequestPayment: (String) -> Unit,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var detail by remember { mutableStateOf<ProductionRunDetail?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var pulling by remember { mutableStateOf(false) }
    var showPaymentPrompt by remember { mutableStateOf(false) }
    var design by remember { mutableStateOf<DesignDetail?>(null) }
    // The design load used to fail silently, leaving the Complete sheet
    // without materials and no hint why.
    var designFailed by remember { mutableStateOf(false) }
    var costSummary by remember { mutableStateOf<RunCostSummary?>(null) }
    var loading by remember { mutableStateOf(true) }
    var errorText by remember { mutableStateOf<String?>(null) }

    var acting by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var showFinish by rememberSaveable { mutableStateOf(false) }
    var showComplete by rememberSaveable { mutableStateOf(false) }

    suspend fun loadDesign(designId: String) {
        try {
            design = PartnerApi.get(context).design(designId)
            designFailed = false
        } catch (e: Exception) {
            designFailed = true
        }
    }

    suspend fun load(reloadDesign: Boolean = false) {
        loading = detail == null
        try {
            val fetched = PartnerApi.get(context).productionRun(runId)
            detail = fetched
            errorText = null
            // The linked design carries the complete form's material options.
            if (design == null || reloadDesign) {
                fetched.productionRun.designId?.let { loadDesign(it) }
            }
            // A completed run shows what it pays; the card hides if this fails.
            costSummary = if (fetched.productionRun.status == "completed") {
                runCatching { PartnerApi.get(context).productionRunCostSummary(runId) }.getOrNull()
            } else null
        } catch (e: Exception) {
            errorText = e.message
        }
        loading = false
    }

    LaunchedEffect(Unit) { load() }

    // Re-read in place after an action: content and scroll stay, a thin bar
    // runs along the top.
    suspend fun reload() {
        refreshing = true
        try {
            load(reloadDesign = true)
            errorText?.let { if (detail != null) actionError = "Couldn't refresh: $it" }
        } finally {
            refreshing = false
        }
    }

    suspend fun run(action: RunAction, notes: String? = null, completeBody: PartnerApi.CompleteRunBody? = null) {
        if (acting) return
        // Resolve before flipping the spinner — an early return after
        // `acting = true` would wedge the action button forever.
        if (action == RunAction.COMPLETE && completeBody == null) return
        acting = true
        try {
            val api = PartnerApi.get(context)
            when (action) {
                RunAction.ACCEPT -> api.acceptRun(runId)
                RunAction.START -> api.startRun(runId)
                RunAction.FINISH -> api.finishRun(runId, notes)
                RunAction.COMPLETE -> api.completeRun(runId, requireNotNull(completeBody))
            }
            reload()
        } catch (e: Exception) {
            actionError = e.message
        } finally {
            acting = false
        }
    }

    val current = detail
    val currentRun = current?.productionRun
    val nextAction = currentRun?.let { nextRunAction(it) }
    val isSample = currentRun?.runType == "sample"
    androidx.compose.material3.Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Run") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
        bottomBar = {
            val action = nextAction
            if (action != null) {
                SlideToConfirmBar(
                    text = "Slide to ${action.label.replaceFirstChar { it.lowercase() }}",
                    enabled = !acting,
                    onSlideComplete = {
                        when (action) {
                            RunAction.ACCEPT, RunAction.START -> scope.launch { run(action) }
                            RunAction.FINISH -> showFinish = true
                            RunAction.COMPLETE -> showComplete = true
                        }
                    },
                )
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                loading -> DetailSkeleton()
            current == null -> Box(Modifier.fillMaxSize().padding(24.dp)) {
                ErrorState("Couldn't load this run", errorText ?: "") { scope.launch { load() } }
            }
            else -> Refreshable(
                refreshing = pulling,
                onRefresh = {
                    scope.launch {
                        pulling = true
                        reload()
                        pulling = false
                    }
                },
            ) {
                val run = current.productionRun
                RefreshBar(refreshing && !pulling)
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (nextAction != null) {
                        item {
                            SectionCard("Your next step") {
                                Text(nextAction.hint(isSample), fontSize = 13.sp)
                                Text(
                                    "Drag the bar below to continue.",
                                    fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
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
                            run.quantity?.let { StatRow("Quantity", formatQuantity(it)) }
                            run.producedQuantity?.let { StatRow("Produced", formatQuantity(it)) }
                        }
                    }

                    costSummary?.let { summary ->
                        item { RunCostCard(summary, fallbackCurrency = run.costCurrency) }
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
                                if (designFailed) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(
                                            "Couldn't load materials",
                                            fontSize = 12.sp,
                                            color = MaterialTheme.colorScheme.error,
                                        )
                                        Text(
                                            " · ",
                                            fontSize = 12.sp,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                        TextButton(
                                            onClick = { scope.launch { loadDesign(designId) } },
                                            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 4.dp),
                                        ) { Text("Retry", fontSize = 12.sp) }
                                    }
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
    }

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
            orderedQuantity = current?.productionRun?.quantity ?: 0.0,
            materials = design?.inventoryItems.orEmpty(),
            run = current?.productionRun,
            // Throws on failure, so the sheet keeps the input and shows why.
            onSubmit = { body ->
                PartnerApi.get(context).completeRun(runId, body)
                showPaymentPrompt = true
                scope.launch { reload() }
            },
            onDismiss = { showComplete = false },
        )
    }

    if (showPaymentPrompt) {
        RequestPaymentPrompt(
            designs = 1,
            onRequest = {
                showPaymentPrompt = false
                onRequestPayment(runId)
            },
            onDismiss = { showPaymentPrompt = false },
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

/** What a completed run pays — the partner's rate, their total, and the
 *  all-in cost per piece. Only shown when the cost-summary call succeeds. */
@Composable
private fun RunCostCard(summary: RunCostSummary, fallbackCurrency: String?) {
    val currency = (summary.currency ?: fallbackCurrency)
        ?.trim()?.takeIf { it.isNotEmpty() }?.uppercase() ?: "INR"
    val partner = summary.partner
    SectionCard("Cost") {
        partner?.estimate?.let { rate ->
            StatRow(
                "Your rate",
                formatCurrency(rate, currency) +
                    if (partner.costType == "per_unit") " per piece" else " total",
            )
        }
        partner?.total?.let { StatRow("Your total", formatCurrency(it, currency)) }
        summary.costPerUnit?.let { StatRow("Cost per piece", formatCurrency(it, currency)) }
        if (partner?.estimate == null && partner?.total == null && summary.costPerUnit == null) {
            Text(
                "No cost was recorded for this run.",
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

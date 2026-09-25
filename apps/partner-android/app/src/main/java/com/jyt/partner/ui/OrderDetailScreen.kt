package com.jyt.partner.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AddAPhoto
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.jyt.partner.api.PartnerApi
import com.jyt.partner.models.ApiDate
import com.jyt.partner.models.formatDate
import com.jyt.partner.models.DesignDetail
import com.jyt.partner.models.PartnerOrder
import com.jyt.partner.models.ProductionRun
import com.jyt.partner.models.RunTask
import kotlinx.coroutines.launch

/** A design work-order — the OrderDetailView counterpart. Leads with the
 *  BIG next-step action, opens the run lifecycle sheets, and shows the
 *  design's media with a photo/video upload. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OrderDetailScreen(
    auth: com.jyt.partner.AuthViewModel,
    orderId: String,
    onOpenRun: (String) -> Unit,
    onOpenDesign: (String) -> Unit,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var detail by remember { mutableStateOf<PartnerOrder?>(null) }
    var runs by remember { mutableStateOf<List<ProductionRun>>(emptyList()) }
    var runTasks by remember { mutableStateOf<Map<String, List<RunTask>>>(emptyMap()) }
    var design by remember { mutableStateOf<DesignDetail?>(null) }
    var loading by remember { mutableStateOf(true) }
    var errorText by remember { mutableStateOf<String?>(null) }

    var acting by remember { mutableStateOf(false) }
    var uploading by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var showFinish by rememberSaveable { mutableStateOf(false) }
    var showComplete by rememberSaveable { mutableStateOf(false) }
    var showActionMenu by remember { mutableStateOf(false) }

    suspend fun loadRuns(orderDetail: PartnerOrder?) {
        val refs = orderDetail?.productionRuns ?: return
        // One detail read per run carries BOTH the run and its tasks.
        val details = refs.mapNotNull { ref ->
            runCatching { PartnerApi.get(context).productionRun(ref.id) }.getOrNull()
        }
        runs = details.map { it.productionRun }
        runTasks = details.mapNotNull { d ->
            d.tasks?.let { d.productionRun.id to it }
        }.toMap()
    }

    suspend fun load() {
        loading = detail == null
        try {
            val fetched = PartnerApi.get(context).order(orderId)
            detail = fetched
            errorText = null
            loadRuns(fetched)
            // The linked design carries the media gallery + materials for
            // the Complete form.
            design?.let { return }
            val designId = fetched.designs?.firstOrNull()?.id
            if (designId != null) {
                design = runCatching { PartnerApi.get(context).design(designId) }.getOrNull()
            }
        } catch (e: Exception) {
            errorText = e.message
        }
        loading = false
    }

    LaunchedEffect(Unit) { load() }

    val activeRun: ProductionRun? = remember(runs) {
        runs.firstOrNull { it.status != "completed" && it.status != "cancelled" }
    }
    val nextAction = activeRun?.let { nextRunAction(it) }
    val isSample = activeRun?.runType == "sample"

    suspend fun run(action: RunAction, notes: String? = null, completeBody: PartnerApi.CompleteRunBody? = null) {
        if (acting) return
        // Resolve the target BEFORE flipping the spinner on — an early
        // return after `acting = true` would wedge the button forever.
        val runId = activeRun?.id ?: return
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
            // Re-read everything — status, runs and design media all change.
            detail = null
            design = null
            runs = emptyList()
            runTasks = emptyMap()
            load()
        } catch (e: Exception) {
            actionError = e.message
        } finally {
            acting = false
        }
    }

    // Photo picker — the library path (the camera path stays on iOS parity
    // TODO until the device test pass).
    val mediaPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia()
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            // Guard BEFORE flipping the spinner — a completed run means
            // there is no upload target, and a stuck "Uploading…" is worse
            // than a clear refusal (mirrors the iOS upload() guard).
            val runId = activeRun?.id
            if (runId == null) {
                actionError = "This order has no production run to attach media to."
                return@launch
            }
            uploading = true
            try {
                val api = PartnerApi.get(context)
                val resolver = context.contentResolver
                val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: return@launch
                val mime = resolver.getType(uri) ?: "image/jpeg"
                val name = resolver.query(uri, null, null, null, null)?.use { c ->
                    c.moveToFirst()
                    c.getString(c.getColumnIndexOrThrow(android.provider.OpenableColumns.DISPLAY_NAME))
                } ?: "upload.jpg"
                val files = api.uploadRunMedia(
                    runId,
                    listOf(PartnerApi.MediaPart(name, mime, bytes)),
                )
                api.attachRunMedia(runId, files)
                design = runCatching {
                    detail?.designs?.firstOrNull()?.id?.let { api.design(it) }
                }.getOrNull() ?: design
            } catch (e: Exception) {
                actionError = e.message
            } finally {
                uploading = false
            }
        }
    }

    val current = detail
    androidx.compose.material3.Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Order #${detail?.displayId ?: "…"}") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
        bottomBar = {
            // The next step as a slide-to-confirm bar — the deliberate drag
            // is the confirmation, so ACCEPT/START fire directly and
            // FINISH/COMPLETE open their forms.
            val action = nextAction
            if (action != null) {
                SlideToConfirmBar(
                    text = "Slide to ${action.label.replaceFirstChar { it.lowercase() }}",
                    enabled = !acting && !uploading,
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
                loading -> Box(Modifier.fillMaxSize()) {
                CircularProgressIndicator(Modifier.align(Alignment.Center))
            }
            current == null -> Box(Modifier.fillMaxSize().padding(24.dp)) {
                ErrorState(
                    title = "Couldn't load this order",
                    message = errorText ?: "Something went wrong.",
                ) { scope.launch { load() } }
            }
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                // ── Your next step ── the BIG pinned block.
                item {
                    Card(
                        shape = RoundedCornerShape(16.dp),
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                    ) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Text("Your next step", fontWeight = FontWeight.SemiBold)
                            if (nextAction != null) {
                                Text(
                                    nextAction.hint(isSample),
                                    fontSize = 13.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Text(
                                    "Drag the bar below to continue.",
                                    fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            } else {
                                OutlinedButton(
                                    onClick = {
                                        mediaPicker.launch(
                                            PickVisualMediaRequest(
                                                ActivityResultContracts.PickVisualMedia.ImageAndVideo
                                            )
                                        )
                                    },
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Icon(Icons.Filled.AddAPhoto, contentDescription = null)
                                    Spacer(Modifier.size(8.dp))
                                    Text(if (uploading) "Uploading media…" else "Add photo or video")
                                }
                            }
                        }
                    }
                }

                // ── Summary
                item {
                    SectionCard("Summary") {
                        StatRow("Order #", "#${current.displayId}")
                        StatRow("Created", formatDate(ApiDate.parse(current.createdAt)))
                        StatRow("Total", formatCurrency(current.total, current.currencyCode))
                        current.workStatus?.let { status ->
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text("Work status")
                                WorkStatusBadge(status)
                            }
                        }
                        current.paymentStatus?.takeIf { it.isNotBlank() }?.let {
                            StatRow("Payment", it.replace('_', ' '))
                        }
                        current.fulfillmentStatus?.takeIf { it.isNotBlank() }?.let {
                            StatRow("Fulfillment", it.replace('_', ' '))
                        }
                    }
                }

                // ── Designs — the loaded design gets the rich row; the
                // list summaries fill the rest WITHOUT duplicating it.
                if (!current.designs.isNullOrEmpty() || design != null) {
                    item {
                        SectionCard("Designs") {
                            design?.let { d ->
                                ClickableRow(onClick = { onOpenDesign(d.id) }) {
                                    DesignThumb(
                                        name = d.name,
                                        thumbnail = d.thumbnailUrl
                                            ?: d.mediaFiles?.firstOrNull { it.isThumbnail == true }?.url
                                            ?: d.mediaFiles?.firstOrNull()?.url,
                                        size = 44,
                                    )
                                    Spacer(Modifier.size(12.dp))
                                    Text(d.name ?: "Untitled design", fontWeight = FontWeight.SemiBold)
                                }
                            }
                            current.designs.orEmpty()
                                .filter { row -> row.id != design?.id }
                                .forEach { row ->
                                    ClickableRow(onClick = { onOpenDesign(row.id) }) {
                                        DesignThumb(name = row.name, thumbnail = row.thumbnail, size = 44)
                                        Spacer(Modifier.size(12.dp))
                                        Text(row.name ?: "Untitled design")
                                    }
                                }
                        }
                    }
                }

                // ── Items
                val items = current.items.orEmpty()
                if (items.isNotEmpty()) {
                    item {
                        SectionCard("Items") {
                            items.forEach { itemRow ->
                                Row(
                                    modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                                ) {
                                    DesignThumb(name = itemRow.title, thumbnail = itemRow.thumbnail, size = 36)
                                    Column {
                                        Text(itemRow.title ?: "Item", fontWeight = FontWeight.Medium)
                                        Text(
                                            "Qty ${itemRow.quantity} · ${formatCurrency(itemRow.total, current.currencyCode)}",
                                            fontSize = 12.sp,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                // ── Media
                item {
                    SectionCard("Media") {
                        val files = design?.mediaFiles.orEmpty()
                        if (files.isEmpty()) {
                            Text(
                                "No media yet — capture the work in progress.",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        } else {
                            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                items(files, key = { it.url }) { file ->
                                    AsyncImage(
                                        model = file.url,
                                        contentDescription = null,
                                        contentScale = ContentScale.Crop,
                                        modifier = Modifier.size(96.dp).clip(RoundedCornerShape(10.dp)),
                                    )
                                }
                            }
                        }
                        OutlinedButton(
                            onClick = {
                                mediaPicker.launch(
                                    PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)
                                )
                            },
                            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                        ) {
                            Text(if (uploading) "Uploading…" else "Upload photo or video")
                        }
                    }
                }

                // ── Production runs
                if (runs.isNotEmpty()) {
                    item {
                        SectionCard("Production runs") {
                            runs.forEach { run ->
                                ClickableRow(onClick = { onOpenRun(run.id) }) {
                                    RunStatusBadge(run.status ?: "")
                                    Spacer(Modifier.size(12.dp))
                                    Text(
                                        (run.runType?.replaceFirstChar { it.uppercase() } ?: "Run") +
                                            " · ${formatQuantity((run.quantity ?: 0).toDouble())} pcs",
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

    if (showFinish) {
        FinishRunSheet(
            // Same gate as RunDetailScreen: only genuinely pending tasks
            // count against the acknowledgement.
            pendingTasks = activeRun
                ?.let { runTasks[it.id].orEmpty() }
                .orEmpty()
                .filter { it.status == "pending" },
            isSample = isSample,
            onConfirm = { notes ->
                scope.launch { run(RunAction.FINISH, notes = notes) }
            },
            onDismiss = { showFinish = false },
        )
    }

    if (showComplete) {
        CompleteRunSheet(
            orderedQuantity = activeRun?.quantity ?: 0,
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

// ── Shared section helpers ─────────────────────────────────────────────

@Composable
fun SectionCard(title: String, content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Card(
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            content()
        }
    }
}

@Composable
fun StatRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, fontWeight = FontWeight.Medium)
    }
}

@Composable
fun ClickableRow(onClick: () -> Unit, content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    Surface(
        onClick = onClick,
        color = androidx.compose.ui.graphics.Color.Transparent,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            content = content,
        )
    }
}

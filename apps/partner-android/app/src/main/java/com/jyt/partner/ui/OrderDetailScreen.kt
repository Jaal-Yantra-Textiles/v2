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
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.runtime.key
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
import com.jyt.partner.models.resolveDesignId
import com.jyt.partner.models.RunTask
import kotlinx.coroutines.launch

/** A design work-order — the OrderDetailView counterpart. Leads with the
 *  BIG next-step action, opens the run lifecycle sheets, and shows the
 *  design's media with a photo/video upload.
 *
 *  An order with several runs (one per design) gets one card per design,
 *  each with its own action and upload, plus an "all designs" sheet —
 *  Accept / Start / Finish / Complete all — that names the designs before
 *  it acts. Every action, form and upload targets a run explicitly, and the
 *  Complete form reads THAT run's design materials. */
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
    // Every design the order's runs point at, by id (the order read itself
    // carries no design names).
    var designsById by remember { mutableStateOf<Map<String, DesignDetail>>(emptyMap()) }
    var loading by remember { mutableStateOf(true) }
    var errorText by remember { mutableStateOf<String?>(null) }

    var acting by remember { mutableStateOf(false) }
    var uploading by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    // Which run(s) a form or confirmation is for — never "whichever is first".
    var finishTargets by remember { mutableStateOf<List<ProductionRun>>(emptyList()) }
    var completeQueue by remember { mutableStateOf<List<ProductionRun>>(emptyList()) }
    var completeTotal by remember { mutableStateOf(0) }
    var completeDone by remember { mutableStateOf(0) }
    var completedRunId by remember { mutableStateOf<String?>(null) }
    var confirmAction by remember { mutableStateOf<Pair<RunAction, List<ProductionRun>>?>(null) }
    var showBulkSheet by remember { mutableStateOf(false) }
    var uploadTargetRunId by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        loading = detail == null
        try {
            val api = PartnerApi.get(context)
            val fetched = api.order(orderId)
            // One detail read per run carries BOTH the run and its tasks.
            val details = fetched.productionRuns.orEmpty().mapNotNull { ref ->
                runCatching { api.productionRun(ref.id) }.getOrNull()
            }
            val fetchedRuns = details.map { it.productionRun }
            val designIds = (fetchedRuns.mapNotNull { it.designId } +
                listOfNotNull(fetched.resolveDesignId(fetchedRuns))).distinct()
            // The designs carry the media gallery + the materials for Complete.
            designsById = designIds.mapNotNull { id ->
                runCatching { api.design(id) }.getOrNull()?.let { id to it }
            }.toMap()
            runs = fetchedRuns
            runTasks = details.mapNotNull { d -> d.tasks?.let { d.productionRun.id to it } }.toMap()
            detail = fetched
            errorText = null
        } catch (e: Exception) {
            errorText = e.message
        }
        loading = false
    }

    LaunchedEffect(Unit) { load() }

    val multi = isMultiRun(runs)
    val activeRun: ProductionRun? = remember(runs) { runs.firstOrNull { it.isOpen() } }
    val nextAction = activeRun?.let { nextRunAction(it) }
    val isSample = activeRun?.runType == "sample"
    fun designOf(run: ProductionRun?): DesignDetail? = run?.designId?.let { designsById[it] }
    // Single-run orders: the run's own design, else the order's.
    val design: DesignDetail? = designOf(activeRun)
        ?: detail?.resolveDesignId(runs)?.let { designsById[it] }
    fun nameOf(run: ProductionRun): String = designOf(run)?.name ?: "Design"
    val bulk = remember(runs) { bulkActions(runs) }

    suspend fun apply(action: RunAction, run: ProductionRun) {
        val api = PartnerApi.get(context)
        when (action) {
            RunAction.ACCEPT -> api.acceptRun(run.id)
            RunAction.START -> api.startRun(run.id)
            else -> error("${action.name} needs its form")
        }
    }

    suspend fun reload() {
        detail = null
        runs = emptyList()
        runTasks = emptyMap()
        designsById = emptyMap()
        load()
    }

    /** Accept / Start / Finish on one or many runs; reports per design. */
    suspend fun act(action: RunAction, targets: List<ProductionRun>, notes: String? = null) {
        if (acting || targets.isEmpty()) return
        acting = true
        try {
            val result = runEach(targets) { run ->
                if (action == RunAction.FINISH) PartnerApi.get(context).finishRun(run.id, notes)
                else apply(action, run)
            }
            result.failureMessage(::nameOf)?.let { actionError = it }
            // Re-read everything — status, runs and design media all change.
            reload()
        } finally {
            acting = false
        }
    }

    fun startAction(action: RunAction, targets: List<ProductionRun>) {
        when (action) {
            RunAction.ACCEPT, RunAction.START -> scope.launch { act(action, targets) }
            RunAction.FINISH -> finishTargets = targets
            RunAction.COMPLETE -> {
                completeQueue = targets
                completeTotal = targets.size
                completeDone = 0
                completedRunId = null
            }
        }
    }

    // Photo picker — the library path (the camera path stays on iOS parity
    // TODO until the device test pass).
    val mediaPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia()
    ) { uri ->
        val targetRun = runs.firstOrNull { it.id == uploadTargetRunId } ?: activeRun
        uploadTargetRunId = null
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            // Guard BEFORE flipping the spinner — a completed run means
            // there is no upload target, and a stuck "Uploading…" is worse
            // than a clear refusal (mirrors the iOS upload() guard).
            if (targetRun == null) {
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
                    targetRun.id,
                    listOf(PartnerApi.MediaPart(name, mime, bytes)),
                )
                api.attachRunMedia(targetRun.id, files)
                // Refresh the design the photo went to.
                targetRun.designId?.let { id ->
                    runCatching { api.design(id) }.getOrNull()?.let { designsById = designsById + (id to it) }
                }
            } catch (e: Exception) {
                actionError = e.message
            } finally {
                uploading = false
            }
        }
    }

    fun pickMedia(forRun: ProductionRun?) {
        uploadTargetRunId = forRun?.id
        mediaPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
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
            if (multi) {
                // Several designs: one button opens the "all designs" sheet.
                if (bulk.isNotEmpty()) {
                    Surface(tonalElevation = 3.dp) {
                        Button(
                            onClick = { showBulkSheet = true },
                            enabled = !acting && !uploading,
                            modifier = Modifier.fillMaxWidth().padding(16.dp),
                        ) {
                            Text(if (acting) "Working…" else "Actions for all designs")
                        }
                    }
                }
            } else {
                // The next step as a slide-to-confirm bar — the deliberate drag
                // is the confirmation, so ACCEPT/START fire directly and
                // FINISH/COMPLETE open their forms.
                val action = nextAction
                val run = activeRun
                if (action != null && run != null) {
                    SlideToConfirmBar(
                        text = "Slide to ${action.label.replaceFirstChar { it.lowercase() }}",
                        enabled = !acting && !uploading,
                        onSlideComplete = { startAction(action, listOf(run)) },
                    )
                }
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
                            if (multi) {
                                val open = runs.count { it.isOpen() }
                                Text(
                                    if (open == 0) "All ${runs.size} designs in this order are done."
                                    else "This order has ${runs.size} designs, $open still open. " +
                                        "Act on one design from its card, or on several at once with " +
                                        "“Actions for all designs” below.",
                                    fontSize = 13.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            } else if (nextAction != null) {
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
                                    onClick = { pickMedia(activeRun) },
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

                if (multi) {
                    // ── One card per design's run.
                    item {
                        Text(
                            "Designs in this order · ${runs.size}",
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 15.sp,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                        )
                    }
                    items(runs, key = { it.id }) { run ->
                        DesignRunCard(
                            run = run,
                            design = designOf(run),
                            busy = acting || uploading,
                            onOpenRun = { onOpenRun(run.id) },
                            onOpenDesign = { run.designId?.let(onOpenDesign) },
                            onAction = { action ->
                                // A tap is easy to mis-hit: Accept/Start confirm
                                // first; Finish/Complete forms are their own check.
                                when (action) {
                                    RunAction.ACCEPT, RunAction.START -> confirmAction = action to listOf(run)
                                    else -> startAction(action, listOf(run))
                                }
                            },
                            onUpload = { pickMedia(run) },
                        )
                    }
                } else {
                    // ── Designs — the loaded design gets the rich row; the
                    // list summaries fill the rest WITHOUT duplicating it.
                    if (!current.designs.isNullOrEmpty() || design != null) {
                        item {
                            SectionCard("Designs") {
                                design?.let { d ->
                                    ClickableRow(onClick = { onOpenDesign(d.id) }) {
                                        DesignThumb(name = d.name, thumbnail = d.thumbOf(), size = 44)
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

                if (!multi) {
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
                                onClick = { pickMedia(activeRun) },
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
                                                " · ${formatQuantity(run.quantity ?: 0.0)} pcs",
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

    // ── "All designs" sheet: each action some design owes, with who owes it.
    if (showBulkSheet) {
        ModalBottomSheet(onDismissRequest = { showBulkSheet = false }) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 28.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text("Actions for all designs", fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                Text(
                    "Pick one; you'll see which designs it applies to before anything happens.",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 8.dp),
                )
                bulk.forEach { (action, targets) ->
                    ClickableRow(onClick = {
                        showBulkSheet = false
                        confirmAction = action to targets
                    }) {
                        Column(Modifier.weight(1f)) {
                            Text("${action.bulkLabel} (${targets.size})", fontWeight = FontWeight.Medium)
                            Text(
                                targets.joinToString(", ") { nameOf(it) },
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 2,
                            )
                        }
                    }
                }
            }
        }
    }

    // ── Which designs? Ticked by default; untick to leave one out.
    confirmAction?.let { (action, targets) ->
        var chosen by remember(action, targets) { mutableStateOf(targets.map { it.id }.toSet()) }
        AlertDialog(
            onDismissRequest = { confirmAction = null },
            title = {
                Text(
                    if (targets.size == 1) "${action.shortLabel} ${nameOf(targets.first())}?"
                    else "${action.bulkLabel}: which designs?"
                )
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        action.hint(targets.any { it.runType == "sample" }),
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (action == RunAction.COMPLETE && targets.size > 1) {
                        Text(
                            "You'll fill the completion form for each design in turn.",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (targets.size > 1) {
                        targets.forEach { run ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(
                                    checked = run.id in chosen,
                                    onCheckedChange = { on -> chosen = if (on) chosen + run.id else chosen - run.id },
                                )
                                Column {
                                    Text(nameOf(run), fontWeight = FontWeight.Medium)
                                    Text(
                                        "${run.runType?.replaceFirstChar { it.uppercase() } ?: "Run"} · " +
                                            "${formatQuantity(run.quantity ?: 0.0)} pcs",
                                        fontSize = 12.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = chosen.isNotEmpty(),
                    onClick = {
                        confirmAction = null
                        startAction(action, targets.filter { it.id in chosen })
                    },
                ) {
                    Text(if (targets.size == 1) action.shortLabel else "${action.shortLabel} ${chosen.size}")
                }
            },
            dismissButton = { TextButton(onClick = { confirmAction = null }) { Text("Cancel") } },
        )
    }

    if (finishTargets.isNotEmpty()) {
        val targets = finishTargets
        FinishRunSheet(
            // Only genuinely pending tasks count against the acknowledgement,
            // across every run being finished.
            pendingTasks = targets.flatMap { runTasks[it.id].orEmpty() }.filter { it.status == "pending" },
            isSample = targets.any { it.runType == "sample" },
            title = if (targets.size == 1) (if (multi) "Finish ${nameOf(targets.first())}" else "Mark as Finished")
                else "Finish ${targets.size} designs",
            onConfirm = { notes -> scope.launch { act(RunAction.FINISH, targets, notes) } },
            onDismiss = { finishTargets = emptyList() },
        )
    }

    // ── Complete, one design at a time. key() gives each run a fresh form,
    // so one design's quantities and cost never carry into the next.
    completeQueue.firstOrNull()?.let { run ->
        val position = completeDone + 1
        key(run.id) {
            CompleteRunSheet(
                orderedQuantity = run.quantity ?: 0.0,
                materials = designOf(run)?.inventoryItems.orEmpty(),
                run = run,
                title = when {
                    completeTotal > 1 -> "Complete $position of $completeTotal · ${nameOf(run)}"
                    multi -> "Complete ${nameOf(run)}"
                    else -> "Complete the run"
                },
                // Throws on failure, so the sheet keeps the input and shows why.
                onSubmit = { body ->
                    PartnerApi.get(context).completeRun(run.id, body)
                    completedRunId = run.id
                },
                // The sheet calls this after a successful submit too, so tell
                // "done, next design" apart from "cancelled".
                onDismiss = {
                    if (completedRunId == run.id) {
                        completeDone += 1
                        completeQueue = completeQueue.drop(1)
                        if (completeQueue.isEmpty()) scope.launch { reload() }
                    } else {
                        val left = completeQueue.size
                        completeQueue = emptyList()
                        if (completeTotal > 1) {
                            actionError = "Stopped. $completeDone of $completeTotal designs completed; " +
                                "the other $left are still open."
                        }
                        if (completeDone > 0) scope.launch { reload() }
                    }
                },
            )
        }
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

private fun DesignDetail.thumbOf(): String? =
    thumbnailUrl
        ?: mediaFiles?.firstOrNull { it.isThumbnail == true }?.url
        ?: mediaFiles?.firstOrNull()?.url

/** One design's run on a multi-design order: what it is, where it stands,
 *  its own next step, and its own photo upload. */
@Composable
private fun DesignRunCard(
    run: ProductionRun,
    design: DesignDetail?,
    busy: Boolean,
    onOpenRun: () -> Unit,
    onOpenDesign: () -> Unit,
    onAction: (RunAction) -> Unit,
    onUpload: () -> Unit,
) {
    val action = nextRunAction(run)
    Card(
        onClick = onOpenRun,
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(onClick = onOpenDesign, color = androidx.compose.ui.graphics.Color.Transparent) {
                    DesignThumb(name = design?.name, thumbnail = design?.thumbOf(), size = 56)
                }
                Spacer(Modifier.size(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        design?.name ?: "Design",
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 2,
                    )
                    Text(
                        "${run.runType?.replaceFirstChar { it.uppercase() } ?: "Run"} · " +
                            "${formatQuantity(run.quantity ?: 0.0)} pcs",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                RunStatusBadge(run.status ?: "")
            }
            design?.mediaFiles?.takeIf { it.isNotEmpty() }?.let { files ->
                LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(files.take(8), key = { it.url }) { file ->
                        AsyncImage(
                            model = file.url,
                            contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.size(56.dp).clip(RoundedCornerShape(8.dp)),
                        )
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (action != null) {
                    Button(
                        onClick = { onAction(action) },
                        enabled = !busy,
                        modifier = Modifier.weight(1f),
                    ) { Text(action.shortLabel) }
                }
                if (run.isOpen()) {
                    OutlinedButton(
                        onClick = onUpload,
                        enabled = !busy,
                        modifier = if (action == null) Modifier.weight(1f) else Modifier,
                    ) {
                        Icon(Icons.Filled.AddAPhoto, contentDescription = "Add photo or video")
                        if (action == null) {
                            Spacer(Modifier.size(8.dp))
                            Text("Add photo")
                        }
                    }
                }
            }
        }
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

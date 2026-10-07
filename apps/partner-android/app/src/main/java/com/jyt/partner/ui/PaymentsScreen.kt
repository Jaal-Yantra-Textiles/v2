package com.jyt.partner.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jyt.partner.AuthViewModel
import com.jyt.partner.api.PartnerApi
import com.jyt.partner.models.ApiDate
import com.jyt.partner.models.PartnerPayment
import com.jyt.partner.models.PayableRun
import com.jyt.partner.models.PaymentClaim
import com.jyt.partner.models.PaymentSubmission
import com.jyt.partner.models.formatDate
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private fun inr(amount: Double, currency: String? = null) =
    formatCurrency(amount, currency?.uppercase() ?: "INR")

/** Payments — what the partner has asked to be paid for, and what has been
 *  paid out. Drafts lead: the server prepares one when a run is completed
 *  with a price, and it waits on the partner to submit it.
 *
 *  With [forRunId] (arriving from a run completion) it looks for that run's
 *  draft and opens it; with none, it offers to request payment for the run. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PaymentsScreen(
    auth: AuthViewModel,
    forRunId: String?,
    onOpenSubmission: (String) -> Unit,
    onRequestPayment: (String?) -> Unit,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val state by auth.state.collectAsState()
    val partnerId = (state as? AuthViewModel.State.SignedIn)?.me?.partnerId

    var submissions by remember { mutableStateOf<List<PaymentSubmission>>(emptyList()) }
    var payouts by remember { mutableStateOf<List<PartnerPayment>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var pulling by remember { mutableStateOf(false) }
    var errorText by remember { mutableStateOf<String?>(null) }
    // The completion hand-off runs once per visit.
    var lookedForRun by rememberSaveable { mutableStateOf(forRunId == null) }

    suspend fun load() {
        try {
            val api = PartnerApi.get(context)
            submissions = api.paymentSubmissions().paymentSubmissions
            payouts = partnerId?.let { runCatching { api.partnerPayments(it).payments }.getOrNull() }.orEmpty()
            errorText = null
        } catch (e: Exception) {
            errorText = e.message ?: "Something went wrong."
        }
        loading = false
    }

    LaunchedEffect(Unit) {
        load()
        val runId = forRunId
        if (!lookedForRun && runId != null) {
            // The draft is made by a subscriber just after completion — give
            // it a few seconds to land before offering a fresh request.
            var draft = submissions.firstOrNull { it.claimsRun(runId) }
            var tries = 0
            while (draft == null && tries < 3) {
                delay(2000)
                load()
                draft = submissions.firstOrNull { it.claimsRun(runId) }
                tries++
            }
            lookedForRun = true
            if (draft != null) onOpenSubmission(draft.id) else onRequestPayment(runId)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Payments") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
        bottomBar = {
            Surface(tonalElevation = 3.dp) {
                Button(
                    onClick = { onRequestPayment(null) },
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                ) { Text("Request payment") }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                // Coming from a completion: say what the wait is for.
                !lookedForRun -> Column(
                    Modifier.align(Alignment.Center),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    CircularProgressIndicator()
                    Text(
                        "Finding this run's payment request…",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                }
                loading -> ListSkeleton(rows = 4, thumb = false)
                errorText != null && submissions.isEmpty() -> ErrorState(
                    title = "Couldn't load payments",
                    message = errorText ?: "",
                ) { scope.launch { loading = true; load() } }
                else -> Refreshable(
                    refreshing = pulling,
                    onRefresh = {
                        scope.launch {
                            pulling = true
                            load()
                            pulling = false
                        }
                    },
                ) { LazyColumn(
                    contentPadding = PaddingValues(vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    val drafts = submissions.filter { it.isDraft }
                    val rest = submissions.filterNot { it.isDraft }
                    if (drafts.isNotEmpty()) {
                        item {
                            SectionCard("Waiting for you to submit") {
                                Text(
                                    "Prepared when you completed the work. Check the amount and submit.",
                                    fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                drafts.forEach { SubmissionRow(it) { onOpenSubmission(it.id) } }
                            }
                        }
                    }
                    item {
                        SectionCard("Payment requests") {
                            if (rest.isEmpty()) {
                                Text(
                                    "No requests yet. Tap “Request payment” once work is completed.",
                                    fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            rest.forEach { SubmissionRow(it) { onOpenSubmission(it.id) } }
                        }
                    }
                    item {
                        SectionCard("Payments received") {
                            if (payouts.isEmpty()) {
                                Text(
                                    "No payments recorded yet.",
                                    fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            payouts.forEach { p ->
                                Row(
                                    modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column(Modifier.weight(1f)) {
                                        Text(inr(p.amount, p.currencyCode), fontWeight = FontWeight.SemiBold)
                                        Text(
                                            listOfNotNull(
                                                formatDate(ApiDate.parse(p.paymentDate ?: p.createdAt)),
                                                p.paymentType?.replace('_', ' '),
                                            ).joinToString(" · "),
                                            fontSize = 12.sp,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                    p.status?.let { PaymentStatusBadge(it) }
                                }
                            }
                        }
                    }
                } }
            }
        }
    }
}

@Composable
private fun SubmissionRow(s: PaymentSubmission, onClick: () -> Unit) {
    ClickableRow(onClick = onClick) {
        Column(Modifier.weight(1f)) {
            Text(inr(s.totalAmount, s.currency), fontWeight = FontWeight.SemiBold)
            val items = s.items.orEmpty()
            Text(
                listOfNotNull(
                    items.firstOrNull()?.label?.let { if (items.size > 1) "$it +${items.size - 1}" else it },
                    formatDate(ApiDate.parse(s.submittedAt ?: s.createdAt)),
                ).joinToString(" · "),
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
        }
        Spacer(Modifier.size(8.dp))
        PaymentStatusBadge(s.status)
    }
}

/** One payment request: its lines, where it stands, and — for a Draft —
 *  the Submit button. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PaymentSubmissionScreen(submissionId: String, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var submission by remember { mutableStateOf<PaymentSubmission?>(null) }
    var errorText by remember { mutableStateOf<String?>(null) }
    var notes by rememberSaveable { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var confirmSubmit by remember { mutableStateOf(false) }

    suspend fun load() {
        try {
            submission = PartnerApi.get(context).paymentSubmission(submissionId)
            errorText = null
        } catch (e: Exception) {
            errorText = e.message ?: "Something went wrong."
        }
    }
    LaunchedEffect(submissionId) { load() }

    val current = submission
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (current?.isDraft == true) "Payment request (draft)" else "Payment request") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
        bottomBar = {
            if (current?.isDraft == true) {
                Surface(tonalElevation = 3.dp) {
                    Button(
                        onClick = { confirmSubmit = true },
                        enabled = !sending,
                        modifier = Modifier.fillMaxWidth().padding(16.dp),
                    ) { Text(if (sending) "Submitting…" else "Submit for review") }
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                current == null && errorText != null -> ErrorState(
                    title = "Couldn't load this request",
                    message = errorText ?: "",
                ) { scope.launch { load() } }
                current == null -> DetailSkeleton(sections = 2)
                else -> LazyColumn(
                    contentPadding = PaddingValues(vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    item {
                        SectionCard("Summary") {
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(inr(current.totalAmount, current.currency), fontSize = 22.sp, fontWeight = FontWeight.Bold)
                                PaymentStatusBadge(current.status)
                            }
                            current.submittedAt?.let { StatRow("Submitted", formatDate(ApiDate.parse(it))) }
                            current.reviewedAt?.let { StatRow("Reviewed", formatDate(ApiDate.parse(it))) }
                            current.paidAt?.let { StatRow("Paid", formatDate(ApiDate.parse(it))) }
                            if (current.status == "Rejected") {
                                Text(
                                    "Rejected: ${current.rejectionReason ?: "no reason given"}",
                                    color = MaterialTheme.colorScheme.error,
                                    fontSize = 13.sp,
                                )
                            }
                            current.notes?.takeIf { it.isNotBlank() }?.let {
                                Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    item {
                        SectionCard("What it pays for") {
                            current.items.orEmpty().forEach { line ->
                                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                                    Column(Modifier.weight(1f)) {
                                        Text(line.label, fontWeight = FontWeight.Medium)
                                        val q = line.quantity
                                        val u = line.unitAmount
                                        if (q != null && u != null) {
                                            Text(
                                                "${formatQuantity(q)} × ${inr(u, current.currency)}",
                                                fontSize = 12.sp,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                    }
                                    Text(inr(line.amount, current.currency), fontWeight = FontWeight.SemiBold)
                                }
                            }
                        }
                    }
                    if (current.isDraft) {
                        item {
                            SectionCard("Note for the team (optional)") {
                                OutlinedTextField(
                                    value = notes,
                                    onValueChange = { notes = it },
                                    modifier = Modifier.fillMaxWidth(),
                                )
                                Text(
                                    "If the amount is wrong, don't submit — tell the team, or request payment on the partner website where you can change it.",
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

    if (confirmSubmit && current != null) {
        AlertDialog(
            onDismissRequest = { confirmSubmit = false },
            title = { Text("Submit ${inr(current.totalAmount, current.currency)} for review?") },
            text = { Text("Our team reviews it and pays it out. You can't change it from the app after this.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmSubmit = false
                    scope.launch {
                        sending = true
                        try {
                            PartnerApi.get(context).submitPaymentSubmission(current.id, notes)
                            load()
                        } catch (e: Exception) {
                            actionError = e.message
                        } finally {
                            sending = false
                        }
                    }
                }) { Text("Submit") }
            },
            dismissButton = { TextButton(onClick = { confirmSubmit = false }) { Text("Cancel") } },
        )
    }
    actionError?.let {
        AlertDialog(
            onDismissRequest = { actionError = null },
            title = { Text("Couldn't submit") },
            text = { Text(it) },
            confirmButton = { TextButton(onClick = { actionError = null }) { Text("OK") } },
        )
    }
}

/** Pick completed runs and ask to be paid for them. Amounts come from the
 *  agreed rates; the app doesn't let a partner retype them (the website does). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RequestPaymentScreen(preselectRunId: String?, onDone: () -> Unit, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var runs by remember { mutableStateOf<List<PayableRun>>(emptyList()) }
    var drafts by remember { mutableStateOf<List<PaymentSubmission>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var errorText by remember { mutableStateOf<String?>(null) }
    var selected by rememberSaveable { mutableStateOf(setOfNotNull(preselectRunId)) }
    var notes by rememberSaveable { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf(false) }

    suspend fun load() {
        try {
            val api = PartnerApi.get(context)
            runs = api.payableRuns().payableRuns
            drafts = api.paymentSubmissions().paymentSubmissions.filter { it.isDraft }
            // Only claimable runs stay ticked.
            selected = selected.filter { id -> runs.any { it.runId == id && canPick(it, drafts) } }.toSet()
            errorText = null
        } catch (e: Exception) {
            errorText = e.message ?: "Something went wrong."
        }
        loading = false
    }
    LaunchedEffect(Unit) { load() }

    val claimable = runs.filter { canPick(it, drafts) }
    val other = runs.filterNot { canPick(it, drafts) }.filter { it.billingStatus != "billed" }
    val chosen = runs.filter { it.runId in selected }
    val total = chosen.sumOf { PaymentClaim.lineAmount(it) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Request payment") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
        bottomBar = {
            Surface(tonalElevation = 3.dp) {
                Button(
                    onClick = { confirm = true },
                    enabled = chosen.isNotEmpty() && !sending,
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                ) {
                    Text(
                        when {
                            sending -> "Sending…"
                            chosen.isEmpty() -> "Pick the work to be paid for"
                            else -> "Request ${inr(total)}"
                        }
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                loading -> ListSkeleton(rows = 4, thumb = false)
                errorText != null && runs.isEmpty() -> ErrorState(
                    title = "Couldn't load your completed work",
                    message = errorText ?: "",
                ) { scope.launch { loading = true; load() } }
                claimable.isEmpty() && other.isEmpty() -> EmptyState(
                    icon = Icons.Filled.Payments,
                    title = "Nothing to request yet",
                    subtitle = "Completed runs that haven't been paid for show up here.",
                )
                else -> LazyColumn(
                    contentPadding = PaddingValues(vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (claimable.isNotEmpty()) {
                        item {
                            SectionCard("Completed work") {
                                claimable.forEach { run ->
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Checkbox(
                                            checked = run.runId in selected,
                                            onCheckedChange = { on ->
                                                selected = if (on) selected + run.runId else selected - run.runId
                                            },
                                        )
                                        Column(Modifier.weight(1f)) {
                                            Text(run.designName ?: "Design", fontWeight = FontWeight.Medium)
                                            Text(
                                                lineDescription(run),
                                                fontSize = 12.sp,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                        Text(inr(PaymentClaim.lineAmount(run)), fontWeight = FontWeight.SemiBold)
                                    }
                                }
                            }
                        }
                        item {
                            SectionCard("Note for the team (optional)") {
                                OutlinedTextField(
                                    value = notes,
                                    onValueChange = { notes = it },
                                    modifier = Modifier.fillMaxWidth(),
                                )
                            }
                        }
                    }
                    if (other.isNotEmpty()) {
                        item {
                            SectionCard("Not from the app") {
                                other.forEach { run ->
                                    Column(Modifier.padding(vertical = 4.dp)) {
                                        Text(run.designName ?: "Design", fontWeight = FontWeight.Medium)
                                        Text(
                                            whyNot(run, drafts),
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

    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Request ${inr(total)}?") },
            text = {
                Text(
                    "For ${chosen.joinToString(", ") { it.designName ?: "Design" }}. " +
                        "It goes straight to our team for review."
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirm = false
                    scope.launch {
                        sending = true
                        try {
                            PartnerApi.get(context).createPaymentSubmission(PaymentClaim.build(chosen, notes))
                            onDone()
                        } catch (e: Exception) {
                            actionError = e.message
                            load()
                        } finally {
                            sending = false
                        }
                    }
                }) { Text("Request") }
            },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } },
        )
    }
    actionError?.let {
        AlertDialog(
            onDismissRequest = { actionError = null },
            title = { Text("Couldn't send the request") },
            text = { Text(it) },
            confirmButton = { TextButton(onClick = { actionError = null }) { Text("OK") } },
        )
    }
}

/** A run already in a Draft is submitted from that draft, never claimed twice. */
private fun canPick(run: PayableRun, drafts: List<PaymentSubmission>): Boolean =
    PaymentClaim.canClaim(run) && drafts.none { it.claimsRun(run.runId) }

private fun whyNot(run: PayableRun, drafts: List<PaymentSubmission>): String = when {
    drafts.any { it.claimsRun(run.runId) } -> "Already in a draft request — submit it from Payments."
    PaymentClaim.blockedReason(run) != null -> PaymentClaim.blockedReason(run)!!
    PaymentClaim.needsTypedPrice(run) -> "Part of this was already paid; the rest needs a price. Request it on the partner website."
    else -> "No agreed price yet. Ask the team to set one, or request it on the partner website."
}

private fun lineDescription(run: PayableRun): String {
    val pieces = "${formatQuantity(run.payableQuantity)} pcs"
    val how = if (run.unitIsDerived) "agreed total" else "× ${inr(run.unitAmount)}"
    val done = run.completedAt?.let { " · completed ${formatDate(ApiDate.parse(it))}" }.orEmpty()
    return "$pieces $how$done"
}

/** Shown right after a completion: the money step follows the work step. */
@Composable
fun RequestPaymentPrompt(designs: Int, onRequest: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (designs > 1) "$designs designs completed" else "Run completed") },
        text = {
            Text(
                "Ask to be paid for this work now? If it has an agreed price, a payment request " +
                    "is already prepared — you just check it and submit."
            )
        },
        confirmButton = { TextButton(onClick = onRequest) { Text("Request payment") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Later") } },
    )
}

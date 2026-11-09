package com.jyt.partner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jyt.partner.api.PartnerApi
import com.jyt.partner.models.ApiDate
import com.jyt.partner.models.formatDate
import com.jyt.partner.models.CompleteInventoryOrderBody
import com.jyt.partner.models.InventoryOrderLine
import com.jyt.partner.models.InventoryOrderStatus
import com.jyt.partner.models.PartnerInventoryOrder
import kotlinx.coroutines.launch
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.async
import kotlin.math.roundToInt
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** An inventory order — the InventoryOrderDetailView counterpart. Leads
 *  with the next steps (start / record the delivery / mark ready / book a
 *  carrier shipment), lists the goods lines with fulfilled vs outstanding,
 *  the carrier shipments, and what charges make the order payable. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InventoryOrderDetailScreen(
    orderId: String,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var detail by remember { mutableStateOf<PartnerInventoryOrder?>(null) }
    var charges by remember { mutableStateOf<com.jyt.partner.models.InventoryOrderChargesResponse?>(null) }
    var loading by remember { mutableStateOf(true) }
    var refreshing by remember { mutableStateOf(false) }
    var pulling by remember { mutableStateOf(false) }
    var errorText by remember { mutableStateOf<String?>(null) }

    var actionError by remember { mutableStateOf<String?>(null) }
    var acting by remember { mutableStateOf(false) }
    var showStartConfirm by remember { mutableStateOf(false) }
    var showReadyConfirm by remember { mutableStateOf(false) }
    var showReceipt by remember { mutableStateOf(false) }
    var showShipment by remember { mutableStateOf(false) }

    suspend fun load() = coroutineScope {
        loading = detail == null
        try {
            val api = PartnerApi.get(context)
            val chargesCall = async { runCatching { api.inventoryOrderCharges(orderId) }.getOrNull() }
            detail = api.inventoryOrder(orderId)
            charges = chargesCall.await()
            errorText = null
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
            load()
            errorText?.let { if (detail != null) actionError = "Couldn't refresh: $it" }
        } finally {
            refreshing = false
        }
    }

    val steps: List<OrderStep> = orderSteps(detail?.statusEnum)

    // No Scaffold here: TopAppBar pads the status bar, this pads the navigation bar.
    Column(modifier = Modifier.fillMaxSize().navigationBarsPadding()) {
        TopAppBar(
            title = { Text("Inventory order") },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                }
            },
        )

        val current = detail
        when {
            loading -> DetailSkeleton()
            current == null -> Box(Modifier.fillMaxSize().padding(24.dp)) {
                ErrorState("Couldn't load this order", errorText ?: "") {
                    scope.launch { load() }
                }
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
            RefreshBar(refreshing && !pulling)
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                item {
                    SectionCard("Overview") {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text("Status")
                            current.statusEnum?.let { InventoryOrderStatusBadge(it) }
                        }
                        current.quantity?.let { StatRow("Goods ordered", formatQuantity(it)) }
                        current.outstandingQuantity.takeIf { it > 0 }?.let {
                            StatRow("Still to deliver", formatQuantity(it))
                        }
                        current.totalPrice?.let {
                            StatRow("Total", formatCurrency(it, current.currencyCode))
                        }
                        current.orderDate?.let { StatRow("Ordered", formatDate(ApiDate.parse(it))) }
                        current.expectedDeliveryDate?.let {
                            StatRow("Expected delivery", formatDate(ApiDate.parse(it)))
                        }
                        if (current.isSample == true) {
                            StatRow("Type", "Sample order")
                        }
                        StatRow("Order ID", current.id)
                    }
                }

                if (steps.isNotEmpty()) {
                    item {
                        SectionCard("Your next step") {
                            Text(
                                nextStepHint(current.statusEnum),
                                fontSize = 13.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            steps.forEachIndexed { index, step ->
                                val onClick = {
                                    when (step) {
                                        OrderStep.START -> showStartConfirm = true
                                        OrderStep.RECORD_DELIVERY -> showReceipt = true
                                        OrderStep.READY_FOR_DELIVERY -> showReadyConfirm = true
                                        OrderStep.CREATE_SHIPMENT -> showShipment = true
                                    }
                                }
                                val modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(top = if (index == 0) 6.dp else 0.dp)
                                // The first step leads; the rest are alternatives.
                                if (index == 0) {
                                    Button(onClick = onClick, enabled = !acting, modifier = modifier) {
                                        Text(step.label, fontWeight = FontWeight.SemiBold)
                                    }
                                } else {
                                    OutlinedButton(onClick = onClick, enabled = !acting, modifier = modifier) {
                                        Text(step.label)
                                    }
                                }
                            }
                        }
                    }
                }

                val lines = current.orderLines.orEmpty()
                if (lines.isNotEmpty()) {
                    item {
                        SectionCard("Goods") {
                            // One table-like block: rows separated by hairlines,
                            // not stacked cards.
                            lines.forEachIndexed { index, line ->
                                if (index > 0) {
                                    HorizontalDivider(
                                        color = MaterialTheme.colorScheme.outlineVariant,
                                        modifier = Modifier.padding(vertical = 8.dp),
                                    )
                                }
                                GoodsLineCard(line = line, currencyCode = current.currencyCode)
                            }
                        }
                    }
                }

                val shipments = current.shipments.orEmpty()
                if (shipments.isNotEmpty()) {
                    item {
                        SectionCard("Shipments") {
                            shipments.forEachIndexed { index, shipment ->
                                if (index > 0) {
                                    androidx.compose.material3.HorizontalDivider(Modifier.padding(vertical = 4.dp))
                                }
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    Text(
                                        shipment.carrier?.replaceFirstChar { it.uppercase() } ?: "Carrier",
                                        fontWeight = FontWeight.Medium,
                                    )
                                    shipment.status?.let {
                                        Text(
                                            shipmentStatusLabel(it),
                                            fontSize = 12.sp,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                                (shipment.awb ?: shipment.trackingNumber)?.takeIf { it.isNotBlank() }?.let {
                                    StatRow("AWB", it)
                                }
                                shipment.pickupScheduledDate?.takeIf { it.isNotBlank() }?.let {
                                    StatRow("Pickup", formatYmd(it))
                                }
                            }
                        }
                    }
                }

                val currentCharges = charges
                if (currentCharges != null && currentCharges.charges.isNotEmpty()) {
                    item {
                        SectionCard("Charges") {
                            currentCharges.charges.forEach { charge ->
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    Text(charge.type.replaceFirstChar { it.uppercase() })
                                    Text(
                                        formatCurrency(charge.amount, current.currencyCode),
                                        color = if ((charge.direction ?: 0) >= 0) {
                                            androidx.compose.ui.graphics.Color.Unspecified
                                        } else {
                                            MaterialTheme.colorScheme.onSurfaceVariant
                                        },
                                    )
                                }
                            }
                            currentCharges.goodsTotal?.let {
                                StatRow("Goods total", formatCurrency(it, current.currencyCode))
                            }
                            currentCharges.payableCeiling?.let {
                                StatRow("Payable up to", formatCurrency(it, current.currencyCode))
                            }
                        }
                    }
                }

                current.partnerInfo?.let { info ->
                    if (info.partnerStatus != null || info.deliveryDate != null || !info.trackingNumber.isNullOrBlank()) {
                        item {
                            SectionCard("Delivery") {
                                info.partnerStatus?.let { StatRow("Your progress", it.replaceFirstChar { c -> c.uppercase() }) }
                                info.deliveryDate?.let { StatRow("Delivery date", formatDate(ApiDate.parse(it))) }
                                info.trackingNumber?.takeIf { it.isNotBlank() }?.let {
                                    StatRow("Tracking", it)
                                }
                            }
                        }
                    }
                }
            }
            }
        }
    }

    if (showStartConfirm) {
        AlertDialog(
            onDismissRequest = { showStartConfirm = false },
            title = { Text("Start this order?") },
            text = { Text("Confirm you'll supply the goods on this order?") },
            confirmButton = {
                TextButton(
                    onClick = {
                        showStartConfirm = false
                        scope.launch {
                            acting = true
                            try {
                                PartnerApi.get(context).startInventoryOrder(orderId)
                                reload()
                            } catch (e: Exception) {
                                actionError = e.message
                            }
                            acting = false
                        }
                    },
                ) { Text("Start") }
            },
            dismissButton = { TextButton(onClick = { showStartConfirm = false }) { Text("Cancel") } },
        )
    }

    if (showReadyConfirm) {
        AlertDialog(
            onDismissRequest = { showReadyConfirm = false },
            title = { Text("Ready for delivery?") },
            text = { Text("Confirm the goods are packed and ready to hand to the carrier.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        showReadyConfirm = false
                        scope.launch {
                            acting = true
                            try {
                                PartnerApi.get(context).markInventoryOrderReadyForDelivery(orderId)
                                reload()
                            } catch (e: Exception) {
                                actionError = e.message
                            }
                            acting = false
                        }
                    },
                ) { Text("Mark ready") }
            },
            dismissButton = { TextButton(onClick = { showReadyConfirm = false }) { Text("Cancel") } },
        )
    }

    // Closing the sheet — submitted or cancelled — always clears the flag;
    // it used to stay true, so the dialog came straight back.
    if (showReceipt && detail != null) {
        DeliveryReceiptSheet(
            order = detail!!,
            onDismiss = { showReceipt = false },
            onRecorded = {
                showReceipt = false
                scope.launch { reload() }
            },
        )
    }

    if (showShipment) {
        CreateShipmentSheet(
            orderId = orderId,
            onDismiss = { showShipment = false },
            // Reload behind the sheet so the new shipment is listed by the
            // time the partner closes the confirmation.
            onCreated = { scope.launch { load() } },
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

/** One goods line on the order detail — a table row (not a card): name +
 *  unit price, a sent-vs-ordered progress bar, and the quantity stats as
 *  colored chips (the iOS app's teal/orange fragments, upgraded to carry
 *  awaiting-count and shortfall too). Rows are separated by hairlines in
 *  the Goods section. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun GoodsLineCard(line: InventoryOrderLine, currencyCode: String?) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                line.displayName,
                fontWeight = FontWeight.Medium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Text(
                formatCurrency(line.price, currencyCode),
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (line.quantity > 0.0) {
            val progress = (line.fulfilled / line.quantity).coerceIn(0.0, 1.0).toFloat()
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                LinearProgressIndicator(
                    progress = { progress },
                    modifier = Modifier
                        .weight(1f)
                        .height(6.dp)
                        .clip(RoundedCornerShape(3.dp)),
                    trackColor = MaterialTheme.colorScheme.surfaceContainerHighest,
                )
                // No "0% sent" label on a fresh line — an empty track
                // already says nothing has gone out.
                if (progress > 0f) {
                    Text(
                        "${(progress * 100).roundToInt()}% sent",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            LineStatChip("Ordered ${formatQuantity(line.quantity)}", LineStatTone.MUTED)
            if (line.fulfilled > 0) {
                LineStatChip("Sent ${formatQuantity(line.fulfilled)}", LineStatTone.SENT)
            }
            if (line.outstanding > 0) {
                LineStatChip("Outstanding ${formatQuantity(line.outstanding)}", LineStatTone.OUTSTANDING)
            }
            // #2289 — sent but not counted yet, and counted short.
            if (line.awaitingCount > 0) {
                LineStatChip("Awaiting count ${formatQuantity(line.awaitingCount)}", LineStatTone.AWAITING)
            }
            if (line.short > 0) {
                LineStatChip("Short ${formatQuantity(line.short)}", LineStatTone.SHORT)
            }
        }
    }
}

/** What a quantity chip means — muted for the plan, color for the states
 *  that need attention at a glance (the badge-tone rule, applied to stats). */
private enum class LineStatTone { MUTED, SENT, OUTSTANDING, AWAITING, SHORT }

@Composable
private fun lineStatColor(tone: LineStatTone): Color {
    val dark = isSystemInDarkTheme()
    return when (tone) {
        LineStatTone.MUTED -> MaterialTheme.colorScheme.onSurfaceVariant
        LineStatTone.SENT -> if (dark) Color(0xFF5EEAD4) else Color(0xFF0F766E)
        LineStatTone.OUTSTANDING -> if (dark) Color(0xFFFDBA74) else Color(0xFFB45309)
        LineStatTone.AWAITING -> if (dark) Color(0xFF93C5FD) else Color(0xFF1D4ED8)
        LineStatTone.SHORT -> MaterialTheme.colorScheme.error
    }
}

@Composable
private fun LineStatChip(label: String, tone: LineStatTone) {
    val color = lineStatColor(tone)
    Text(
        text = label,
        fontSize = 11.sp,
        fontWeight = FontWeight.Medium,
        color = color,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier
            .background(color.copy(alpha = 0.12f), RoundedCornerShape(8.dp))
            // One chip can never be wider than the card — FlowRow wraps but
            // does not clip an oversized child.
            .widthIn(max = 200.dp)
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

internal enum class OrderStep(val label: String) {
    START("Start this order"),
    RECORD_DELIVERY("Record delivery"),
    READY_FOR_DELIVERY("Mark ready for delivery"),
    CREATE_SHIPMENT("Create shipment"),
}

/** What the partner can do next, by status — the backend's own gates:
 *  ready-for-delivery only from Partial; a carrier shipment from
 *  Processing, Partial, Ready for Delivery or Shipped (shipment-guard). */
internal fun orderSteps(status: InventoryOrderStatus?): List<OrderStep> = when (status) {
    InventoryOrderStatus.PENDING -> listOf(OrderStep.START)
    InventoryOrderStatus.PROCESSING -> listOf(OrderStep.RECORD_DELIVERY, OrderStep.CREATE_SHIPMENT)
    InventoryOrderStatus.PARTIAL -> listOf(
        OrderStep.RECORD_DELIVERY,
        OrderStep.READY_FOR_DELIVERY,
        OrderStep.CREATE_SHIPMENT,
    )
    InventoryOrderStatus.READY_FOR_DELIVERY, InventoryOrderStatus.SHIPPED ->
        listOf(OrderStep.CREATE_SHIPMENT)
    else -> emptyList()
}

private fun nextStepHint(status: InventoryOrderStatus?): String = when (status) {
    InventoryOrderStatus.PENDING ->
        "Confirm you can supply this order — it moves to Processing and the team is notified."
    InventoryOrderStatus.PROCESSING ->
        "Record what you delivered — the quantities the team receives against stock — or book a carrier shipment to send the goods."
    InventoryOrderStatus.PARTIAL ->
        "Part of this order is recorded as delivered. Record the rest, mark it ready once the goods are packed, or book a carrier shipment."
    InventoryOrderStatus.READY_FOR_DELIVERY ->
        "The goods are packed. Book a carrier shipment to send them."
    InventoryOrderStatus.SHIPPED ->
        "This order has shipped. Book another carrier shipment if more goods still have to go."
    else -> ""
}

private fun shipmentStatusLabel(raw: String): String = when (raw) {
    "created" -> "Created"
    "pickup_scheduled" -> "Pickup scheduled"
    "picked_up" -> "Picked up"
    "in_transit" -> "In transit"
    "out_for_delivery" -> "Out for delivery"
    "delivered" -> "Delivered"
    "rto" -> "Returning to sender"
    "cancelled" -> "Cancelled"
    else -> raw.replace('_', ' ').replaceFirstChar { it.uppercase() }
}

/** The goods receipt — per-line delivered quantities (prefilled with what's
 *  outstanding), delivery date, tracking number and notes. Quantities are
 *  editable decimals: cloth is metres and kilograms, so whole-number
 *  steppers alone can't record what actually shipped (iOS parity — its
 *  sheet pairs the steppers with a .decimalPad text field). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun DeliveryReceiptSheet(
    order: PartnerInventoryOrder,
    onDismiss: () -> Unit,
    onRecorded: () -> Unit,
) {
    // The clamped numeric truth, plus the raw editable text per line.
    var quantities by remember(order.id) {
        mutableStateOf(
            order.orderLines.orEmpty().associate { it.id to it.outstanding }
        )
    }
    var quantityText by remember(order.id) {
        mutableStateOf(
            order.orderLines.orEmpty().associate { it.id to plainQuantity(it.outstanding) }
        )
    }

    /** Digits and a single dot, nothing else. */
    fun sanitize(raw: String): String {
        val filtered = raw.filter { it.isDigit() || it == '.' }
        val firstDot = filtered.indexOf('.')
        return if (firstDot >= 0) {
            filtered.take(firstDot + 1) + filtered.substring(firstDot + 1).replace(".", "")
        } else filtered
    }

    fun setLine(line: InventoryOrderLine, value: Double) {
        val next = value.coerceIn(0.0, line.outstanding)
        quantities = quantities + (line.id to next)
        quantityText = quantityText + (line.id to plainQuantity(next))
    }

    fun step(line: InventoryOrderLine, delta: Double) {
        setLine(line, (quantities[line.id] ?: 0.0) + delta)
    }

    var deliveryDateMillis by rememberSaveable { mutableStateOf(System.currentTimeMillis()) }
    var trackingNumber by rememberSaveable { mutableStateOf("") }
    var notes by rememberSaveable { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var sendError by remember { mutableStateOf<String?>(null) }
    var detailsExpanded by rememberSaveable { mutableStateOf(false) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    // Fewer than what's outstanding on any line is a partial delivery, and
    // (as on the web) the team needs a note saying why.
    val lines = order.orderLines.orEmpty()
    val isPartial = lines.any { line -> (quantities[line.id] ?: 0.0) < line.outstanding }
    val hasOutstanding = lines.any { it.outstanding > 0.0 }
    val totalOutstanding = lines.sumOf { it.outstanding }
    val totalEntered = lines.sumOf { quantities[it.id] ?: 0.0 }
    // The fast path is armed — every line carries its full outstanding.
    val everythingEntered = hasOutstanding && lines.all { (quantities[it.id] ?: 0.0) >= it.outstanding }

    // The live summary under the title — what this receipt records right now.
    val summary = when {
        everythingEntered -> "Full delivery — ${formatQuantity(totalEntered)} recorded against stock."
        totalEntered > 0.0 -> "Recording ${formatQuantity(totalEntered)} of ${formatQuantity(totalOutstanding)} outstanding."
        else -> "Enter each line, or tap \"Delivered everything\" below."
    }

    ModalBottomSheet(
        onDismissRequest = { if (!sending) onDismiss() },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .navigationBarsPadding()
                // The pinned action row rides above the keyboard instead of
                // being covered by it while a quantity field is focused.
                .imePadding(),
        ) {
            // Scrollable body — everything but the pinned actions.
            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text("Record delivery", fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                Text(
                    summary,
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                // The common case in one tap — fill every line with what's
                // outstanding. The steppers stay for partial deliveries.
                if (hasOutstanding) {
                    FilledTonalButton(
                        onClick = { lines.forEach { if (it.outstanding > 0.0) setLine(it, it.outstanding) } },
                        enabled = !everythingEntered,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(
                            imageVector = if (everythingEntered) Icons.Filled.CheckCircle else Icons.Filled.Done,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            if (everythingEntered) "Everything marked — full delivery"
                            else "Delivered everything",
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }

                if (lines.isNotEmpty()) {
                    Card(
                        shape = RoundedCornerShape(14.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(modifier = Modifier.padding(horizontal = 12.dp)) {
                            lines.forEachIndexed { index, line ->
                                if (index > 0) {
                                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                                }
                                Column(
                                    modifier = Modifier.padding(vertical = 12.dp),
                                    verticalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Text(
                                            line.displayName,
                                            fontWeight = FontWeight.Medium,
                                            maxLines = 2,
                                            overflow = TextOverflow.Ellipsis,
                                            modifier = Modifier.weight(1f),
                                        )
                                        Text(
                                            "of ${formatQuantity(line.quantity)}",
                                            fontSize = 12.sp,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            maxLines = 1,
                                        )
                                    }
                                    if (line.outstanding <= 0.0) {
                                        // Fully delivered line — nothing to type; keep it
                                        // visible so the partner sees it's accounted for.
                                        Text(
                                            "Nothing left to deliver — ${formatQuantity(line.quantity)} recorded in full.",
                                            fontSize = 12.sp,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    } else {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                                        ) {
                                            IconButton(onClick = { step(line, -1.0) }) {
                                                Icon(Icons.Filled.Remove, contentDescription = "Less")
                                            }
                                            OutlinedTextField(
                                                value = quantityText[line.id] ?: "",
                                                onValueChange = { raw ->
                                                    val clean = sanitize(raw)
                                                    quantityText = quantityText + (line.id to clean)
                                                    clean.toDoubleOrNull()?.let { parsed -> setLine(line, parsed) }
                                                },
                                                label = { Text("Delivered") },
                                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                                singleLine = true,
                                                modifier = Modifier.weight(1f),
                                            )
                                            IconButton(onClick = { step(line, 1.0) }) {
                                                Icon(Icons.Filled.Add, contentDescription = "More")
                                            }
                                        }
                                        // Its own line, not inside the stepper row — on a
                                        // narrow screen "already sent 1,234.56" could push
                                        // the field past the edge.
                                        if (line.fulfilled > 0) {
                                            Text(
                                                "Already sent ${formatQuantity(line.fulfilled)} — this entry is on top.",
                                                fontSize = 11.sp,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Partial nudge — always visible while a partial is entered.
                if (isPartial) {
                    Text(
                        "Partial delivery — add a note in Delivery details.",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.error,
                    )
                }

                // Delivery details — collapsed by default: a full delivery is
                // quantities + Submit, nothing more.
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { detailsExpanded = !detailsExpanded },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Delivery details",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.weight(1f),
                    )
                    if (isPartial && notes.isBlank()) {
                        Text(
                            "note required",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.error,
                        )
                        Spacer(Modifier.width(8.dp))
                    }
                    Icon(
                        imageVector = if (detailsExpanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                        contentDescription = if (detailsExpanded) "Collapse" else "Expand",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (detailsExpanded) {
                    Text(
                        "Leave a line at 0 to deliver it later.",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    // Delivery date — a compact prev/next-day stepper keeps
                    // the sheet dependency-free.
                    Text(
                        "Delivery date",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        IconButton(onClick = { deliveryDateMillis -= 86_400_000L }) {
                            Icon(Icons.Filled.Remove, contentDescription = "Earlier")
                        }
                        Text(
                            SimpleDateFormat("MMM d, yyyy", Locale.US).format(Date(deliveryDateMillis)),
                            fontWeight = FontWeight.Medium,
                        )
                        IconButton(onClick = { deliveryDateMillis += 86_400_000L }) {
                            Icon(Icons.Filled.Add, contentDescription = "Later")
                        }
                    }
                    OutlinedTextField(
                        value = trackingNumber,
                        onValueChange = { trackingNumber = it },
                        label = { Text("Tracking number (optional)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = notes,
                        onValueChange = { notes = it },
                        label = {
                            Text(
                                if (isPartial) "Why is this a partial delivery? (required)"
                                else "Anything the team should know (optional)"
                            )
                        },
                        isError = isPartial && notes.isBlank(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (sendError != null) {
                    Text(sendError ?: "", fontSize = 12.sp, color = MaterialTheme.colorScheme.error)
                }
            }

            // Pinned actions — always visible at the bottom, above the
            // keyboard, no matter how many lines scroll past.
            Spacer(Modifier.height(12.dp))
            if (sending) {
                Box(
                    Modifier.fillMaxWidth().padding(vertical = 8.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(Modifier.size(24.dp))
                }
            } else {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 20.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    OutlinedButton(
                        onClick = { onDismiss() },
                        modifier = Modifier.weight(1f),
                    ) { Text("Cancel") }
                    Button(
                        onClick = {
                            val entries = order.orderLines.orEmpty().mapNotNull { line ->
                                val quantity = quantities[line.id] ?: 0.0
                                // Backend validator: quantity must be > 0.
                                if (quantity <= 0.0) null
                                else CompleteInventoryOrderBody.Line(line.id, quantity)
                            }
                            if (entries.isEmpty()) {
                                sendError = "Record at least one line's delivered quantity."
                                return@Button
                            }
                            if (isPartial && notes.isBlank()) {
                                // Bring the note field into view instead of
                                // making the partner hunt for it.
                                detailsExpanded = true
                                sendError = "Add a note when delivering less than what's outstanding."
                                return@Button
                            }
                            sending = true
                            scope.launch {
                                try {
                                    PartnerApi.get(context).completeInventoryOrder(
                                        id = order.id,
                                        body = CompleteInventoryOrderBody(
                                            notes = notes.takeIf { it.isNotBlank() },
                                            deliveryDate = SimpleDateFormat("yyyy-MM-dd", Locale.US)
                                                .format(Date(deliveryDateMillis)),
                                            trackingNumber = trackingNumber.takeIf { it.isNotBlank() },
                                            lines = entries,
                                        ),
                                    )
                                    onRecorded()
                                } catch (e: Exception) {
                                    sendError = e.message ?: "Couldn't record the delivery."
                                }
                                sending = false
                            }
                        },
                        modifier = Modifier.weight(1f),
                    ) { Text("Submit", fontWeight = FontWeight.SemiBold) }
                }
            }
        }
    }
}

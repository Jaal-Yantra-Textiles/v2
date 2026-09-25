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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Checkroom
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.derivedStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jyt.partner.api.PartnerApi
import com.jyt.partner.models.ApiDate
import com.jyt.partner.models.formatDate
import com.jyt.partner.models.PartnerOrder
import com.jyt.partner.models.WorkStatus
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.util.Currency

/** Currency in the order's own currency — Medusa v2 stores prices in major
 *  units, so the raw value formats directly. */
fun formatCurrency(amount: Double, code: String?): String {
    val format = NumberFormat.getCurrencyInstance() as java.text.DecimalFormat
    val currency = runCatching { Currency.getInstance((code ?: "inr").uppercase()) }.getOrNull()
    if (currency != null) format.currency = currency
    return format.format(amount)
}

fun formatQuantity(value: Double): String {
    val format = NumberFormat.getNumberInstance()
    format.maximumFractionDigits = 2
    return format.format(value)
}

/** The design work-orders list — the DesignOrdersView counterpart: design
 *  picture + name lead, order #, total, date, work-status badge; search,
 *  20-at-a-time pagination, pull-to-refresh. */
@Composable
fun OrdersScreen(onOpenOrder: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var orders by remember { mutableStateOf<List<PartnerOrder>>(emptyList()) }
    var search by rememberSaveable { mutableStateOf("") }
    var initialLoading by remember { mutableStateOf(true) }
    var appending by remember { mutableStateOf(false) }
    var nextPageOffset by remember { mutableStateOf<Int?>(null) }
    var errorText by remember { mutableStateOf<String?>(null) }
    // Monotonic request sequence — a slower, older response must never
    // overwrite a newer one's results.
    var requestSeq by remember { mutableStateOf(0) }

    suspend fun load(reset: Boolean) {
        val seq = ++requestSeq
        if (reset) initialLoading = orders.isEmpty() else appending = true
        val offset = if (reset) 0 else orders.size
        try {
            val page = PartnerApi.get(context).orders(
                kind = "design",
                limit = 20,
                offset = offset,
                query = search.takeIf { it.isNotBlank() },
            )
            if (seq != requestSeq) return // superseded by a newer request
            orders = if (reset) page.orders else orders + page.orders
            val next = page.offset + page.limit
            nextPageOffset = if (next < page.count) next else null
            errorText = null
        } catch (e: Exception) {
            if (orders.isEmpty() && seq == requestSeq) {
                errorText = e.message ?: "Something went wrong."
            }
        }
        if (seq == requestSeq) {
            initialLoading = false
            appending = false
        }
    }

    // One effect for the initial load AND debounced search — the empty
    // initial search loads immediately; typing settles for 350ms first.
    LaunchedEffect(search) {
        if (search.isNotEmpty()) delay(350)
        load(reset = true)
    }

    val listState = rememberLazyListState()
    val shouldLoadNext by remember {
        derivedStateOf {
            val info = listState.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull()?.index ?: 0
            info.totalItemsCount > 0 && last >= info.totalItemsCount - 4
        }
    }
    // Re-fires when a page lands (nextPageOffset moves) so a list that is
    // still within the load window keeps paginating without a nudge.
    LaunchedEffect(shouldLoadNext, nextPageOffset) {
        if (shouldLoadNext && nextPageOffset != null && !appending) {
            load(reset = false)
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = search,
            onValueChange = { search = it },
            placeholder = { Text("Search orders…") },
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
            singleLine = true,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
        )
        Box(modifier = Modifier.fillMaxSize()) {
            when {
                errorText != null && orders.isEmpty() -> ErrorState(
                    title = "Couldn't load design orders",
                    message = errorText ?: "",
                ) {
                    scope.launch { load(reset = true) }
                }
                orders.isEmpty() && initialLoading -> Box(Modifier.fillMaxSize()) {
                    CircularProgressIndicator(Modifier.align(Alignment.Center))
                }
                orders.isEmpty() -> EmptyState(
                    icon = Icons.Filled.Checkroom,
                    title = "No design orders",
                    subtitle = "Work you're commissioned for will show up here.",
                )
                else -> LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(orders, key = { it.id }) { order ->
                        OrderRow(order = order, onClick = { onOpenOrder(order.id) })
                    }
                    if (appending) {
                        item("pagination-footer") {
                            Box(
                                Modifier
                                    .fillMaxWidth()
                                    .padding(16.dp),
                            ) {
                                CircularProgressIndicator(
                                    Modifier
                                        .align(Alignment.Center)
                                        .size(28.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ErrorState(title: String, message: String, retry: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            Icons.Filled.Warning,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.error,
            modifier = Modifier.size(48.dp),
        )
        Spacer(Modifier.height(10.dp))
        Text(title, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(6.dp))
        Text(message, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(10.dp))
        Button(onClick = retry) { Text("Retry") }
    }
}

@Composable
private fun OrderRow(order: PartnerOrder, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 5.dp),
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.Top,
        ) {
            val first = order.designs?.firstOrNull()
            DesignThumb(name = first?.name, thumbnail = first?.thumbnail, size = 44)
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = first?.name ?: "Design order",
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    Spacer(Modifier.weight(1f))
                    order.workStatus?.let { WorkStatusBadge(it) }
                }
                order.designs?.drop(1)?.takeIf { it.isNotEmpty() }?.let { extra ->
                    Text(
                        "+${extra.size} more design${if (extra.size > 1) "s" else ""}",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                    StatPair("Order", "#${order.displayId}")
                    StatPair("Total", formatCurrency(order.total, order.currencyCode))
                    Spacer(Modifier.weight(1f))
                    StatPair(
                        "Created",
                        formatDate(ApiDate.parse(order.createdAt)),
                        alignEnd = true,
                    )
                }
            }
        }
    }
}

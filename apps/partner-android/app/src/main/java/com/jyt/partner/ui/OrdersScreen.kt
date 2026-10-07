package com.jyt.partner.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.material3.FilterChip
import androidx.compose.ui.layout.ContentScale
import coil.compose.AsyncImage
import com.jyt.partner.models.OrderFilter
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
 *  status chips, and the ongoing work as big cards on top. The list cannot
 *  be filtered by work status server-side, so every page is loaded (a
 *  partner has tens of orders, not thousands) and narrowed in memory. */
@Composable
fun OrdersScreen(onOpenOrder: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var orders by remember { mutableStateOf<List<PartnerOrder>>(emptyList()) }
    var search by rememberSaveable { mutableStateOf("") }
    var filter by rememberSaveable { mutableStateOf(OrderFilter.ALL) }
    var initialLoading by remember { mutableStateOf(true) }
    var appending by remember { mutableStateOf(false) }
    var errorText by remember { mutableStateOf<String?>(null) }
    // Monotonic request sequence — a slower, older response must never
    // overwrite a newer one's results.
    var requestSeq by remember { mutableStateOf(0) }

    suspend fun load() {
        val seq = ++requestSeq
        initialLoading = orders.isEmpty()
        var loaded = emptyList<PartnerOrder>()
        try {
            while (true) {
                val page = PartnerApi.get(context).orders(
                    kind = "design",
                    limit = PAGE_SIZE,
                    offset = loaded.size,
                    query = search.takeIf { it.isNotBlank() },
                )
                if (seq != requestSeq) return // superseded by a newer request
                loaded = loaded + page.orders
                // First page shows at once; the rest stream in behind it.
                orders = loaded
                initialLoading = false
                errorText = null
                if (page.orders.isEmpty() || loaded.size >= page.count || loaded.size >= MAX_ORDERS) break
                appending = true
            }
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
        load()
    }

    val counts = remember(orders) { OrderFilter.counts(orders) }
    val ongoing = remember(orders) { orders.filter { OrderFilter.ONGOING.matches(it.workStatus) } }
    // Under "All" the ongoing work leads as cards, so the list below skips it.
    val showOngoingCards = filter == OrderFilter.ALL && ongoing.isNotEmpty()
    val rows = remember(orders, filter) {
        if (filter == OrderFilter.ALL) orders.filterNot { OrderFilter.ONGOING.matches(it.workStatus) }
        else orders.filter { filter.matches(it.workStatus) }
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
        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(OrderFilter.entries, key = { it.name }) { f ->
                val n = counts[f] ?: 0
                FilterChip(
                    selected = f == filter,
                    onClick = { filter = f },
                    label = { Text(if (orders.isEmpty()) f.label else "${f.label} $n") },
                )
            }
        }
        Box(modifier = Modifier.fillMaxSize()) {
            when {
                errorText != null && orders.isEmpty() -> ErrorState(
                    title = "Couldn't load design orders",
                    message = errorText ?: "",
                ) {
                    scope.launch { load() }
                }
                orders.isEmpty() && initialLoading -> Box(Modifier.fillMaxSize()) {
                    CircularProgressIndicator(Modifier.align(Alignment.Center))
                }
                orders.isEmpty() -> EmptyState(
                    icon = Icons.Filled.Checkroom,
                    title = "No design orders",
                    subtitle = "Work you're commissioned for will show up here.",
                )
                rows.isEmpty() && !showOngoingCards && !appending -> EmptyState(
                    icon = Icons.Filled.Checkroom,
                    title = "No ${filter.label.lowercase()} orders",
                    subtitle = "Pick another filter to see the rest.",
                )
                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(bottom = 12.dp),
                ) {
                    if (showOngoingCards) {
                        item("ongoing-header") { SectionHeader("Ongoing · ${ongoing.size}") }
                        item("ongoing-cards") {
                            LazyRow(
                                contentPadding = PaddingValues(horizontal = 16.dp),
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                items(ongoing, key = { it.id }) { order ->
                                    OngoingCard(order = order, onClick = { onOpenOrder(order.id) })
                                }
                            }
                        }
                        if (rows.isNotEmpty()) item("rest-header") { SectionHeader("Other orders") }
                    }
                    items(rows, key = { it.id }) { order ->
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

private const val PAGE_SIZE = 50
// A runaway guard, far above any partner's real order count.
private const val MAX_ORDERS = 1000

@Composable
private fun SectionHeader(text: String) {
    Text(
        text = text,
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 6.dp),
    )
}

/** A big card for work in hand: the design picture leads. */
@Composable
private fun OngoingCard(order: PartnerOrder, onClick: () -> Unit) {
    val first = order.designs?.firstOrNull()
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.width(220.dp),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(150.dp)
                .background(MaterialTheme.colorScheme.surfaceVariant),
            contentAlignment = Alignment.Center,
        ) {
            val url = first?.thumbnail?.takeIf { it.isNotBlank() }
            if (url != null) {
                AsyncImage(
                    model = url,
                    contentDescription = first.name,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            } else {
                Icon(
                    Icons.Filled.Checkroom,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                text = first?.name ?: "Design order",
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "#${order.displayId}",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.weight(1f))
                order.workStatus?.let { WorkStatusBadge(it) }
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

package com.jyt.partner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
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
import com.jyt.partner.models.InventoryOrderStatus
import com.jyt.partner.models.PartnerInventoryOrder
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The inventory orders list — the InventoryOrdersView counterpart: the
 *  raw-material purchases the partner is commissioned for. Status filter,
 *  search, 20-at-a-time pagination. */
@Composable
fun InventoryOrdersScreen(onOpenOrder: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var orders by remember { mutableStateOf<List<PartnerInventoryOrder>>(emptyList()) }
    var search by rememberSaveable { mutableStateOf("") }
    var statusFilter by remember { mutableStateOf<InventoryOrderStatus?>(null) }
    var initialLoading by remember { mutableStateOf(true) }
    var appending by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
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
            val page = PartnerApi.get(context).inventoryOrders(
                limit = 20,
                offset = offset,
                status = statusFilter?.raw,
                query = search.takeIf { it.isNotBlank() },
            )
            if (seq != requestSeq) return // superseded by a newer request
            orders = if (reset) page.inventoryOrders else orders + page.inventoryOrders
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

    // One effect for the initial load, debounced search and filter changes.
    LaunchedEffect(search, statusFilter) {
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
        InventoryOrderFilters(
            search = search,
            onSearchChange = { search = it },
            statusFilter = statusFilter,
            onStatusChange = { statusFilter = it },
        )

        Refreshable(
            refreshing = refreshing,
            onRefresh = {
                scope.launch {
                    refreshing = true
                    load(reset = true)
                    refreshing = false
                }
            },
        ) {
            when {
                errorText != null && orders.isEmpty() -> ErrorState(
                    title = "Couldn't load inventory orders",
                    message = errorText ?: "",
                ) {
                    scope.launch { load(reset = true) }
                }
                orders.isEmpty() && initialLoading -> ListSkeleton(thumb = false)
                orders.isEmpty() -> EmptyState(
                    icon = Icons.Filled.Inventory2,
                    title = "No inventory orders",
                    subtitle = "Raw material you're commissioned to supply shows up here.",
                )
                else -> LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(orders, key = { it.id }) { order ->
                        InventoryOrderRow(order = order, onClick = { onOpenOrder(order.id) })
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

/** The search field and the status filter chips — the web's visible filter
 *  UI, extracted so the screenshot harness can show the real chrome above
 *  canned rows. */
@Composable
internal fun InventoryOrderFilters(
    search: String,
    onSearchChange: (String) -> Unit,
    statusFilter: InventoryOrderStatus?,
    onStatusChange: (InventoryOrderStatus?) -> Unit,
) {
    OutlinedTextField(
        value = search,
        onValueChange = onSearchChange,
        placeholder = { Text("Search orders…") },
        leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
        singleLine = true,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
    )

    // Status filter chips — horizontally scrollable when the statuses
    // don't all fit.
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 16.dp)
            .padding(bottom = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        StatusFilterChip("All", selected = statusFilter == null) {
            onStatusChange(null)
        }
        InventoryOrderStatus.entries.forEach { status ->
            StatusFilterChip(status.raw, selected = statusFilter == status) {
                onStatusChange(status)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun InventoryOrderRow(order: PartnerInventoryOrder, onClick: () -> Unit) {
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
                    text = order.id,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Spacer(Modifier.weight(1f))
                order.statusEnum?.let { InventoryOrderStatusBadge(it) }
            }
            // Weighted columns bound each stat's width, so a big quantity or
            // amount ellipsizes instead of pushing "Created" off the card.
            Row {
                order.quantity?.let {
                    StatPair(
                        "Goods",
                        formatQuantity(it),
                        modifier = Modifier.weight(1f, fill = false),
                    )
                }
                order.totalPrice?.let {
                    StatPair(
                        "Total",
                        formatCurrency(it, order.currencyCode),
                        modifier = Modifier.weight(1f, fill = false),
                    )
                }
                StatPair(
                    "Created",
                    formatDate(ApiDate.parse(order.createdAt)),
                    modifier = Modifier.weight(1f, fill = false),
                    alignEnd = true,
                )
            }
            // The goods as wrapping chips — up to three names, then a "+N
            // more" chip — so a line list reads at a glance instead of one
            // dot-joined string that clips.
            order.orderLines?.takeIf { it.isNotEmpty() }?.let { lines ->
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    lines.take(3).forEach { line ->
                        ItemChip(line.displayName)
                    }
                    val remaining = lines.size - 3
                    if (remaining > 0) {
                        ItemChip("+$remaining more")
                    }
                }
            }
            if (order.isSample == true) {
                Text(
                    text = "Sample order",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}

/** A single goods line name on a list row — quiet chip, one line, capped
 *  width so a long material name can't crowd out the rest of the row. */
@Composable
private fun ItemChip(label: String) {
    Text(
        text = label,
        fontSize = 11.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier
            .background(
                MaterialTheme.colorScheme.surfaceVariant,
                RoundedCornerShape(8.dp),
            )
            .widthIn(max = 180.dp)
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

/** One status filter chip — the selected one is filled ink (the badge's
 *  ACTION tone), so the active filter reads at a glance. */
@Composable
private fun StatusFilterChip(label: String, selected: Boolean, onClick: () -> Unit) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = { Text(label, fontSize = 12.sp) },
        colors = FilterChipDefaults.filterChipColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
            labelColor = MaterialTheme.colorScheme.onSurfaceVariant,
            selectedContainerColor = MaterialTheme.colorScheme.onSurface,
            selectedLabelColor = MaterialTheme.colorScheme.surface,
        ),
    )
}

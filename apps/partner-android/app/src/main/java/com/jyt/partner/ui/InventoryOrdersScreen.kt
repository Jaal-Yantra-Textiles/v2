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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
    var filterMenuOpen by remember { mutableStateOf(false) }
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
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = search,
                onValueChange = { search = it },
                placeholder = { Text("Search orders…") },
                leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                singleLine = true,
                modifier = Modifier.weight(1f),
            )
            Box {
                IconButton(onClick = { filterMenuOpen = true }) {
                    Icon(
                        imageVector = if (statusFilter == null) {
                            Icons.Filled.Inventory2
                        } else {
                            Icons.Filled.Inventory2
                        },
                        contentDescription = "Filter by status",
                        tint = if (statusFilter == null) {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        } else {
                            MaterialTheme.colorScheme.primary
                        },
                    )
                }
                DropdownMenu(
                    expanded = filterMenuOpen,
                    onDismissRequest = { filterMenuOpen = false },
                ) {
                    DropdownMenuItem(
                        text = { Text("All statuses") },
                        onClick = {
                            statusFilter = null
                            filterMenuOpen = false
                        },
                    )
                    InventoryOrderStatus.entries.forEach { status ->
                        DropdownMenuItem(
                            text = { Text(status.raw) },
                            onClick = {
                                statusFilter = status
                                filterMenuOpen = false
                            },
                        )
                    }
                }
            }
        }

        Box(modifier = Modifier.fillMaxSize()) {
            when {
                errorText != null && orders.isEmpty() -> ErrorState(
                    title = "Couldn't load inventory orders",
                    message = errorText ?: "",
                ) {
                    scope.launch { load(reset = true) }
                }
                orders.isEmpty() && initialLoading -> Box(Modifier.fillMaxSize()) {
                    CircularProgressIndicator(Modifier.align(Alignment.Center))
                }
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

@Composable
private fun InventoryOrderRow(order: PartnerInventoryOrder, onClick: () -> Unit) {
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
            Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                order.quantity?.let { StatPair("Goods", formatQuantity(it)) }
                order.totalPrice?.let { StatPair("Total", formatCurrency(it, order.currencyCode)) }
                Spacer(Modifier.weight(1f))
                StatPair(
                    "Created",
                    formatDate(ApiDate.parse(order.createdAt)),
                    alignEnd = true,
                )
            }
            order.orderLines?.takeIf { it.isNotEmpty() }?.let { lines ->
                Text(
                    text = lines.joinToString(" · ") { it.displayName },
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (order.isSample == true) {
                Text(
                    text = "Sample order",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                    color = androidx.compose.ui.graphics.Color(0xFF00897B),
                )
            }
        }
    }
}

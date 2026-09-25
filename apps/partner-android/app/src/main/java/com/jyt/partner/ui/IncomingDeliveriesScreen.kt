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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jyt.partner.api.PartnerApi
import com.jyt.partner.models.ApiDate
import com.jyt.partner.models.formatDate
import com.jyt.partner.models.IncomingDelivery
import kotlinx.coroutines.launch

/** #2286 — goods delivered TO this partner's warehouse, whoever supplies
 *  them. The receiving partner's side of the inventory orders: each line
 *  shows what was ordered, received and still outstanding — no prices. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun IncomingDeliveriesScreen(onBack: () -> Unit, onOpenDelivery: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var deliveries by remember { mutableStateOf<List<IncomingDelivery>>(emptyList()) }
    var locationId by remember { mutableStateOf<String?>(null) }
    var includeAll by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var errorText by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        loading = deliveries.isEmpty()
        try {
            val response = PartnerApi.get(context).incomingDeliveries(all = includeAll)
            deliveries = response.incomingDeliveries
            locationId = response.locationId
            errorText = null
        } catch (e: Exception) {
            if (deliveries.isEmpty()) errorText = e.message ?: "Something went wrong."
        }
        loading = false
    }

    LaunchedEffect(includeAll) { load() }

    Column(modifier = Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text("Incoming deliveries") },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                }
            },
        )

        if (errorText != null) {
            Box(Modifier.fillMaxSize()) {
                ErrorState("Couldn't load deliveries", errorText ?: "") { scope.launch { load() } }
            }
        } else if (loading) {
            Box(Modifier.fillMaxSize()) {
                CircularProgressIndicator(Modifier.align(Alignment.Center))
            }
        } else if (locationId == null) {
            Box(Modifier.fillMaxSize()) {
                EmptyState(
                    icon = Icons.Filled.Warning,
                    title = "No warehouse is set up",
                    subtitle = "Contact the JYT team to link your warehouse — goods delivered to you will show up here.",
                )
            }
        } else {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 2.dp),
            ) {
                Checkbox(checked = includeAll, onCheckedChange = { includeAll = it })
                Text(
                    "Include fully received",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (deliveries.isEmpty()) {
                Box(Modifier.fillMaxSize()) {
                    EmptyState(
                        icon = Icons.Filled.Warning,
                        title = if (includeAll) "No deliveries" else "Nothing outstanding",
                        subtitle = "Goods sent to your warehouse show up here.",
                    )
                }
            } else {
                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    items(deliveries, key = { it.id }) { delivery ->
                        IncomingDeliveryRow(delivery) { onOpenDelivery(delivery.id) }
                    }
                }
            }
        }
    }
}

@Composable
private fun IncomingDeliveryRow(delivery: IncomingDelivery, onClick: () -> Unit) {
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
                    text = delivery.from ?: "Order",
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Spacer(Modifier.weight(1f))
                delivery.statusEnum?.let { InventoryOrderStatusBadge(it) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                StatPair("Outstanding", formatQuantity(delivery.outstanding))
                delivery.expectedDeliveryDate?.let {
                    StatPair("Expected", formatDate(ApiDate.parse(it)), alignEnd = true)
                }
            }
            delivery.lines.takeIf { it.isNotEmpty() }?.let { lines ->
                Text(
                    text = lines.joinToString(" · ") { it.name ?: "Material" },
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (delivery.isSample == true) {
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

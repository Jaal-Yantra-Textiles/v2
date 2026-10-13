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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
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
import com.jyt.partner.models.PartnerDesignRow
import com.jyt.partner.models.designSearchQuery
import com.jyt.partner.models.designStatusLabel
import com.jyt.partner.models.displayThumbnail
import com.jyt.partner.models.formatDate
import com.jyt.partner.models.partnerStatus
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The Designs tab (#2402): every design the partner can see — picture,
 *  name, where their work stands — with a search box and 20-at-a-time
 *  pagination. Search runs on the server (`q`), over the whole set. */
@Composable
fun DesignsScreen(onOpenDesign: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var designs by remember { mutableStateOf<List<PartnerDesignRow>>(emptyList()) }
    var search by rememberSaveable { mutableStateOf("") }
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
        if (reset) initialLoading = designs.isEmpty() else appending = true
        val offset = if (reset) 0 else designs.size
        try {
            val page = PartnerApi.get(context).designs(
                limit = 20,
                offset = offset,
                query = designSearchQuery(search),
            )
            if (seq != requestSeq) return // superseded by a newer request
            designs = if (reset) page.designs else designs + page.designs
            val next = page.offset + page.limit
            nextPageOffset = if (next < page.count) next else null
            errorText = null
        } catch (e: Exception) {
            if (designs.isEmpty() && seq == requestSeq) {
                errorText = e.message ?: "Something went wrong."
            }
        }
        if (seq == requestSeq) {
            initialLoading = false
            appending = false
        }
    }

    // One effect for the initial load and debounced search changes.
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
            placeholder = { Text("Search designs…") },
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
            singleLine = true,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
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
                errorText != null && designs.isEmpty() -> ErrorState(
                    title = "Couldn't load designs",
                    message = errorText ?: "",
                ) {
                    scope.launch { load(reset = true) }
                }
                designs.isEmpty() && initialLoading -> ListSkeleton()
                designs.isEmpty() && designSearchQuery(search) != null -> EmptyState(
                    icon = Icons.Filled.Search,
                    title = "No matching designs",
                    subtitle = "Try a different name.",
                )
                designs.isEmpty() -> EmptyState(
                    icon = Icons.Filled.Palette,
                    title = "No designs yet",
                    subtitle = "Designs shared with you or made by you show up here.",
                )
                else -> LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(designs, key = { it.id }) { design ->
                        DesignRow(design = design, onClick = { onOpenDesign(design.id) })
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
private fun DesignRow(design: PartnerDesignRow, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 5.dp),
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            DesignThumb(name = design.name, thumbnail = design.displayThumbnail, size = 52)
            Spacer(Modifier.width(12.dp))
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = design.name?.takeIf { it.isNotBlank() } ?: "Untitled design",
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    Spacer(Modifier.weight(1f))
                    design.partnerStatus?.let { DesignWorkBadge(it) }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    designStatusLabel(design.status)?.let {
                        Text(
                            text = it,
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    Text(
                        text = formatDate(ApiDate.parse(design.createdAt)),
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

/** The partner's own status on the design, in the shared badge tones. */
@Composable
private fun DesignWorkBadge(status: String) {
    val tone = when (status) {
        "incoming", "assigned" -> BadgeTone.ACTION
        "finished", "completed" -> BadgeTone.DONE
        "cancelled" -> BadgeTone.MUTED
        else -> BadgeTone.ACTIVE
    }
    StatusBadge(designStatusLabel(status) ?: status, tone)
}
